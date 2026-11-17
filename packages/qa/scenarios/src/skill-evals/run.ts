// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One round: every selected case × both arms × `repeats`, each a `claude -p`
 * turn in its own fresh directory under the local Claude Code login, graded by
 * the case's own assertions, one JSON record per turn.
 *
 * The login guard is the scenario runner's, imported and never copied
 * (`subscriptionOnlyEnv`, `assertSubscriptionLogin`): a round refuses to start
 * while `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set or the CLI reports
 * an API-key login, and every turn is spawned with neither variable.
 *
 * What a turn's record can say:
 *
 * - `pass` / `fail` — the answer (the result line's text, the reply the asker
 *   reads) against the case's tokens;
 * - `invalid` — the turn did not run the arm it was meant to: the with-skill
 *   arm's init line does not list the bundle, or the no-skill arm's lists a
 *   bundle of the catalog. Out of the denominator, and counted;
 * - `error` — the turn produced no answer to grade (the process failed or was
 *   killed, or the result line is not `success`, `error_max_turns` included).
 *   Out of the denominator, and counted.
 *
 * Every turn's stream reports the subscription's rate-limit window. The round
 * stops scheduling turns once a window reports `rejected` or a utilization at
 * or above `maxUtilization`: a round shares the login with everything else on
 * it, and the turns not run are recorded as not run, never as failures.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertSubscriptionLogin, CLAUDE_EFFORT_ENV, effortLevelsFromHelp, subscriptionOnlyEnv } from '../runner/driver.js';
import { runTurnProcess, type TurnProcessRun } from '../runner/drivers/process.js';
import { parseStreamJson } from '../runner/transcript.js';
import type { TurnProcess } from '../runner/transcript.js';
import { ARMS, type Arm, armArgs, prepareArmWorkdir } from './arms.js';
import type { SkillEvalCase } from './cases.js';
import { type Grader, gradeAnswer } from './grade.js';

export const RUN_RECORD_SCHEMA = 'skill-eval-run/1';

export type RunVerdict = 'pass' | 'fail' | 'invalid' | 'error';

export interface RateLimitReading {
  status?: string;
  rateLimitType?: string;
  utilization?: number;
  resetsAt?: number;
}

/** What one turn's stream says beyond the parsed transcript. */
export interface TurnStreamFacts {
  /** The result line's `result` text: the answer graded. */
  answer?: string;
  /** The init line's `skills`. */
  initSkills?: string[];
  /** The `skill` input of every `Skill` tool call. */
  skillsInvoked: string[];
  /** The result line's `permission_denials` count. */
  permissionDenials?: number;
  /** The last `rate_limit_event` of the stream. */
  rateLimit?: RateLimitReading;
}

/** Read the facts {@link parseStreamJson} does not keep. Pure over its input. */
export function readStreamFacts(stdout: string): TurnStreamFacts {
  const facts: TurnStreamFacts = { skillsInvoked: [] };
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (ev.type === 'system' && ev.subtype === 'init' && Array.isArray(ev.skills)) {
      facts.initSkills = ev.skills.filter((s): s is string => typeof s === 'string');
    } else if (ev.type === 'result') {
      if (typeof ev.result === 'string') facts.answer = ev.result;
      if (Array.isArray(ev.permission_denials)) facts.permissionDenials = ev.permission_denials.length;
    } else if (ev.type === 'rate_limit_event' && typeof ev.rate_limit_info === 'object' && ev.rate_limit_info !== null) {
      const r = ev.rate_limit_info as Record<string, unknown>;
      facts.rateLimit = {
        ...(typeof r.status === 'string' ? { status: r.status } : {}),
        ...(typeof r.rateLimitType === 'string' ? { rateLimitType: r.rateLimitType } : {}),
        ...(typeof r.utilization === 'number' ? { utilization: r.utilization } : {}),
        ...(typeof r.resetsAt === 'number' ? { resetsAt: r.resetsAt } : {}),
      };
    } else if (ev.type === 'assistant' && typeof ev.message === 'object' && ev.message !== null) {
      const content = (ev.message as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;
      for (const b of content as Array<Record<string, unknown>>) {
        if (b?.type === 'tool_use' && b.name === 'Skill' && typeof b.input === 'object' && b.input !== null) {
          const skill = (b.input as Record<string, unknown>).skill;
          if (typeof skill === 'string') facts.skillsInvoked.push(skill);
        }
      }
    }
  }
  return facts;
}

export interface SkillEvalRunRecord {
  schema: typeof RUN_RECORD_SCHEMA;
  key: string;
  bundle: string;
  file: string;
  id: number | string;
  arm: Arm;
  /** 1-based. */
  repeat: number;
  verdict: RunVerdict;
  /** Why an `invalid` or `error` turn is out of the denominator. */
  reason?: string;
  /** `must_contain` tokens the answer lacks. */
  missing: string[];
  /** `must_not_contain` tokens the answer carries. */
  forbidden: string[];
  /** The answer graded; absent ⇒ the turn gave none. */
  answer?: string;
  /** Bundles of the catalog the init line listed. */
  bundlesLoaded: string[];
  /** Every skill the turn launched with the `Skill` tool. */
  skillsInvoked: string[];
  /** The tools the turn called, in order. */
  toolCalls: string[];
  permissionDenials?: number;
  /** The model the turn was served (the init line's). */
  model?: string;
  numTurns?: number;
  resultSubtype?: string;
  /** The CLI's own cost estimate: notional under a subscription login, nothing billed. */
  reportedCostUsd?: number;
  reportedDurationMs?: number;
  process: TurnProcess;
  rateLimit?: RateLimitReading;
  startedAt: string;
}

/** Judge one finished turn. Pure over its inputs. */
export function judgeTurn(
  c: SkillEvalCase,
  arm: Arm,
  repeat: number,
  run: TurnProcessRun,
  catalogBundles: readonly string[],
  startedAt: string,
  grade: Grader = gradeAnswer,
): SkillEvalRunRecord {
  const turn = parseStreamJson(run.stdout);
  const facts = readStreamFacts(run.stdout);
  const bundlesLoaded = (facts.initSkills ?? []).filter((s) => catalogBundles.includes(s));
  const base = {
    schema: RUN_RECORD_SCHEMA,
    key: c.key,
    bundle: c.bundle,
    file: c.file,
    id: c.id,
    arm,
    repeat,
    bundlesLoaded,
    skillsInvoked: facts.skillsInvoked,
    toolCalls: turn.toolCalls.map((t) => t.rawName),
    ...(facts.permissionDenials !== undefined ? { permissionDenials: facts.permissionDenials } : {}),
    ...(turn.meta.model ? { model: turn.meta.model } : {}),
    ...(turn.meta.numTurns !== undefined ? { numTurns: turn.meta.numTurns } : {}),
    ...(turn.meta.resultSubtype ? { resultSubtype: turn.meta.resultSubtype } : {}),
    ...(turn.meta.reportedCostUsd !== undefined ? { reportedCostUsd: turn.meta.reportedCostUsd } : {}),
    ...(turn.meta.reportedDurationMs !== undefined ? { reportedDurationMs: turn.meta.reportedDurationMs } : {}),
    process: run.process,
    ...(facts.rateLimit ? { rateLimit: facts.rateLimit } : {}),
    startedAt,
    ...(facts.answer !== undefined ? { answer: facts.answer } : {}),
  } as const;
  const out = (verdict: RunVerdict, rest: { reason?: string; missing?: string[]; forbidden?: string[] } = {}): SkillEvalRunRecord => ({
    ...base,
    verdict,
    ...(rest.reason ? { reason: rest.reason } : {}),
    missing: rest.missing ?? [],
    forbidden: rest.forbidden ?? [],
  });

  const p = run.process;
  if (p.error || p.timedOut || p.exit !== 0) {
    return out('error', { reason: p.error ? `the process failed: ${p.error}` : p.timedOut ? `killed by the ${p.timeoutMs} ms case timeout` : `the CLI exited ${String(p.exit)}${p.signal ? ` (${p.signal})` : ''}` });
  }
  if (facts.initSkills === undefined) return out('error', { reason: 'the stream carries no init line, so the arm cannot be verified' });
  if (arm === 'with-skill' && !bundlesLoaded.includes(c.bundle)) {
    return out('invalid', { reason: `the with-skill turn's init line does not list \`${c.bundle}\`` });
  }
  if (arm === 'no-skill' && bundlesLoaded.length > 0) {
    return out('invalid', { reason: `the no-skill turn's init line lists ${bundlesLoaded.map((b) => `\`${b}\``).join(', ')}` });
  }
  if (turn.meta.resultSubtype !== 'success' || facts.answer === undefined) {
    return out('error', { reason: `no answer to grade: the result line is \`${turn.meta.resultSubtype ?? 'absent'}\`` });
  }
  const g = grade(facts.answer, c);
  return out(g.pass ? 'pass' : 'fail', { missing: g.missing, forbidden: g.forbidden });
}

