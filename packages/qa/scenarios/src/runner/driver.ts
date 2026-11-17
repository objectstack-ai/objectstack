// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The agent driver: the one seam between the runner and the model.
 *
 * The cost ruling on cloud#3600 (「目前阶段尽量不要用云端的token，api的更贵」)
 * fixes what may sit behind it: a Claude Code session on a subscription
 * login, never an API-billed model. Ruling D2 of the scenario-library epic
 * (2026-11-06, the gallery write path) names the two callers that qualify: a
 * LOCAL session on the developer's own login, and a scheduled Claude Code
 * task in the project's cloud environment on the maintainer's subscription
 * login (the gallery refresh, `export/refresh.ts`). An API-billed model is
 * still never allowed, wherever the session runs. No driver calls a model
 * API itself:
 *
 *   - {@link ClaudeCodeDriver} spawns the `claude` CLI in headless mode
 *     (`claude -p --output-format stream-json`, the prompt on stdin). It REFUSES
 *     to start when the process would bill an API key — `ANTHROPIC_API_KEY` /
 *     `ANTHROPIC_AUTH_TOKEN` in the environment, or a CLI whose `auth status`
 *     reports an API-key login — and strips both variables from every child it
 *     spawns.
 *   - `CodexDriver` (`drivers/codex.ts`, `--driver codex`) does the same with
 *     the OpenAI Codex CLI (`codex exec --json`) on a ChatGPT plan login.
 *   - `ExternalDriver` (`drivers/external.ts`, `--driver external:COMMAND`)
 *     runs any command that speaks this seam as a stdin/stdout JSON process
 *     contract (the package README states it).
 *   - {@link RecordedDriver} replays turns recorded earlier, so the runner's
 *     own tests (and a re-grade of an old run) need no model and no network.
 *     It re-sends each turn's recorded writes to the booted app through the
 *     runner's door ({@link AskTask.callTool}), so an operation reads back
 *     what the recorded run wrote.
 *
 * {@link RecordingDriver} wraps a live driver and writes every turn it sees to
 * a recording the replay driver reads back.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { SCENARIO_TIERS, type ScenarioTier } from '../schema.js';
import { placeAskSkills, readAskSkills, SKILL_TOOL, type AskSkillsBundle, type AskSkillsInfo } from './ask-skills.js';
import { flowRefusalOf } from '../score/scenario-run-grade.js';
import type { ToolAnswer } from './app.js';
import { noResult, runTurnProcess } from './drivers/process.js';
import { WRITE_TOOLS } from './observe.js';
import { promptChoiceText, statedPromptChoice, type PromptChoice } from './prompts.js';
import { parseStreamJson, refusalCodeOf, type ParsedTurn, type RunnerToolCall } from './transcript.js';

/** Which run step a turn belongs to; the replay key is built from it. */
export interface StepRef {
  card: string;
  /**
   * `scratch` (from nothing), `template` (from a verified build installed
   * unmanaged, then changed) or `ask` (the Run half alone, on a verified build
   * installed unmanaged; its turns are `run` questions and operations only).
   */
  mode: 'scratch' | 'template' | 'ask';
  /** `build`, `iterate`, `run` (the first Run half) or `iterate-run` (the Run half after the iterate). */
  phase: 'build' | 'iterate' | 'run' | 'iterate-run';
  /** A question or operation id; `author` for an authoring turn. */
  step: string;
  persona?: string;
  /**
   * Which ask of a question turn this is, counted from 1, when the run asks
   * each question turn more than once (`--ask-repeats`). Absent, or 1, is the
   * first ask, whose key is the one every turn had before repeats, so a
   * recording made without them still replays. An authoring or operation
   * turn never carries one.
   */
  repeat?: number;
  /**
   * The second turn of a `pending_confirmation` operation: the agent asked
   * first, and this turn carries the person's confirmation. Its key adds one
   * segment, {@link CONFIRM_KEY_SEGMENT}; the first turn's key is unchanged, so
   * a recording made without second turns still replays its first turns. Only
   * an operation turn carries one, and never with {@link repeat}.
   */
  confirmation?: true;
}

/** The key segment an ask after the first adds ({@link stepKey}): `…/account_count/sdr/repeat-2`. */
const REPEAT_KEY_PREFIX = 'repeat-';

/** The key segment of an operation's confirmation turn ({@link StepRef.confirmation}): `…/remove_ben/sdr/confirm`. */
export const CONFIRM_KEY_SEGMENT = 'confirm';

