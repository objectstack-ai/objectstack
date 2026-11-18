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
 *   reads) against the case's tokens; for a trigger case, whether the turn
 *   loaded the bundle (a `Skill` launch of it, or a `Read` of a file under its
 *   `.claude/skills/BUNDLE/`) against `should_trigger`. A trigger case runs on
 *   the with-skill arm only: without the bundle nothing can be loaded;
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
import { ARMS, type Arm, armArgs, placeCaseFiles, prepareArmWorkdir } from './arms.js';
import { hashCase, type SkillEvalCase } from './cases.js';
import { type Grader, gradeAnswer } from './grade.js';

export const RUN_RECORD_SCHEMA = 'skill-eval-run/1';

export type RunVerdict = 'pass' | 'fail' | 'invalid' | 'error';

/**
 * How a with-skill turn shows its bundle was installed: `init-line` (listed),
 * or, for a bundle the init line never lists, `launched` (the turn launched
 * it) or `not-shown` (it did not, so nothing in the stream shows it).
 */
export type ArmEvidence = 'init-line' | 'launched' | 'not-shown';

/** How a turn reached a bundle's text: a `Skill` launch of it, or a `Read` of a file under it. */
export type LoadEvidence = 'skill-tool' | 'read';

/** A trigger case's reading: what it asked, and how the turn reached the bundle (empty ⇒ it did not). */
export interface TriggerReading {
  shouldTrigger: boolean;
  loadedBy: LoadEvidence[];
}

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
  /**
   * Every file a `Read` call named under a `.claude/skills/` directory, as the
   * path below it (`objectstack-data/SKILL.md`): the turn reading a skill's
   * text instead of launching it.
   */
  skillFilesRead: string[];
  /** The result line's `permission_denials` count. */
  permissionDenials?: number;
  /** The tool each of those denials refused, in order. */
  deniedTools?: string[];
  /** The last `rate_limit_event` of the stream. */
  rateLimit?: RateLimitReading;
}

/** A path under a project's `.claude/skills/`, captured below it. */
const SKILL_FILE_PATH = /(?:^|\/)\.claude\/skills\/(.+)$/;

