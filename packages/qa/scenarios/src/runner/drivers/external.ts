// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `--driver external:COMMAND`: the {@link AgentDriver} seam as a process
 * contract, so any agent tool a wrapper can drive headless measures the same
 * card. The package README states the contract for the people who write such
 * a command; this file is its one implementation.
 *
 *   - One process per call. The call goes on stdin as one JSON object
 *     ({@link ExternalInfoInput}, {@link ExternalAuthorInput},
 *     {@link ExternalAskInput}); the answer comes back on stdout as one JSON
 *     object ({@link ExternalInfoSchema}, {@link ExternalTurnSchema}). Logs go
 *     to stderr; the record keeps its last 2,000 characters.
 *   - Exit 0 with an answer of the declared shape is the turn. Any other end —
 *     a non-zero exit, a signal, the runner's timeout, stdout that is not one
 *     JSON object of that shape — is a FAILED turn with a named reason
 *     (`no-result(exit 3)`, `invalid-output(…)`), never an empty pass.
 *   - ⛔ The persona's API key reaches the command only through a 0600 file
 *     whose PATH is in the ask input (`mcp.configFile`), shaped as Claude
 *     Code's `--mcp-config` file; the file is deleted when the call returns.
 *     The key is never on argv, never in the environment, never in stdin as a
 *     value — and so never in a run record, a scorecard or a gallery export.
 *   - The run's limits (`--author-timeout`, the turn caps, the models) travel
 *     in `limits`; the command may ignore them. The timeout is the runner's
 *     own: a call still running at `limits.timeoutMs` is killed (SIGTERM).
 *   - At start the runner makes one `info` call: the command names itself and
 *     its version, which every record and gallery page states. A command that
 *     cannot answer it is refused before any card runs.
 *
 * The runner cannot see an external command's login, so the record says so
 * (`authMethod`); every billing variable the runner knows is removed from the
 * command's environment, as for the built-in drivers.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import { SCENARIO_TIERS, type ScenarioTier } from '../../schema.js';
import { API_BILLING_ENV, DEFAULT_AUTHOR_TIMEOUT_MIN, snapshotSources, type AgentDriver, type AskTask, type AuthorResult, type AuthorTask, type DriverInfo, type StepRef } from '../driver.js';
import { toolNameOf, type ParsedTurn, type RunnerToolCall } from '../transcript.js';
import { CODEX_API_BILLING_ENV } from './codex.js';
import { noResult, runTurnProcess } from './process.js';

/** The contract's name and version, the first key of every input. A command checks it and refuses one it does not know. */
export const EXTERNAL_DRIVER_CONTRACT = 'objectstack-scenario-driver/1';

/** The run's limits, as the flags set them; a command may ignore any of them. */
export interface ExternalLimits {
  /** The runner kills the call at this wall-clock budget, ms (`--author-timeout` for an authoring call; 5 min for an ask). */
  timeoutMs: number;
  /** `--author-max-turns` / `--ask-max-turns`, when given. */
  maxTurns?: number;
  /** `--model`, or `--author-model` / `--ask-model`, when given. */
  model?: string;
}

export interface ExternalInfoInput {
  contract: typeof EXTERNAL_DRIVER_CONTRACT;
  kind: 'info';
}

/** Build or iterate an app: edit the project in `cwd` with shell and file tools. The call runs in `cwd`. */
export interface ExternalAuthorInput {
  contract: typeof EXTERNAL_DRIVER_CONTRACT;
  kind: 'author';
  step: StepRef;
  prompt: string;
  cwd: string;
  tier: ScenarioTier;
  limits: ExternalLimits;
}

/**
 * Answer one persona turn (a data question, or a write operation) over the
 * booted app's MCP endpoint, as that persona. `mcp.configFile` is a 0600 file,
 * `{"mcpServers":{"app":{"type":"http","url":…,"headers":{"Authorization":"Bearer …"}}}}`,
 * the one place the persona's key is. The call runs in the file's directory.
 */
export interface ExternalAskInput {
  contract: typeof EXTERNAL_DRIVER_CONTRACT;
  kind: 'ask';
  step: StepRef;
  prompt: string;
  mcp: { url: string; configFile: string };
  limits: ExternalLimits;
}

/** The `info` answer: `name` becomes the record's driver (`external:NAME`), `version` its version. */
export const ExternalInfoSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'a name of letters, digits, `.`, `_` and `-`'),
  version: z.string().min(1),
});

