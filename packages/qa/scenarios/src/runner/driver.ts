// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The agent driver: the one seam between the runner and the model.
 *
 * The cost ruling on cloud#3600 (「目前阶段尽量不要用云端的token，api的更贵」)
 * fixes what may sit behind it: a LOCAL Claude Code session on the developer's
 * own login, never an API-billed model and never a cloud agent. So there are
 * exactly two drivers, and neither calls a model API itself:
 *
 *   - {@link ClaudeCodeDriver} spawns the `claude` CLI in headless mode
 *     (`claude -p … --output-format stream-json`). It REFUSES to start when the
 *     process would bill an API key — `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`
 *     in the environment, or a CLI whose `auth status` reports an API-key login —
 *     and strips both variables from every child it spawns.
 *   - {@link RecordedDriver} replays turns recorded earlier, so the runner's
 *     own tests (and a re-grade of an old run) need no model and no network.
 *
 * {@link RecordingDriver} wraps a live driver and writes every turn it sees to
 * a recording the replay driver reads back.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { parseStreamJson, type ParsedTurn } from './transcript.js';

/** Which run step a turn belongs to; the replay key is built from it. */
export interface StepRef {
  card: string;
  /** `scratch` (from nothing) or `template` (from a verified build installed unmanaged). */
  mode: 'scratch' | 'template';
  /** `build`, `iterate`, `run` (the first Run half) or `iterate-run` (the Run half after the iterate). */
  phase: 'build' | 'iterate' | 'run' | 'iterate-run';
  /** A question or operation id; `author` for an authoring turn. */
  step: string;
  persona?: string;
}

export const stepKey = (s: StepRef): string => [s.card, s.mode, s.phase, s.step, s.persona ?? '-'].join('/');

export interface AuthorTask extends StepRef {
  /** The project directory the agent edits. */
  cwd: string;
  prompt: string;
}

export interface AskTask extends StepRef {
  prompt: string;
  /** The booted app's MCP endpoint and the persona's API key. */
  mcp: { url: string; apiKey: string };
}

export interface AuthorResult {
  turn: ParsedTurn;
  /** Files the replay driver writes back (relative path → content); a live run records what changed. */
  files?: Record<string, string>;
}

export interface DriverInfo {
  /** `claude-code-cli` or `recorded`. */
  driver: string;
  /** The CLI version, or the recording's path. */
  version?: string;
  /** How the CLI is logged in (`claude auth status`), e.g. `oauth_token`; never a secret. */
  authMethod?: string;
  /** Always `false`: no driver here bills an API key; the record states it. */
  apiBilled: false;
}

export interface AgentDriver {
  info(): DriverInfo;
  author(task: AuthorTask): Promise<AuthorResult>;
  ask(task: AskTask): Promise<ParsedTurn>;
}

// ── The live driver: the local `claude` CLI ─────────────────────────────────

/** Environment variables that would make the CLI bill an API key instead of the login. */
export const API_BILLING_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const;

// The cost ruling recorded on objectstack-ai/cloud#3600; the message below carries its substance, not its id.
export class ApiBillingRefusedError extends Error {
  constructor(reason: string) {
    super(
      `the scenario runner drives a local Claude Code login only, never an API-billed model: ${reason}. ` +
        'Unset it and run `claude auth login` with your subscription.',
    );
    this.name = 'ApiBillingRefusedError';
  }
}

/** The child environment: the caller's, with every API-billing variable removed. */
export function subscriptionOnlyEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const k of API_BILLING_ENV) delete out[k];
  return out;
}

/** Refuse an API-billed configuration; answer the login method otherwise. Pure over its inputs. */
export function assertSubscriptionLogin(env: NodeJS.ProcessEnv, authStatus: unknown): string {
  for (const k of API_BILLING_ENV) {
    if (env[k] !== undefined && env[k] !== '') throw new ApiBillingRefusedError(`\`${k}\` is set`);
  }
  const s = (typeof authStatus === 'object' && authStatus !== null ? authStatus : {}) as Record<string, unknown>;
  if (s.loggedIn !== true) throw new ApiBillingRefusedError('`claude auth status` reports no login');
  const method = typeof s.authMethod === 'string' ? s.authMethod : 'unknown';
  if (/api[_-]?key/i.test(method)) throw new ApiBillingRefusedError(`\`claude auth status\` reports an API-key login (${method})`);
  return method;
}

