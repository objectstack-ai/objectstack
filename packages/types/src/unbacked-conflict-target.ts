// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one named predicate for "did the database refuse this `ON CONFLICT`
 * target because no PRIMARY KEY or UNIQUE index backs it?" (#8567).
 *
 * ## ⚠️ This is NOT `isUniqueViolationError` — it is the OPPOSITE condition
 *
 * Read this before touching either predicate. They are one file apart and one
 * word apart in English, and they answer inverse questions:
 *
 * | predicate | the index | the row |
 * |:---|:---|:---|
 * | {@link isUniqueViolationError} | **exists** | violated it |
 * | `isUnbackedConflictTargetError` | **does not exist** | never got compared |
 *
 * Merging them — or reaching for whichever one autocomplete offers — reports a
 * *working* constraint as a missing one, which sends an operator to add an
 * index that is already there while the real duplicate goes unexplained. The
 * warning is repeated at both call sites and in `unique-violation.ts` because
 * it is the most expensive mistake available anywhere near this question.
 *
 * ⚠️ The separation is **not clean today, in the pre-existing direction**, and
 * pinning it is what found that: `isUniqueViolationError` claims SQLite's
 * unbacked-target error, because that sentence ends `…PRIMARY KEY or UNIQUE
 * constraint` and its vocabulary matches the word pair `unique constraint`
 * wherever it appears — including inside a sentence saying the constraint is
 * ABSENT. Filed as #8590; not fixed by #8567, which would have moved verdicts
 * in six consuming packages on a card that measured a different question.
 * `unbacked-conflict-target.test.ts` records both predicates' verdicts on every
 * measured text, per dialect, so neither the fix nor a fresh drift can land
 * silently. Nothing below may take a limb from that vocabulary, or give one to
 * it, while #8590 is open.
 *
 * ## What each dialect actually says — measured, never transcribed
 *
 * #8445 landed this recognition for SQLite alone and said so: the container
 * that implemented it had no other server, and transcribing another dialect's
 * wording from memory was ruled out as evidence. #8567 raised the condition on
 * a real Postgres 16.13 (system PG16 binaries, `initdb` + `pg_ctl`, no
 * container runtime) through the same knex + `pg` path `SqlDriver.upsert`
 * uses, and read the fields off the thrown error object:
 *
 * ```
 * # POSTGRES 16.13, knex 3.3.0 + pg 8.22.0
 * upsert('plain', { email: 'a@b.com', title: 'x' }, ['email'])
 *   -> name=error (DatabaseError) code=42P10 severity=ERROR status=undefined
 *      routine=infer_arbiter_indexes   constraint=undefined   detail=undefined
 *      msg=insert into "plain" ("email", "id", "title") values ($1, $2, $3)
 *          on conflict ("email") do update set "title" = excluded."title"
 *          - there is no unique or exclusion constraint matching the ON CONFLICT specification
 *
 * # SQLITE 3.x, knex 3.3.0 + better-sqlite3 (#8445's measurement, unchanged)
 * upsert('plain', { email: 'a@b.com', title: 'x' }, ['email'])
 *   -> name=SqliteError code=SQLITE_ERROR status=undefined
 *      msg=insert into `plain` (...) values (...) on conflict (`email`) do update set ...
 *          - ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint
 * ```
 *
 * Two dialects, two unrelated sentences, and the same envelope from knex: the
 * STATEMENT, then ` - `, then the server's own text. That tail is what both
 * limbs below are anchored on, so a knex-prefixed message and a bare driver
 * message are recognised identically.
 *
 * ## Why the `code` channel is unused — also measured
 *
 * The obvious predicate is `code === '42P10'`, and it is wrong in both
 * directions:
 *
 *  - **SQLite has no code to read.** It answers plain `SQLITE_ERROR`, the same
 *    generic code a syntax error or a missing table carries. `driver-sql`'s
 *    own suite pins that: an upsert against a table that was never created
 *    must come back as itself, and it is a `SQLITE_ERROR` too.
 *  - **Postgres' code OVER-matches.** `42P10` is `invalid_column_reference`,
 *    not "unbacked conflict target". Measured on the same cluster, same
 *    session:
 *
 *    ```
 *    select id from plain order by 7  -> code=42P10  "ORDER BY position 7 is not in select list"
 *    select id from plain group by 9  -> code=42P10  "GROUP BY position 9 is not in select list"
 *    ```
 *
 *    A code-only limb would answer `VALIDATION_ERROR` "no unique index backs
 *    your conflict keys" to a caller whose real defect is an out-of-range sort
 *    position — a refusal pointing at the wrong thing entirely. So the message
 *    is not a fallback for a missing code here; it is the only channel that
 *    identifies the condition, on both dialects, and the code channel is
 *    deliberately left unread rather than ANDed in for a narrowing it does not
 *    provide.
 *
 * The Postgres limb is safe to match on prose because the sentence has exactly
 * one source: `infer_arbiter_indexes` (`plancat.c`), reached only while
 * planning an `ON CONFLICT` inference, which the measured `routine` field
 * confirms. The SQLite limb has the same property, stated at #8445.
 *
 * ## MySQL: the condition cannot arise, and that is measured too
 *
 * MySQL has no `ON CONFLICT` syntax. knex compiles the driver's exact call to
 * `ON DUPLICATE KEY UPDATE`, which takes **no conflict target** — the named
 * keys are dropped from the statement before it leaves the process, so the
 * server is never asked to find an index for them and cannot complain that
 * none exists. Compiled with knex 3.3.0 on the `mysql2` dialect, no server
 * needed (`.toSQL()`), and pinned by
 * `sql-driver-upsert-conflict-target-dialects.test.ts`:
 *
 * ```
 * knex('plain').insert({...}).onConflict(['email']).merge(['title']).toSQL()
 *   mysql2 -> insert into `plain` (`email`, `id`, `title`) values (?, ?, ?)
 *             on duplicate key update `title` = values(`title`)      ← no `email` target
 *   pg     -> insert into "plain" (...) values ($1, $2, $3)
 *             on conflict ("email") do update set "title" = excluded."title"
 * ```
 *
 * So there is no MySQL limb to write, and its absence is a finding rather than
 * a gap. ⚠️ What MySQL does *instead* — merge on whichever unique key the row
 * happens to collide with, or insert a second row — is a different defect with
 * a different fix, and is NOT this predicate's business.
 *
 * ## Home
 *
 * `@objectstack/types`, beside {@link isUniqueViolationError}, for the reason
 * that module records: every consumer of the question already depends on this
 * package, so naming it here never adds an edge, and this module deliberately
 * imports nothing. The alternative — a second private regex in each driver
 * that meets the condition — is exactly the state `unique-violation.ts` was
 * written to retire, where four hand-written vocabularies disagreed about
 * MySQL and nobody could see it.
 */

