// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 D4] The one refusal every evaluator answers for a fixed-read leaf
 * (`@objectstack/spec/data`'s `isFixedReadLeaf`: `SharedRecordIds` today,
 * ADR-0147's leaf on the card that adds it) it will not evaluate, and its
 * once-per-evaluator log.
 *
 * It is ADR-0139 D3's envelope (ADR-0112): `INTERNAL_ERROR` / 500, a message
 * naming the evaluator, the leaf and the remedy, logged at `error` once per
 * evaluator. ⛔ Not `INVALID_FILTER`: no request can spell the leaf, so the
 * fault is a composition's, never an author's. An UNBRANDED copy is a
 * different fault and keeps its own answer at the comparand door
 * (`INVALID_FILTER` / 400, a non-list comparand).
 *
 * Who answers it:
 *
 *  - **the engine's executor seam** (`@objectstack/objectql`,
 *    `fixed-read-leaf-seam.ts`), for a leaf out of position, on the wrong
 *    verb, for another principal, in one of the two classes it recognises,
 *    or bound for a driver whose `DriverCapabilities.fixedReadLeaves` does not
 *    name it;
 *  - **every evaluator that cannot run the leaf**, on its own card (ADR-0155
 *    plan steps 3 to 5).
 *
 * Built once for every fixed-read leaf (ADR-0155 D4, "Built once"), on the
 * floor every evaluator already stands on, beside
 * `readable-ids-driver-refusal.ts`, whose once-per-instance log it shares
 * ({@link logRefusalOnce}).
 */

import { fixedInnerReadOf, fixedReadLeafNameOf, isFixedReadLeaf } from '@objectstack/spec/data';
import { logRefusalOnce, type ReadableIdsRefusalLog } from './readable-ids-driver-refusal.js';

/** The ADR-0112 envelope of the refusal: a composition fault, never `INVALID_FILTER`. */
export type FixedReadLeafRefusalError = Error & {
  code: 'INTERNAL_ERROR';
  status: 500;
  httpStatus: 500;
  /** The object the refused operation runs on, when the refusing evaluator knows it. */
  object?: string;
};

/**
 * How every refusal names the leaf at `at`: its name and the one table its
 * fixed inner read reads, never its inputs (a recipient is a principal's id,
 * and the message reaches logs).
 *
 * `leaf` is `unknown` on purpose: the brand is a `unique symbol`, and a caller
 * in another package can hold the leaf's type from the other module format's
 * declarations of `@objectstack/spec`, which TypeScript reads as a second,
 * unrelated symbol. The guard decides at run time instead.
 */
export function describeFixedReadLeaf(at: string, leaf: unknown): string {
  if (!isFixedReadLeaf(leaf)) return `${at} holds a value that is not a fixed-read leaf`;
  return `${at} holds a ${fixedReadLeafNameOf(leaf)} leaf, a fixed read of '${fixedInnerReadOf(leaf).table}'`;
}

/**
 * The refusal `evaluator` (a driver's or the engine seam's name, e.g.
 * `driver-sql`) answers, with `message` naming the leaf, why and the remedy.
 */
export function fixedReadLeafRefusal(evaluator: string, message: string, object?: string): FixedReadLeafRefusalError {
  const err = new Error(`[${evaluator}] ${message}`) as FixedReadLeafRefusalError;
  err.code = 'INTERNAL_ERROR';
  err.status = 500;
  err.httpStatus = 500;
  if (object !== undefined) err.object = object;
  return err;
}

/**
 * {@link fixedReadLeafRefusal}, logged at `error` the FIRST time this
 * evaluator refuses (`state.logged` is that evaluator's own flag), and
 * returned for the caller to throw. A composition fault means every such
 * operation on this evaluator fails, so one line names it; the caller sees
 * every refusal.
 */
export function refuseFixedReadLeafOnce(
  evaluator: string,
  message: string,
  log: ReadableIdsRefusalLog | undefined,
  state: { logged: boolean },
  object?: string,
): FixedReadLeafRefusalError {
  const err = fixedReadLeafRefusal(evaluator, message, object);
  logRefusalOnce(err, log, state, 'evaluator');
  return err;
}
