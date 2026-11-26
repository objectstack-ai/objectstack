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
 *   - The run's limits (`--author-timeout`, the turn caps, the models, the effort) travel
 *     in `limits`; the command may ignore them. The timeout is the runner's
 *     own: a call still running at `limits.timeoutMs` is killed (SIGTERM).
 *   - At start the runner makes one `info` call: the command names itself and
 *     its version, which every record and gallery page states, and the
 *     contract it speaks ({@link EXTERNAL_DRIVER_CONTRACTS}). A command that
 *     cannot answer it is refused before any card runs. The `info` input is
 *     the one input every version shares and always carries the first name
 *     ({@link EXTERNAL_DRIVER_CONTRACT}), so a command of either version
 *     answers it; every later input carries the name the command answered.
 *   - Door mode (contract `/2` only): an `author` call may carry `door`
 *     ({@link ExternalDoorInput}), the app's MCP draft door and nothing of a
 *     project. The door's OAuth token travels as the persona's key does — in a
 *     0600 file of the same shape, outside the call's directory, deleted when
 *     the call returns. A `/1` command is never sent a door: the run is refused
 *     before any card runs ({@link ExternalDriver.assertDoor}), naming why.
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
import { placeAskSkills, type AskSkillsBundle } from '../ask-skills.js';
import { API_BILLING_ENV, DEFAULT_AUTHOR_TIMEOUT_MIN, snapshotSources, type AgentDriver, type AskTask, type AuthorResult, type AuthorTask, type DoorClient, type DriverInfo, type StepRef } from '../driver.js';
import { toolNameOf, type ParsedTurn, type RunnerToolCall } from '../transcript.js';
import { CODEX_API_BILLING_ENV } from './codex.js';
import { noResult, runTurnProcess } from './process.js';
import { readDoorArm, type DoorArm } from '../door.js';

/**
 * The contract's first version: `info`, `author` (a project in `cwd`) and
 * `ask`. Every `info` input carries this name, and every later input to a
 * command whose `info` answer names no contract. Its value never changes: a
 * command that pins it (a literal schema, a type check against
 * {@link ExternalInfoInput}) keeps answering this runner. A command checks the
 * name and refuses one it does not know.
 */
export const EXTERNAL_DRIVER_CONTRACT = 'objectstack-scenario-driver/1';

/**
 * The second version: `/1` plus door mode (`door` on an `author` input,
 * {@link ExternalDoorInput}). The first key of every input after `info`, for
 * a command whose `info` answer names it.
 */
export const EXTERNAL_DRIVER_CONTRACT_V2 = 'objectstack-scenario-driver/2';

/** Every contract version this runner speaks, oldest first. */
export const EXTERNAL_DRIVER_CONTRACTS = [EXTERNAL_DRIVER_CONTRACT, EXTERNAL_DRIVER_CONTRACT_V2] as const;
export type ExternalContract = (typeof EXTERNAL_DRIVER_CONTRACTS)[number];

const isExternalContract = (c: string): c is ExternalContract => (EXTERNAL_DRIVER_CONTRACTS as readonly string[]).includes(c);

/** The run's limits, as the flags set them; a command may ignore any of them. */
export interface ExternalLimits {
  /** The runner kills the call at this wall-clock budget, ms (`--author-timeout` for an authoring call; 5 min for an ask). */
  timeoutMs: number;
  /** `--author-max-turns` / `--ask-max-turns`, when given. */
  maxTurns?: number;
  /** `--model`, or `--author-model` / `--ask-model`, when given. */
  model?: string;
  /**
   * `--effort`, or `--author-effort` / `--ask-effort`, when given: the level
   * name exactly as typed (the runner does not check it against any tool's
   * levels). A command that cannot set an effort should refuse the call, not
   * run at its default, or the record names an effort no turn ran at.
   */
  effort?: string;
}

/** The one input every contract version shares, so it always carries the first name. */
export interface ExternalInfoInput {
  contract: typeof EXTERNAL_DRIVER_CONTRACT;
  kind: 'info';
}

/**
 * Door mode's half of an `author` input (contract `/2`): the booted app's MCP
 * draft door, and nothing of a project. `mcp.configFile` is a 0600 file
 * outside `cwd`, `{"mcpServers":{"app":{"type":"http","url":…,"headers":{"Authorization":"Bearer …"}}}}`,
 * the one place the door's OAuth token is (scoped to the authoring tools,
 * `DOOR_TOKEN_SCOPE`). `skillsDir`, when the run gives skills
 * (`--door-skills`, less `--door-skill-omit`), is `cwd/.claude/skills`, one
 * directory per skill holding its `SKILL.md`.
 */
export interface ExternalDoorInput {
  mcp: { url: string; configFile: string };
  skillsDir?: string;
}

/**
 * Build or iterate an app. Without `door`: edit the project in `cwd` with
 * shell and file tools. With `door` (contract `/2`, `step.mode` `door`): build
 * through the door alone; `cwd` is an empty directory of the call's own
 * (holding only the skills, when given) and no file in it is graded. The call
 * runs in `cwd`.
 */