/**
 * The replay key of a step: `card/mode/phase/step/persona`, `-` for no
 * persona. A repeated question turn's asks after the first add one segment,
 * `repeat-N` ({@link StepRef.repeat}); the first ask's key is unchanged. An
 * operation's confirmation turn adds one segment, `confirm`
 * ({@link StepRef.confirmation}).
 */
export const stepKey = (s: StepRef): string => {
  const key = [s.card, s.mode, s.phase, s.step, s.persona ?? '-'].join('/');
  if (s.confirmation === true) {
    if (s.repeat !== undefined && s.repeat !== 1) throw new RangeError(`an operation's confirmation turn is never a repeated ask (\`${key}\`)`);
    return `${key}/${CONFIRM_KEY_SEGMENT}`;
  }
  if (s.repeat === undefined || s.repeat === 1) return key;
  if (!Number.isInteger(s.repeat) || s.repeat < 1) throw new RangeError(`a step's repeat counts asks from 1, not ${String(s.repeat)} (\`${key}\`)`);
  return `${key}/${REPEAT_KEY_PREFIX}${s.repeat}`;
};

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
  /**
   * The runner's own door to the booted app as this turn's persona: one MCP
   * `tools/call` with the persona's key (`AppHarness.callTool`). The replay
   * driver re-sends the turn's recorded writes through it; a live driver
   * ignores it. Absent ⇒ a replay re-reads the turn and sends nothing.
   */
  callTool?: (tool: string, args: Record<string, unknown>) => Promise<ToolAnswer>;
}

export interface AuthorResult {
  turn: ParsedTurn;
  /** Files the replay driver writes back (relative path → content); a live run records what changed. */
  files?: Record<string, string>;
}

export interface DriverInfo {
  /** `claude-code-cli`, `codex-cli`, `external:NAME` (the name the command gives itself) or `recorded`. */
  driver: string;
  /** The CLI's (or the external command's) version, or the recording's path. */
  version?: string;
  /** How the CLI is logged in (`claude auth status`, `codex login status`), e.g. `oauth_token`; never a secret. */
  authMethod?: string;
  /** A replay's: the driver and version that made the recording it replays — the agent whose turns these are. */
  replayOf?: { driver: string; version?: string };
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
  /** The effort level the live driver asks for on an authoring turn (`--effort` / `--author-effort`); absent ⇒ the CLI's default effort. */
  authorEffort?: string;
  /** The effort level the live driver asks for on a question or operation turn (`--effort` / `--ask-effort`); absent ⇒ the CLI's default effort. */
  askEffort?: string;
  /**
   * The skills every question and operation turn was given (`--ask-skills`,
   * `ask-skills.ts`): each skill's name, the sha256 of its files and its
   * declared version. Absent ⇒ none: the turn's directory held no skill and
   * the `Skill` tool was not allowed. A replay states the recording's.
   */
  askSkills?: AskSkillsInfo;
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
  /** `cli` names the agent tool and its login command; default Claude Code's. */
  constructor(reason: string, cli: { tool: string; login: string } = { tool: 'Claude Code', login: 'claude auth login' }) {
    super(
      `the scenario runner drives a local ${cli.tool} login only, never an API-billed model: ${reason}. ` +
        `Unset it and run \`${cli.login}\` with your subscription.`,
    );
    this.name = 'ApiBillingRefusedError';
  }
}

/**
 * The `claude` CLI's own effort setting. Read in Claude Code 2.1.325's own
 * code (the CLI reports no served effort to measure it by): when it is set, it
 * wins over the `--effort` flag, so a turn the runner asks for
 * one effort would run at another while its record named the first. The live
 * driver therefore reads it once from the caller's environment (as the effort
 * when no effort flag is given), passes the effort as `--effort`, and removes
 * the variable from every turn's environment. `unset` and `auto` mean the
 * CLI's default effort, as the CLI reads them.
 */
export const CLAUDE_EFFORT_ENV = 'CLAUDE_CODE_EFFORT_LEVEL';

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
 * The effort levels a `claude` CLI accepts, read off its own `--help`: the
 * parenthesised list in the `--effort` entry (Claude Code 2.1.325 prints
 * `--effort <level>  Effort level for the current session (low, medium, high,
 * xhigh, max)`, the list wrapped onto the next line). `undefined` ⇒ the help
 * has no `--effort` entry, or the entry names no list. Pure over its input.
 */