/**
 * One dialect vocabulary for this condition, in the channel that carries it.
 *
 * Deliberately **message-only**, unlike `UniqueViolationSignature`'s
 * three-channel table — the module head records the measurements: SQLite's
 * `code` is the generic `SQLITE_ERROR`, and Postgres' `42P10` is
 * `invalid_column_reference`, which an out-of-range `ORDER BY` position also
 * raises. Neither channel narrows anything, and a `codes` set standing empty
 * beside them would read as "nobody has filled this in yet" rather than as the
 * decision it is.
 */
interface UnbackedConflictTargetSignature {
    /**
     * `error.message` — matched on the server's own sentence, which knex leaves
     * as the tail after the statement and ` - `.
     */
    readonly message: RegExp;
}

/**
 * Every wording measured for this condition, one limb per dialect that can
 * raise it. Nothing here is inferred: each limb was read off a thrown error
 * object, and the transcript is in the module head above.
 *
 *  - SQLite: `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE
 *    constraint` — stable since `ON CONFLICT` arrived in 3.24 (#8445).
 *  - Postgres: `there is no unique or exclusion constraint matching the ON
 *    CONFLICT specification` — `infer_arbiter_indexes`, PG 16.13 (#8567).
 *
 * Deliberately NOT here: any limb for MySQL (the condition cannot reach the
 * server — see the module head), and any bare `ON CONFLICT` fragment. A limb
 * loose enough to match `on conflict` alone would match the driver's own
 * *statement* text, which knex prefixes onto every upsert failure — including
 * a unique violation, which is the opposite condition.
 */
const UNBACKED_CONFLICT_TARGET: UnbackedConflictTargetSignature = {
    message:
        /ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint|there is no unique or exclusion constraint matching the ON CONFLICT specification/i,
};

/** How far to follow an `error.cause` chain — drivers wrap, but not deeply. */
const MAX_CAUSE_DEPTH = 4;

/**
 * Whether a thrown driver error says the `ON CONFLICT` target it was given is
 * backed by no PRIMARY KEY or UNIQUE index.
 *
 * Reads the message channel, then one step at a time down the `cause` chain —
 * pool and query-builder layers re-throw with the original attached, and the
 * refusal this predicate gates keeps the raw error as its own `cause`. A plain
 * string is judged directly, so a caller that already unwrapped `err.message`
 * can pass it in.
 *
 * **Unrecognised is always `false`.** A false positive is the expensive
 * direction: it tells a caller to go add an index when the real failure was a
 * syntax error, a missing table, or — worst — a genuine unique violation on an
 * index that exists and works. A false negative costs only the raw error that
 * was the status quo before recognition existed.
 *
 * @param error - the thrown value, of any shape.
 *
 * @example
 * ```ts
 * catch (error) {
 *   // ⚠️ NOT isUniqueViolationError — that is the opposite condition.
 *   if (isUnbackedConflictTargetError(error)) throw refuseUnbackedConflictTarget(object, keys, error);
 *   throw error;
 * }
 * ```
 */
export function isUnbackedConflictTargetError(error: unknown): boolean {
    return matchesUnbackedConflictTarget(error, 0);
}

function matchesUnbackedConflictTarget(error: unknown, depth: number): boolean {
    if (error === null || error === undefined || depth > MAX_CAUSE_DEPTH) return false;

    if (typeof error === 'string') return UNBACKED_CONFLICT_TARGET.message.test(error);
    if (typeof error !== 'object') return false;

    const err = error as { message?: unknown; cause?: unknown };

    if (typeof err.message === 'string' && UNBACKED_CONFLICT_TARGET.message.test(err.message)) return true;

    return matchesUnbackedConflictTarget(err.cause, depth + 1);
}