export interface ExternalAuthorInput {
  contract: ExternalContract;
  kind: 'author';
  step: StepRef;
  prompt: string;
  cwd: string;
  tier: ScenarioTier;
  limits: ExternalLimits;
  door?: ExternalDoorInput;
}

/**
 * Answer one persona turn (a data question, or a write operation) over the
 * booted app's MCP endpoint, as that persona. `mcp.configFile` is a 0600 file,
 * `{"mcpServers":{"app":{"type":"http","url":…,"headers":{"Authorization":"Bearer …"}}}}`,
 * the one place the persona's key is. The call runs in the file's directory.
 */
export interface ExternalAskInput {
  contract: ExternalContract;
  kind: 'ask';
  step: StepRef;
  prompt: string;
  mcp: { url: string; configFile: string };
  limits: ExternalLimits;
}

/**
 * The `info` answer: `name` becomes the record's driver (`external:NAME`),
 * `version` its version, `contract` the contract it speaks (absent ⇒
 * {@link EXTERNAL_DRIVER_CONTRACT}, the answer every `/1` command gives).
 */
export const ExternalInfoSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'a name of letters, digits, `.`, `_` and `-`'),
  version: z.string().min(1),
  contract: z.string().min(1).optional(),
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

/**
 * The `author` and `ask` answer: the reply the agent wrote (every text it
 * said, joined), its tool calls, and what it knows of itself — its model, its
 * turn count and its usage. Every key after `toolCalls` is optional, so a
 * command that reports no usage answers the same contract.
 */