export function effortLevelsFromHelp(help: string): string[] | undefined {
  const lines = help.split('\n');
  const at = lines.findIndex((l) => /^\s*--effort\b/.test(l));
  if (at === -1) return undefined;
  const entry = [lines[at]!];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() === '' || /^\s*-/.test(l)) break;
    entry.push(l);
  }
  const list = /\(([a-z]+(?:\s*,\s*[a-z]+)*)\)/i.exec(entry.join(' '));
  return list ? list[1]!.split(',').map((x) => x.trim()) : undefined;
}

/**
 * Refuse an effort level the CLI would not take. Measured on Claude Code
 * 2.1.325: an unknown `--effort` value is not an error — the CLI warns on
 * stderr, runs the turn at its default effort and exits 0 — so a misspelt
 * level would put a level on the record that no turn ran at. Each entry of
 * `wanted` is a level and where it came from (a flag, or the variable), for
 * the message.
 */
function assertEffortLevels(levels: string[] | undefined, wanted: ReadonlyArray<readonly [string, string]>, cli = 'the `claude` CLI'): void {
  if (wanted.length === 0) return;
  const named = wanted.map(([, from]) => from).join(', ');
  if (levels === undefined) throw new Error(`${named}: ${cli} lists no \`--effort\` levels in its \`--help\`, so it cannot be asked for an effort; update Claude Code, or run without an effort flag`);
  for (const [level, from] of wanted) {
    if (!levels.includes(level)) throw new Error(`${from} takes one of the levels ${cli} accepts (${levels.join(', ')}), not \`${level}\``);
  }
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
  /** The effort level passed as `--effort` on every turn; else the caller's {@link CLAUDE_EFFORT_ENV}; else none, the CLI's default. */
  effort?: string;
  /** The effort level for an authoring turn (build and iterate), in place of {@link effort}. */
  authorEffort?: string;
  /** The effort level for a question or operation turn, in place of {@link effort}. */
  askEffort?: string;
  /**
   * A skills directory every question and operation turn is given
   * (`--ask-skills`, `ask-skills.ts`): read once here, written into each turn's
   * directory under `.claude/skills/`, with `Skill` added to the turn's allowed
   * tools. Absent ⇒ the turn runs as it always did.
   */
  askSkillsDir?: string;
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
  private readonly askSkills: AskSkillsBundle | undefined;

  constructor(opts: ClaudeCodeDriverOptions = {}) {
    this.opts = opts;
    this.bin = opts.bin ?? 'claude';
    // Read before any process starts: a directory that holds no skill is refused, and every turn gets these bytes.
    this.askSkills = opts.askSkillsDir !== undefined ? readAskSkills(opts.askSkillsDir) : undefined;
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
    // An effort the CLI does not list would run at its default effort while the record named it.
    const wanted: Array<readonly [string, string]> = [];
    if (this.authorEffort !== undefined) wanted.push([this.authorEffort, opts.authorEffort !== undefined ? '--author-effort' : opts.effort !== undefined ? '--effort' : CLAUDE_EFFORT_ENV]);
    if (this.askEffort !== undefined) wanted.push([this.askEffort, opts.askEffort !== undefined ? '--ask-effort' : opts.effort !== undefined ? '--effort' : CLAUDE_EFFORT_ENV]);
    if (wanted.length) {
      const help = spawnSync(this.bin, ['--help'], { encoding: 'utf8', env: this.turnEnv() });
      assertEffortLevels(effortLevelsFromHelp(help.stdout ?? ''), wanted, `\`${this.bin}\` ${this.version}`);
    }
  }

  /** The effort the caller's environment sets for the CLI ({@link CLAUDE_EFFORT_ENV}); `unset` / `auto` / empty ⇒ none. */
  private get envEffort(): string | undefined {
    const raw = process.env[CLAUDE_EFFORT_ENV]?.trim().toLowerCase();
    return raw === undefined || raw === '' || raw === 'unset' || raw === 'auto' ? undefined : raw;
  }

  /** A turn's environment: no API-billing variable, and no {@link CLAUDE_EFFORT_ENV} to override the `--effort` the turn passes. */
  private turnEnv(): NodeJS.ProcessEnv {
    const env = subscriptionOnlyEnv();
    delete env[CLAUDE_EFFORT_ENV];
    return env;
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

  private get authorEffort(): string | undefined {
    return this.opts.authorEffort ?? this.opts.effort ?? this.envEffort;
  }

  private get askEffort(): string | undefined {
    return this.opts.askEffort ?? this.opts.effort ?? this.envEffort;
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
      ...(this.authorEffort ? { authorEffort: this.authorEffort } : {}),
      ...(this.askEffort ? { askEffort: this.askEffort } : {}),
      ...(this.askSkills ? { askSkills: this.askSkills.info } : {}),
    };
  }

  private base(maxTurns: number, model: string | undefined, effort: string | undefined): string[] {
    const a = ['--output-format', 'stream-json', '--verbose', '--max-turns', String(maxTurns)];
    if (model) a.push('--model', model);
    if (effort) a.push('--effort', effort);
    return a;
  }

  async author(task: AuthorTask): Promise<AuthorResult> {
    const empty = join(mkdtempSync(join(tmpdir(), 'scenario-mcp-')), 'none.json');
    writeFileSync(empty, JSON.stringify({ mcpServers: {} }));
    try {
      const maxTurns = this.authorMaxTurns(task.tier);
      const model = this.authorModel;
      const effort = this.authorEffort;
      const args = [
        '-p',
        ...this.base(maxTurns, model, effort),
        '--mcp-config', empty, '--strict-mcp-config',
        '--permission-mode', 'acceptEdits',
        '--allowedTools', 'Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill',
      ];
      const run = await runTurnProcess(this.bin, args, { cwd: task.cwd, input: task.prompt, timeoutMs: this.authorTimeoutMs, env: this.turnEnv() });
      const turn = parseStreamJson(run.stdout);
      turn.meta.process = { ...run.process, maxTurns, ...(model ? { requestedModel: model } : {}), ...(effort ? { requestedEffort: effort } : {}) };
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
      const effort = this.askEffort;
      // The skills, when given, sit where a project's own skills sit, and only then may the session load one.
      if (this.askSkills) placeAskSkills(this.askSkills, dir);
      const args = ['-p', ...this.base(maxTurns, model, effort), '--mcp-config', cfg, '--strict-mcp-config', '--allowedTools', 'mcp__app', ...(this.askSkills ? [SKILL_TOOL] : [])];
      const run = await runTurnProcess(this.bin, args, { cwd: dir, input: task.prompt, timeoutMs: this.opts.askTimeoutMs ?? 5 * 60_000, env: this.turnEnv() });
      const turn = parseStreamJson(run.stdout);
      turn.meta.process = { ...run.process, maxTurns, ...(model ? { requestedModel: model } : {}), ...(effort ? { requestedEffort: effort } : {}) };
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
  /**
   * The prompt choice the recorded turns were sent (`--lang`, `--prompt`),
   * when a flag set one; absent ⇒ the default prompts. A replay under
   * another choice is refused before any card runs
   * ({@link RecordedDriver.assertPromptChoice}).
   */
  promptChoice?: PromptChoice;
}

/**
 * Two prompt choices send the same prompts: the same language (no choice is
 * its own: English, else Chinese, per card text) and the same build prompt
 * (no choice is `detailed`).
 */
export function samePromptChoice(a: PromptChoice | undefined, b: PromptChoice | undefined): boolean {
  return a?.lang === b?.lang && (a?.prompt ?? 'detailed') === (b?.prompt ?? 'detailed');
}

export class MissingRecordingError extends Error {
  constructor(key: string) {
    super(`no recorded turn for \`${key}\``);
    this.name = 'MissingRecordingError';
  }
}

/**
 * A replayed turn whose recorded writes the booted app did not answer as it
 * answered the recorded run, or that the recording cannot re-send faithfully.
 * What the turn's operation reads back then measures the replay, not the
 * agent: the runner records it NOT MEASURED with {@link reason}, never a fail.
 */
export class ReplayNotFaithfulError extends Error {
  constructor(
    readonly key: string,
    /** Why, naming each write call that broke the replay. */
    readonly reason: string,
    /** The recorded turn, as the run saw it. */
    readonly turn: ParsedTurn,
  ) {
    super(`the replay of \`${key}\` is not faithful: ${reason}`);
    this.name = 'ReplayNotFaithfulError';
  }
}

/** The calls of a recorded turn to the app's write doors, in recorded order (reads are never re-sent). */
const recordedWrites = (turn: ParsedTurn): RunnerToolCall[] => turn.toolCalls.filter((c) => (WRITE_TOOLS as readonly string[]).includes(c.name));

/** How a write door answered, as a replay compares it: `applied`, or the refusal it carried (rule 3 of `observe.ts`). */
function answerOutcome(output: unknown, isError: boolean): string {
  const code = refusalCodeOf(output);
  if (code !== undefined) return `refused ${code}`;
  if (flowRefusalOf(output) !== undefined) return 'refused by its flow';
  return isError ? 'refused without a code' : 'applied';
}

/** The id an applied create answered (`{ id }`), when its output carries one. */
function createdIdOf(output: unknown): string | undefined {
  if (typeof output !== 'string') return undefined;
  try {
    const v: unknown = JSON.parse(output);
    const id = typeof v === 'object' && v !== null ? (v as Record<string, unknown>).id : undefined;
    return typeof id === 'string' && id !== '' ? id : undefined;
  } catch {
    return undefined;
  }
}

/** `value` with every string equal to a recorded id replaced by the id the replay's app gave that row. */
function remapIds(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => remapIds(v, ids));
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapIds(v, ids)]));
  return value;
}

