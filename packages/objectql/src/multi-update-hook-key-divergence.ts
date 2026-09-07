// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14099] The refusal that ends "one hook-mutated payload, applied to every
 * matched row" — ADR-0058 Addendum II D3, ENFORCED rather than merely stated.
 *
 * ## The corruption this retires
 *
 * `driver.updateMany` takes ONE `SET` clause for N rows, so D3 makes the
 * predicate write's payload batch-scoped and hands every per-row `before*`
 * dispatch THE payload rather than a copy. The addendum names the residual
 * hazard in as many words: a rewrite CONDITIONED on the row
 * (`ctx.previous`, `ctx.input.id`) "does not scope itself to the row it was
 * decided on, it widens to every matched row" — and until this module it said
 * so as "a contract statement, not an enforcement".
 *
 * Measured downstream, against published 17.2.0: `duly_task` carries a
 * `readonly` `completed_at` stamped by a `beforeUpdate` hook on the transition
 * into `done`. Two rows — one open, one completed earlier — updated in one
 * `multi: true` call. The already-done row's `completed_at` MOVED, from
 * `…:26.560Z` to `…:26.571Z`. It did not transition. Nothing errored, and the
 * corrupted row is byte-for-byte indistinguishable from one that really was
 * completed late — which is what turns a compliant record into a breach in
 * every on-time measure that reads the column. The whole class is exposed:
 * `approved_at`, `closed_at`, `shipped_at`, `first_responded_at`.
 *
 * ## The criterion is the KEY SET, never the values
 *
 * Maintainer ruling of 2026-09-02 (recommendation C, on the decision batch that
 * kept Addendum II D3 standing):
 *
 * > On a `multi: true` update the engine keeps dispatching the before-phase
 * > hooks per row with the per-row pre-image and records, per row, the set of
 * > payload keys the hook chain assigned. If the recorded key sets differ
 * > between any two rows, the whole batch is refused before any write … If
 * > every row's key set is identical, the batch proceeds as one `updateMany`
 * > with the batch payload, exactly as D3 says. The criterion is the key set,
 * > never the values, so the audit stamp's per-row clock reads cannot make an
 * > honest batch non-deterministic.
 *
 * ⛔ Do not "tighten" this to compare VALUES. That variant was rejected on
 * measurement twice over, and both measurements are recoverable only here:
 *
 *  - objectql's own `sys_stamp_audit_update` builtin is registered on `'*'`,
 *    so it runs in essentially every deployment, and it reads the clock INSIDE
 *    the per-record stamp. Under per-row dispatch that is one clock read per
 *    row, so two rows either side of a millisecond boundary carry different
 *    `updated_at` VALUES on an entirely honest batch. A value comparison would
 *    refuse it non-deterministically — the failure direction nobody can debug.
 *  - A value comparison also re-breaks #14088's own row: a hook that
 *    deliberately writes the value the caller also sent (`completed_at: null`
 *    on a reopen, against a caller that round-tripped the record) is
 *    indistinguishable, by value, from a hook that never touched the key. That
 *    is the defect `hook-write-provenance.ts` exists to remove; a value test
 *    here would reintroduce it one seam over.
 *
 * The key set is what {@link recordHookPayloadWrites} already records, so this
 * refusal adds no new instrument — it reads the #14088 recorder, armed per row.
 *
 * ## What is NOT covered, named rather than hidden
 *
 * A hook that writes the SAME key on every row but with per-row VALUES (a
 * per-row derived priority, say) passes this test and still applies ONE row's
 * value to every matched row. The ruling's own sentence says "the first row's
 * value"; the engine's MEASURED behaviour is the LAST dispatch's, because the
 * per-row rewrites accumulate onto one payload in dispatch order and the last
 * assignment to a key is what the single `SET` clause carries. Pinned in both
 * suites — `bulk-write-per-row-hooks.test.ts`'s D3 case reads
 * `['stamped-2','stamped-2']`, and this module's own residue pin reads `low`
 * on the row whose own dispatch derived `high`. Which row wins changes nothing
 * about the ruling's verdict; it is corrected here because a docblock naming
 * the wrong row sends the next author hunting for a per-row seam that does not
 * exist. That is D3's cost by design; the ruling carries it openly and points
 * at the prescription below as the exit. This module does not widen to cover
 * it, and a future author reaching for a value comparison to close it must
 * re-read the two measurements above first.
 *
 * ## Divergence is `union` minus `intersection`
 *
 * The diverging keys are every key some row's window holds and some other
 * row's does not — order-independent by construction, so the envelope names
 * the same keys whatever order the driver returned the matched rows in, and it
 * names ALL of them rather than the first pair to disagree.
 *
 * ## When the recording cannot speak, the batch is not judged at all
 *
 * That decision does not live here, deliberately: it is the ENGINE that knows
 * whether its recording survived the batch. A hook may REPLACE
 * `ctx.input.data` rather than mutate it, and the replacement's keys are
 * indistinguishable from the caller's (`hook-write-provenance.ts`'s KNOWN
 * LIMIT) — so `seal` returns no record, and the engine skips this comparison
 * entirely instead of feeding it windows that describe a payload the batch no
 * longer writes. Refusing on a measurement that no longer applies would be a
 * fabricated verdict; abstaining keeps the pre-#14099 behaviour for that
 * shape, which is the same fail-safe direction #14088 chose for the same
 * limit. This function therefore takes real key sets only, and reading a
 * missing row as an empty set is not a case it can be handed.
 */

