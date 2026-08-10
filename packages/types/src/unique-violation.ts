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
 * ## The second question, answered separately
 *
 * `isUniqueViolationError` answers yes/no. **Which column** conflicted is a
 * different question with a different failure mode, so it is a different export:
 * {@link uniqueViolationColumn}, added by #6544 under the maintainer's
 * 2026-08-08 ruling. Read its doc comment before touching either — the two are
 * gated on each other and the column answer is deliberately narrower than the
 * boolean.
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

/* ------------------------------------------------------------------------- *
 *  #6544 — which column conflicted
 * ------------------------------------------------------------------------- */

/**
 * SQLite names the offending **columns** directly, as `table.column` pairs:
 * `UNIQUE constraint failed: sys_user.email`. Captured to end-of-line because
 * knex prefixes the failing statement, so the useful part is always the tail.
 */
const SQLITE_TARGETS = /unique constraint failed:\s*([^\n]*)/i;

/**
 * Postgres names the offending **columns** only in its `DETAIL:` line —
 * `Key (email)=(acme@example.com) already exists.` — which node-postgres puts
 * on `error.detail` and knex flattens into the message. The trailing `=(`
 * is required: it is what separates this form from the constraint-name form
 * (`violates unique constraint "sys_user_email_key"`), which names an INDEX.
 *
 * An expression index (`Key (lower(email))=(…)`) cannot match, because the
 * capture forbids `)` — which is the correct answer: `lower(email)` is not a
 * column.
 */
const POSTGRES_DETAIL_TARGETS = /\bkey \(([^)]+)\)=\(/i;

/** SQLite's other spelling, for a partial or expression index: `UNIQUE constraint failed: index 'x'`. */
const SQLITE_INDEX_FORM = /^index\b/i;

/** What a column name may look like once the table qualifier and quoting are stripped. */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/** Strip quoting and any `table.` qualifier from one constraint target. */
function bareIdentifier(raw: string): string {
    const stripped = raw.trim().replace(/[`"'[\]]/g, '');
    const dot = stripped.lastIndexOf('.');
    return dot >= 0 ? stripped.slice(dot + 1) : stripped;
}

/**
 * Reduce one dialect's list of constraint targets to THE conflicting column,
 * or `undefined` when there is not exactly one that is determinably a column.
 *
 * A composite key resolves to `undefined` on purpose: there is no single
 * offending column, and picking the first is the same class of wrong answer as
 * returning an index name — it points a form at `tenant_id` when what the user
 * typed twice was `email`.
 */
function soleColumn(targets: string): string | undefined {
    const names = targets.split(',').map(bareIdentifier);
    if (names.length !== 1) return undefined;
    const [name] = names;
    return PLAIN_IDENTIFIER.test(name) ? name : undefined;
}

function columnFromText(text: string): string | undefined {
    const sqlite = SQLITE_TARGETS.exec(text);
    if (sqlite) {
        const targets = sqlite[1].trim();
        // `index 'idx_email_unique'` is an index name, not a column. Refuse.
        return SQLITE_INDEX_FORM.test(targets) ? undefined : soleColumn(targets);
    }

    const postgres = POSTGRES_DETAIL_TARGETS.exec(text);
    if (postgres) return soleColumn(postgres[1]);

    // MySQL deliberately has no limb here — see the doc comment on
    // `uniqueViolationColumn`. `Duplicate entry 'x' for key 'i'` names `i`,
    // which is an INDEX, and this function does not guess columns from indexes.
    return undefined;
}

function findUniqueViolationColumn(error: unknown, depth: number): string | undefined {
    if (error === null || error === undefined || depth > MAX_CAUSE_DEPTH) return undefined;

    if (typeof error === 'string') return columnFromText(error);
    if (typeof error !== 'object') return undefined;

    const err = error as { message?: unknown; detail?: unknown; cause?: unknown };

    if (typeof err.message === 'string') {
        const fromMessage = columnFromText(err.message);
        if (fromMessage !== undefined) return fromMessage;
    }
    // node-postgres keeps the `DETAIL:` line off the message and on its own
    // field, so for the driver we actually ship this is where the column is.
    if (typeof err.detail === 'string') {
        const fromDetail = columnFromText(err.detail);
        if (fromDetail !== undefined) return fromDetail;
    }

    return findUniqueViolationColumn(err.cause, depth + 1);
}

/**
 * Which column a unique-constraint violation was raised on — or `undefined`
 * when the dialect did not determinably name one (#6544).
 *
 * ## The contract, and why it is this narrow
 *
 * **A value comes back only when the identifier the driver printed is
 * determinably a COLUMN.** When a dialect names an *index* instead — MySQL's
 * `Duplicate entry 'a@b.com' for key 'idx_email_unique'`, Postgres'
 * `violates unique constraint "sys_user_email_key"`, SQLite's
 * `UNIQUE constraint failed: index 'idx_lower_email'` — the answer is
 * `undefined`, never the index name.
 *
 * That is the maintainer's 2026-08-08 ruling on #6544, and the reasoning is the
 * caller's, not this module's: **an index name mistaken for a column is worse
 * than no answer at all.**
 *
 *  - `@objectstack/rest`'s import runner renders this into a form field —
 *    "A record with this `email` already exists." An index name there points
 *    the user at a field that does not exist on the object, so they cannot act
 *    on it; `undefined` degrades to generic copy, which is merely less helpful.
 *  - #5495's autonumber-retry branch asks a yes/no question of the answer —
 *    "is the conflicting column the autonumber field?" — and an index name
 *    produces a *wrong retry decision*, not a vaguer one.
 *
 * ⛔ **The accepted cost: MySQL deployments usually get no column.** MySQL's
 * duplicate-entry message names the index and never the column, so there is
 * nothing here to read. That is deliberate. Do not "improve" this by deriving a
 * column from an index name (`idx_email_unique` → `email`, or MySQL 8's
 * `for key 'sys_user.email'` → `email`): index names are free-form, a
 * deployment's may match no column at all, and a plausible-looking wrong field
 * is exactly the failure this export exists to avoid. If MySQL must name
 * columns, the answer is a schema lookup of the index — a different, wider
 * contract — not a guess in this function.
 *
 * A **composite** key is `undefined` for the same reason: `Key (tenant_id,
 * email)=(…)` has no single offending column, and naming the first is the same
 * class of wrong answer.
 *
 * ## What it reads
 *
 * Gated on {@link isUniqueViolationError}, so a NOT NULL or FOREIGN KEY failure
 * can never reach the extraction — SQLite's `NOT NULL constraint failed: t.c`
 * shares its shape with the positive and is refused at the gate, not by the
 * patterns. Then `message`, then `detail` (node-postgres keeps its `DETAIL:`
 * line there), then one step down the `cause` chain, bounded exactly as the
 * predicate's walk is. A bare string is read as a message, so a caller holding
 * only `err.message` can pass it straight in.
 *
 * @param error - the thrown value, of any shape.
 * @returns the conflicting column, or `undefined` when none is determinable.
 *
 * @example
 * ```ts
 * const column = uniqueViolationColumn(error);
 * return column
 *   ? `A record with this ${column} already exists.`
 *   : 'A record with this value already exists.';
 * ```
 */
export function uniqueViolationColumn(error: unknown): string | undefined {
    if (!isUniqueViolationError(error)) return undefined;
    return findUniqueViolationColumn(error, 0);
}
