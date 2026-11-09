// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 6] The predicate-write hook dispatch bodies of `ObjectQL`, moved
 * out of `engine.ts` whole: the per-row `after*` contexts a `multi: true` write
 * dispatches (`buildPerRowAfterContexts`), the per-row `before*` dispatch with
 * its D3 accumulate and key-divergence halves (`dispatchPerRowBeforeHooks`),
 * the ceiling on that fan-out (`assertBulkPerRowHookBudget`), and the unit an
 * aborting `after*` chain runs in (`inAfterAbortUnit`).
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited: the same single-record context shape, the same one
 * payload carried by reference through every row, the same refusal before any
 * write, and the same commit-then-rethrow for `SummaryRecomputeError`. Each
 * method's docblock stays on the method in `engine.ts`, which is still the
 * contract.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), applied per method as
 * `engine-secret-internal-fields.ts` applies it. The class keeps all four
 * methods — the published `.d.ts` lists each one's name and position — and
 * each body is one literal of exactly the {@link HookDispatchHost} members
 * that method reads, plus a `.call`. The one field the bodies read
 * (`_registry`) goes as a GETTER, so the read happens when the body makes it.
 * The two methods they call (`triggerHooks`, `transaction`) go as late-bound
 * closures over the instance, so a double or spy set on the engine is still
 * the one a call reaches. `assertBulkPerRowHookBudget` reads no member and is
 * called directly.
 *
 * The three other members of the same section (`hasHooksFor`,
 * `opensAfterAbortUnit`, `dispatchUnscopedMultiWriteHooks`) stay in the class:
 * each calls `hookMatchesObject`, a function `engine.ts` declares at module
 * level, and reaching it from here would be a value import of the engine.
 *
 * This module imports the engine only as a TYPE, so there is no module cycle
 * at run time, and nothing re-exports it, so the published surface does not
 * move.
 *
 * [#30053 codemod] A PRIVATE method's docblock has since moved here,
 * onto its function (`--hand-docs` of `scripts/codemod-split-engine.mjs`),
 * and the class keeps none for it; a public or protected method's docblock
 * stays on the class, the contract, and its function keeps the placeholder.
 */

import type { HookContext } from '@objectstack/spec/data';
import { resolveBulkPerRowHookBudget } from '@objectstack/spec/data';
import { SummaryRecomputeError } from './summary-errors.js';
import { HookTargetRebindError } from './hook-target-rebind-errors.js';
import { coerceBooleanFields } from './validation/record-validator.js';
import { recordHookPayloadWrites } from './hook-write-provenance.js';
import {
  divergingHookPayloadKeys,
  MultiUpdateHookKeyDivergenceError,
} from './multi-update-hook-key-divergence.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's type on the class is a change here too, and naming a member the
 * class does not have is a compile error. See the module header for which
 * members are getters.
 */
export interface HookDispatchHost {
  readonly _registry: ObjectQL['_registry'];
  triggerHooks: ObjectQL['triggerHooks'];
  transaction: ObjectQL['transaction'];
}

/** [#22782] The unit {@link opensAfterAbortUnit} asked for; `write` re-enters the door, which joins it. */
export async function inAfterAbortUnit<T>(
  this: Pick<HookDispatchHost, 'transaction'>,
  write: () => Promise<T>,
): Promise<T> {
  let written: SummaryRecomputeError | undefined;
  const result = await this.transaction(async () => {
    try {
      return await write();
    } catch (e) {
      if (!(e instanceof SummaryRecomputeError)) throw e;
      written = e;
      return undefined as T;
    }
  });
  if (written) throw written;
  return result;
}

/**
 * [#5038] The per-row after-hook contexts a predicate (`multi: true`) write
 * dispatches, one per matched row.
 *
 * ## Why per row at all
 *
 * ADR-0058's bulk-write addendum (the 2026-08-04 ruling on #4800 / #4862)
 * records the contract: **a bulk write is N record changes, so after-hooks
 * and the record-change flow triggers riding them evaluate and fire PER
 * ROW**, with `previous` = that row's pre-write state and `record` = that
 * row's actual state. Before it, the engine fired the hook ONCE, never
 * assigned `previous`, and left `record` degraded to the bare payload — so
 * the transition condition both the docs and ten showcase flows teach
 * (`status == "done" && previous.status != "done"`) was unevaluable on a
 * bulk write, and the audit/notification flows behind it silently did not
 * happen.
 *
 * ## The shape is the SINGLE-RECORD shape, deliberately
 *
 * Each context is exactly what a single-id write builds — `input.id` is the
 * row, `input.data` is this write's payload, `result` is the row's state,
 * `previous` is its pre-image. That is #2922's ruling for batch INSERT
 * restated: a single array-shaped context "broke every consumer built for
 * the single shape", so a per-row context must be indistinguishable from a
 * record-scoped one. It is also what makes this fix land at the PRODUCER:
 * `hook-wrappers`' `record`/`previous` bindings, the record-change trigger's
 * `buildContext`, and plugin-audit's diff all read these same four fields and
 * need no bulk-aware branch of their own.
 *
 * `input.data` is a shallow COPY per row: the batch has one payload, but an
 * after-handler that writes through the flat-input proxy must not have its
 * mutation leak into the next row's view.
 *
 * ## `result` is composed, not re-read
 *
 * The row's post-write state is `row ⊕ payload` — the pre-image the matched
 * set already gave us, overlaid with the payload the driver just applied.
 * Composing keeps the issue's performance guardrail literal: the matched row
 * set is read ONCE and reused for every per-row evaluation. Re-reading the
 * batch after the write to capture driver-side stamps would be a second
 * full-set query for fields the after-view has never carried on this path.
 *
 * For a DELETE there is no post-state, so `result` is left unset and
 * `input` carries no `data`: consumers fall back to `previous` (the deleted
 * row), which is what `record` means for a delete.
 */
export function buildPerRowAfterContexts(
  this: Pick<HookDispatchHost, '_registry'>,
  object: string,
  event: 'afterUpdate' | 'afterDelete',
  rows: Record<string, unknown>[],
  batchCtx: HookContext,
  payload?: Record<string, unknown>,
): HookContext[] {
  const schema = this._registry.getObject(object);
  const options = (batchCtx.input as { options?: unknown } | undefined)?.options;
  return rows.map((row, index) => ({
    ...batchCtx,
    event,
    input: payload
      ? { id: (row as { id?: unknown }).id, data: { ...payload }, options }
      : { id: (row as { id?: unknown }).id, options },
    // [#6966] `mode` and `scope` ride over from the batch context; only the
    // position differs. Spreading `batchCtx` would carry index 0 onto every
    // row, which is the one member a per-row consumer keys "do this once" on.
    dispatch: { ...(batchCtx.dispatch as object), index } as HookContext['dispatch'],
    previous: coerceBooleanFields(schema as any, row as any),
    result: payload
      ? coerceBooleanFields(schema as any, { ...row, ...payload } as any)
      : undefined,
  }) as unknown as HookContext);
}

/**
 * [#5574] The per-row `before*` dispatch of a predicate (`multi: true`)
 * write — ADR-0058 Addendum II, clauses D1–D4.
 *
 * ## D1/D2 — one dispatch per matched row, on the SINGLE-RECORD shape
 *
 * `input.id` names the row, `previous` is that row's pre-image, and
 * `input.options` is still the CALLER's bag (the PHASE rule in `hook.zod.ts`
 * is unchanged: the `before*` phase reads the pre-merge view, `where` and
 * `multi` visible). `result` stays ABSENT — the before phase has no
 * post-state, and a value assigned to `ctx.result` here is overwritten by the
 * write's own result before any `after*` handler could see it.
 *
 * Zero matched rows is zero dispatches, and `[]` is meaningful: a batch that
 * changed nothing is not a record change. The caller checks that BEFORE
 * calling in, so an empty row set never reaches this loop.
 *
 * ## D3 — the payload is BATCH-scoped, and that IS the merge rule
 *
 * Every per-row context carries THE payload, not a copy — deliberately
 * unlike {@link buildPerRowAfterContexts}, which copies because an
 * after-handler's mutation has nowhere legitimate to go. There is exactly one
 * payload for a predicate update (`driver.updateMany` takes one SET clause
 * for N rows), so:
 *
 *  - a rewrite takes effect on the WHOLE batch, whichever row's dispatch made
 *    it, and rewrites ACCUMULATE across the N dispatches in dispatch order;
 *  - N post-hook payloads cannot diverge, so nothing is reconciled, no
 *    payload is discarded, and no predicate write is ever split into N
 *    single-row writes.
 *
 * Two ways a handler can write the payload and both must accumulate: mutating
 * it in place (`ctx.input.data.x = 1`) needs no help, while REPLACING it
 * (`ctx.input.data = {…}`) would otherwise be lost with the row context that
 * held it. So each row reads the batch payload fresh and writes it back after
 * its dispatch — that write-back is what makes "accumulate in dispatch order"
 * true for both spellings rather than only the first.
 *
 * A rewrite CONDITIONED on the row (`ctx.previous`, `ctx.input.id`) cannot
 * scope itself to the row it was decided on: it widens to every matched row.
 * Per-row `previous` is supplied so a guard can REFUSE the write (throw),
 * and — ruled on #16074 — so a hook can make a ROW-INVARIANT-IN-EFFECT
 * rewrite: one whose written KEY SET is the same on every matched row AND is
 * assigned IN PLACE (`ctx.input.data.x = 1`, never `ctx.input.data = {…}`,
 * which the recording below cannot attribute). A rewrite AIMED at one row
 * stays outside the contract, and what makes the admitted shape safe is that
 * enforcement rather than the hook's good faith.
 *
 * ## D3, ENFORCED — divergent key sets refuse the batch [#14099]
 *
 * That last paragraph used to end "a contract statement, not an enforcement
 * — no static rule can decide whether a rewrite is row-invariant". The second
 * half is still true and the conclusion no longer follows: nothing STATIC can
 * decide it, but the dispatch can MEASURE it. #14088's recorder is armed once
 * more per row here, so each dispatch reports the set of payload keys THAT
 * row's hook chain assigned; if two rows disagree, the batch is refused whole
 * before any write ({@link MultiUpdateHookKeyDivergenceError}).
 *
 * Maintainer ruling of 2026-09-02, on the corruption `duly` measured against
 * published 17.2.0 — a `completed_at` transition stamp moved an
 * already-completed row's timestamp, silently, on a two-row batch. The
 * criterion is the key SET and never the values, which is what lets the
 * clock-reading audit stamp through: every row writes `updated_at`, so an
 * honest batch is never refused non-deterministically. The full argument,
 * both rejected value-comparison variants, and the blind spot the ruling
 * carries openly (same key, per-row VALUES) live on
 * `multi-update-hook-key-divergence.ts`.
 *
 * ## D4 — `input.id` is not a reroute lever here
 *
 * On the old batch dispatch it was: `input.id` was present-but-`undefined`,
 * and binding it moved the write onto the single-id branch. A per-row context
 * arrives with `id` already bound and the dispatch already decided, so
 * rebinding retargets nothing — and is refused rather than ignored.
 */
export async function dispatchPerRowBeforeHooks(
  this: Pick<HookDispatchHost, '_registry' | 'triggerHooks'>,
  object: string,
  event: 'beforeUpdate' | 'beforeDelete',
  rows: Record<string, unknown>[],
  batchCtx: HookContext,
): Promise<void> {
  const schema = this._registry.getObject(object);
  const carriesPayload = event === 'beforeUpdate';
  // ── [#14099] D3's ENFORCEMENT half: one observation window per row ──────
  //
  // The #14088 recorder, armed a SECOND time for this loop and NESTED over
  // the batch-scoped recording `update()` already armed at its entry. The
  // nesting is what makes both readings true at once: a write through this
  // view lands on the outer recording's view, which lands on the real
  // payload — so the outer record (the one the read-only strips read for
  // provenance) still sees every hook write, while `closeWindow()` gives
  // this loop what only it needs: the keys assigned by ONE row's chain.
  //
  // ⭐ ONE recording for the whole loop, not one per row, and that is a
  // contract point rather than a saving: every per-row context must carry
  // THE SAME payload object (D3, pinned by reference identity in
  // `bulk-write-per-row-hooks.test.ts`). A fresh view per row would still be
  // write-through onto one payload — no copy, nothing to reconcile — but it
  // would hand each row a DIFFERENT object, which is a difference an author
  // can observe and which this contract says is not there.
  const batchPayloadAtEntry = (batchCtx.input as { data?: unknown }).data;
  const hookWrites =
    carriesPayload && batchPayloadAtEntry !== null && typeof batchPayloadAtEntry === 'object'
      ? recordHookPayloadWrites(batchPayloadAtEntry as Record<string, unknown>)
      : undefined;
  if (hookWrites) (batchCtx.input as { data?: unknown }).data = hookWrites.payload;
  const perRowHookWrittenKeys: ReadonlySet<string>[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const rowId = (row as { id?: unknown }).id;
    const options = (batchCtx.input as { options?: unknown }).options;
    const rowCtx = {
      ...batchCtx,
      event,
      // [#6966] See `buildPerRowAfterContexts` — same rule. The `scope`
      // identity carried over from `batchCtx` is what lets a `before*`
      // handler leave something an `after*` handler can still find: a per-row
      // context is a fresh object, so a stash written on the context itself
      // dies with the row that held it.
      dispatch: { ...(batchCtx.dispatch as object), index } as HookContext['dispatch'],
      // D3: THE payload, read fresh so a previous row's REPLACEMENT is what
      // this row sees. Never a copy.
      input: carriesPayload
        ? { id: rowId, data: (batchCtx.input as { data?: unknown }).data, options }
        : { id: rowId, options },
      previous: coerceBooleanFields(schema as any, row as any),
      // D2: no post-state in the before phase.
      result: undefined,
    } as unknown as HookContext;

    await this.triggerHooks(event, rowCtx);

    // D3, the accumulate half — see the class doc above.
    if (carriesPayload) {
      (batchCtx.input as { data?: unknown }).data = (rowCtx.input as { data?: unknown }).data;
      // [#14099] and the enforcement half: close THIS row's window, so the
      // next row opens a fresh one.
      if (hookWrites) perRowHookWrittenKeys.push(hookWrites.closeWindow());
    }
    // D4.
    const observed = (rowCtx.input as { id?: unknown }).id;
    if (observed !== rowId) {
      throw new HookTargetRebindError({
        object, event, path: 'per-row', expectedId: rowId, observedId: observed,
      });
    }
  }

  // [#14099] Close this loop's recording and put the underlying payload back
  // in `batchCtx.input.data`, so no recording VIEW travels on to the outer
  // seal, the strips or a driver.
  //
  // `hookWrittenKeys` is `undefined` exactly when a hook REPLACED the payload
  // object somewhere in this batch (`hook-write-provenance.ts`'s KNOWN
  // LIMIT). Then the whole batch ABSTAINS: the windows collected before the
  // replacement describe writes the replacement discarded, so refusing on
  // them would be a verdict about a payload that is no longer the one being
  // written. Abstaining keeps the pre-#14099 behaviour for that shape, which
  // is the same fail-safe direction #14088 chose for the same limit.
  const sealedLoopWrites = hookWrites?.seal((batchCtx.input as { data?: unknown }).data);
  if (sealedLoopWrites) {
    (batchCtx.input as { data?: unknown }).data = sealedLoopWrites.data;
  }

  // [#14099] The refusal, ruled 2026-09-02 (recommendation C). Placed after
  // the loop and not inside it, for two reasons that are both about the
  // envelope rather than about cost: the diverging set is `union` minus
  // `intersection` over EVERY row, so the message names every offending key
  // instead of the first pair to disagree, and it is order-independent — the
  // same batch answers the same way whatever order the driver returned the
  // matched rows in.
  //
  // ⭐ Still BEFORE any write, which is the load-bearing half. This method is
  // called from `update()`'s predicate branch ahead of the outer hook-write
  // seal, both readonly strips, `evaluateValidationRules` and every
  // `driver.updateMany` — and it runs outside `update()`'s own `try`, so the
  // envelope reaches the caller undecorated. Not "after the first row", not
  // "inside a transaction that then rolls back": nothing was written.
  if (sealedLoopWrites?.hookWrittenKeys !== undefined) {
    const diverging = divergingHookPayloadKeys(perRowHookWrittenKeys);
    if (diverging.length > 0) {
      throw new MultiUpdateHookKeyDivergenceError(object, diverging, rows.length);
    }
  }
}

/**
 * [#5038, one ceiling for both phases since #5574] Ceiling on the matched-row
 * set a predicate write fires per-row hooks over.
 *
 * The consequence ADR-0058's addendum told this implementation to price: a
 * hook that used to run once per batch now runs once per row, so a
 * notification hook sends N messages and a cache-invalidation hook runs N
 * times. Unbounded, a single `multi: true` update matching a whole table
 * turns into an unbounded fan-out of handler executions inside one write.
 *
 * Exceeding it REJECTS the write, before the FIRST per-row dispatch and
 * before `updateMany`/`deleteMany` runs, so nothing is written and no handler
 * ran for a batch that was going to be refused anyway. The alternative —
 * quietly falling back to firing once for the batch — is the silent
 * degradation this whole family exists to abolish (#4649/#4775): the hooks
 * would not fire for N-1 rows and nothing would say so.
 *
 * [#5574] The rule itself is `resolveBulkPerRowHookBudget` in
 * `packages/spec/src/data/bulk-write-hook-conformance.ts` (D6), not a copy
 * kept in step by a pin. This method is the RAISING half only: the contract
 * is pure and total (no clock, no I/O, no throw), the engine turns a
 * `refused` verdict into the thrown error. Splitting it that way is what lets
 * `before*` and `after*`, update and delete, share one ceiling and one
 * message with nothing to keep synchronised.
 */
export function assertBulkPerRowHookBudget(object: string, event: string, matched: number): void {
  const verdict = resolveBulkPerRowHookBudget({ object, event, matched });
  if (verdict.kind === 'ok') return;
  throw Object.assign(new Error(verdict.message), {
    code: verdict.code,
    object: verdict.object,
    event: verdict.event,
    matched: verdict.matched,
    limit: verdict.limit,
  });
}
