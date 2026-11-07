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
 *     (`claude -p --output-format stream-json`, the prompt on stdin). It REFUSES
 *     to start when the process would bill an API key — `ANTHROPIC_API_KEY` /
 *     `ANTHROPIC_AUTH_TOKEN` in the environment, or a CLI whose `auth status`
 *     reports an API-key login — and strips both variables from every child it
 *     spawns.
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

import { SCENARIO_TIERS, type ScenarioTier } from '../schema.js';
import { parseStreamJson, type ParsedTurn, type TurnProcess } from './transcript.js';

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
  /** The card's tier: it sizes the live driver's turn cap ({@link DEFAULT_AUTHOR_MAX_TURNS}). Not part of the replay key. */
  tier: ScenarioTier;
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
  /** The live driver's wall-clock budget per authoring turn (build and iterate), ms. */
  authorTimeoutMs?: number;
  /** The live driver's turn cap per authoring turn, by card tier (`--author-max-turns` sets every tier alike). */
  authorMaxTurns?: Record<ScenarioTier, number>;
  /** The live driver's turn cap per question or operation turn. */
  askMaxTurns?: number;
  /** The model the live driver asks for on an authoring turn (`--model` / `--author-model`); absent ⇒ the login's default. */
  authorModel?: string;
  /** The model the live driver asks for on a question or operation turn (`--model` / `--ask-model`); absent ⇒ the login's default. */
  askModel?: string;
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

/**
 * The authoring budget a run gets unless `--author-timeout` says otherwise:
 * sized for a mid-tier (`starter`) card, whose 7–8-object builds ran well past
 * a quarter of an hour.
 */
export const DEFAULT_AUTHOR_TIMEOUT_MIN = 60;

/**
 * The agentic turns one authoring turn (build or iterate) may take unless
 * `--author-max-turns` says otherwise, by the card's tier. A `control` card's
 * 2–3-object build finished in 17–21 turns under the old flat cap of 80, which
 * stays. Every `starter` build measured hit that 80 (`error_max_turns`) after
 * 15–24 minutes, 11–18 s a turn: the 60-minute author timeout holds 200–325
 * such turns, so 300 puts the turn cap and the wall clock at about the same
 * point. A `delivery` card (none in the library yet) gets twice that; at the
 * same pace 600 turns outlast the default timeout, so its run raises
 * `--author-timeout` too, or the clock ends the turn first.
 */
export const DEFAULT_AUTHOR_MAX_TURNS: Readonly<Record<ScenarioTier, number>> = { control: 80, starter: 300, delivery: 600 };

/** The agentic turns one question or operation turn may take unless `--ask-max-turns` says otherwise, every tier alike. */
export const DEFAULT_ASK_MAX_TURNS = 12;

export interface ClaudeCodeDriverOptions {
  /** The CLI binary; default `claude`. */
  bin?: string;
  /** Agentic turns allowed for one question or operation; default {@link DEFAULT_ASK_MAX_TURNS}. */
  askMaxTurns?: number;
  /** Agentic turns allowed for one authoring task, every tier alike; default by the card's tier, {@link DEFAULT_AUTHOR_MAX_TURNS}. */
  authorMaxTurns?: number;
  /** Wall-clock budget per authoring turn (build and iterate), ms; default {@link DEFAULT_AUTHOR_TIMEOUT_MIN}. */
  authorTimeoutMs?: number;
  /** Wall-clock budget per question or operation, ms; default 5 min. */
  askTimeoutMs?: number;
  /** The model passed as `--model` on every turn (an alias such as `sonnet`, or a full name); the login's default otherwise. */
  model?: string;
  /** The model for an authoring turn (build and iterate), in place of {@link model}. */
  authorModel?: string;
  /** The model for a question or operation turn, in place of {@link model}. */
  askModel?: string;
}

/** `claude-sonnet-4-5-20250929[1m]` → `['claude', 'sonnet', '4', '5', '20250929']`: the name's parts, the context-size suffix dropped. */
const modelParts = (name: string): string[] => name.toLowerCase().replace(/\[[^\]]*\]$/, '').split('-').filter(Boolean);

/**
 * Was the turn served the model it asked for? The CLI takes an alias
 * (`sonnet`) or a name (`claude-opus-4-1`) and the stream's init line names
 * the model it resolved to (`claude-sonnet-4-5-20250929`), so a turn is served
 * as asked when the served name holds the requested one as a whole run of its
 * dash-separated parts — `sonnet` and `claude-sonnet-4-5` in
 * `claude-sonnet-4-5-20250929`, never `opus` in it. Any other answer, an alias
 * that names no model family (`default`, `opusplan`) included, is a mismatch the
 * scorecard shows beside both names, for the reader to judge.
 */
export function servedAsRequested(requested: string, served: string): boolean {
  const want = modelParts(requested);
  const got = modelParts(served);
  if (want.length === 0) return false;
  for (let i = 0; i + want.length <= got.length; i++) {
    if (want.every((part, j) => got[i + j] === part)) return true;
  }
  return false;
}

interface CliRun {
  stdout: string;
  process: TurnProcess;
}

const STDERR_TAIL = 2000;

