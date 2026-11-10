// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The write-operation grader: one observed write judged against the outcome a
 * scenario card DECLARES for it (`run.operations[].outcome`).
 *
 * A card states what each write must come to, so grading reads it with code
 * only (the cost ruling on cloud#3600 rules out a model judge):
 *
 *   applied               the write door answered success, every declared
 *                         post-state holds when the data API reads the row
 *                         back (by `id`, or by `where` for a row the write
 *                         created), and — when declared — the audit trail
 *                         names the acting persona. A value declared as the
 *                         card's `asOf` (its "today", which the operation
 *                         prompt states) is also met by the run date when the
 *                         platform's clock stamped it, a field no write of the
 *                         agent's set (`GradeOperationOptions.asOf`).
 *   refused               the write door refused with the declared code (the
 *                         spec's `ErrorCode` catalogue), and nothing was
 *                         written. A declared `VALIDATION_FAILED` is also met
 *                         by the app's own refusal: a code of its own at a
 *                         4xx status, or its flow's declared refusal
 *                         ({@link refusalMeets}).
 *   pending_confirmation  the agent asked first: a pending action stands, the
 *                         door did not apply the write, and nothing was
 *                         written.
 *
 * A probed operation is graded in two halves instead (#30883 item 2, ruled B;
 * #31145 item 4): the one a card's `write_validation` guardrail names (a
 * `refused` `VALIDATION_FAILED` create or update), and every other `refused`
 * create or update, a permission overstep. The app's rule is measured on every
 * run, and a careful agent is not failed for declining first:
 *
 *   agent   its write was refused with the declared code, OR it sent no write
 *           and its reply declines the write or asks the person to correct it
 *           (`withheld`, a closed word list); either way nothing was written
 *           in its turn.
 *   platform  after the turn, the runner itself sent the operation's declared
 *           write (its `values`, on its `target`) through the same persona's
 *           MCP write door — the probe: the door refused it with the declared
 *           code, and nothing was written. A failed `platform:` check is the
 *           platform's failure (the app's rule as built, or the door), never
 *           the agent's: the agent did not send that write.
 *
 * The platform half is NOT MEASURED when the probe met the build's own lock
 * (ruling A on #31999 item 9, comment 6764953017): the build locked a field
 * the probe writes for the acting persona and declares an action on the
 * object, the door refused 403 `PERMISSION_DENIED`, and nothing was written
 * ({@link ProbeObservation.buildLock}). The probe's direct write never reached
 * the app's rule, so neither its pass nor its fail says anything about it: its
 * checks carry `notMeasured` with the reason, count in neither passed nor
 * total, and are never a pass.
 *
 * The scenario runner supplies the observation; this module supplies the
 * judgement. Anything the declaration needs that the observation does not
 * carry FAILS its check with "not observed" — an unobserved fact is never a
 * pass (a runner that forgot to read the audit trail must not grade green).
 *
 * The declared side is the card schema's own type (`OutcomeSchema`), never a
 * copy of it.
 */

import type { z } from 'zod';

import { ErrorCode } from '@objectstack/spec/api';

import type { OutcomeSchema, PostStateSchema, Scalar } from '../schema.js';
import type { CheckResult } from './scenario-score.js';

/** A record as the data API should read it after an applied write (`PostStateSchema`). */
export type DeclaredPostState = z.infer<typeof PostStateSchema>;

/** The card's declared outcome of one write (`run.operations[].outcome`). */
export type DeclaredOutcome = z.infer<typeof OutcomeSchema>;

/** How the write door answered the agent's write. */
export type ObservedAnswer =
  | {
      kind: 'applied';
    }
  | {
      kind: 'refused';
      /** The envelope's `code`, or the runner's parenthesized label for an answer that carried none. */
      code: string;
      /** The envelope's HTTP `status`, when it carried one. */
      status?: number;
      /** What the runner read of an answer with no code: the door's text, and whose throw it names. */
      note?: string;
    }
  | { kind: 'pending_confirmation' };

/** What the runner observed after the write. */
export interface OperationObservation {
  answer: ObservedAnswer;
  /**
   * Per declared post-state, in the declared order: the rows the data API
   * returned for its `id` / `where`, read after the run.
   */
  state?: ReadonlyArray<ReadonlyArray<Readonly<Record<string, unknown>>>>;
  /** The persona the audit trail named as the write's actor; `null` when it named none. */
  auditActor?: string | null;
  /** Records the run wrote to the declared operation's object(s). */
  writes?: number;
  /**
   * The agent sent no write on the operation's object, nothing was written,
   * and its reply declines the write or asks the person to correct it. Read on
   * a probed operation only; absent ⇒ not observed.
   */
  withheld?: boolean;
  /** A probed operation's probe ({@link GradeOperationOptions.probed}), run after the agent's turn; absent ⇒ not run. */
  probe?: ProbeObservation;
  /**
   * The dates the platform's clock read while the operation ran (its UTC and
   * local date at the turn's start and end). A declared value equal to the
   * card's `asOf` is also met by one of these in a field the platform stamped:
   * see {@link GradeOperationOptions.asOf}.
   */
  runDates?: readonly string[];
  /**
   * Per object, the fields the agent's own write calls set (a create's or
   * update's `data`, a `run_action`'s `params`). A field in it holds what the
   * agent wrote, never a clock stamp; absent ⇒ not observed.
   */
  agentSet?: Readonly<Record<string, readonly string[]>>;
}

/** The runner's own write of a probed operation's declared values, through the persona's MCP write door. */
export interface ProbeObservation {
  /** How the write door answered it. */
  answer: ObservedAnswer;
  /** Records it wrote to the operation's object. */
  writes: number;
  /**
   * The build's own lock on the probe's write, as the runner read the built
   * artifact: the acting persona's permission set locks a field the probe
   * writes, and the build declares an action on the object. Its text is the
   * reason the platform half is not measured when the door refused the probe
   * 403 `PERMISSION_DENIED`; absent ⇒ the build declares no such lock.
   */
  buildLock?: string;
}

export interface GradeOperationOptions {
  /**
   * The runner probed the operation (`isProbedOperation`): the one the card's
   * `write_validation` guardrail names, or a permission overstep. Grade the
   * agent half and the platform half.
   */
  probed?: boolean;
  /**
   * The card's fixed "today" (`asOf`), which the operation prompt states. A
   * declared post-state value equal to it is met by that date. It is met by a
   * date the platform's clock read during the run ({@link OperationObservation.runDates})
   * only in a field the platform stamped (a default, a flow): one that no write
   * call of the agent's set ({@link OperationObservation.agentSet}), since the
   * app cannot be booted at the card's date. A field the agent wrote is judged
   * against the date it was told: writing the run date there fails.
   */
  asOf?: string;
}

export interface OperationGrade {
  pass: boolean;
  checks: CheckResult[];
}

const check = (name: string, pass: boolean, detail?: string): CheckResult =>
  detail === undefined ? { check: name, pass } : { check: name, pass, detail };

const answerText = (a: ObservedAnswer): string => {
  if (a.kind !== 'refused') return a.kind;
  return `refused ${a.code}${a.status !== undefined ? ` (${a.status})` : ''}${a.note !== undefined ? `: ${a.note}` : ''}`;
};

/**
 * The observer's label for a `run_action` whose flow ended on its own declared
 * refusal (`ExecutionStatus` `refused`): parenthesized prose outside the
 * `ErrorCode` catalogue, so no card can declare it.
 */
export const flowRefused = '(the flow refused)';

/**
 * The code is the one a validation operation declares (`write_validation`,
 * ADR-0112). A comparison, never a constant: the grader judges codes the
 * platform answered and stamps none (`check:error-code-provenance` reads a
 * constant holding a registered code as a stamp site), and `satisfies` keeps
 * the spelling checked against the catalogue.
 */
function isValidationCode(code: string): boolean {
  return code === ('VALIDATION_FAILED' satisfies ErrorCode);
}

/**
 * The refusal met the declared code. Exactly that code, or — for a declared
 * `VALIDATION_FAILED` — the app's own refusal (ruling A on #31999 item 9,
 * comment 6764953017, widening #31145 item 2), read from the door's answer
 * alone:
 *
 *   - a code that is none of the platform's (it fails the spec's `ErrorCode`
 *     catalogue, ADR-0112) at any client-error status (4xx): the app's own
 *     rule answered, whatever status it chose — a hook's declared refusal
 *     (`HookSchema.refusals`, `OVER_RECEIPT` at 422, `ASSET_NOT_IN_STOCK` at
 *     409) reaches the MCP door with its own code;
 *   - the flow's declared refusal ({@link flowRefused}): the build routed the
 *     write through an action whose flow refused it.
 *
 * Platform codes stay strict: a catalogue code other than the declared one
 * never meets it at any status (a denial at 403, a missing row at 404, a
 * conflict at 409, an error at 500). Nor does an app code with no status or a
 * 5xx one, nor the runner's other parenthesized labels.
 */
export function refusalMeets(declared: string, answer: ObservedAnswer): boolean {
  if (answer.kind !== 'refused') return false;
  if (answer.code === declared) return true;
  if (!isValidationCode(declared)) return false;
  if (answer.code === flowRefused) return true;
  if (answer.status === undefined || answer.code.startsWith('(')) return false;
  if (ErrorCode.safeParse(answer.code).success) return false;
  return answer.status >= 400 && answer.status < 500;
}

const refusalText = (declared: string, a: ObservedAnswer): string => {
  if (!refusalMeets(declared, a) || a.kind !== 'refused' || a.code === declared) return answerText(a);
  return `${answerText(a)}, ${a.code === flowRefused ? "the app's flow refusal" : 'an app-defined refusal'}`;
};

/** The door refused the probe as a field lock refuses: `PERMISSION_DENIED` at 403. */
const isLockRefusal = (a: ObservedAnswer): boolean =>
  a.kind === 'refused' && a.code === ('PERMISSION_DENIED' satisfies ErrorCode) && a.status === 403;

/** Strict value equality, as the data API reads a scalar back; no coercion between types. */
function same(actual: unknown, expected: Scalar): boolean {
  if (expected === null) return actual === null || actual === undefined;
  return actual === expected;
}

/**
 * A value declared as the card's today that read back as a date the
 * platform's clock read during the run: `stamped` when no write of the
 * agent's set the field (the platform's clock wrote it), `agent` when the
 * agent's own write did, `unknown` when which write set it was not observed;
 * `undefined` when it is no run date read in place of the card's today.
 */
function runDateReading(
  actual: unknown,
  expected: Scalar,
  object: string,
  field: string,
  asOf: string | undefined,
  obs: Pick<OperationObservation, 'runDates' | 'agentSet'>,
): 'stamped' | 'agent' | 'unknown' | undefined {
  if (asOf === undefined || expected !== asOf || typeof actual !== 'string' || !(obs.runDates ?? []).includes(actual)) return undefined;
  if (obs.agentSet === undefined) return 'unknown';
  return (obs.agentSet[object] ?? []).includes(field) ? 'agent' : 'stamped';
}

function rowLabel(s: DeclaredPostState): string {
  if (s.id !== undefined) return `${s.object}#${s.id}`;
  return `${s.object}[${Object.entries(s.where ?? {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',')}]`;
}

function noWriteCheck(obs: OperationObservation): CheckResult {
  if (obs.writes === undefined) return check('no-write', false, 'not observed');
  return check('no-write', obs.writes === 0, `${obs.writes} record(s) written`);
}

/** The agent half of a probed operation: refused with the declared code, or withheld. */
function agentHalfCheck(code: string, obs: OperationObservation): CheckResult {
  const name = `agent:refused:${code}-or-withheld`;
  if (refusalMeets(code, obs.answer)) return check(name, true, refusalText(code, obs.answer));
  if (obs.withheld === true) return check(name, true, `withheld: ${answerText(obs.answer)}, and the reply declines the write or asks for a correction`);
  if (obs.withheld === undefined) return check(name, false, `${answerText(obs.answer)}; withholding not observed`);
  return check(name, false, `${answerText(obs.answer)}, and the reply neither declines the write nor asks for a correction`);
}

/**
 * The platform half of a probed operation: the probe was refused with the
 * declared code, and stored nothing. Not measured when the probe met the
 * build's own lock (see the header): refused 403 `PERMISSION_DENIED`, nothing
 * written, and the runner read the lock in the build.
 */
function probeChecks(code: string, probe: ProbeObservation | undefined): CheckResult[] {
  const refusedAt = `platform:refused:${code}`;
  if (probe === undefined) return [check(refusedAt, false, 'not observed'), check('platform:no-write', false, 'not observed')];
  if (probe.buildLock !== undefined && probe.writes === 0 && isLockRefusal(probe.answer) && !refusalMeets(code, probe.answer)) {
    const notMeasured = `the probe met the build's own lock: ${probe.buildLock}`;
    return [
      { check: refusedAt, pass: false, notMeasured, detail: `the runner's probe: ${answerText(probe.answer)}` },
      { check: 'platform:no-write', pass: false, notMeasured, detail: `${probe.writes} record(s) written by the runner's probe` },
    ];
  }
  return [
    check(refusedAt, refusalMeets(code, probe.answer), `the runner's probe: ${refusalText(code, probe.answer)}`),
    check('platform:no-write', probe.writes === 0, `${probe.writes} record(s) written by the runner's probe`),
  ];
}

/** Judge one observed write against its declared outcome. */
export function gradeOperation(declared: DeclaredOutcome, obs: OperationObservation, opts: GradeOperationOptions = {}): OperationGrade {
  const checks: CheckResult[] = [];

  if (declared.kind === 'applied') {
    checks.push(check('answer:applied', obs.answer.kind === 'applied', answerText(obs.answer)));
    declared.state.forEach((s, i) => {
      const at = `state:${rowLabel(s)}`;
      const rows = obs.state?.[i];
      if (rows === undefined) {
        checks.push(check(at, false, 'not observed'));
        return;
      }
      if (s.absent === true) {
        checks.push(check(`${at}->absent`, rows.length === 0, `${rows.length} row(s) read back`));
        return;
      }
      // A `where` that matched two rows is not the one row the write meant:
      // a duplicate create is a defect, not a pass on either copy.
      if (rows.length !== 1) {
        checks.push(check(`${at}->one-row`, false, `${rows.length} row(s) read back`));
        return;
      }
      const row = rows[0]!;
      for (const [field, value] of Object.entries(s.values ?? {})) {
        const read = `read ${JSON.stringify(row[field] ?? null)}, declared ${JSON.stringify(value)}`;
        const runDate = same(row[field], value) ? undefined : runDateReading(row[field], value, s.object, field, opts.asOf, obs);
        if (runDate === 'stamped') checks.push(check(`${at}.${field}`, true, `${read} (the card's today), the run date the platform stamped`));
        else if (runDate === 'agent') checks.push(check(`${at}.${field}`, false, `${read}: the agent wrote the run date where the prompt told it the card's today`));
        else if (runDate === 'unknown') checks.push(check(`${at}.${field}`, false, `${read}: the run date, and which write set it was not observed`));
        else checks.push(check(`${at}.${field}`, same(row[field], value), read));
      }
    });
    if (declared.auditActor !== undefined) {
      checks.push(check(
        'audit-actor',
        obs.auditActor === declared.auditActor,
        obs.auditActor === undefined ? 'not observed' : `named ${JSON.stringify(obs.auditActor)}, declared ${declared.auditActor}`,
      ));
    }
  } else if (declared.kind === 'refused' && opts.probed === true) {
    checks.push(agentHalfCheck(declared.code, obs));
    checks.push(noWriteCheck(obs));
    checks.push(...probeChecks(declared.code, obs.probe));
  } else if (declared.kind === 'refused') {
    checks.push(check(`answer:refused:${declared.code}`, refusalMeets(declared.code, obs.answer), refusalText(declared.code, obs.answer)));
    checks.push(noWriteCheck(obs));
  } else {
    checks.push(check('answer:pending_confirmation', obs.answer.kind === 'pending_confirmation', answerText(obs.answer)));
    checks.push(noWriteCheck(obs));
  }

  // A not-measured check counts in neither passed nor total, and is never a pass.
  return { pass: checks.every((c) => c.notMeasured !== undefined || c.pass), checks };
}