/**
 * Replays a {@link Recording}. A step it has no turn for is a loud error, never an empty turn.
 * Each ask of a repeated question turn is read by its own key ({@link stepKey});
 * how many asks are read is the run's `--ask-repeats`, checked against what the
 * recording holds before any card runs ({@link RecordedDriver.assertAskRepeats}).
 *
 * A question or operation turn's recorded writes (`create_record`,
 * `update_record`, `delete_record`, `run_action` through the app's MCP door)
 * are re-sent to the freshly booted app, in recorded order, as the turn's
 * persona ({@link AskTask.callTool}), before the turn is handed back: the
 * runner's read-back then finds what the recorded run wrote. Reads are never
 * re-sent. A refused write is re-sent too, and must be refused again with the
 * same code. A row the recorded run created is known to the replay's app
 * under a new id, so a later write naming the recorded id is sent with the
 * new one. The replay is not faithful, and the turn's grade measures nothing
 * ({@link ReplayNotFaithfulError}), when a recorded write has no recorded
 * answer (nothing is re-sent for that turn: whether it ran is unknown), or
 * when the app answers a re-sent write otherwise than it answered the run.
 */
export class RecordedDriver implements AgentDriver {
  /** Recorded id → the id the replay's app gave the same created row. */
  private readonly ids = new Map<string, string>();