/**
 * One CLI process, the prompt written to its stdin. The prompt never travels
 * on argv: a build prompt carries the card's whole seed, and on Linux one
 * argument longer than 128 KiB (`MAX_ARG_STRLEN`) makes `spawn` throw `E2BIG`
 * before the CLI starts — the two largest cards' build prompts are past it.
 *
 * Never rejects: a process that could not start, was killed by the timeout or
 * exited without a result is answered with what was seen of it, so the turn
 * it belongs to is recorded rather than lost.
 */
function runCli(bin: string, args: string[], cwd: string, input: string, timeoutMs: number): Promise<CliRun> {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let error: string | undefined;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const settle = (exit: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const tail = stderr.trim().slice(-STDERR_TAIL);
      resolvePromise({
        stdout,
        process: {
          elapsedMs: Date.now() - started,
          exit,
          ...(signal ? { signal } : {}),
          timedOut,
          timeoutMs,
          ...(tail ? { stderrTail: tail } : {}),
          ...(error ? { error } : {}),
        },
      });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { cwd, env: subscriptionOnlyEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e); // `spawn E2BIG` and its kin throw here
      settle(null, null);
      return;
    }
    child.stdout!.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr!.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (e) => {
      error ??= e.message; // `spawn ENOENT`: no `close` may follow
      if (child.pid === undefined) settle(null, null);
    });
    child.stdin!.on('error', (e) => (error ??= e.message)); // EPIPE: the CLI exited before reading its prompt
    child.stdin!.end(input);
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.on('close', (exit, signal) => settle(exit, signal));
  });
}

/**
 * `no-result(exit 143)`, `no-result(signal SIGTERM)`, `no-result(spawn E2BIG)`:
 * a turn that printed no result line, by how its process ended — or, when no
 * process ever ran, why.
 */
const noResult = (p: TurnProcess): string =>
  `no-result(${p.exit !== null ? `exit ${p.exit}` : p.signal ? `signal ${p.signal}` : (p.error ?? 'no exit code, no signal')})`;

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

  private get authorTimeoutMs(): number {
    return this.opts.authorTimeoutMs ?? DEFAULT_AUTHOR_TIMEOUT_MIN * 60_000;
  }

  private authorMaxTurns(tier: ScenarioTier): number {
    return this.opts.authorMaxTurns ?? DEFAULT_AUTHOR_MAX_TURNS[tier];
  }

  private get askMaxTurns(): number {
    return this.opts.askMaxTurns ?? DEFAULT_ASK_MAX_TURNS;
  }

  private get authorModel(): string | undefined {
    return this.opts.authorModel ?? this.opts.model;
  }

  private get askModel(): string | undefined {
    return this.opts.askModel ?? this.opts.model;
  }

  info(): DriverInfo {
    return {
      driver: 'claude-code-cli',
      version: this.version,
      authMethod: this.authMethod,
      apiBilled: false,
      authorTimeoutMs: this.authorTimeoutMs,
      authorMaxTurns: Object.fromEntries(SCENARIO_TIERS.map((t) => [t, this.authorMaxTurns(t)])) as Record<ScenarioTier, number>,
      askMaxTurns: this.askMaxTurns,
      ...(this.authorModel ? { authorModel: this.authorModel } : {}),
      ...(this.askModel ? { askModel: this.askModel } : {}),
    };
  }

  private base(maxTurns: number, model: string | undefined): string[] {
    const a = ['--output-format', 'stream-json', '--verbose', '--max-turns', String(maxTurns)];
    if (model) a.push('--model', model);
    return a;
  }

  async author(task: AuthorTask): Promise<AuthorResult> {
    const empty = join(mkdtempSync(join(tmpdir(), 'scenario-mcp-')), 'none.json');
    writeFileSync(empty, JSON.stringify({ mcpServers: {} }));
    try {
      const maxTurns = this.authorMaxTurns(task.tier);
      const model = this.authorModel;
      const args = [
        '-p',
        ...this.base(maxTurns, model),
        '--mcp-config', empty, '--strict-mcp-config',
        '--permission-mode', 'acceptEdits',
        '--allowedTools', 'Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill',
      ];
      const run = await runCli(this.bin, args, task.cwd, task.prompt, this.authorTimeoutMs);
      const turn = parseStreamJson(run.stdout);
      turn.meta.process = { ...run.process, maxTurns, ...(model ? { requestedModel: model } : {}) };
      if (turn.meta.resultSubtype === undefined) turn.meta.resultSubtype = noResult(run.process);
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
      const maxTurns = this.askMaxTurns;
      const model = this.askModel;
      const args = ['-p', ...this.base(maxTurns, model), '--mcp-config', cfg, '--strict-mcp-config', '--allowedTools', 'mcp__app'];
      const run = await runCli(this.bin, args, dir, task.prompt, this.opts.askTimeoutMs ?? 5 * 60_000);
      const turn = parseStreamJson(run.stdout);
      turn.meta.process = { ...run.process, maxTurns, ...(model ? { requestedModel: model } : {}) };
      if (turn.meta.resultSubtype === undefined) turn.meta.resultSubtype = noResult(run.process);
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