/** One tool call of the turn, in the order made. An MCP tool may be named bare (`query_records`) or prefixed (`mcp__app__query_records`). */
export const ExternalToolCallSchema = z.strictObject({
  name: z.string().min(1),
  input: z.unknown().optional(),
  /** What the tool answered, as the model was given it; absent ⇒ it never answered (the turn was cut short). */
  output: z.unknown().optional(),
  /** The tool answered with an error. */
  isError: z.boolean().optional(),
});

/** The `author` and `ask` answer: the reply the agent wrote (every text it said, joined), its tool calls, and what it knows of itself. */
export const ExternalTurnSchema = z.strictObject({
  replyText: z.string(),
  toolCalls: z.array(ExternalToolCallSchema),
  /** The model the turn was served, when the tool reports it. */
  model: z.string().min(1).optional(),
  /** The agentic turns the call took, when the tool counts them. */
  numTurns: z.number().int().min(0).optional(),
});
export type ExternalTurn = z.infer<typeof ExternalTurnSchema>;

/** Every variable the runner knows would bill an API key; none reaches an external command. */
export const EXTERNAL_STRIPPED_ENV = [...API_BILLING_ENV, ...CODEX_API_BILLING_ENV] as const;

const externalEnv = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => {
  const out = { ...env };
  for (const k of EXTERNAL_STRIPPED_ENV) delete out[k];
  return out;
};

/**
 * `node ./driver.mjs --fast` → `['node', '/abs/driver.mjs', '--fast']`: split
 * on whitespace (no shell, no quoting); a word that starts `./` or `../`, and
 * a first word holding a `/`, is resolved against `base` — each call runs in
 * its task's directory, so a relative path would otherwise move with it.
 */
export function parseExternalCommand(command: string, base = process.cwd()): string[] {
  const words = command.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) throw new Error('--driver external: needs a command (`--driver external:./my-driver.mjs`)');
  return words.map((w, i) => (w.startsWith('./') || w.startsWith('../') || (i === 0 && w.includes('/')) ? resolve(base, w) : w));
}