export const ExternalTurnSchema = z.strictObject({
  replyText: z.string(),
  toolCalls: z.array(ExternalToolCallSchema),
  /** The model the turn was served, when the tool reports it. */
  model: z.string().min(1).optional(),
  /** The agentic turns the call took, when the tool counts them. */
  numTurns: z.number().int().min(0).optional(),
  /**
   * The cost of the call in US dollars, as the tool reports it (the same
   * reading as Claude Code's `total_cost_usd`). Absent ⇒ the tool reported
   * none, and the record holds none: never a zero.
   */
  reportedCostUsd: z.number().nonnegative().optional(),
  /** The input tokens the call used, when the tool reports them. Absent ⇒ none recorded. */
  inputTokens: z.number().int().min(0).optional(),
  /** The output tokens the call used, when the tool reports them. Absent ⇒ none recorded. */
  outputTokens: z.number().int().min(0).optional(),
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

/** A 0600 MCP config file's content: the app's endpoint under the name `app`, the bearer the one secret in it. */
const mcpConfigText = (url: string, bearer: string): string => JSON.stringify({ mcpServers: { app: { type: 'http', url, headers: { Authorization: `Bearer ${bearer}` } } } });

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
  effort?: string;
  authorEffort?: string;
  askEffort?: string;
  /** Relative command words resolve against this; default the runner's working directory. */
  base?: string;
  /** Door mode's skills (`--door-skills`), read once here (`readDoorArm`) and placed in each door turn's `cwd`. */
  doorSkillsDir?: string;
  /** Skill names left out of {@link doorSkillsDir} (`--door-skill-omit`). */
  doorSkillOmit?: readonly string[];
}

export class ExternalDriver implements AgentDriver {
  private readonly argv: string[];
  private readonly name: string;
  private readonly version: string;
  /** The contract the command answered in `info`: every later input carries it. */
  readonly contract: ExternalContract;
  private readonly doorSkills: AskSkillsBundle | undefined;
  private readonly door: DoorArm | undefined;

  /** Makes the `info` call; a command that cannot answer it is refused here, before any card runs. */
  constructor(private readonly opts: ExternalDriverOptions) {
    this.argv = parseExternalCommand(opts.command, opts.base);
    // Read before any process starts: an omission naming no skill is refused, and every door turn gets these bytes.
    const door = readDoorArm(opts);
    this.doorSkills = door.skills;
    this.door = door.arm;
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
    const contract = info.value.contract ?? EXTERNAL_DRIVER_CONTRACT;
    if (!isExternalContract(contract)) {
      throw new Error(`--driver external:${opts.command}: the command's \`info\` answer names the contract \`${contract}\`, which this runner does not speak (it speaks ${EXTERNAL_DRIVER_CONTRACTS.map((k) => `\`${k}\``).join(', ')})`);
    }
    this.contract = contract;
  }

  /** Does the command take a door (contract `/2`)? */
  get speaksDoor(): boolean {
    return this.contract !== EXTERNAL_DRIVER_CONTRACT;
  }

  /**
   * Refuse door mode for a command that does not take a door, naming why:
   * the runner calls it before any card runs, and {@link author} again before
   * it would send a door, so a `/1` command is never handed one.
   */
  assertDoor(): void {
    if (!this.speaksDoor) {
      throw new Error(
        `--driver external:${this.opts.command}: \`${this.name}\` speaks \`${this.contract}\`, which has no door; door mode hands an external command the app's MCP draft door on \`${EXTERNAL_DRIVER_CONTRACT_V2}\` only (its \`info\` answer names that contract)`,
      );
    }
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

  private get authorEffort(): string | undefined {
    return this.opts.authorEffort ?? this.opts.effort;
  }

  private get askEffort(): string | undefined {
    return this.opts.askEffort ?? this.opts.effort;
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
      ...(this.authorEffort ? { authorEffort: this.authorEffort } : {}),
      ...(this.askEffort ? { askEffort: this.askEffort } : {}),
      ...(this.door ? { door: this.door } : {}),
    };
  }

  private limits(timeoutMs: number, maxTurns: number | undefined, model: string | undefined, effort: string | undefined): ExternalLimits {
    return { timeoutMs, ...(maxTurns !== undefined ? { maxTurns } : {}), ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  }

  /** One call: its input on stdin, its answer read into a turn — or a failed turn that says why. */
  private async call(input: ExternalAuthorInput | ExternalAskInput, cwd: string): Promise<ParsedTurn> {
    const run = await runTurnProcess(this.argv[0]!, this.argv.slice(1), { cwd, input: JSON.stringify(input), timeoutMs: input.limits.timeoutMs, env: externalEnv() });
    const proc = {
      ...run.process,
      ...(input.limits.maxTurns !== undefined ? { maxTurns: input.limits.maxTurns } : {}),
      ...(input.limits.model ? { requestedModel: input.limits.model } : {}),
      ...(input.limits.effort ? { requestedEffort: input.limits.effort } : {}),
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
      meta: {
        process: proc,
        ...(out.model ? { model: out.model } : {}),
        ...(out.numTurns !== undefined ? { numTurns: out.numTurns } : {}),
        // A usage figure the command did not report stays absent: a turn that reports none records none, never a zero.
        ...(out.reportedCostUsd !== undefined ? { reportedCostUsd: out.reportedCostUsd } : {}),
        ...(out.inputTokens !== undefined ? { inputTokens: out.inputTokens } : {}),
        ...(out.outputTokens !== undefined ? { outputTokens: out.outputTokens } : {}),
        resultSubtype: 'success',
        isError: false,
      },
    };
  }

  async author(task: AuthorTask): Promise<AuthorResult> {
    if (task.door) return this.doorAuthor(task, task.door);
    const input: ExternalAuthorInput = {
      contract: this.contract,
      kind: 'author',
      step: stepOf(task),
      prompt: task.prompt,
      cwd: task.cwd,
      tier: task.tier,
      limits: this.limits(this.authorTimeoutMs, this.opts.authorMaxTurns, this.authorModel, this.authorEffort),
    };
    const turn = await this.call(input, task.cwd);
    return { turn, files: snapshotSources(task.cwd) };
  }

  /**
   * A door mode authoring call (contract `/2`): run in the task's own empty
   * directory with the arm's skills under `.claude/skills/`, the door's token
   * in a 0600 file outside it (never on argv, in the environment or on
   * stdin), deleted when the call returns. It records no files: there is no
   * project.
   */
  private async doorAuthor(task: AuthorTask, door: DoorClient): Promise<AuthorResult> {
    this.assertDoor();
    const dir = mkdtempSync(join(tmpdir(), 'scenario-external-door-'));
    const configFile = join(dir, 'mcp.json');
    writeFileSync(configFile, mcpConfigText(door.mcp.url, door.mcp.token), { mode: 0o600 });
    try {
      if (this.doorSkills) placeAskSkills(this.doorSkills, task.cwd);
      const input: ExternalAuthorInput = {
        contract: this.contract,
        kind: 'author',
        step: stepOf(task),
        prompt: task.prompt,
        cwd: task.cwd,
        tier: task.tier,
        limits: this.limits(this.authorTimeoutMs, this.opts.authorMaxTurns, this.authorModel, this.authorEffort),
        door: { mcp: { url: door.mcp.url, configFile }, ...(this.doorSkills ? { skillsDir: join(task.cwd, '.claude', 'skills') } : {}) },
      };
      return { turn: await this.call(input, task.cwd) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async ask(task: AskTask): Promise<ParsedTurn> {
    // The key lives in a 0600 file for the duration of the call; the input names the file, never the key.
    const dir = mkdtempSync(join(tmpdir(), 'scenario-external-'));
    const configFile = join(dir, 'mcp.json');
    writeFileSync(configFile, mcpConfigText(task.mcp.url, task.mcp.apiKey), { mode: 0o600 });
    try {
      const input: ExternalAskInput = {
        contract: this.contract,
        kind: 'ask',
        step: stepOf(task),
        prompt: task.prompt,
        mcp: { url: task.mcp.url, configFile },
        limits: this.limits(this.opts.askTimeoutMs ?? 5 * 60_000, this.opts.askMaxTurns, this.askModel, this.askEffort),
      };
      return await this.call(input, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** The step a task belongs to, and nothing else of it: an ask task also carries the persona's key. */
const stepOf = (t: StepRef): StepRef => ({ card: t.card, mode: t.mode, phase: t.phase, step: t.step, ...(t.persona !== undefined ? { persona: t.persona } : {}) });
