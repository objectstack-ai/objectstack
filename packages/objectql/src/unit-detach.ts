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
 */

import { AsyncLocalStorage } from 'node:async_hooks';

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
 * The key of `ScopedContext#[DETACHED_HOOK_RUN]`, which runs a body outside
 * the units open for that api ({@link runOutsideOpenUnits}). A symbol, and ⛔
 * not re-exported from the package entry, for the reason `SEED_USER_GRANTS`
 * gives (`hook-run-as.ts`): it is no nameable member of the class's published
 * face.
 */
export const DETACHED_HOOK_RUN: unique symbol = Symbol('objectstack.objectql.detachedHookRun');

interface DetachableHookApi {
  [DETACHED_HOOK_RUN]<T>(body: () => T): T;
}

/**
 * Run an `async` hook's `body` detached from the units open for `api`, the
 * hook's `ctx.api`. An api that cannot detach (a hook context assembled by
 * hand) runs `body` as is.
 */
export function runDetachedHook<T>(api: unknown, body: () => T): T {
  const detachable = api as Partial<DetachableHookApi> | undefined;
  if (!detachable || typeof detachable[DETACHED_HOOK_RUN] !== 'function') return body();
  return detachable[DETACHED_HOOK_RUN](body);
}