/** Read the facts {@link parseStreamJson} does not keep. Pure over its input. */
export function readStreamFacts(stdout: string): TurnStreamFacts {
  const facts: TurnStreamFacts = { skillsInvoked: [], skillFilesRead: [] };
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
      if (Array.isArray(ev.permission_denials)) {
        facts.permissionDenials = ev.permission_denials.length;
        facts.deniedTools = ev.permission_denials.map((d) => (typeof d === 'object' && d !== null && typeof (d as Record<string, unknown>).tool_name === 'string' ? String((d as Record<string, unknown>).tool_name) : 'unknown'));
      }
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
        } else if (b?.type === 'tool_use' && b.name === 'Read' && typeof b.input === 'object' && b.input !== null) {
          const path = (b.input as Record<string, unknown>).file_path;
          const below = typeof path === 'string' ? SKILL_FILE_PATH.exec(path.replace(/\\/g, '/')) : null;
          if (below) facts.skillFilesRead.push(below[1]!);
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
  /**
   * {@link hashCase} of the case as the turn ran it. Absent on a record written
   * before the runner hashed cases: `--regrade` cannot show such a record's
   * case is unchanged, and says so.
   */
  caseHash?: string;
  verdict: RunVerdict;
  /** Why an `invalid` or `error` turn is out of the denominator. */
  reason?: string;
  /** A with-skill turn's evidence that its bundle was installed. */
  armEvidence?: ArmEvidence;
  /** The verdict the turn was given when it ran, kept once a `--regrade` changes it. */
  regradedFrom?: RunVerdict;
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
  /** Files the turn read under `.claude/skills/` (absent on a record written before the runner kept them). */
  skillFilesRead?: string[];
  /** A trigger case's reading: whether the turn loaded the bundle, and how. */
  trigger?: TriggerReading;
  /** The tools the turn called, in order. */
  toolCalls: string[];
  permissionDenials?: number;
  /** The tool each permission denial refused (a read outside the turn's directory is one). */
  deniedTools?: string[];
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

/** What a turn's arm can be checked against: the catalog's bundles, and those its init line never lists. */
export interface CatalogView {
  bundles: readonly string[];
  /** `user-invocable: false` bundles ({@link SkillEvalCatalog.unlistedBundles}). */
  unlisted: readonly string[];
}

/** The reason an `error` record carries when the stream had no init line. */
export const NO_INIT_LINE = 'the stream carries no init line, so the arm cannot be verified';

/** The facts a verdict is drawn from: a live turn's, or a recorded one's (`--regrade`). */
export interface VerdictFacts {
  process: TurnProcess;
  initSeen: boolean;
  bundlesLoaded: readonly string[];
  skillsInvoked: readonly string[];
  /** Absent on a record written before the runner kept it: read as none. */
  skillFilesRead?: readonly string[];
  resultSubtype?: string;
  answer?: string;
}

export interface Verdict {
  verdict: RunVerdict;
  reason?: string;
  missing: string[];
  forbidden: string[];
  armEvidence?: ArmEvidence;
  trigger?: TriggerReading;
}

/** The arms a case runs on: both, or the with-skill arm alone for a trigger case. Pure. */
export const armsOf = (c: Pick<SkillEvalCase, 'shouldTrigger'>): readonly Arm[] => (c.shouldTrigger === undefined ? ARMS : ['with-skill']);

/** How the turn reached `bundle`'s text, in a fixed order; empty ⇒ it did not. Pure. */
export function loadEvidence(bundle: string, f: Pick<VerdictFacts, 'skillsInvoked' | 'skillFilesRead'>): LoadEvidence[] {
  const by: LoadEvidence[] = [];
  if (f.skillsInvoked.includes(bundle)) by.push('skill-tool');
  if ((f.skillFilesRead ?? []).some((p) => p.startsWith(`${bundle}/`))) by.push('read');
  return by;
}

/**
 * Draw the verdict. Pure over its inputs.
 *
 * The with-skill arm is shown installed by the init line listing the bundle.
 * A bundle the init line never lists (`user-invocable: false`) is graded on
 * its answer, with `armEvidence` saying whether the turn launched it; a listed
 * bundle absent from the line is `invalid`. The no-skill arm is `invalid` when
 * its init line lists a catalog bundle or it launches one.
 *
 * A trigger case is judged on {@link loadEvidence}, not on its answer: `pass`
 * when the turn loaded the bundle exactly when `shouldTrigger` says it should.
 * A turn that loaded it is judged however it ended (the load already
 * happened); one that did not is judged only when it ended `success`, since a
 * turn cut short may have been about to load it. On the no-skill arm it is
 * `invalid`: nothing there can be loaded.
 */
export function verdictOf(c: SkillEvalCase, arm: Arm, f: VerdictFacts, catalog: CatalogView, grade: Grader = gradeAnswer): Verdict {
  const none = { missing: [], forbidden: [] };
  const p = f.process;
  if (p.error || p.timedOut || p.exit !== 0) {
    return { verdict: 'error', reason: p.error ? `the process failed: ${p.error}` : p.timedOut ? `killed by the ${p.timeoutMs} ms case timeout` : `the CLI exited ${String(p.exit)}${p.signal ? ` (${p.signal})` : ''}`, ...none };
  }
  if (!f.initSeen) return { verdict: 'error', reason: NO_INIT_LINE, ...none };
  if (c.shouldTrigger !== undefined && arm !== 'with-skill') return { verdict: 'invalid', reason: 'a trigger case runs on the with-skill arm only', ...none };
  let armEvidence: ArmEvidence | undefined;
  if (arm === 'with-skill') {
    if (f.bundlesLoaded.includes(c.bundle)) armEvidence = 'init-line';
    else if (catalog.unlisted.includes(c.bundle)) armEvidence = f.skillsInvoked.includes(c.bundle) ? 'launched' : 'not-shown';
    else return { verdict: 'invalid', reason: `the with-skill turn's init line does not list \`${c.bundle}\``, ...none };
  } else {
    if (f.bundlesLoaded.length > 0) return { verdict: 'invalid', reason: `the no-skill turn's init line lists ${f.bundlesLoaded.map((b) => `\`${b}\``).join(', ')}`, ...none };
    const launched = f.skillsInvoked.filter((s) => catalog.bundles.includes(s));
    if (launched.length > 0) return { verdict: 'invalid', reason: `the no-skill turn launched ${launched.map((b) => `\`${b}\``).join(', ')}`, ...none };
  }
  const ev = armEvidence ? { armEvidence } : {};
  if (c.shouldTrigger !== undefined) {
    const trigger: TriggerReading = { shouldTrigger: c.shouldTrigger, loadedBy: loadEvidence(c.bundle, f) };
    const loaded = trigger.loadedBy.length > 0;
    if (!loaded && f.resultSubtype !== 'success') {
      return { verdict: 'error', reason: `the turn ended \`${f.resultSubtype ?? 'absent'}\` without loading the bundle, so not loading it is not shown`, ...none, ...ev, trigger };
    }
    return { verdict: loaded === c.shouldTrigger ? 'pass' : 'fail', ...none, ...ev, trigger };
  }
  if (f.resultSubtype !== 'success' || f.answer === undefined) {
    return { verdict: 'error', reason: `no answer to grade: the result line is \`${f.resultSubtype ?? 'absent'}\``, ...none, ...ev };
  }
  const g = grade(f.answer, c);
  return { verdict: g.pass ? 'pass' : 'fail', missing: g.missing, forbidden: g.forbidden, ...ev };
}

