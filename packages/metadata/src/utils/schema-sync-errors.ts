// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Driver-error classification for the metadata storage seams (#4728, #4825;
 * rule from #4632).
 *
 * Two questions live here, and they share one mechanism on purpose. A second
 * hand-rolled `catch`-and-guess elsewhere in this package would be a second
 * de-facto vocabulary of "which driver errors are benign" — the exact debt this
 * module exists to retire. Both predicates below are thin wrappers over one
 * signature matcher, so a driver quirk is taught to the package once.
 *
 * 1. {@link isSchemaAlreadyExistsError} — "was this DDL failure just the table
 *    already being there?" (#4728, `ensureSchema` / `ensureHistorySchema`).
 * 2. {@link isMissingTableError} — "did this READ fail because the table has
 *    not been provisioned yet?" (#4825, `nextEventSeq`).
 *
 * They are deliberately **not** each other's negation. Each answers "is this
 * the one benign reason?" and defaults to *not benign*, so an error neither
 * recognises is loud under both.
 *
 * ---
 *
 * ## 1. DDL failure classification (#4728)
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
 *
 * ---
 *
 * ## 2. Missing-table classification for reads (#4825)
 *
 * `DatabaseLoader.nextEventSeq()` reads `sys_metadata_history` to decide what
 * `event_seq` the NEXT history row gets. Its `catch` named both reasons a read
 * can fail — "table not provisioned yet" (benign: 1 really is the next number)
 * and "driver error" (**not** benign) — and answered both with `return 1`.
 *
 * That is the #4728 shape one layer down, but the damage is the opposite kind
 * and worse. #4728 was *bytes that never landed*; this is **bytes that land
 * wrong**: with N rows already in the table, one flaky read hands the next row
 * `event_seq = 1`, colliding with an existing row. The insert **succeeds**, no
 * line is logged, and `event_seq` — the ordering key that history listing and
 * rollback targeting both stand on — is now silently untrustworthy.
 *
 * So the read seam gets the same treatment, with the same conservative default:
 *
 * ```ts
 * catch (error) {
 *   if (isMissingTableError(error)) return 1;   // benign: nothing to collide with
 *   throw error;                                // caller reports the consequence
 * }
 * ```
 */

/** One "which errors mean X?" vocabulary, in the three forms drivers use. */
interface DriverErrorSignature {
    /** `error.code` — Postgres SQLSTATE, or mysql2's symbolic name. */
    readonly codes: ReadonlySet<string>;
    /** `error.errno` — MySQL/MariaDB numeric equivalents. */
    readonly errnos: ReadonlySet<number>;
    /** `error.message` — the only signal SQLite-family drivers give. */
    readonly message: RegExp;
}

/**
 * Driver/SQLSTATE codes that mean "the thing you asked me to create is already
 * there". Postgres reports SQLSTATE on `code`; mysql2 reports its symbolic name.
 */
const ALREADY_EXISTS: DriverErrorSignature = {
    codes: new Set([
        // PostgreSQL SQLSTATE (class 42 — syntax error or access rule violation)
        '42P07', // duplicate_table
        '42701', // duplicate_column
        '42710', // duplicate_object — index / constraint already exists
        // MySQL / MariaDB (mysql2 puts the symbolic name on `code`)
        'ER_TABLE_EXISTS_ERROR', // 1050
        'ER_DUP_FIELDNAME', // 1060
        'ER_DUP_KEYNAME', // 1061
    ]),
    errnos: new Set([1050, 1060, 1061]),
    /**
     * Message fallback for drivers that carry no machine-readable code —
     * notably SQLite, whose `code` is the undifferentiated `SQLITE_ERROR` for
     * every DDL failure, so the message is the only signal available:
     *   - `table sys_metadata already exists`
     *   - `duplicate column name: environment_id`
     *   - `index idx_x already exists`
     * Postgres phrases its own as `relation "x" already exists` /
     * `column "x" of relation "y" already exists`, which matches the same test.
     */
    message: /already exists|duplicate column name|duplicate key name/i,
};

