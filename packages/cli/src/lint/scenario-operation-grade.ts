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
 * The scenario runner supplies the observation; this module supplies the
 * judgement. Anything the declaration needs that the observation does not
 * carry FAILS its check with "not observed" — an unobserved fact is never a
 * pass (a runner that forgot to read the audit trail must not grade green).
 *
 * ⛔ {@link DeclaredOutcome} mirrors the card's `OutcomeSchema`
 * (`packages/qa/scenarios/src/schema.ts`) field for field, for the reason
 * `scenario-score.ts` gives for `expect`: no dependency on the private package
 * that parses cards. A change there is a change here, in the same shape.
 */

import type { CheckResult } from './scenario-score.js';

type Scalar = string | number | boolean | null;

/** A record as the data API should read it after an applied write. */
export interface DeclaredPostState {
  object: string;
  id?: string;
  where?: Readonly<Record<string, Scalar>>;
  values?: Readonly<Record<string, Scalar>>;
  absent?: true;
}

/** The card's declared outcome of one write. */
export type DeclaredOutcome =
  | { kind: 'applied'; state: readonly DeclaredPostState[]; auditActor?: string }
  | { kind: 'refused'; code: string }
  | { kind: 'pending_confirmation' };

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

/** Judge one observed write against its declared outcome. */
export function gradeOperation(declared: DeclaredOutcome, obs: OperationObservation): OperationGrade {
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
