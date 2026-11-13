// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where a write stands with respect to a transaction, for code that acts
 * BESIDE that write through the engine (the runtime's script-body doors) and
 * must know whether what it writes will commit or roll back with it.
 *
 *  - `'none'`: no transaction is open; a write through the engine stands alone.
 *  - `'joined'`: the engine's ambient transaction is open (ADR-0034), and a
 *    write through the engine joins it: it commits or rolls back with the
 *    write that is running.
 *  - `'separate'`: the running write carries a transaction handle the ambient
 *    store does not hold (a sandboxed body's `ctx.api.transaction`, threaded
 *    explicitly, ADR-0067). A write through the engine would take another
 *    connection, outside it.
 *
 * A handle whose unit has already closed counts as no transaction. Read
 * through the engine's own ambient store and unit ledger, so the answer is the
 * one the engine's write path acts on.
 */
export type OpenTransactionKind = 'none' | 'joined' | 'separate';

interface TransactionReadableEngine {
  txStore?: { getStore(): { transaction?: unknown } | undefined };
  isClosedUnitHandle?: (handle: unknown) => boolean;
}

/**
 * Answer {@link OpenTransactionKind} for a write running on `engine` whose
 * execution context carries `threaded` as its transaction handle (or none).
 * An engine that exposes neither the ambient store nor the unit ledger (a
 * double) is read from `threaded` alone.
 */
export function openTransactionKind(engine: unknown, threaded?: unknown): OpenTransactionKind {
  const e = engine as TransactionReadableEngine | undefined;
  const closed = (handle: unknown): boolean => {
    try {
      return typeof e?.isClosedUnitHandle === 'function' && e.isClosedUnitHandle(handle) === true;
    } catch {
      return false;
    }
  };
  let ambient: unknown;
  try {
    ambient = e?.txStore?.getStore()?.transaction;
  } catch {
    ambient = undefined;
  }
  const ambientOpen = ambient != null && !closed(ambient);
  const threadedOpen = threaded != null && !closed(threaded);
  if (threadedOpen && (!ambientOpen || threaded !== ambient)) return 'separate';
  return ambientOpen || threadedOpen ? 'joined' : 'none';
}