const applyVerdict = <T extends object>(base: T, v: Verdict) => ({
  ...base,
  verdict: v.verdict,
  ...(v.reason ? { reason: v.reason } : {}),
  missing: v.missing,
  forbidden: v.forbidden,
  ...(v.armEvidence ? { armEvidence: v.armEvidence } : {}),
  ...(v.trigger ? { trigger: v.trigger } : {}),
});

/** Judge one finished turn. Pure over its inputs. */
export function judgeTurn(
  c: SkillEvalCase,
  arm: Arm,
  repeat: number,
  run: TurnProcessRun,
  catalog: CatalogView,
  startedAt: string,
  grade: Grader = gradeAnswer,
): SkillEvalRunRecord {
  const turn = parseStreamJson(run.stdout);
  const facts = readStreamFacts(run.stdout);
  const bundlesLoaded = (facts.initSkills ?? []).filter((s) => catalog.bundles.includes(s));
  const base = {
    schema: RUN_RECORD_SCHEMA,
    key: c.key,
    bundle: c.bundle,
    file: c.file,
    id: c.id,
    arm,
    repeat,
    caseHash: hashCase(c),
    bundlesLoaded,
    skillsInvoked: facts.skillsInvoked,
    skillFilesRead: facts.skillFilesRead,
    toolCalls: turn.toolCalls.map((t) => t.rawName),
    ...(facts.permissionDenials !== undefined ? { permissionDenials: facts.permissionDenials } : {}),
    ...(facts.deniedTools?.length ? { deniedTools: facts.deniedTools } : {}),
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
  const v = verdictOf(c, arm, { process: run.process, initSeen: facts.initSkills !== undefined, bundlesLoaded, skillsInvoked: facts.skillsInvoked, skillFilesRead: facts.skillFilesRead, ...(turn.meta.resultSubtype ? { resultSubtype: turn.meta.resultSubtype } : {}), ...(facts.answer !== undefined ? { answer: facts.answer } : {}) }, catalog, grade);
  return applyVerdict(base, v);
}

/**
 * Whether the case a record ran is the case now: `same` (the hashes match),
 * `changed` (its prompt or a token list was edited since), or `unhashed` (the
 * record predates case hashes, so nothing shows either way). Pure.
 */
export type CaseDrift = 'same' | 'changed' | 'unhashed';
export function caseDrift(rec: Pick<SkillEvalRunRecord, 'caseHash'>, c: SkillEvalCase): CaseDrift {
  if (rec.caseHash === undefined) return 'unhashed';
  return rec.caseHash === hashCase(c) ? 'same' : 'changed';
}

/**
 * Re-draw a recorded turn's verdict under this runner's rules (`--regrade`):
 * the answer and the arm facts are the record's, so no model is asked. A
 * record whose verdict now differs from the one its turn was given keeps that
 * first verdict as `regradedFrom`, across any number of regrades.
 *
 * A record whose case has changed since its turn is refused: grading an old
 * answer against a reworded case is a new measurement nobody ran, not a rule
 * applied again. {@link regradeRecords} sets such cases apart before this runs.
 */
export function regradeRecord(rec: SkillEvalRunRecord, c: SkillEvalCase, catalog: CatalogView, grade: Grader = gradeAnswer): SkillEvalRunRecord {
  if (caseDrift(rec, c) === 'changed') throw new Error(`--regrade: \`${rec.key}\` has changed since the turn ran (record ${rec.caseHash}, now ${hashCase(c)}); a changed case is set apart, never regraded`);
  const { reason: _reason, armEvidence: _ev, regradedFrom: _was, trigger: _trigger, ...rest } = rec;
  const v = verdictOf(c, rec.arm, { process: rec.process, initSeen: rec.reason !== NO_INIT_LINE, bundlesLoaded: rec.bundlesLoaded, skillsInvoked: rec.skillsInvoked, ...(rec.skillFilesRead ? { skillFilesRead: rec.skillFilesRead } : {}), ...(rec.resultSubtype ? { resultSubtype: rec.resultSubtype } : {}), ...(rec.answer !== undefined ? { answer: rec.answer } : {}) }, catalog, grade);
  const out = applyVerdict(rest, v);
  const asRun = rec.regradedFrom ?? rec.verdict;
  return v.verdict === asRun ? out : { ...out, regradedFrom: asRun };
}

export interface RegradeOutcome {
  /** The regraded records: every record of a case still as it ran, or carrying no hash. */
  records: SkillEvalRunRecord[];
  /** The round's cases the summary is drawn over: planned, still in the catalog, and not changed. */
  cases: SkillEvalCase[];
  /** Records whose verdict now differs from the one their turn was given. */
  changed: number;
  /** Records carrying no case hash, regraded against the case as it is now. */
  unhashed: number;
  /**
   * Cases set apart, not regraded and out of every pass rate: `changed` since
   * the round (a record's hash differs), or `removed` from the catalog.
   * Their record files are left as they are.
   */
  setApart: { changed: string[]; removed: string[] };
  /** Cases in the catalog now that the round never planned: left out. */
  added: string[];
}

/**
 * Regrade a recorded round (`--regrade`). Pure over its inputs.
 *
 * `plannedKeys` are the cases the round planned (its summary's), so a case
 * added since is left out instead of counted as not run. A case whose text
 * changed since the round, or that left the catalog, is set apart: its old
 * answers are never graded against new assertions, and the regraded summary
 * names it instead of folding it into a rate. A record with no hash (written
 * before the runner hashed cases) is regraded and counted as `unhashed`.
 */
export function regradeRecords(records: readonly SkillEvalRunRecord[], plannedKeys: readonly string[], catalogCases: readonly SkillEvalCase[], view: CatalogView, grade: Grader = gradeAnswer): RegradeOutcome {
  const now = new Map(catalogCases.map((c) => [c.key, c]));
  const planned = new Set(plannedKeys);
  const removed = new Set(plannedKeys.filter((k) => !now.has(k)));
  for (const r of records) if (!now.has(r.key)) removed.add(r.key);
  const changedCases = new Set(records.filter((r) => now.has(r.key) && caseDrift(r, now.get(r.key)!) === 'changed').map((r) => r.key));
  const out: SkillEvalRunRecord[] = [];
  let changed = 0;
  let unhashed = 0;
  for (const r of records) {
    if (removed.has(r.key) || changedCases.has(r.key)) continue;
    const c = now.get(r.key)!;
    if (caseDrift(r, c) === 'unhashed') unhashed += 1;
    const next = regradeRecord(r, c, view, grade);
    if (next.regradedFrom !== undefined) changed += 1;
    out.push(next);
  }
  const keep = (k: string) => planned.has(k) && !removed.has(k) && !changedCases.has(k);
  return {
    records: out,
    cases: catalogCases.filter((c) => keep(c.key)),
    changed,
    unhashed,
    setApart: { changed: [...changedCases].sort(), removed: [...removed].sort() },
    added: catalogCases.filter((c) => !planned.has(c.key)).map((c) => c.key),
  };
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

/**
 * The turns of a round, case-major with both arms adjacent, so a stopped round
 * still holds paired arms; a trigger case takes the with-skill arm only.
 */
export function planRound(cases: readonly SkillEvalCase[], repeats: number): RoundJob[] {
  const jobs: RoundJob[] = [];
  for (let r = 1; r <= repeats; r++) for (const c of cases) for (const arm of armsOf(c)) jobs.push({ case: c, arm, repeat: r });
  return jobs;
}

export const runRecordFile = (j: { case: SkillEvalCase; arm: Arm; repeat: number }): string =>
  `${j.case.bundle}__${j.case.file.replace(/\.json$/, '')}__${String(j.case.id)}__${j.arm}__r${j.repeat}.json`;

export interface RoundOptions {
  bin: string;
  skillsRoot: string;
  catalog: CatalogView;
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
        placeCaseFiles(job.case.files, job.case.bundle, opts.skillsRoot, dir.cwd);
        const run = await runTurn(opts.bin, armArgs(dir.mcpConfigPath, opts), { cwd: dir.cwd, input: job.case.prompt, timeoutMs: opts.caseTimeoutMs, env });
        const rec = judgeTurn(job.case, job.arm, job.repeat, run, opts.catalog, startedAt);
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