// ── Preflight ────────────────────────────────────────────────────────────────

export type SpawnSyncLike = (bin: string, args: string[], env: NodeJS.ProcessEnv) => { status: number | null; stdout: string; stderr: string };

const defaultSpawnSync: SpawnSyncLike = (bin, args, env) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', env });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? r.error.message : '') };
};

export interface Preflight {
  version: string;
  authMethod: string;
}

/**
 * Refuse an API-billed configuration before any turn: judged on the CALLER's
 * environment (a key set there is a configuration error even though every
 * turn is spawned without it), then on `claude auth status`.
 */
export function preflight(bin: string, env: NodeJS.ProcessEnv = process.env, run: SpawnSyncLike = defaultSpawnSync, effort?: string): Preflight {
  const childEnv = subscriptionOnlyEnv(env);
  const status = run(bin, ['auth', 'status'], childEnv);
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(status.stdout);
  } catch {
    /* refused below as "no login" */
  }
  const authMethod = assertSubscriptionLogin(env, parsed);
  const ver = run(bin, ['--version'], childEnv);
  if (ver.status !== 0) throw new Error(`\`${bin} --version\` failed: is Claude Code installed? ${ver.stderr}`.trim());
  if (effort !== undefined) {
    const levels = effortLevelsFromHelp(run(bin, ['--help'], childEnv).stdout);
    if (!levels?.includes(effort)) throw new Error(`--effort takes one of the levels \`${bin}\` lists (${levels?.join(', ') ?? 'none'}), not \`${effort}\``);
  }
  return { version: ver.stdout.trim(), authMethod };
}