/**
 * Codes/messages that mean "the table you tried to READ has not been created".
 *
 * Narrower than it looks, on purpose. `does not exist` on its own also covers
 * `role "x" does not exist` (42704), `database "x" does not exist` (3D000) and
 * `column "x" does not exist` (42703) — every one of them a **real** failure
 * that must stay loud, and every one of them a case where "start numbering at
 * 1" would be the wrong answer against a table that may be full of rows. So the
 * message test demands the word table/relation next to the phrase rather than
 * the phrase alone, and the code set carries only the table-scoped SQLSTATEs.
 */
const MISSING_TABLE: DriverErrorSignature = {
    codes: new Set([
        '42P01', // PostgreSQL undefined_table
        'ER_NO_SUCH_TABLE', // MySQL / MariaDB 1146
    ]),
    errnos: new Set([1146]),
    /**
     *   - SQLite / libsql: `no such table: sys_metadata_history`
     *   - PostgreSQL:      `relation "sys_metadata_history" does not exist`
     *   - MySQL/MariaDB:   `Table 'app.sys_metadata_history' doesn't exist`
     */
    message:
        /no such table|relation ["'`][^"'`]+["'`] does not exist|table ["'`][^"'`]+["'`] doesn'?t exist|unknown table/i,
};

/** How far to follow an `error.cause` chain — drivers wrap, but not deeply. */
const MAX_CAUSE_DEPTH = 4;

/**
 * The single matcher both predicates run on: code, then errno, then message,
 * then one step down the `cause` chain.
 *
 * Unrecognised is always `false` — a benign verdict must be *earned*, never
 * defaulted to, because a false "benign" corrupts data while a false "real"
 * costs one error line.
 */
function matchesDriverError(
    error: unknown,
    signature: DriverErrorSignature,
    depth: number,
): boolean {
    if (error === null || error === undefined || depth > MAX_CAUSE_DEPTH) return false;

    if (typeof error === 'string') return signature.message.test(error);
    if (typeof error !== 'object') return false;

    const err = error as {
        code?: unknown;
        errno?: unknown;
        message?: unknown;
        cause?: unknown;
    };

    if (typeof err.code === 'string' && signature.codes.has(err.code)) return true;
    if (typeof err.errno === 'number' && signature.errnos.has(err.errno)) return true;
    if (typeof err.message === 'string' && signature.message.test(err.message)) return true;

    // Drivers commonly re-throw with the original attached as `cause`.
    return matchesDriverError(err.cause, signature, depth + 1);
}

/**
 * Is this DDL error the benign "already provisioned" case?
 *
 * @param error - The value thrown by `syncSchema()` (or any DDL call).
 * @param depth - Internal `cause`-chain recursion counter; callers pass nothing.
 * @returns `true` only when the error positively identifies as
 *          table/column/index-already-exists. Anything else — including an
 *          unrecognised error, `undefined`, or a permission/connection failure —
 *          returns `false` and MUST be reported loudly by the caller.
 */
export function isSchemaAlreadyExistsError(error: unknown, depth = 0): boolean {
    return matchesDriverError(error, ALREADY_EXISTS, depth);
}

/**
 * Is this READ error the benign "table has not been provisioned yet" case?
 *
 * The only failure that licenses a caller to treat an empty table as the truth
 * — there are no rows, so there is nothing to be inconsistent with. A
 * connection drop, a timeout, a permission denial or a query error all mean the
 * rows may well exist and simply were not seen; those return `false` and the
 * caller must report the consequence and give up rather than compute an answer
 * from data it never read (#4825).
 *
 * @param error - The value thrown by a driver/engine read (`find`, `findOne`, …).
 * @param depth - Internal `cause`-chain recursion counter; callers pass nothing.
 * @returns `true` only when the error positively identifies as
 *          table/relation-does-not-exist.
 */
export function isMissingTableError(error: unknown, depth = 0): boolean {
    return matchesDriverError(error, MISSING_TABLE, depth);
}
