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

/** The body of `ObjectQL#inAfterAbortUnit`; the method's docblock there is its contract. */
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

/** The body of `ObjectQL#buildPerRowAfterContexts`; the method's docblock there is its contract. */
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

/** The body of `ObjectQL#dispatchPerRowBeforeHooks`; the method's docblock there is its contract. */
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

/** The body of `ObjectQL#assertBulkPerRowHookBudget`; the method's docblock there is its contract. */
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