const issueText = (e: z.ZodError): string => {
  const first = e.issues[0];
  if (!first) return 'not the declared shape';
  return `${first.path.length ? `\`${first.path.join('.')}\`: ` : ''}${first.message}${e.issues.length > 1 ? ` (+${e.issues.length - 1} more)` : ''}`;
};

/** Read one JSON object of `schema` off stdout, or say why not. */
function readAnswer<T>(stdout: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; why: string } {
  const text = stdout.trim();
  if (text === '') return { ok: false, why: 'stdout is empty' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, why: 'stdout is not one JSON object' };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, why: issueText(parsed.error).slice(0, 300) };
}

export interface ExternalDriverOptions {
  /** The command, as given after `external:` (`node ./driver.mjs`). */
  command: string;
  /** Wall-clock budget per authoring call, ms; default {@link DEFAULT_AUTHOR_TIMEOUT_MIN}. */
  authorTimeoutMs?: number;
  /** Wall-clock budget per ask call, ms; default 5 min. */
  askTimeoutMs?: number;
  /** Wall-clock budget for the `info` call, ms; default 30 s. */
  infoTimeoutMs?: number;
  authorMaxTurns?: number;
  askMaxTurns?: number;
  model?: string;
  authorModel?: string;
  askModel?: string;
  /** Relative command words resolve against this; default the runner's working directory. */
  base?: string;
}

export class ExternalDriver implements AgentDriver {
  private readonly argv: string[];
  private readonly name: string;
  private readonly version: string;

  /** Makes the `info` call; a command that cannot answer it is refused here, before any card runs. */
  constructor(private readonly opts: ExternalDriverOptions) {
    this.argv = parseExternalCommand(opts.command, opts.base);
    const input: ExternalInfoInput = { contract: EXTERNAL_DRIVER_CONTRACT, kind: 'info' };
    const run = spawnSync(this.argv[0]!, this.argv.slice(1), { input: JSON.stringify(input), encoding: 'utf8', timeout: opts.infoTimeoutMs ?? 30_000, env: externalEnv() });
    const stderr = (run.stderr ?? '').trim();
    const refused = (why: string) => new Error(`--driver external:${opts.command}: the command did not answer the \`info\` call (${why})${stderr ? `; stderr: ${stderr.slice(-500)}` : ''}`);
    if (run.error) throw refused(run.error.message);
    if (run.status !== 0) throw refused(run.status === null ? `signal ${run.signal}` : `exit ${run.status}`);
    const info = readAnswer(run.stdout, ExternalInfoSchema);
    if (!info.ok) throw refused(info.why);
    this.name = info.value.name;
    this.version = info.value.version;
  }

  private get authorTimeoutMs(): number {
    return this.opts.authorTimeoutMs ?? DEFAULT_AUTHOR_TIMEOUT_MIN * 60_000;
  }

  private get authorModel(): string | undefined {
    return this.opts.authorModel ?? this.opts.model;
  }

  private get askModel(): string | undefined {
    return this.opts.askModel ?? this.opts.model;
  }

  info(): DriverInfo {
    return {
      driver: `external:${this.name}`,
      version: this.version,
      authMethod: 'not verified (an external command: the runner cannot see its login)',
      apiBilled: false,
      authorTimeoutMs: this.authorTimeoutMs,
      ...(this.opts.authorMaxTurns !== undefined
        ? { authorMaxTurns: Object.fromEntries(SCENARIO_TIERS.map((t) => [t, this.opts.authorMaxTurns!])) as Record<ScenarioTier, number> }
        : {}),
      ...(this.opts.askMaxTurns !== undefined ? { askMaxTurns: this.opts.askMaxTurns } : {}),
      ...(this.authorModel ? { authorModel: this.authorModel } : {}),
      ...(this.askModel ? { askModel: this.askModel } : {}),
    };
  }

  private limits(timeoutMs: number, maxTurns: number | undefined, model: string | undefined): ExternalLimits {
    return { timeoutMs, ...(maxTurns !== undefined ? { maxTurns } : {}), ...(model ? { model } : {}) };
  }

  /** One call: its input on stdin, its answer read into a turn — or a failed turn that says why. */
  private async call(input: ExternalAuthorInput | ExternalAskInput, cwd: string): Promise<ParsedTurn> {
    const run = await runTurnProcess(this.argv[0]!, this.argv.slice(1), { cwd, input: JSON.stringify(input), timeoutMs: input.limits.timeoutMs, env: externalEnv() });
    const proc = {
      ...run.process,
      ...(input.limits.maxTurns !== undefined ? { maxTurns: input.limits.maxTurns } : {}),
      ...(input.limits.model ? { requestedModel: input.limits.model } : {}),
    };
    if (run.process.exit !== 0 || run.process.timedOut) {
      return { replyText: '', toolCalls: [], meta: { process: proc, resultSubtype: noResult(run.process) } };
    }
    const answer = readAnswer(run.stdout, ExternalTurnSchema);
    if (!answer.ok) return { replyText: '', toolCalls: [], meta: { process: proc, resultSubtype: `invalid-output(${answer.why})`, isError: true } };
    const out = answer.value;
    const toolCalls: RunnerToolCall[] = out.toolCalls.map((c) => ({
      name: toolNameOf(c.name),
      rawName: c.name,
      input: c.input ?? {},
      output: c.output,
      ...(c.isError ? { isError: true } : {}),
    }));
    return {
      replyText: out.replyText,
      toolCalls,
      meta: { process: proc, ...(out.model ? { model: out.model } : {}), ...(out.numTurns !== undefined ? { numTurns: out.numTurns } : {}), resultSubtype: 'success', isError: false },
    };
  }

  async author(task: AuthorTask): Promise<AuthorResult> {
    const input: ExternalAuthorInput = {
      contract: EXTERNAL_DRIVER_CONTRACT,
      kind: 'author',
      step: stepOf(task),
      prompt: task.prompt,
      cwd: task.cwd,
      tier: task.tier,
      limits: this.limits(this.authorTimeoutMs, this.opts.authorMaxTurns, this.authorModel),
    };
    const turn = await this.call(input, task.cwd);
    return { turn, files: snapshotSources(task.cwd) };
  }

  async ask(task: AskTask): Promise<ParsedTurn> {
    // The key lives in a 0600 file for the duration of the call; the input names the file, never the key.
    const dir = mkdtempSync(join(tmpdir(), 'scenario-external-'));
    const configFile = join(dir, 'mcp.json');
    writeFileSync(
      configFile,
      JSON.stringify({ mcpServers: { app: { type: 'http', url: task.mcp.url, headers: { Authorization: `Bearer ${task.mcp.apiKey}` } } } }),
      { mode: 0o600 },
    );
    try {
      const input: ExternalAskInput = {
        contract: EXTERNAL_DRIVER_CONTRACT,
        kind: 'ask',
        step: stepOf(task),
        prompt: task.prompt,
        mcp: { url: task.mcp.url, configFile },
        limits: this.limits(this.opts.askTimeoutMs ?? 5 * 60_000, this.opts.askMaxTurns, this.askModel),
      };
      return await this.call(input, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** The step a task belongs to, and nothing else of it: an ask task also carries the persona's key. */
const stepOf = (t: StepRef): StepRef => ({ card: t.card, mode: t.mode, phase: t.phase, step: t.step, ...(t.persona !== undefined ? { persona: t.persona } : {}) });
