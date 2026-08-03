// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DDL failure classification for metadata schema sync (#4728, rule from #4632).
 *
 * `IDataDriver.syncSchema()` is contractually **idempotent** ("creates tables if
 * missing, adds columns, updates indexes"), so in principle a re-sync of an
 * existing table should not throw at all. In practice a driver may surface the
 * already-provisioned case as an error instead of a no-op — `CREATE TABLE`
 * without `IF NOT EXISTS`, an `ALTER TABLE ADD COLUMN` for a column that is
 * already there. That single failure reason is benign: the table and its columns
 * exist, so the bytes will land.
 *
 * **Every other** DDL failure is not benign, and the difference is the whole
 * point of this module. Insufficient privileges, a datasource that never
 * connected, an incompatible column type — after those, the table or column does
 * not exist, yet the process keeps looking healthy while everything it claims to
 * persist has nowhere to land. That is the #4420 shape, and AGENTS.md →
 * "Degradation log levels" requires it to be reported at `error`.
 *
 * The defect this replaces was a `catch` whose comment named the benign reason
 * ("e.g. table already exists") and used it to excuse **all** of them. Callers
 * must therefore ask the question by error *type*:
 *
 * ```ts
 * catch (error) {
 *   if (!isSchemaAlreadyExistsError(error)) {
 *     console.error('… consequence … fix …', error);   // loud, and stay not-ready
 *     return;
 *   }
 *   // benign only: the table is already provisioned, carry on
 * }
 * ```
 *
 * Classification is deliberately conservative — anything not positively
 * recognised as "already exists" is treated as a real failure, because the cost
 * of a false "benign" (silent data loss) is far higher than the cost of a false
 * "real" (one extra error line).
 */

/**
 * Driver/SQLSTATE codes that mean "the thing you asked me to create is already
 * there". Postgres reports SQLSTATE on `code`; mysql2 reports its symbolic name.
 */
const ALREADY_EXISTS_CODES: ReadonlySet<string> = new Set([
    // PostgreSQL SQLSTATE (class 42 — syntax error or access rule violation)
    '42P07', // duplicate_table
    '42701', // duplicate_column
    '42710', // duplicate_object — index / constraint already exists
    // MySQL / MariaDB (mysql2 puts the symbolic name on `code`)
    'ER_TABLE_EXISTS_ERROR', // 1050
    'ER_DUP_FIELDNAME', // 1060
    'ER_DUP_KEYNAME', // 1061
]);

/** MySQL/MariaDB numeric equivalents of the codes above (`errno`). */
const ALREADY_EXISTS_ERRNOS: ReadonlySet<number> = new Set([1050, 1060, 1061]);

/**
 * Message fallback for drivers that carry no machine-readable code — notably
 * SQLite, whose `code` is the undifferentiated `SQLITE_ERROR` for every DDL
 * failure, so the message is the only signal available:
 *   - `table sys_metadata already exists`
 *   - `duplicate column name: environment_id`
 *   - `index idx_x already exists`
 * Postgres phrases its own as `relation "x" already exists` /
 * `column "x" of relation "y" already exists`, which matches the same test.
 */
const ALREADY_EXISTS_MESSAGE = /already exists|duplicate column name|duplicate key name/i;

/** How far to follow an `error.cause` chain — drivers wrap, but not deeply. */
const MAX_CAUSE_DEPTH = 4;

/**
 * Is this DDL error the benign "already provisioned" case?
 *
 * @param error - The value thrown by `syncSchema()` (or any DDL call).
 * @returns `true` only when the error positively identifies as
 *          table/column/index-already-exists. Anything else — including an
 *          unrecognised error, `undefined`, or a permission/connection failure —
 *          returns `false` and MUST be reported loudly by the caller.
 */
export function isSchemaAlreadyExistsError(error: unknown, depth = 0): boolean {
    if (error === null || error === undefined || depth > MAX_CAUSE_DEPTH) return false;

    if (typeof error === 'string') return ALREADY_EXISTS_MESSAGE.test(error);
    if (typeof error !== 'object') return false;

    const err = error as {
        code?: unknown;
        errno?: unknown;
        message?: unknown;
        cause?: unknown;
    };

    if (typeof err.code === 'string' && ALREADY_EXISTS_CODES.has(err.code)) return true;
    if (typeof err.errno === 'number' && ALREADY_EXISTS_ERRNOS.has(err.errno)) return true;
    if (typeof err.message === 'string' && ALREADY_EXISTS_MESSAGE.test(err.message)) return true;

    // Drivers commonly re-throw with the original attached as `cause`.
    return isSchemaAlreadyExistsError(err.cause, depth + 1);
}
