// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The **bulk-write hook dispatch contract** — what a predicate (`multi: true`)
 * update/delete hands a lifecycle hook, in BOTH phases, stated once so the
 * engine, the record-change trigger and every guard hook are held to the same
 * yardstick.
 *
 * ADR-0058's bulk-write addendum owns this decision. Addendum I (#4800 /
 * #4862 / #5037 / #5038) settled the `after*` half and #5038 delivered it.
 * Addendum II (#5574's maintainer ruling B, 2026-08-06, landed by #6462)
 * extends the same per-row semantics to the `before*` half, and this module is
 * that ruling's contract face. It landed as the spec half of a deliberate
 * contract-first split; #5574's engine card delivered the producer, so every
 * entry below now reads `delivered: true` and the split is closed.
 *
 * # Why a module and not one more paragraph of TSDoc
 *
 * `HookContextSchema.input` in `hook.zod.ts` carries the per-event shape table,
 * and it describes **what the engine builds today** — pinned against a real
 * dispatch by `packages/objectql/src/hook-input-shape-contract.test.ts`, which
 * is where the #5273 drift (three keys the table named and no producer set) was
 * finally made discoverable. That table must therefore never run ahead of the
 * engine.
 *
 * A contract-first ruling needs the opposite: a place to state the target
 * before the producer agrees, loudly enough that "not delivered yet" cannot be
 * mistaken for "delivered". So the two live apart and say different things.
 * {@link BULK_WRITE_HOOK_DISPATCH_CONTRACT} carries a `delivered` flag per
 * event, and `bulk-write-hook-conformance.test.ts` pins exactly which entries
 * are false — so the engine half could not land without turning this file's
 * pin red and flipping the flag in the same PR. It did, and it did: the
 * `before*` flags were flipped by #5574's engine half, and the pin now asserts
 * that NOTHING is undelivered. The flag stays on the entries rather than being
 * deleted with the gap it recorded, so the contract-first split remains
 * readable as a decision (Prime Directive #13) and a future clause added the
 * same way has a slot to be honest in.
 *
 * # The decision, in full
 *
 * **D1 — dispatch.** On a predicate write, a `before*` event dispatches ONCE
 * PER MATCHED ROW, replacing the single batch dispatch, exactly as `after*`
 * has since #5038. Rows outer, hooks inner (batch INSERT's order, #2922), so a
 * handler observes one whole record at a time. Zero matched rows is zero
 * record changes and therefore zero dispatches — `[]` is meaningful and
 * distinct from "no row set was read".
 *
 * **D2 — per-row context shape.** `input.id` names that row; `previous` is
 * that row's pre-image; `input.options` is the CALLER's bag (`where` and
 * `multi` visible — the PHASE rule in `hook.zod.ts` is unchanged, and the
 * `before*` phase still reads the pre-merge view). `result` stays absent:
 * the before phase has no post-state, and a value assigned to `ctx.result`
 * there is overwritten by the write's own result before any `after*` handler
 * sees it. The `after*` per-row `result` (`row` composed with the payload) is
 * #5038's and untouched.
 *
 * **D3 — the payload is BATCH-scoped, and that is the merge rule.** There is
 * exactly ONE payload for a predicate update — `driver.updateMany` takes one
 * SET clause for N rows — and every per-row `beforeUpdate` context carries THAT
 * payload, not a per-row copy. So:
 *
 *  - a rewrite takes effect on the WHOLE batch, whichever row's dispatch made
 *    it, and rewrites accumulate across the N dispatches in dispatch order;
 *  - N post-hook payloads cannot diverge, so there is no reconciliation step,
 *    no payload is discarded, and no predicate write is ever split into N
 *    single-row writes. One `updateMany`, one affected count (#4639), one
 *    aggregate `data.records.updated` — the write's own contract is untouched,
 *    exactly as #5038 left it;
 *  - a rewrite CONDITIONED on the row (`ctx.previous`, `ctx.input.id`) is
 *    therefore **outside this contract**: it does not scope itself to the row
 *    it was decided on, it widens to every matched row. Per-row `previous` is
 *    supplied so a guard can REFUSE the write, not so a rewrite can be aimed
 *    at one row. The three supported routes for row-specific work are: throw
 *    (which is what the guard case wants), write through `ctx.api` per row, or
 *    have the CALLER paginate the batch into by-id updates.
 *
 * On a predicate DELETE this clause is vacuous — a delete context carries an
 * id and no payload — which is why `payloadScope` is `'none'` there.
 *
 * **D4 — `input.id` is not a reroute lever on this path.** On the batch
 * dispatch it was: `input.id` was present-but-`undefined`, and binding it moved
 * the write onto the single-id branch. A per-row context arrives with `id`
 * ALREADY bound to its row, and the dispatch decision was made before the row
 * set was read — so rebinding it retargets nothing. A silent no-op is the
 * failure this family exists to abolish, so the engine half refuses the
 * rebinding rather than ignoring it. This is the ONE respect in which a per-row
 * `before*` context is not interchangeable with a single-id one; everything
 * else in D5 is.
 *
 * **D5 — equivalence with the single-id path.** A `before*` handler that reads
 * `previous` / `input.id` / `input.data` and either throws or applies a
 * ROW-INVARIANT rewrite sees the same context and produces the same outcome
 * whether the same N rows arrive as N by-id writes or one predicate write.
 * The declared, deliberate differences are exactly four: `input.options`
 * carries `multi` and `where`; the write resolves an affected COUNT and names
 * no row (#4639); one aggregate realtime event replaces N per-record ones; and
 * D4.
 *
 * **D6 — the budget is one ceiling for both phases.**
 * {@link MAX_BULK_PER_ROW_HOOK_ROWS} governs `before*` and `after*` alike, and
 * over it the write is REFUSED — before any per-row dispatch and before the
 * driver call, so nothing is written and no handler ran for a batch that was
 * going to be refused anyway. Never a downgrade to one dispatch for the batch:
 * that would skip the hook for N-1 rows and say nothing, which is the shape
 * #4649 / #4775 / #5038 all exist to abolish. {@link resolveBulkPerRowHookBudget}
 * is that rule, executable.
 *
 * **D7 — one read, reused.** The matched row set is read ONCE per predicate
 * write, with the middleware-composed AST the write itself binds (#2982), and
 * serves per-row validation (#3106), the `readonlyWhen` strip (#3042), the
 * per-row `before*` dispatch (D1) and the per-row `after*` dispatch (#5038).
 * A second fetch is refused by the ruling in as many words. One corollary the
 * engine half must honour rather than rediscover: because the engine binds
 * `previous` BEFORE dispatching, objectql's `sys_fetch_previous_update`
 * builtin (`plugin.ts`, `object: '*'`, priority 5) short-circuits on its own
 * `!ctx.previous` guard and issues no `findOne` — which is what keeps "no
 * second fetch" true in the one deployment shape where it would otherwise be
 * false N times over.
 *
 * # What this contract deliberately does NOT do, and why
 *
 * The obvious alternative was per-row payload COPIES plus a reconciliation
 * rule — converge on one payload when the N copies agree, refuse (or split the
 * write) when they do not. It was rejected on measured evidence, and the
 * evidence is worth keeping because it is not recoverable by reading the
 * design:
 *
 *  - **A value-based reconciliation is defeated by the clock.** objectql's own
 *    `sys_stamp_audit_update` builtin is registered on `'*'`, so it runs in
 *    essentially every deployment, and it computes `new Date().toISOString()`
 *    INSIDE the per-record stamp (`applyToRecord` in `plugin.ts`). Under
 *    per-row dispatch that is one clock read per row, so two rows either side
 *    of a millisecond boundary carry different `updated_at` values. A
 *    converge-or-refuse rule would then refuse honest batches
 *    non-deterministically, and a converge-or-split rule would shatter one
 *    `updateMany` into N single-row writes for the same reason. Both fail in
 *    the direction nobody can debug.
 *  - **Nothing measured needs divergent payloads.** Every `beforeUpdate`
 *    payload rewrite in this repo is row-invariant: the audit stamp
 *    (session + clock), plugin-pinyin-search's companion projection (derived
 *    from the payload's own text), service-storage's copy-on-claim (derived
 *    from the payload plus the referenced `sys_file` rows — and it already
 *    declines to claim on a bulk write for want of a definite owner). Building
 *    a divergence mechanism for zero measured producers is capability
 *    expansion without business pull.
 *  - **It stays reversible in the safe direction.** Refusing divergence today
 *    can be relaxed by a later ADR if the pull ever appears; a write that has
 *    already learned to split itself cannot be un-split without breaking
 *    whoever came to depend on it.
 *
 * The residual hazard is named rather than hidden: D3 hands authors per-row
 * `previous` and a batch-scoped payload, so a row-conditional rewrite is
 * *expressible* and wrong. That is a contract statement, not an enforcement —
 * no static rule can decide whether a rewrite is row-invariant — so it belongs
 * in the authoring docs and, if it ever earns one, an advisory lint over hook
 * bodies (`packages/lint`'s `validate-hook-body-writes` is the existing seam).
 * Naming an unenforceable clause is the honest half of ADR-0049, not a breach
 * of it: the alternative was to leave the same hazard undocumented.
 *
 * @see docs/adr/0058-expression-and-predicate-surface.md — Addendum II
 * @see HookContextSchema in `data/hook.zod.ts` — the per-event shape the engine
 *      builds TODAY, pinned in objectql
 */

/** A lifecycle phase, as the bulk-write contract distinguishes them. */
export type BulkWriteHookPhase = 'before' | 'after';

/** Whether a per-row context carries a mutable write payload, and whose it is. */
export type BulkWritePayloadScope =
  /** One payload for the whole batch; a rewrite applies to every matched row (D3). */
  | 'batch'
  /** No payload on this event at all (delete carries an id and options only). */
  | 'none';

/**
 * One row of the dispatch contract: what a predicate write hands this event.
 */
export interface BulkWriteHookDispatchContractEntry {
    /** The lifecycle event this row is about. */
    readonly event: 'beforeUpdate' | 'beforeDelete' | 'afterUpdate' | 'afterDelete';
    /** Which phase it belongs to. */
    readonly phase: BulkWriteHookPhase;
    /**
     * The keys the PER-ROW context carries, in the order the shape table in
     * `hook.zod.ts` lists them. `previous` is that row's pre-image on every
     * entry — that is the whole point of the contract.
     */
    readonly contextKeys: readonly ('id' | 'data' | 'options' | 'previous' | 'result')[];
    /** {@link BulkWritePayloadScope} — the D3 answer for this event. */
    readonly payloadScope: BulkWritePayloadScope;
    /**
     * Has the ENGINE delivered per-row dispatch for this event?
     *
     * `false` is not a gap to route around — it is a contract-first split
     * recorded in the open: the ruling required the spec half to land first.
     * A consumer that must branch on live behaviour reads the engine, never
     * this flag; the flag exists so the flip is a visible, pinned edit.
     */
    readonly delivered: boolean;
    /** Issue that DELIVERED it (when `delivered`), else the one that will. */
    readonly engineDeliveryIssue: number;
}

/**
 * The four write events a predicate (`multi: true`) write dispatches per
 * matched row, with what each per-row context carries.
 *
 * Read as a table, `after*` and `before*` side by side, because "same
 * yardstick as the after side" is the ruling's own test of this contract.
 */
export const BULK_WRITE_HOOK_DISPATCH_CONTRACT: readonly BulkWriteHookDispatchContractEntry[] = [
    {
        event: 'beforeUpdate',
        phase: 'before',
        contextKeys: ['id', 'data', 'options', 'previous'],
        payloadScope: 'batch',
        delivered: true,
        engineDeliveryIssue: 5574,
    },
    {
        event: 'beforeDelete',
        phase: 'before',
        contextKeys: ['id', 'options', 'previous'],
        payloadScope: 'none',
        delivered: true,
        engineDeliveryIssue: 5574,
    },
    {
        event: 'afterUpdate',
        phase: 'after',
        contextKeys: ['id', 'data', 'options', 'previous', 'result'],
        payloadScope: 'batch',
        delivered: true,
        engineDeliveryIssue: 5038,
    },
    {
        event: 'afterDelete',
        phase: 'after',
        contextKeys: ['id', 'options', 'previous'],
        payloadScope: 'none',
        delivered: true,
        engineDeliveryIssue: 5038,
    },
];

/**
 * Ceiling on the matched-row set one predicate write may fire per-row hooks
 * over — D6, and the same number for both phases.
 *
 * The cost it bounds is the one ADR-0058's Addendum I told the implementation
 * to price: a hook that used to run once per batch runs once per row, so a
 * notification hook sends N messages. Unbounded, one `multi: true` update over
 * a whole table becomes an unbounded fan-out of handler executions inside a
 * single write.
 *
 * ONE definition, since #5574's engine half. `ObjectQL.MAX_BULK_PER_ROW_HOOK_ROWS`
 * (`engine.ts`) is now a re-export of this constant and
 * `ObjectQL.assertBulkPerRowHookBudget` is the raising half of
 * {@link resolveBulkPerRowHookBudget} — the engine raises, the contract
 * decides. Between #5038 and then the same literal and the same message were
 * written down twice, agreeing only because a pin in
 * `bulk-write-hook-conformance.test.ts` said so.
 */
export const MAX_BULK_PER_ROW_HOOK_ROWS = 10_000;

/**
 * The code carried by a budget refusal.
 *
 * Deliberately an `ERR_`-prefixed operational code on the thrown error's own
 * property bag, NOT an ADR-0112 wire code: `StandardErrorCode` and
 * `ERROR_CODE_LEDGER` are a closed vocabulary that the REST layer promotes onto
 * the response envelope, and minting a member of it by side effect is the exact
 * `declared != enforced` shape that vocabulary exists to prevent. Same reasoning
 * that keeps `HookConditionLimitation` off `error.code` in objectql.
 */
export const BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE = 'ERR_BULK_PER_ROW_HOOK_LIMIT';

/** A budget verdict: proceed, or refuse the whole write. */
export type BulkPerRowHookBudgetVerdict =
    | { readonly kind: 'ok'; readonly matched: number; readonly limit: number }
    | {
        readonly kind: 'refused';
        readonly code: typeof BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE;
        readonly object: string;
        readonly event: string;
        readonly matched: number;
        readonly limit: number;
        readonly message: string;
    };

/**
 * D6, executable: may a predicate write on `object` dispatch `event` once per
 * each of `matched` rows?
 *
 * A refusal is total — the write does not proceed in any reduced form. The
 * message names the count, the ceiling, both routes out, and the one thing a
 * reader most needs to be told: that nothing was written and that the write was
 * not quietly downgraded to a single dispatch for the batch.
 *
 * Pure and total: no clock, no I/O, no throw. The engine raises; the contract
 * decides.
 */
export function resolveBulkPerRowHookBudget(input: {
    readonly object: string;
    readonly event: string;
    readonly matched: number;
}): BulkPerRowHookBudgetVerdict {
    const { object, event, matched } = input;
    const limit = MAX_BULK_PER_ROW_HOOK_ROWS;
    if (matched <= limit) return { kind: 'ok', matched, limit };
    return {
        kind: 'refused',
        code: BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE,
        object,
        event,
        matched,
        limit,
        message:
            `Refusing the bulk write on '${object}': it matches ${matched} rows, and '${event}' hooks are `
            + `contracted to fire PER ROW on a predicate write (ADR-0058, bulk-write addendum), which is `
            + `over the ${limit}-row ceiling for one write. Nothing was written. `
            + `Narrow the predicate so the batch matches fewer rows (paginate the write), or remove the `
            + `'${event}' hook from this object. The write is NOT silently downgraded to one hook call for `
            + `the batch — that would skip the hook for ${matched - 1} rows without saying so.`,
    };
}