/**
 * The keys whose presence in the hook chain's writes DIFFERS across the rows
 * of one predicate update, sorted; `[]` when every row agreed (which includes
 * a batch of one row, and a batch where no hook wrote anything).
 *
 * Each entry is one row's OBSERVATION WINDOW —
 * {@link HookWriteRecording.closeWindow}'s return, the keys that row's chain
 * assigned. Pure and total: it never throws and never reads the engine. The
 * engine raises; the contract decides.
 */
export function divergingHookPayloadKeys(perRow: readonly ReadonlySet<string>[]): string[] {
  if (perRow.length < 2) return [];
  const union = new Set<string>();
  for (const set of perRow) for (const key of set) union.add(key);
  const diverging: string[] = [];
  for (const key of union) {
    if (!perRow.every((set) => set.has(key))) diverging.push(key);
  }
  return diverging.sort();
}

/**
 * The wire code, registered in the spec's `ERROR_CODE_LEDGER` under
 * `@objectstack/objectql`.
 *
 * ⚠️ A REGISTERED ADR-0112 code rather than the `ERR_`-prefixed operational
 * kind its `HookTargetRebindError` neighbour uses, and the difference is not
 * stylistic: the whole value of this refusal is that the application RECOGNISES
 * it and takes the prescription. An unregistered spelling demotes off
 * `error.code` at the dispatcher door and rides `declaredCode` instead, which
 * is exactly the wrong place for the one code `duly` and `hotcrm` have to
 * branch on. `FILE_FIELD_BULK_WRITE_REFUSED` — the same seam, the same shape of
 * refusal, one predicate write over — made the same call for the same reason.
 */
export const MULTI_UPDATE_HOOK_KEY_DIVERGENCE_CODE = 'MULTI_UPDATE_HOOK_KEY_DIVERGENCE' as const;

/**
 * `400`, taken from `FileFieldBulkWriteError`'s reasoning verbatim because the
 * verdict is the same one: the write is expressible and permitted, it just
 * cannot be expressed as ONE payload, and the remedy belongs to the caller.
 * Not `409` — nothing about the stored rows is in conflict, and nothing changes
 * if the caller retries later.
 */
export const MULTI_UPDATE_HOOK_KEY_DIVERGENCE_STATUS = 400 as const;

/**
 * The ADR-0112 envelope a `multi: true` update raises when its per-row
 * `beforeUpdate` dispatches assigned DIFFERENT sets of payload keys.
 *
 * Thrown from the per-row before-phase, which runs outside `update()`'s own
 * `try` block, so it reaches the caller intact — and, decisively, BEFORE the
 * payload is sealed, before both readonly strips, before validation and before
 * any `driver.updateMany`. Nothing is written: not the first row, not a
 * transaction that then rolls back.
 */
export class MultiUpdateHookKeyDivergenceError extends Error {
  override readonly name = 'MultiUpdateHookKeyDivergenceError';
  readonly code = MULTI_UPDATE_HOOK_KEY_DIVERGENCE_CODE;
  readonly status = MULTI_UPDATE_HOOK_KEY_DIVERGENCE_STATUS;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = MULTI_UPDATE_HOOK_KEY_DIVERGENCE_STATUS;
  /** The object the refused batch targeted. */
  readonly object: string;
  /** The keys whose presence differed across rows, sorted. */
  readonly keys: readonly string[];
  /** How many rows the predicate matched — the batch that was refused whole. */
  readonly rows: number;
  /** The remedy half, addressed to the hook's author rather than to a user. */
  readonly developerMessage: string;

  constructor(object: string, keys: readonly string[], rows: number) {
    super(buildMessage(object, keys, rows));
    this.object = object;
    this.keys = [...keys];
    this.rows = rows;
    this.developerMessage =
      `A predicate update sends ONE 'SET' clause to the driver, so there is exactly one payload ` +
      `for all ${rows} matched records (ADR-0058 Addendum II D3) — whatever a 'beforeUpdate' handler ` +
      `writes for one row is applied to every row. The handler wrote ` +
      `${keys.map((k) => `'${k}'`).join(', ')} for some of these records and not for others, which ` +
      `means it is deciding per record; the engine refuses rather than applying one record's ` +
      `derived value to all of them. Two supported ways to express it: write the affected records ` +
      `from INSIDE the handler with 'ctx.api' (a per-row write, which the handler's own sandbox ` +
      `signals — 'ctx.dispatch.mode', 'ctx.input.id' — let it aim), or have the caller issue the ` +
      `updates by id. Branch on \`code === '${MULTI_UPDATE_HOOK_KEY_DIVERGENCE_CODE}'\` (ADR-0112) ` +
      `to detect this.`;
  }
}

/**
 * The user-facing sentence.
 *
 * ⛔ It must not begin with a SQL verb — `@objectstack/rest`'s importer runs
 * row errors through `sanitizeRowError`, whose SQL backstop replaces any
 * message STARTING with `insert`/`update`/`delete` with generic text. The same
 * constraint `DuplicateRecordError`'s message records, measured there.
 */
function buildMessage(object: string, keys: readonly string[], rows: number): string {
  const named = keys.map((k) => `'${k}'`).join(', ');
  return (
    `Refusing a multi-record update on '${object}': its 'beforeUpdate' handlers wrote ${named} for ` +
    `some of the ${rows} matched records and not for others, and a predicate update has one payload ` +
    `for every record — so one record's value would have been written to all of them. Nothing was ` +
    `written. Write those records individually, from inside the handler with 'ctx.api' or by id.`
  );
}
