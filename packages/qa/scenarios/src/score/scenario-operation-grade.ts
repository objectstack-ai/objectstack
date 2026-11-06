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
 *                         names the acting persona.
 *   refused               the write door refused with exactly the declared
 *                         code (the spec's `ErrorCode` catalogue), and nothing
 *                         was written.
 *   pending_confirmation  the agent asked first: a pending action stands, the
 *                         door did not apply the write, and nothing was
 *                         written.
 *
 * The operation a card's `write_validation` guardrail names (a `refused`
 * `VALIDATION_FAILED` create or update) is graded in two halves instead
 * (#30883 item 2, ruled B), so the app's validation rule is measured on every
 * run and a careful agent is not failed for catching the bad value first:
 *
 *   agent   its write was refused with exactly the declared code, OR it sent
 *           no write and its reply declines the write or asks the person to
 *           correct it (`withheld`, a closed word list); either way nothing
 *           was written in its turn.
 *   platform  after the turn, the runner itself sent the operation's declared
 *           write (its `values`, on its `target`) through the same persona's
 *           MCP write door — the probe: the door refused it with exactly the
 *           declared code, and nothing was written. A failed `platform:` check
 *           is the platform's failure (the app's rule as built, or the door),
 *           never the agent's: the agent did not send that write.
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

import type { OutcomeSchema, PostStateSchema, Scalar } from '../schema.js';
import type { CheckResult } from './scenario-score.js';

/** A record as the data API should read it after an applied write (`PostStateSchema`). */
export type DeclaredPostState = z.infer<typeof PostStateSchema>;

/** The card's declared outcome of one write (`run.operations[].outcome`). */
export type DeclaredOutcome = z.infer<typeof OutcomeSchema>;

/** How the write door answered the agent's write. */
export type ObservedAnswer =
  | { kind: 'applied' }
  | { kind: 'refused'; code: string }
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
   * a validation operation only; absent ⇒ not observed.
   */
  withheld?: boolean;
  /** A validation operation's probe, run after the agent's turn; absent ⇒ not run. */
  probe?: ProbeObservation;
}

/** The runner's own write of a validation operation's declared values, through the persona's MCP write door. */
export interface ProbeObservation {
  /** How the write door answered it. */
  answer: ObservedAnswer;
  /** Records it wrote to the operation's object. */
  writes: number;
}

export interface GradeOperationOptions {
  /** The operation is the one the card's `write_validation` guardrail names: grade the agent half and the platform half. */
  validation?: boolean;
}

export interface OperationGrade {
  pass: boolean;
  checks: CheckResult[];
}

const check = (name: string, pass: boolean, detail?: string): CheckResult =>
  detail === undefined ? { check: name, pass } : { check: name, pass, detail };

const answerText = (a: ObservedAnswer): string => (a.kind === 'refused' ? `refused ${a.code}` : a.kind);

/** Strict value equality, as the data API reads a scalar back; no coercion between types. */
function same(actual: unknown, expected: Scalar): boolean {
  if (expected === null) return actual === null || actual === undefined;
  return actual === expected;
}

function rowLabel(s: DeclaredPostState): string {
  if (s.id !== undefined) return `${s.object}#${s.id}`;
  return `${s.object}[${Object.entries(s.where ?? {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',')}]`;
}

function noWriteCheck(obs: OperationObservation): CheckResult {
  if (obs.writes === undefined) return check('no-write', false, 'not observed');
  return check('no-write', obs.writes === 0, `${obs.writes} record(s) written`);
}

/** The agent half of a validation operation: refused with the declared code, or withheld. */
function agentValidationCheck(code: string, obs: OperationObservation): CheckResult {
  const name = `agent:refused:${code}-or-withheld`;
  if (obs.answer.kind === 'refused' && obs.answer.code === code) return check(name, true, answerText(obs.answer));
  if (obs.withheld === true) return check(name, true, `withheld: ${answerText(obs.answer)}, and the reply declines the write or asks for a correction`);
  if (obs.withheld === undefined) return check(name, false, `${answerText(obs.answer)}; withholding not observed`);
  return check(name, false, `${answerText(obs.answer)}, and the reply neither declines the write nor asks for a correction`);
}

/** The platform half of a validation operation: the probe was refused with the declared code, and stored nothing. */
function probeChecks(code: string, probe: ProbeObservation | undefined): CheckResult[] {
  const refusedAt = `platform:refused:${code}`;
  if (probe === undefined) return [check(refusedAt, false, 'not observed'), check('platform:no-write', false, 'not observed')];
  return [
    check(refusedAt, probe.answer.kind === 'refused' && probe.answer.code === code, `the runner's probe: ${answerText(probe.answer)}`),
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
        checks.push(check(`${at}.${field}`, same(row[field], value), `read ${JSON.stringify(row[field] ?? null)}, declared ${JSON.stringify(value)}`));
      }
    });
    if (declared.auditActor !== undefined) {
      checks.push(check(
        'audit-actor',
        obs.auditActor === declared.auditActor,
        obs.auditActor === undefined ? 'not observed' : `named ${JSON.stringify(obs.auditActor)}, declared ${declared.auditActor}`,
      ));
    }
  } else if (declared.kind === 'refused' && opts.validation === true) {
    checks.push(agentValidationCheck(declared.code, obs));
    checks.push(noWriteCheck(obs));
    checks.push(...probeChecks(declared.code, obs.probe));
  } else if (declared.kind === 'refused') {
    checks.push(check(
      `answer:refused:${declared.code}`,
      obs.answer.kind === 'refused' && obs.answer.code === declared.code,
      answerText(obs.answer),
    ));
    checks.push(noWriteCheck(obs));
  } else {
    checks.push(check('answer:pending_confirmation', obs.answer.kind === 'pending_confirmation', answerText(obs.answer)));
    checks.push(noWriteCheck(obs));
  }

  return { pass: checks.every((c) => c.pass), checks };
}