export interface ClaudeCodeDriverOptions {
  /** The CLI binary; default `claude`. */
  bin?: string;
  /** Agentic turns allowed for one question or operation; default 12. */
  maxTurnsAsk?: number;
  /** Agentic turns allowed for one authoring task; default 80. */
  maxTurnsAuthor?: number;
  /** Wall-clock budget per call, ms; default 15 min for authoring, 5 min for a question. */
  authorTimeoutMs?: number;
  askTimeoutMs?: number;
  /** Optional model alias passed as `--model` (the login's default otherwise). */
  model?: string;
}

interface CliRun {
  stdout: string;
  stderr: string;
  exit: number | null;
}

function runCli(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<CliRun> {
  return new Promise((resolvePromise) => {
    const child = spawn(bin, args, { cwd, env: subscriptionOnlyEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', (exit) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, exit });
    });
  });
}

/** Every file under `dir` (skipping dependency and build trees) → content, for the author recording. */
export function snapshotSources(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const skip = new Set(['node_modules', 'dist', '.git', '.objectstack', '.claude']);
  const walk = (d: string) => {
    for (const ent of readdirSafe(d)) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) {
        if (!skip.has(ent.name)) walk(p);
      } else if (ent.isFile() && /\.(ts|json|md|mts)$/.test(ent.name)) {
        out[relative(dir, p).split(sep).join('/')] = readFileSync(p, 'utf8');
      }
    }
  };
  walk(dir);
  return out;
}

function readdirSafe(d: string) {
  try {
    return readdirSync(d, { withFileTypes: true });
  } catch {
    return [];
  }
}

export class ClaudeCodeDriver implements AgentDriver {
  private readonly bin: string;
  private readonly opts: ClaudeCodeDriverOptions;
  private readonly version: string;
  private readonly authMethod: string;

