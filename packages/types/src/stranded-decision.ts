// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The machine-readable half of a `RESUME_FAILED` — a decision that is durably
 * recorded whose flow run could not be resumed (#13807).
 *
 * ## The condition
 *
 * An approval decision finalises: the `sys_approval_request` row flips to its
 * terminal status, the audit action is written, the record's mirrored status
 * field advances — and only THEN is the owning flow run resumed. When that
 * resume fails the writes are already durable, so the outcome stands and the
 * run is stranded. `@objectstack/plugin-approvals` throws rather than
 * answering `resumed: false`, deliberately: a recorded decision whose flow
 * never advances is #4420's zombie half-state, and the contract
 * (`ApprovalDecisionResult`) declares the throw intentional.
 *
 * ⛔ This module does NOT change that posture. The maintainer ruled on
 * 2026-09-04 (decision batch #37, option B) that the door **keeps its status
 * code** — the 500-class `RESUME_FAILED` — because the effect landing while
 * the run strands is still a failure. What the ruling changed is that the
 * throw must be *truthful*: the facts a caller needs were being discarded.
 *
 * ## What was being discarded, measured
 *
 * Three states coexist after such a call: the caller reads 500, the request
 * IS in its terminal status, and the run is stranded. A caller — human,
 * script, or agent — reads 500 as "the rejection did not happen" and retries
 * or escalates. It did happen. Before this module the only carrier of that
 * fact was English prose in `error`, so an operator had to regex the run id
 * out of a sentence, and nothing said whether the run was repairable at all.
 *
 * Meanwhile the engine already knew. `AutomationResult.status: 'stranded'`
 * (`@objectstack/spec`, `automation-service.ts`) is stamped on exactly the
 * exit that journals a repair snapshot — the shape-4 name from #13937 — and
 * it is distinct from `'failed'` on purpose: `'failed'` says the run ran and
 * was rejected, `'stranded'` says a recorded continuation stopped mid-flight
 * and an operator has something to repair. It had a producer and, until this
 * module, **zero consumers**: the approvals door read only
 * `success` / `code` / `error` off the resume result and dropped it one line
 * before the envelope was built.
 *
 * ## Why it lives in `@objectstack/types`
 *
 * Same Home rule as {@link ValidationFailureDetails} one file over: the
 * PRODUCER is `@objectstack/plugin-approvals` and the CONSUMER is the REST
 * door in `@objectstack/rest`, and rest cannot import a plugin. Both already
 * depend on this package, so the shared declaration adds no dependency edge —
 * and keeping the constructor and the reader in ONE module is what stops the
 * two sides from drifting into a stringly-typed agreement about a property
 * name.
 *
 * ⛔ Deliberately NOT a tolerant reader. There is no alias chain and no prose
 * parsing: a body either carries the four facts the producer attached, or the
 * response is exactly what it was before. A `RESUME_FAILED` raised by
 * something that never had a decision to report (a test double, a future
 * caller) must not be dressed up as one.
 */

/**
 * The four facts a stranded decision publishes alongside its `code` and
 * `error`. Every field is present or the whole envelope is absent — a partial
 * one would let a consumer branch on `finalized === undefined` and read it as
 * "the decision did not stand", which is the exact misreading this exists to
 * end.
 */
export interface StrandedDecisionDetails {
  /**
   * Always `true`. The decision reached a terminal state and is durable; the
   * 5xx is about the run, never about the decision. Spelled as a literal
   * rather than omitted so a consumer reads a fact instead of an absence.
   */
  finalized: true;
  /**
   * Which outcome was recorded — `'approve'` / `'reject'` for a decision, and
   * the sibling doors on the same path for the rest (`'revise'` on a
   * send-back, `'resubmit'`). Free-form by design: the vocabulary belongs to
   * the producing service, not to this recogniser.
   */
  decision: string;
  /** The stranded run. The one identifier an operator needs to act. */
  runId: string;
  /**
   * Whether the engine says this run can still be repaired — derived from the
   * engine's own discriminator (`AutomationResult.status === 'stranded'`),
   * never from the message text and never assumed.
   *
   * `false` is the honest answer for every other exit, including the ones
   * that report no status at all (a lost run, an engine that predates the
   * discriminator). ⛔ Absence of the signal is not repairability: promising a
   * repair verb that will refuse is worse than promising nothing.
   */
  repairable: boolean;
}

/** Property under which {@link StrandedDecisionDetails} rides a thrown error. */
const CARRIER = 'strandedDecision';

/**
 * Structured details for a thrown stranded-decision failure, or `undefined`
 * when `err` is not one.
 *
 * Callers use the `undefined` result as the predicate and the returned object
 * as the payload, so the two can never disagree — the same contract
 * `validationFailureDetails` keeps one module over. Every field is validated:
 * a malformed carrier answers `undefined` rather than putting a half-envelope
 * on the wire.
 */
export function strandedDecisionDetails(err: unknown): StrandedDecisionDetails | undefined {
  const carried = (err as Record<string, unknown> | null | undefined)?.[CARRIER];
  if (!carried || typeof carried !== 'object') return undefined;
  const d = carried as Partial<StrandedDecisionDetails>;
  if (d.finalized !== true) return undefined;
  if (typeof d.decision !== 'string' || d.decision === '') return undefined;
  if (typeof d.runId !== 'string' || d.runId === '') return undefined;
  if (typeof d.repairable !== 'boolean') return undefined;
  return { finalized: true, decision: d.decision, runId: d.runId, repairable: d.repairable };
}

/**
 * The CONSTRUCTOR for the shape {@link strandedDecisionDetails} recognises —
 * kept in the same module so the two can never drift.
 *
 * The message stays the producer's own, unchanged: the prose is what a human
 * reads in a log, the details are what a machine reads on the wire, and this
 * ruling added the second without touching the first.
 */
export function strandedDecisionFailure(
  message: string,
  details: StrandedDecisionDetails,
): Error {
  const err = new Error(message) as Error & { [CARRIER]?: StrandedDecisionDetails };
  err[CARRIER] = details;
  return err;
}