/** A turn's environment: no API-billing variable, and no effort variable overriding `--effort`. */
export function turnEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = subscriptionOnlyEnv(env);
  delete out[CLAUDE_EFFORT_ENV];
  return out;
}

// ── The round ────────────────────────────────────────────────────────────────

export interface RoundJob {
  case: SkillEvalCase;
  arm: Arm;
  repeat: number;
}

/** The turns of a round, case-major with both arms adjacent, so a stopped round still holds paired arms. */
export function planRound(cases: readonly SkillEvalCase[], repeats: number): RoundJob[] {
  const jobs: RoundJob[] = [];
  for (let r = 1; r <= repeats; r++) for (const c of cases) for (const arm of ARMS) jobs.push({ case: c, arm, repeat: r });
  return jobs;
}

export const runRecordFile = (j: { case: SkillEvalCase; arm: Arm; repeat: number }): string =>
  `${j.case.bundle}__${j.case.file.replace(/\.json$/, '')}__${String(j.case.id)}__${j.arm}__r${j.repeat}.json`;

export interface RoundOptions {
  bin: string;
  skillsRoot: string;
  catalogBundles: readonly string[];
  outDir: string;
  maxTurns: number;
  caseTimeoutMs: number;
  concurrency: number;
  maxUtilization: number;
  model?: string;
  effort?: string;
  /** Injected in tests; the live process runner otherwise. */
  runTurn?: typeof runTurnProcess;
  onRecord?: (r: SkillEvalRunRecord, done: number, total: number) => void;
}

export interface RoundStop {
  reason: string;
  afterRuns: number;
}

export interface RoundExecution {
  records: SkillEvalRunRecord[];
  notRun: RoundJob[];
  stopped?: RoundStop;
}

/** Why a rate-limit reading stops the round; `undefined` ⇒ it does not. */
export function rateLimitStop(r: RateLimitReading | undefined, maxUtilization: number): string | undefined {
  if (!r) return undefined;
  if (r.status === 'rejected') return `the ${r.rateLimitType ?? 'subscription'} rate-limit window reports \`rejected\``;
  if (r.utilization !== undefined && r.utilization >= maxUtilization) {
    return `the ${r.rateLimitType ?? 'subscription'} rate-limit window reports utilization ${r.utilization}, at or above --max-utilization ${maxUtilization}`;
  }
  return undefined;
}

/** Run the planned turns with at most `concurrency` at once; write each record as it lands. */
export async function executeRound(jobs: readonly RoundJob[], opts: RoundOptions): Promise<RoundExecution> {
  const runTurn = opts.runTurn ?? runTurnProcess;
  const runsDir = join(opts.outDir, 'runs');
  mkdirSync(runsDir, { recursive: true });
  const env = turnEnv();
  const records: SkillEvalRunRecord[] = [];
  const started = new Set<number>();
  let next = 0;
  let stopped: RoundStop | undefined;

  const worker = async () => {
    for (;;) {
      if (stopped || next >= jobs.length) return;
      const at = next++;
      started.add(at);
      const job = jobs[at]!;
      const dir = prepareArmWorkdir(job.arm, job.case.bundle, opts.skillsRoot);
      const startedAt = new Date().toISOString();
      try {
        const run = await runTurn(opts.bin, armArgs(dir.mcpConfigPath, opts), { cwd: dir.cwd, input: job.case.prompt, timeoutMs: opts.caseTimeoutMs, env });
        const rec = judgeTurn(job.case, job.arm, job.repeat, run, opts.catalogBundles, startedAt);
        records.push(rec);
        writeFileSync(join(runsDir, runRecordFile(job)), JSON.stringify(rec, null, 2) + '\n');
        opts.onRecord?.(rec, records.length, jobs.length);
        const why = rateLimitStop(rec.rateLimit, opts.maxUtilization);
        if (why && !stopped) stopped = { reason: why, afterRuns: records.length };
      } finally {
        rmSync(dir.root, { recursive: true, force: true });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
  const notRun = jobs.filter((_, i) => !started.has(i));
  return { records, notRun, ...(stopped ? { stopped } : {}) };
}
