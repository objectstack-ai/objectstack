// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33651] The run of an `async: true` after-hook, detached from every unit of
 * work open when it was dispatched.
 *
 * The engine dispatches `after*` hooks inside the write's unit when there is
 * one (`HookSchema`'s events docblock): a caller's `transaction()`, an atomic
 * batch or cascade, or the unit the write door opens for a blocking `after*`
 * hook that can abort (#22782). A blocking hook's `ctx.api` writes join that
 * unit, which is what makes its abort roll them back. An `async` hook is not
 * awaited, so its writes have no unit to join: the unit commits or rolls back
 * on its own schedule, whatever the hook is doing.
 *
 * #22855 closed the half of this that starts AFTER the unit settles: a closed
 * unit's handle is treated as absent (`runOpenedUnit`, `isClosedUnitHandle`).
 * The half that starts BEFORE stayed open: an `async` hook starts at dispatch,
 * while the unit is still open, so its first writes read the unit ambiently
 * (and through the handle threaded into its `ctx.api`) and enrolled in it.
 * The unit then committed under them, and they failed with "Transaction query
 * already complete". The door's own unit made that the common case: adding a
 * blocking `afterUpdate` beside an `async` one was enough.
 *
 * So the detached run starts outside every such unit, in two halves, the two
 * ways a handle reaches the hook's writes:
 *
 *  - AMBIENT: the run leaves the engine's ambient store (ADR-0034) with
 *    `AsyncLocalStorage#exit`, so no write in it finds an open unit to join;
 *  - EXPLICIT: the handles that were open at dispatch — the ambient one and
 *    the one the hook's `ctx.api` carries — are recorded for the run, and the
 *    engine's `isClosedUnitHandle` answers `true` for them, so every reader of
 *    a threaded handle (`buildDriverOptions`, `opensAfterAbortUnit`, the
 *    secret-row release, `openTransactionKind`) treats them as absent.
 *
 * The hook's writes then run on their own connection, as they would outside
 * any unit; a unit the hook opens itself (`ctx.api.transaction(fn)`) is a new
 * handle and is its own. On a single-connection pool such a write waits for
 * the dispatching unit to release the connection, which nothing awaits, so it
 * cannot deadlock the dispatching write.
 *
 * [#33760] And the detached run waits for the unit to SETTLE: it starts once
 * the outermost unit open at dispatch commits, and never when that unit rolls
 * back. Started at dispatch, the hook ran while the triggering write was not
 * committed yet: on a database with more than one connection its `ctx.api`
 * reads did not see that write, and a rollback did not stop it (measured on
 * Postgres and on SQLite through knex). The unit's owner — `ObjectQL`'s
 * `transaction()` or `ScopedContext`'s, through the one `runOpenedUnit` both
 * run their callback in — gives the unit a {@link UnitCommitQueue} and settles
 * it after its commit or rollback ({@link settleUnitCommitQueue}). A nested
 * `transaction()` joins the outer unit (ADR-0067 D2) and opens no queue, so
 * its return is no commit: the outer unit's outcome decides. The
 * `beginTransaction` / `commitTransaction` / `rollbackTransaction` trio — the
 * sandbox runner's `ctx.api.transaction(fn)` — opens one per handle it owns
 * ({@link openTrioCommitQueue}). Outside any unit, or where no unit opened
 * (a driver without transactions), the run starts at dispatch, as before.
 *
 * Only a WRITE event's run waits ({@link waitsForUnitCommit}). A rollback
 * undoes the write that fired `afterInsert` / `afterUpdate` / `afterDelete`,
 * so a run that announces it must not outlive it. It does not undo a read:
 * the rows `afterFind` saw were already returned to the caller, so an `async`
 * `afterFind` run starts at dispatch, outside the units, as under #33651,
 * whatever the unit it was read in does next.
 *
 * Every run a unit queued starts in one synchronous pass once it commits, in
 * dispatch order: a bulk write with a per-row `async` hook holds one context
 * copy per row until then, bounded by the per-row hook budget
 * (`resolveBulkPerRowHookBudget`), and then starts every handler at once.
 */

import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';

/** The unit handles the current run was detached from, accumulated across nested detached runs. */
const detachedHandles = new AsyncLocalStorage<ReadonlySet<unknown>>();

/** Was the current run detached from the unit whose handle is `handle`? */
export function isDetachedUnitHandle(handle: unknown): boolean {
  return handle != null && detachedHandles.getStore()?.has(handle) === true;
}

/**
 * Run `body` outside every unit open now: out of `txStore`'s ambient entry,
 * with that entry's handle and `threaded` (the handle an api carries
 * explicitly) recorded as detached. `txStore` absent (an engine double) leaves
 * only the explicit half.
 */
export function runOutsideOpenUnits<T>(
  txStore: Pick<AsyncLocalStorage<{ transaction?: unknown } | undefined>, 'getStore' | 'exit'> | undefined,
  threaded: unknown,
  body: () => T,
): T {
  const handles = new Set(detachedHandles.getStore());
  const ambient = txStore?.getStore()?.transaction;
  if (ambient != null) handles.add(ambient);
  if (threaded != null) handles.add(threaded);
  const run = () => detachedHandles.run(handles, body);
  return typeof txStore?.exit === 'function' ? txStore.exit(run) : run();
}

/**
 * The events whose `async` run waits for the commit of the unit it was
 * dispatched in, and is dropped when that unit rolls back: the `after*`
 * events of a write. Any other event (`afterFind`) starts at dispatch.
 */
const UNIT_SETTLED_EVENTS: ReadonlySet<string> = new Set(['afterInsert', 'afterUpdate', 'afterDelete']);

/** Does an `async` run dispatched for `event` wait for its unit's commit? */
export function waitsForUnitCommit(event: unknown): boolean {
  return typeof event === 'string' && UNIT_SETTLED_EVENTS.has(event);
}

/** What a detached run answers when the unit it waited for rolled back: the body never ran. */
export const UNIT_ROLLED_BACK: unique symbol = Symbol('objectstack.objectql.unitRolledBack');

/**
 * [#33760] The runs waiting for one unit to commit. `pending` is the list
 * while the unit is open, and `undefined` once {@link settleUnitCommitQueue}
 * has settled it, so a run asked for after that starts at once.
 */
export interface UnitCommitQueue {
  pending: Array<{ commit(): void; drop(): void }> | undefined;
}

/** A queue for a unit about to open: its owner settles it after the commit or rollback. */
export function newUnitCommitQueue(): UnitCommitQueue {
  return { pending: [] };
}

/**
 * Settle `queue` once its unit's outcome is known: start every waiting run
 * when the unit `committed`, drop every one when it rolled back. Emptied
 * first, so a run that dispatches another starts that one at once.
 */
export function settleUnitCommitQueue(queue: UnitCommitQueue | undefined, committed: boolean): void {
  const pending = queue?.pending;
  if (!queue || !pending) return;
  queue.pending = undefined;
  for (const run of pending) {
    // Each run is fire-and-forget and handles its own outcome; one that
    // throws synchronously must not cost the next its start.
    try { if (committed) run.commit(); else run.drop(); } catch { /* the run's own outcome */ }
  }
}

/**
 * The queues of the units the `beginTransaction` trio opened, by handle. The
 * trio never publishes its unit (no closure spans begin to commit), so its
 * queue cannot ride a store entry; its own `commitTransaction` /
 * `rollbackTransaction` settle it ({@link settleTrioCommitQueue}). Weak, so a
 * handle nobody commits or rolls back takes its waiting runs with it, exactly
 * as it takes its uncommitted writes.
 */
const trioQueues = new WeakMap<object, UnitCommitQueue>();

/** The trio opened a unit on `handle`: runs dispatched in it wait for its commit. */
export function openTrioCommitQueue(handle: unknown): void {
  if (handle !== null && (typeof handle === 'object' || typeof handle === 'function')) trioQueues.set(handle, newUnitCommitQueue());
}

/** The queue of the unit the trio opened on `handle`, while it is open; `undefined` for any other handle. */
export function trioCommitQueueOf(handle: unknown): UnitCommitQueue | undefined {
  if (handle === null || (typeof handle !== 'object' && typeof handle !== 'function')) return undefined;
  return trioQueues.get(handle);
}

/** The trio committed (`committed`) or rolled back the unit on `handle`. */
export function settleTrioCommitQueue(handle: unknown, committed: boolean): void {
  if (handle === null || (typeof handle !== 'object' && typeof handle !== 'function')) return;
  const queue = trioQueues.get(handle);
  trioQueues.delete(handle);
  settleUnitCommitQueue(queue, committed);
}

/** A unit entry as the engine's ambient store and its `openedUnits` map hold it. */
interface QueuedUnitEntry { transaction?: unknown; commitQueue?: UnitCommitQueue }

/**
 * The queue of the unit a run dispatched now is inside, while that unit has
 * not settled: the ambient entry's, else the one of the unit whose handle the
 * api carries (published, or the trio's). A handle the current run was detached from is no unit to wait
 * for: the run is already past that unit's commit.
 */
function unsettledUnitQueue(
  txStore: Pick<AsyncLocalStorage<QueuedUnitEntry | undefined>, 'getStore'> | undefined,
  openedUnits: Pick<WeakMap<object, QueuedUnitEntry>, 'get'> | undefined,
  threaded: unknown,
): UnitCommitQueue | undefined {
  const ambient = txStore?.getStore();
  if (ambient?.commitQueue?.pending) return ambient.commitQueue;
  if (threaded === null || (typeof threaded !== 'object' && typeof threaded !== 'function')) return undefined;
  if (isDetachedUnitHandle(threaded)) return undefined;
  const queue = openedUnits?.get(threaded)?.commitQueue ?? trioQueues.get(threaded);
  return queue?.pending ? queue : undefined;
}

/**
 * [#33760] Run `body` outside every unit open now ({@link runOutsideOpenUnits}),
 * once the unit it was dispatched in commits: queued on that unit's
 * {@link UnitCommitQueue}, in the async context of the dispatch, and answering
 * {@link UNIT_ROLLED_BACK} without running when the unit rolls back. With no
 * unsettled unit to wait for, `body` starts now.
 */
export function runOutsideOpenUnitsOnCommit<T>(
  txStore: Pick<AsyncLocalStorage<QueuedUnitEntry | undefined>, 'getStore' | 'exit'> | undefined,
  openedUnits: Pick<WeakMap<object, QueuedUnitEntry>, 'get'> | undefined,
  threaded: unknown,
  body: () => Promise<T>,
): Promise<T | typeof UNIT_ROLLED_BACK> {
  const queue = unsettledUnitQueue(txStore, openedUnits, threaded);
  if (!queue) return runOutsideOpenUnits(txStore, threaded, body);
  return new Promise<T | typeof UNIT_ROLLED_BACK>((resolve, reject) => {
    // Bound to the dispatch's async context, so the run sees the stores it
    // was dispatched under (identity, cascade), not the committing owner's.
    const start = AsyncResource.bind(() => {
      try {
        runOutsideOpenUnits(txStore, threaded, body).then(resolve, reject);
      } catch (err) {
        reject(err);
      }
    });
    queue.pending!.push({ commit: start, drop: () => resolve(UNIT_ROLLED_BACK) });
  });
}

/**
 * The key of `ScopedContext#[DETACHED_HOOK_RUN]`, which runs a body outside
 * the units open for that api, at once or once the unit it was dispatched in
 * commits ({@link runOutsideOpenUnitsOnCommit}). A symbol, and ⛔
 * not re-exported from the package entry, for the reason `SEED_USER_GRANTS`
 * gives (`hook-run-as.ts`): it is no nameable member of the class's published
 * face.
 */
export const DETACHED_HOOK_RUN: unique symbol = Symbol('objectstack.objectql.detachedHookRun');

interface DetachableHookApi {
  [DETACHED_HOOK_RUN]<T>(body: () => Promise<T>, waitForCommit: boolean): Promise<T | typeof UNIT_ROLLED_BACK>;
}

/**
 * Run an `async` hook's `body` detached from the units open for `api`, the
 * hook's `ctx.api`. With `waitForCommit` ({@link waitsForUnitCommit}), once the
 * unit it was dispatched in commits, answering {@link UNIT_ROLLED_BACK} when
 * that unit rolls back instead; without it, at once. An api that cannot
 * detach (a hook context assembled by hand) runs `body` as is.
 */
export function runDetachedHook<T>(api: unknown, body: () => Promise<T>, waitForCommit: boolean): Promise<T | typeof UNIT_ROLLED_BACK> {
  const detachable = api as Partial<DetachableHookApi> | undefined;
  if (!detachable || typeof detachable[DETACHED_HOOK_RUN] !== 'function') return body();
  return detachable[DETACHED_HOOK_RUN](body, waitForCommit);
}
