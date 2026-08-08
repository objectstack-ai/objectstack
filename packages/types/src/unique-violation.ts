// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one named predicate for "is this driver error a unique-constraint
 * violation?" (#6250).
 *
 * ## The defect this retires
 *
 * Before this module the repo carried **four** hand-written, mutually different
 * answers to that single question — no two covering the same dialects:
 *
 * | where | judged by | covered |
 * |:---|:---|:---|
 * | `service-messaging`'s `isUniqueViolation()` | 3 codes + 3 message substrings | all three |
 * | `@objectstack/rest`'s `mapDataError` | `unique constraint` / `unique violation` only | **no MySQL** |
 * | `@objectstack/rest`'s `sanitizeRowError` | three column-extracting regexes | all three |
 * | `driver-sql`'s inline regex | `unique constraint failed\|duplicate entry\|duplicate key value` | all three |
 *
 * The REST row is the one a user could feel. Its verdict decides whether a
 * conflict comes back as the API contract's `409 UNIQUE_VIOLATION` (a
 * registered code in `packages/spec/src/api/error-code-ledger.zod.ts`) or as a
 * generic `500 INTERNAL_ERROR`, and MySQL's phrasing —
 * `ER_DUP_ENTRY: Duplicate entry 'acme@example.com' for key 'idx_email_unique'`
 * — matches neither substring. Measured on `origin/main` before this change,
 * through the real `mapDataError`:
 *
 * ```
 * mysql, bare message      => 500 INTERNAL_ERROR      ← the reported defect
 * mysql, knex-prefixed SQL => 500 DATABASE_ERROR      ← second spelling, same hole
 * postgres, SQLSTATE only  => 500 INTERNAL_ERROR      ← the code channel was unread
 * sqlite,   message        => 409 UNIQUE_VIOLATION
 * postgres, message        => 409 UNIQUE_VIOLATION
 * ```
 *
 * So the hole was never MySQL-only: it was "the mapping reads one channel
 * (message substrings) of the two that drivers actually use". SQLite and
 * Postgres were invisible survivors because their prose happens to contain the
 * words the substring test looks for.
 *
 * ## Why a predicate rather than a wider heuristic
 *
 * `looksLikeInternalErrorLeak` (one file over) answers a **different**
 * question — "would echoing this text leak server internals?" — and the 409
 * mapping used to be nested *inside* its true-branch, so a message had to look
 * like a leak before it could be recognised as a conflict. Those two questions
 * have no reason to agree, and MySQL is the case where they don't. Widening the
 * leak heuristic to reach the conflict branch would have coupled them harder
 * and quietly reclassified unrelated driver text as safe-to-expose; naming the
 * conflict question separately unpicks them instead. Same move as #5841's
 * `isMissingTableError`, and the same reason.
 *
 * ## Home
 *
 * `@objectstack/types` because every consumer of the question already depends
 * on it, so adopting the predicate never adds an edge. This module deliberately
 * imports nothing.
 *
 * ## What this predicate does NOT do
 *
 * It does not name the **conflicting column**. `sanitizeRowError` extracts one
 * for the import path, and #5495 wants one to decide whether an autonumber
 * collision is retryable — but a structured conflict-column export is a new
 * contract surface, so it is deliberately not decided here (#6250's ruling).
 * This answers the yes/no question only.
 */

/**
 * One dialect vocabulary, in the three channels drivers actually use.
 *
 * Same shape as `@objectstack/metadata`'s `DriverErrorSignature` — deliberately,
 * because it is the shape the drivers force: Postgres puts SQLSTATE on `code`,
 * mysql2 puts a symbolic name on `code` *and* a number on `errno`, and the
 * SQLite family often gives nothing but prose.
 */
interface UniqueViolationSignature {
    /** `error.code` — Postgres SQLSTATE, mysql2's symbolic name, SQLite's extended result code. */
    readonly codes: ReadonlySet<string>;
    /** `error.errno` — MySQL/MariaDB's numeric equivalent of the same condition. */
    readonly errnos: ReadonlySet<number>;
    /** `error.message` — the only channel a knex-wrapped or SQLite-family error reliably carries. */
    readonly message: RegExp;
}

/**
 * The union of every unique-violation signal the four pre-existing
 * implementations encoded, plus the `errno` channel their `code`-only reads
 * missed.
 *
 * **Seeded from what real drivers emit, not invented here.** Every entry traces
 * to one of the four inventoried implementations; nothing was added on a guess:
 *
 *  - `23505` — PostgreSQL SQLSTATE `unique_violation` (from `service-messaging`).
 *  - `ER_DUP_ENTRY` — mysql2's symbolic name for 1062 (from `service-messaging`).
 *  - `SQLITE_CONSTRAINT_UNIQUE` — better-sqlite3 / libsql extended result code
 *    (from `service-messaging`).
 *  - `1062` — the same MySQL condition on the channel mysql2 *also* sets. The
 *    one addition, and not a new dialect: `@objectstack/metadata`'s
 *    `schema-sync-errors.ts` already reads `errno` alongside `code` for exactly
 *    these drivers, so a code-only read is a known gap rather than a decision.
 *
 * The message limbs are a **superset of what `mapDataError` already treated as
 * 409**, which is what makes routing REST through this predicate incapable of
 * narrowing a verdict a client relies on today:
 *
 *  - `unique constraint` — SQLite's `UNIQUE constraint failed: t.c` *and*
 *    Postgres' `... violates unique constraint "..."`. Inherited verbatim from
 *    the REST limb being replaced.
 *  - `unique violation` — inherited verbatim from the same limb (SQLSTATE
 *    23505's condition name, which some transports render as prose).
 *  - `duplicate key` — Postgres' `duplicate key value violates ...`
 *    (from `service-messaging` and `driver-sql`).
 *  - `duplicate entry` — MySQL's `Duplicate entry 'x' for key 'i'`
 *    (from `service-messaging` and `driver-sql`). **This is the limb whose
 *    absence made every MySQL conflict a 500.**
 *
 * Deliberately NOT here: bare `constraint failed`, which SQLite emits for
 * NOT NULL and FOREIGN KEY too. A predicate that says "unique" too often is a
 * worse bug than the one being fixed — a not-null violation answered as
 * `409 UNIQUE_VIOLATION` tells the client to change a value that is not the
 * problem, and 409 is a status an SDK will not retry.
 */
const UNIQUE_VIOLATION: UniqueViolationSignature = {
    codes: new Set(['23505', 'ER_DUP_ENTRY', 'SQLITE_CONSTRAINT_UNIQUE']),
    errnos: new Set([1062]),
    message: /unique constraint|unique violation|duplicate key|duplicate entry/i,
};

/** How far to follow an `error.cause` chain — drivers wrap, but not deeply. */
const MAX_CAUSE_DEPTH = 4;

/**
 * Whether a thrown driver error is a unique/primary-key constraint violation.
 *
 * Reads all three channels in turn — `code`, `errno`, `message` — then one step
 * down the `cause` chain, because pool and query-builder layers re-throw with
 * the original attached. A plain string is judged on the message channel, so a
 * caller that has already unwrapped `err.message` can pass it straight in.
 *
 * **Unrecognised is always `false`.** The default has to be "not a conflict":
 * a false positive relabels an unrelated failure as the client's fault (a 409
 * an SDK will not retry, pointing at a value that is fine), while a false
 * negative costs only the generic envelope that was the status quo.
 *
 * @param error - the thrown value, of any shape.
 *
 * @example
 * ```ts
 * catch (error) {
 *   if (isUniqueViolationError(error)) return conflict();  // 409 UNIQUE_VIOLATION
 *   throw error;
 * }
 * ```
 */
export function isUniqueViolationError(error: unknown): boolean {
    return matchesUniqueViolation(error, 0);
}

function matchesUniqueViolation(error: unknown, depth: number): boolean {
    if (error === null || error === undefined || depth > MAX_CAUSE_DEPTH) return false;

    if (typeof error === 'string') return UNIQUE_VIOLATION.message.test(error);
    if (typeof error !== 'object') return false;

    const err = error as { code?: unknown; errno?: unknown; message?: unknown; cause?: unknown };

    if (typeof err.code === 'string' && UNIQUE_VIOLATION.codes.has(err.code)) return true;
    // Postgres drivers hand SQLSTATE back as a string; a numeric `code` is
    // MySQL's errno wearing the other field's name, so it is judged as one.
    if (typeof err.code === 'number' && UNIQUE_VIOLATION.errnos.has(err.code)) return true;
    if (typeof err.errno === 'number' && UNIQUE_VIOLATION.errnos.has(err.errno)) return true;
    if (typeof err.message === 'string' && UNIQUE_VIOLATION.message.test(err.message)) return true;

    return matchesUniqueViolation(err.cause, depth + 1);
}
