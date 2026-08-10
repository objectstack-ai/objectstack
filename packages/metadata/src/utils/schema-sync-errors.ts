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

// [#6615] The Postgres `"x" of relation "y"` phrase, owned once — see the
// module docblock in `@objectstack/types` for the superstring hole it closes
// and for why the exclusion's width deliberately differs from the extractor's.
import { isRelationSubObjectPhrase } from '@objectstack/types';

/** One "which errors mean X?" vocabulary, in the three forms drivers use. */
interface DriverErrorSignature {
    /** `error.code` — Postgres SQLSTATE, or mysql2's symbolic name. */
    readonly codes: ReadonlySet<string>;
    /** `error.errno` — MySQL/MariaDB numeric equivalents. */
    readonly errnos: ReadonlySet<number>;
    /** `error.message` — the only signal SQLite-family drivers give. */
    readonly message: RegExp;
    /**
     * Optional **front-exclusion**, evaluated before any positive test (#6347).
     *
     * A message test can never exclude a *superstring*: once a legal phrase for
     * X appears inside a longer phrase that means NOT-X, no amount of widening
     * the X regex removes the match — the phrase really is in there. The only
     * repair is to recognise the not-X shape first and stop. So this is a
     * separate channel rather than another alternation in {@link message}.
     */
    readonly excludes?: {
        /** SQLSTATEs / driver codes that positively mean "**not** this case". */
        readonly codes: ReadonlySet<string>;
        /**
         * Message shapes that carry a legal match for this case as a substring.
         *
         * A predicate rather than a `RegExp` since #6615, so this channel can be
         * satisfied by a shared, named question from `@objectstack/types` instead
         * of a pattern this file owns alone. The phrase it tests is the same one
         * `@objectstack/rest` and `@objectstack/service-analytics` read.
         */
        readonly matchesMessage: (message: string) => boolean;
    };
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
 *
 * That was not enough on its own, and #6347 is why. Postgres has **two**
 * missing-column phrasings, one per direction:
 *
 * | path | phrase | SQLSTATE | matched the message test? |
 * |:---|:---|:---|:---|
 * | read (`SELECT`) | `column "bogus" does not exist` | 42703 | no |
 * | write (`INSERT`/`UPDATE`/`ALTER`) | `column "label" of relation "sys_team" does not exist` | 42703 | **yes** |
 *
 * The write-path phrase contains a complete, legal missing-table phrase —
 * `relation "sys_team" does not exist` — as a substring, so the table-scoped
 * test above matched it and answered *benign* about an error the docblock two
 * paragraphs up already named as one that must stay loud. The same holds for
 * every other sub-object of a relation Postgres phrases this way, e.g.
 * `constraint "uq_x" of relation "sys_team" does not exist` (42704). And
 * code-first does not rescue it: {@link matchesDriverError} is a sequential OR,
 * so a `code: '42703'` error simply falls past the two code lines and is
 * decided by the message.
 *
 * Hence {@link DriverErrorSignature.excludes}: the not-a-table shapes are
 * recognised FIRST, and recognition ends the question with `false`.
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
    excludes: {
        /**
         * Exactly the three SQLSTATEs the docblock above already names as
         * must-stay-loud neighbours of `does not exist`. They are listed here
         * rather than merely trusted to miss the message test, because two of
         * them (42703 columns, 42704 constraints/triggers) have a phrasing that
         * *does* hit it, and because a code is a fact where prose is a guess.
         *
         * Postgres-shaped on purpose: measured, neither MySQL
         * (`Unknown column 'label' in 'field list'`) nor SQLite
         * (`no such column: bogus`, `table t has no column named label`)
         * phrases a sub-object failure so that a missing-table phrase falls out
         * of it, so there is nothing there to exclude. Adding their codes would
         * be surface with no defect behind it.
         */
        codes: new Set([
            '42703', // undefined_column
            '42704', // undefined_object — constraint, trigger, role, type, …
            '3D000', // invalid_catalog_name — `database "x" does not exist`
        ]),
        /**
         * `«sub-object» "x" of relation "y" …` — Postgres' phrasing for a
         * failure about something *inside* a relation, which therefore says the
         * relation itself is present. The two in-repo siblings that carry this
         * phrase are `mapDataError` (`packages/rest`, #5352) and
         * `service-analytics`'s missing-column subtraction (#6035/PR #6346).
         *
         * [#6615] All three now read one home — `@objectstack/types` — instead
         * of three hand-kept copies, so the phrase can no longer be taught to
         * the repo a fourth time or drift in one package only. The **width**
         * difference that used to justify the copy is preserved and is the
         * reason the home exports two functions rather than one: those two
         * *extract* the column name to phrase a better error, so a miss costs a
         * vaguer message; this one *excludes*, so a miss restores the
         * corruption. {@link isRelationSubObjectPhrase} is therefore the wider
         * question — it drops their `column`/`[a-z0-9_]+`/`does not exist`
         * anchors: any sub-object, any quoted identifier, any verdict.
         * Over-matching here only ever converts a benign verdict into a loud
         * one, which is the direction this whole module already errs in.
         */
        matchesMessage: isRelationSubObjectPhrase,
    },
};

/** How far to follow an `error.cause` chain — drivers wrap, but not deeply. */
const MAX_CAUSE_DEPTH = 4;

/**
 * The single matcher both predicates run on: exclusions, then code, then errno,
 * then message, then one step down the `cause` chain.
 *
 * Unrecognised is always `false` — a benign verdict must be *earned*, never
 * defaulted to, because a false "benign" corrupts data while a false "real"
 * costs one error line.
 *
 * The exclusion runs at every node and, when it fires, returns `false` **without
 * descending into `cause`** (#6347). Two reasons, both the conservative
 * direction: an error that positively identifies as "a column of an existing
 * relation" *is* that error, whatever it wraps; and stopping can only ever
 * subtract benign verdicts, never add one.
 */
function matchesDriverError(
    error: unknown,
    signature: DriverErrorSignature,
    depth: number,
): boolean {
    if (error === null || error === undefined || depth > MAX_CAUSE_DEPTH) return false;

    if (typeof error === 'string') {
        if (signature.excludes?.matchesMessage(error)) return false;
        return signature.message.test(error);
    }
    if (typeof error !== 'object') return false;

    const err = error as {
        code?: unknown;
        errno?: unknown;
        message?: unknown;
        cause?: unknown;
    };

    const excludes = signature.excludes;
    if (excludes) {
        if (typeof err.code === 'string' && excludes.codes.has(err.code)) return false;
        if (typeof err.message === 'string' && excludes.matchesMessage(err.message)) return false;
    }

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
 * A failure about a **column** of a relation is never this case, in either of
 * Postgres' two phrasings — the relation is right there in the message because
 * it exists (#6347). See {@link MISSING_TABLE}'s `excludes`.
 *
 * @param error - The value thrown by a driver/engine read (`find`, `findOne`, …).
 * @param depth - Internal `cause`-chain recursion counter; callers pass nothing.
 * @returns `true` only when the error positively identifies as
 *          table/relation-does-not-exist.
 */
export function isMissingTableError(error: unknown, depth = 0): boolean {
    return matchesDriverError(error, MISSING_TABLE, depth);
}