  constructor(opts: ClaudeCodeDriverOptions = {}) {
    this.opts = opts;
    this.bin = opts.bin ?? 'claude';
    const ver = spawnSync(this.bin, ['--version'], { encoding: 'utf8', env: subscriptionOnlyEnv() });
    if (ver.status !== 0) throw new Error(`\`${this.bin} --version\` failed: is Claude Code installed? ${ver.stderr ?? ''}`.trim());
    this.version = ver.stdout.trim();
    // Judged on the CALLER's environment: a key set there is a configuration
    // error worth stopping on even though every child is spawned without it.
    const status = spawnSync(this.bin, ['auth', 'status'], { encoding: 'utf8', env: subscriptionOnlyEnv() });
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(status.stdout);
    } catch {
      /* refused below as "no login" */
    }
    this.authMethod = assertSubscriptionLogin(process.env, parsed);
  }

  info(): DriverInfo {
    return { driver: 'claude-code-cli', version: this.version, authMethod: this.authMethod, apiBilled: false };
  }

  private base(maxTurns: number): string[] {
    const a = ['--output-format', 'stream-json', '--verbose', '--max-turns', String(maxTurns)];
    if (this.opts.model) a.push('--model', this.opts.model);
    return a;
  }

  async author(task: AuthorTask): Promise<AuthorResult> {
    const empty = join(mkdtempSync(join(tmpdir(), 'scenario-mcp-')), 'none.json');
    writeFileSync(empty, JSON.stringify({ mcpServers: {} }));
    try {
      const args = [
        '-p', task.prompt,
        ...this.base(this.opts.maxTurnsAuthor ?? 80),
        '--mcp-config', empty, '--strict-mcp-config',
        '--permission-mode', 'acceptEdits',
        '--allowedTools', 'Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill',
      ];
      const run = await runCli(this.bin, args, task.cwd, this.opts.authorTimeoutMs ?? 15 * 60_000);
      const turn = parseStreamJson(run.stdout);
      if (turn.meta.resultSubtype === undefined) turn.meta.resultSubtype = `no-result(exit ${run.exit})`;
      return { turn, files: snapshotSources(task.cwd) };
    } finally {
      rmSync(dirname(empty), { recursive: true, force: true });
    }
  }

  async ask(task: AskTask): Promise<ParsedTurn> {
    // The key lives in a 0600 file for the duration of the call and is never
    // passed on argv (argv is readable by every process on the box).
    const dir = mkdtempSync(join(tmpdir(), 'scenario-ask-'));
    const cfg = join(dir, 'mcp.json');
    writeFileSync(
      cfg,
      JSON.stringify({ mcpServers: { app: { type: 'http', url: task.mcp.url, headers: { Authorization: `Bearer ${task.mcp.apiKey}` } } } }),
      { mode: 0o600 },
    );
    try {
      const args = ['-p', task.prompt, ...this.base(this.opts.maxTurnsAsk ?? 12), '--mcp-config', cfg, '--strict-mcp-config', '--allowedTools', 'mcp__app'];
      const run = await runCli(this.bin, args, dir, this.opts.askTimeoutMs ?? 5 * 60_000);
      const turn = parseStreamJson(run.stdout);
      if (turn.meta.resultSubtype === undefined) turn.meta.resultSubtype = `no-result(exit ${run.exit})`;
      return turn;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ── Replay ──────────────────────────────────────────────────────────────────

/** A recording: every turn of a run, keyed by {@link stepKey}. */
export interface Recording {
  driver: DriverInfo;
  turns: Record<string, ParsedTurn>;
  /** Authoring turns' resulting project sources, keyed like `turns`. */
  files: Record<string, Record<string, string>>;
}

export class MissingRecordingError extends Error {
  constructor(key: string) {
    super(`no recorded turn for \`${key}\``);
    this.name = 'MissingRecordingError';
  }
}

/** Replays a {@link Recording}. A step it has no turn for is a loud error, never an empty turn. */
export class RecordedDriver implements AgentDriver {
  constructor(
    private readonly recording: Recording,
    private readonly source = '(in memory)',
  ) {}

  static fromFile(path: string): RecordedDriver {
    return new RecordedDriver(JSON.parse(readFileSync(path, 'utf8')) as Recording, path);
  }

  info(): DriverInfo {
    return { driver: 'recorded', version: this.source, ...(this.recording.driver.authMethod ? { authMethod: `replay of ${this.recording.driver.driver} (${this.recording.driver.authMethod})` } : {}), apiBilled: false };
  }

  async author(task: AuthorTask): Promise<AuthorResult> {
    const key = stepKey(task);
    const turn = this.recording.turns[key];
    if (!turn) throw new MissingRecordingError(key);
    const files = this.recording.files[key] ?? {};
    const root = resolve(task.cwd);
    for (const [rel, content] of Object.entries(files)) {
      const p = resolve(root, rel);
      if (!p.startsWith(root + sep)) throw new Error(`recorded file \`${rel}\` escapes the project directory`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    return { turn, files };
  }

  async ask(task: AskTask): Promise<ParsedTurn> {
    const key = stepKey(task);
    const turn = this.recording.turns[key];
    if (!turn) throw new MissingRecordingError(key);
    return turn;
  }
}

/** Wraps a live driver and records every turn into {@link RecordingDriver.recording}. */
export class RecordingDriver implements AgentDriver {
  readonly recording: Recording;

  constructor(private readonly inner: AgentDriver) {
    this.recording = { driver: inner.info(), turns: {}, files: {} };
  }

  info(): DriverInfo {
    return this.inner.info();
  }

  async author(task: AuthorTask): Promise<AuthorResult> {
    const r = await this.inner.author(task);
    this.recording.turns[stepKey(task)] = r.turn;
    if (r.files) this.recording.files[stepKey(task)] = r.files;
    return r;
  }

  async ask(task: AskTask): Promise<ParsedTurn> {
    const t = await this.inner.ask(task);
    this.recording.turns[stepKey(task)] = t;
    return t;
  }

  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(this.recording, null, 2));
  }
}
