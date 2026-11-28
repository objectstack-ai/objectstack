// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A standalone MongoDB server and the engine's units of work.
 *
 * The engine opens a unit (a transaction on the default driver) around a write
 * on an object that carries a metadata `before*` hook on the same verb, or an
 * `after*` hook that can abort it, so a refusal later in the write rolls the
 * hook's `ctx.api` writes back with it; and around every `engine.transaction()`
 * call. This driver opens that unit as a client session with
 * `startTransaction()`, which costs no round trip, so `beginTransaction()`
 * succeeds against any server. A standalone `mongod` runs no transactions: the
 * first command sent under the session is answered with code 20
 * (`IllegalOperation`) "Transaction numbers are only allowed on a replica set
 * member or mongos".
 *
 * What the operator used to see was not that answer. For a WRITE the MongoDB
 * Node client replaces it with its own hint — "This MongoDB deployment does
 * not support retryable writes. Please add retryWrites=false to your
 * connection string." — keeping the server's error as `originalError`. The
 * hint is wrong for this case, measured on a MongoDB 8.0 standalone: with
 * `retryWrites=false` the answer is the same, because what is missing is
 * transactions, not retryable writes.
 *
 * Two things live here:
 *
 *  - {@link refusalForUnitFault} recognises that failure on a command that ran
 *    under the unit's session (either spelling: the server's own, or the
 *    client's rewrite of it) and answers a refusal that names the cause and the
 *    fix. It changes WHAT the refusal says and nothing about WHEN: the command
 *    that failed before still fails, a write that opens no unit is untouched,
 *    and a unit that sends no command under its session still commits, as it
 *    did. `beginTransaction()` is deliberately not made to refuse: a unit whose
 *    only writes are carved out of it (an append-only ledger on another
 *    datasource) commits on a standalone server today, and refusing at the
 *    begin would break it.
 *  - {@link isStandaloneHello} reads a `hello` reply so `connect()` can say once,
 *    at boot, that this store carries no units ({@link standaloneStoreWarning}).
 *
 * ⛔ The standalone answer is NOT expressed as `supports.transactionsUnsupported`.
 * That bit makes the engine skip the unit and run a hooked write WITHOUT one, so
 * the hook's side writes would stop rolling back: a change to hook atomicity,
 * which is a product decision and not this refusal's to make.
 */

import { StandardErrorCode } from '@objectstack/spec/api';

/** The server's code for the standalone answer (`IllegalOperation`). */
const ILLEGAL_OPERATION = 20;

/**
 * The server's own text for it. The Node client matches the same words before
 * it rewrites a write's error, so the two spellings are told apart from every
 * other `IllegalOperation` the same way.
 */
const NO_TRANSACTION_NUMBERS = /Transaction numbers are only allowed on a replica set member or mongos/;

/** How deep `originalError` is followed: the client wraps the server's error once. */
const MAX_WRAP_DEPTH = 3;

/**
 * Whether `error` is a standalone server refusing a command sent under a
 * transaction: the server's own error, or the client's retryable-writes
 * rewrite carrying it as `originalError`.
 */
export function isStandaloneTransactionFault(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_WRAP_DEPTH; depth++) {
    if (current === null || typeof current !== 'object') return false;
    const { code, errmsg, message, originalError } = current as {
      code?: unknown; errmsg?: unknown; message?: unknown; originalError?: unknown;
    };
    const text = typeof errmsg === 'string' ? errmsg : typeof message === 'string' ? message : '';
    if (code === ILLEGAL_OPERATION && NO_TRANSACTION_NUMBERS.test(text)) return true;
    current = originalError;
  }
  return false;
}

/** The refusal {@link refusalForUnitFault} answers: an `Error` carrying the ADR-0112 `code` and `status`. */
export type StandaloneUnitRefusal = Error & { code: 'NOT_IMPLEMENTED'; status: 501; cause?: unknown };

/**
 * The refusal for a command that a standalone server refused because it ran
 * under a unit's session, or `error` itself when it is anything else.
 *
 * `NOT_IMPLEMENTED` / 501, the answer this driver already gives for a
 * capability its backend lacks (a zoned date bucket): nothing in the write is
 * wrong, the store cannot carry the transaction the write runs in. The
 * client's error stays reachable as `cause`.
 */
export function refusalForUnitFault(error: unknown): unknown {
  if (!isStandaloneTransactionFault(error)) return error;
  const refusal = new Error(
    'This MongoDB server is a standalone mongod, and MongoDB runs transactions only on a replica set ' +
      'member or through mongos, so the transaction this write runs in cannot be carried and the write ' +
      'is refused. The engine opens that transaction around a write on an object that carries a ' +
      "metadata before* hook on the same verb, or an after* hook whose onError is 'abort', so that a " +
      "refusal later in the write rolls the hook's ctx.api writes back with it, and around every " +
      'engine.transaction(). Nothing written inside the transaction was stored. Fix the store, not the ' +
      'connection string: run MongoDB as a replica set (a single-node one is enough: start mongod with ' +
      '--replSet rs0 and run rs.initiate() once) and point the datasource at it. Adding ' +
      'retryWrites=false to the connection string, as the MongoDB client suggests, does not help: it ' +
      'turns off retryable writes, not the missing transactions. Writes on objects that open no ' +
      'transaction are unaffected.',
  ) as StandaloneUnitRefusal;
  // Assigned, not passed as `new Error(message, { cause })`: this package
  // compiles against the ES2020 lib, which has no `ErrorOptions`.
  refusal.cause = error;
  refusal.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  refusal.status = 501;
  return refusal;
}

/**
 * Whether a `hello` reply describes a standalone server: neither a replica set
 * member (`setName`) nor a `mongos` router (`msg: 'isdbgrid'`, which a load
 * balancer in front of `mongos` relays as well).
 */
export function isStandaloneHello(reply: unknown): boolean {
  if (reply === null || typeof reply !== 'object') return false;
  const { setName, msg } = reply as { setName?: unknown; msg?: unknown };
  return !(typeof setName === 'string' && setName !== '') && msg !== 'isdbgrid';
}

/**
 * The line `connect()` logs once when the store is a standalone server.
 *
 * It cannot name the affected objects: the store connects before any hook is
 * bound, so which objects carry a metadata hook is not known yet. It names the
 * kind of object instead, and says that the first such write is refused with
 * the same cause and fix.
 *
 * `warn`, not `error` (AGENTS.md, degradation log levels): nothing is lost —
 * each affected write is refused to its caller, loudly, and nothing it wrote is
 * stored. A capability is missing, which is the functional case.
 */
export function standaloneStoreWarning(database: string): string {
  return (
    `MongoDB database '${database}' is served by a standalone mongod, which runs no transactions. ` +
    'Every write that runs in one will be refused: a write on an object that carries a metadata before* ' +
    "hook on the same verb, or an after* hook whose onError is 'abort', and every engine.transaction(). " +
    'Writes on other objects are unaffected. The objects are not listed here because the store connects ' +
    'before hooks are bound; the first such write is refused naming this cause. Run MongoDB as a replica ' +
    'set (a single-node one is enough: start mongod with --replSet rs0 and run rs.initiate() once); ' +
    'retryWrites=false in the connection string does not help.'
  );
}
