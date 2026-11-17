// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The refusal of a `DriverOptions.lockRows` request the engine cannot honour.
 *
 * A lock request is a promise the caller acts on: "no other writer commits a
 * change to these rows until my transaction ends". Handing it to a driver that
 * ignores it, or sending it with no transaction to hold the lock to, would
 * answer the read as if the rows were locked while they are not. So the engine
 * refuses, before the driver is called, in the two shapes that cannot hold:
 *
 * - the object's driver does not declare `supports.lockRows`:
 *   `NOT_IMPLEMENTED`, 501 — this backend does not implement that declared
 *   capability, the answer a driver gives a spec-declared aggregate function
 *   it cannot compile;
 * - no transaction reaches the driver for the call: `PRECONDITION_REQUIRED`,
 *   428 — the lock needs a unit of work, and the request carries none.
 *
 * The engine's own sender (a predicate delete's matched-row read) checks both
 * before it asks, so this is the answer only a caller's explicit `lockRows`
 * can draw. `@objectstack/types`' error classification reads the declared
 * `code` and `status`.
 *
 * ⛔ Not exported from the package entry: an in-process caller branches on
 * `code`, which survives the dual build where `instanceof` does not.
 */
export class LockRowsRefusedError extends Error {
  readonly code: 'NOT_IMPLEMENTED' | 'PRECONDITION_REQUIRED';
  readonly status: 501 | 428;
  /** The same number under ADR-0112 D5's spelling. */
  readonly httpStatus: 501 | 428;

  constructor(
    /** The object whose read asked for the lock. */
    public readonly object: string,
    /** Why the lock cannot be held. */
    public readonly reason: 'driver-cannot-lock' | 'no-transaction',
    /** The object's driver, as it names itself. */
    driverName?: string,
  ) {
    super(
      reason === 'driver-cannot-lock'
        ? `Cannot lock the rows of "${object}": its driver${driverName ? ` (${driverName})` : ''} does not ` +
          'declare supports.lockRows, so it would read them unlocked. Drop lockRows, or keep this object ' +
          'on a driver that can lock rows.'
        : `Cannot lock the rows of "${object}" outside a transaction: a row lock is held until the ` +
          'transaction ends, and this read runs in none. Run it inside engine.transaction(), or drop lockRows.',
    );
    this.name = 'LockRowsRefusedError';
    this.code = reason === 'driver-cannot-lock' ? 'NOT_IMPLEMENTED' : 'PRECONDITION_REQUIRED';
    this.status = reason === 'driver-cannot-lock' ? 501 : 428;
    this.httpStatus = this.status;
  }
}