  constructor(
    private readonly recording: Recording,
    private readonly source = '(in memory)',
  ) {}

  static fromFile(path: string): RecordedDriver {
    return new RecordedDriver(JSON.parse(readFileSync(path, 'utf8')) as Recording, path);
  }

  /**
   * How many asks of a question turn the recording holds: its first ask and
   * each repeat after it ({@link StepRef.repeat}), counted from 1 up to the
   * first ask it does not hold. 0 ⇒ it holds no ask of that turn.
   */
  heldAsks(ref: StepRef): number {
    let n = 0;
    while (this.recording.turns[stepKey({ ...ref, repeat: n + 1 })] !== undefined) n++;
    return n;
  }

  /**
   * Refuse an `--ask-repeats` the recording cannot replay, before any card
   * runs: each question turn of `cards` that the recording holds an ask of
   * must hold `repeats` asks ({@link heldAsks}); the refusal names every turn
   * short of it with the count found. A replay reads the first `repeats` asks
   * of a turn and never more, so a smaller count is no refusal. A turn the
   * recording holds no ask of is left to the run, as before: the runner does
   * not ask a seed-dependent turn, and a turn it asks is a loud
   * {@link MissingRecordingError} where it is asked.
   */
  assertAskRepeats(repeats: number, cards: ReadonlyArray<{ id: string; run: { questions: ReadonlyArray<{ id: string }> } }>): void {
    if (repeats <= 1) return;
    const questions = new Map(cards.map((c) => [c.id, new Set(c.run.questions.map((q) => q.id))]));
    const short: string[] = [];
    for (const key of Object.keys(this.recording.turns)) {
      const parts = key.split('/');
      // An ask after the first has a sixth segment; its turn is counted from its first ask's key.
      if (parts.length !== 5) continue;
      const [card, mode, phase, step, persona] = parts as [string, StepRef['mode'], StepRef['phase'], string, string];
      if ((phase !== 'run' && phase !== 'iterate-run') || !questions.get(card)?.has(step)) continue;
      const held = this.heldAsks({ card, mode, phase, step, ...(persona !== '-' ? { persona } : {}) });
      if (held < repeats) short.push(`\`${key}\` (question \`${step}\`${persona !== '-' ? ` as ${persona}` : ''}) holds ${held} ask${held === 1 ? '' : 's'}`);
    }
    if (short.length === 0) return;
    const shown = short.slice(0, 5).join('; ') + (short.length > 5 ? `; and ${short.length - 5} more` : '');
    throw new Error(`--ask-repeats ${repeats} replays ${repeats} asks of each question turn, but the recording ${this.source} holds fewer of ${short.length}: ${shown}`);
  }

  /**
   * Refuse a replay under another prompt choice than the recording was made
   * with ({@link samePromptChoice}), before any card runs: the recorded turns
   * answered the prompts the recording was sent, and a replay never sends a
   * prompt, so the run would grade one choice's answers as another's.
   */
  assertPromptChoice(choice: PromptChoice | undefined): void {
    const made = this.recording.promptChoice;
    if (samePromptChoice(made, choice)) return;
    const flags = (c: PromptChoice | undefined) =>
      [c?.lang !== undefined ? `--lang ${c.lang}` : '', c?.prompt !== undefined ? `--prompt ${c.prompt}` : ''].filter(Boolean).join(' ') || 'neither flag';
    throw new Error(
      `the recording ${this.source} was sent ${promptChoiceText(made ?? {})}, and this run asks for ${promptChoiceText(choice ?? {})}: ` +
        `a replay re-reads the answers to the prompts that were recorded, so replay it with ${flags(made)}`,
    );
  }

  info(): DriverInfo {
    const made = this.recording.driver;
    // A recording of a replay names the agent of the run it replayed, not the replay.
    const replayOf = made.replayOf ?? { driver: made.driver, ...(made.version !== undefined ? { version: made.version } : {}) };
    return {
      driver: 'recorded',
      version: this.source,
      replayOf,
      ...(made.authMethod ? { authMethod: `replay of ${made.driver} (${made.authMethod})` } : {}),
      apiBilled: false,
      // The replayed answers were made with these skills: the record says so, as it says whose turns they are.
      ...(made.askSkills ? { askSkills: made.askSkills } : {}),
    };
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
    const writes = recordedWrites(turn);
    if (writes.length === 0 || task.callTool === undefined) return turn;
    const unanswered = writes.filter((c) => c.output === undefined);
    if (unanswered.length > 0) {
      const names = unanswered.map((c) => `\`${c.name}\``).join(', ');
      throw new ReplayNotFaithfulError(key, `the recording holds no answer to ${names} (the turn was cut short), so whether it wrote is unknown; nothing was re-sent`, turn);
    }
    const broken: string[] = [];
    for (const c of writes) {
      const input = (typeof c.input === 'object' && c.input !== null && !Array.isArray(c.input) ? c.input : {}) as Record<string, unknown>;
      const target = typeof input.objectName === 'string' ? ` on ${input.objectName}` : '';
      const recorded = answerOutcome(c.output, c.isError === true);
      let replayed: string;
      let answer: ToolAnswer | undefined;
      try {
        answer = await task.callTool(c.name, remapIds(input, this.ids) as Record<string, unknown>);
        replayed = answerOutcome(answer.output, answer.isError);
      } catch (e) {
        replayed = `not sent (${e instanceof Error ? e.message : String(e)})`;
      }
      if (replayed !== recorded) {
        broken.push(`\`${c.name}\`${target} was ${recorded} in the recorded run and ${replayed} on replay`);
        continue;
      }
      if (c.name === 'create_record' && recorded === 'applied') {
        const was = createdIdOf(c.output);
        const now = createdIdOf(answer?.output);
        if (was !== undefined && now !== undefined && was !== now) this.ids.set(was, now);
      }
    }
    if (broken.length > 0) throw new ReplayNotFaithfulError(key, `the booted app answered a re-sent write otherwise than the recorded run: ${broken.join('; ')}`, turn);
    return turn;
  }
}

/** Wraps a live driver and records every turn into {@link RecordingDriver.recording}. */
export class RecordingDriver implements AgentDriver {
  readonly recording: Recording;

  /** `choice`: the prompt choice the run sends, stated on the recording when a flag set one ({@link Recording.promptChoice}). */
  constructor(
    private readonly inner: AgentDriver,
    choice?: PromptChoice,
  ) {
    const stated = statedPromptChoice(choice);
    this.recording = {
      driver: inner.info(),
      turns: {},
      files: {},
      ...(stated !== undefined ? { promptChoice: stated } : {}),
    };
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
