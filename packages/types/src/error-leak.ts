// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared "does this error message leak server internals?" heuristic (#3867).
 *
 * ObjectStack has more than one HTTP boundary. `@objectstack/rest` guards the
 * REST data routes inside `mapDataError`; the dispatcher-plugin routes
 * (`/analytics`, `/packages`, `/i18n`, `/automation`, …) exit
 * through `errorResponseBase`. Before #3867 only the first of those sanitised
 * anything, so a driver error raised under `/analytics/query` reached the
 * client verbatim — a real SQL statement in the response body:
 *
 * ```
 * {"success":false,"error":{"message":"SELECT  FROM \"sqlite_sequence\" - near \"FROM\": syntax error","code":500}}
 * ```
 *
 * "Do not ship driver internals to clients" is a property of the HTTP
 * boundary, not of one router, so the predicate lives here — the package both
 * `@objectstack/rest` and `@objectstack/runtime` already depend on — and each
 * boundary applies it in its own envelope. One heuristic, one place to widen
 * when a new dialect's phrasing shows up.
 *
 * Deliberately a *heuristic over the message*, not a driver taxonomy: these
 * errors arrive as plain `Error`s from a half-dozen dialects with no shared
 * shape. It is applied only where the outcome is already a 5xx, so a false
 * positive costs a caller nothing but detail on a response that was a server
 * fault anyway — while the full text still reaches server logs and the
 * error reporter.
 *
 * [#5811] {@link declaresServerFault} joins it here for the same reason and
 * answers the other half of the question: the heuristic asks whether a message
 * *sounds* internal, the declaration asks whether the producer *said so*.
 */

/** Generic replacement text for a message that trips {@link looksLikeInternalErrorLeak}. */
export const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/**
 * [#8132] The phrasings of the dialects this repo actually RUNS, each anchored
 * on the driver's own errmsg template rather than on its tail.
 *
 * The gap that forced these: the keyword set below caught SQLite's
 * `SQLITE_ERROR: no such table: sys_metadata` through the `sqlite_` limb, while
 * the Postgres phrasing of *the same condition* —
 * `relation "sys_metadata" does not exist` — matched nothing and shipped a
 * physical table name to the client from every boundary that applies the
 * predicate.
 *
 * **Why anchored, and never on the bare tail.** `does not exist` is ordinary
 * business English: "user does not exist", "record does not exist". Matching
 * that substring would replace legitimate answers with `Internal server error`,
 * so each pattern requires what the DRIVER always emits and prose usually does
 * not — a quoted identifier, or the trailing colon of SQLite's template. The
 * negative cases in `error-leak.test.ts` pin that distinction.
 *
 * **Why the list stops here.** The module note above argues against growing a
 * driver taxonomy, and it is right that the list is unbounded *across dialects*
 * — MySQL/MSSQL/Oracle each phrase all of this differently and nobody here runs
 * them. These are not a census: they are the two engines `driver-sql`,
 * `driver-turso` and `driver-sqlite-wasm` actually reach. A dialect this repo
 * does not run gets no entry, and {@link declaresServerFault} remains the
 * answer that does not depend on phrasing at all.
 *
 * ⚠️ Related but NOT reusable: `relation-sub-object.ts` owns the same Postgres
 * sentence for two other questions (which column? / is this a sub-object?), and
 * its note warns that its two widths must never be collapsed. Neither answers
 * "is this a leak", and its central problem does not arise here: a message like
 * `column "label" of relation "sys_team" does not exist` contains a complete
 * missing-TABLE phrase as a substring, which is a hazard when you are deciding
 * WHICH object is missing and a non-issue when the verdict is "leak" either way.
 * That is why this asks its own question with its own patterns.
 */
const DIALECT_LEAK_PHRASINGS: readonly RegExp[] = [
  // Postgres 42P01 / 42703 (and, as a superstring, the `… of relation "…"`
  // sub-object family: 42704 and friends). The quotes are required because
  // Postgres always emits them here.
  /\b(?:relation|column)\s+["'`][^"'`]+["'`]\s+does not exist/i,
  // Postgres 42501. Restricted to physical object kinds: `schema`, `view`,
  // `function` and `column` are all ObjectStack AUTHORING vocabulary, so a
  // product message could legitimately use them and a miss is the cheap
  // direction (the outcome is already a 5xx).
  /\bpermission denied for (?:table|relation|sequence|database)\b/i,
  // SQLite/libsql, message-only form. The `sqlite_` limb below catches these
  // only when the driver prefixed its code; `better-sqlite3` and libsql both
  // raise them bare, which is the shape measured across this repo.
  /\bno such (?:table|column):/i,
];

/**
 * Whether `message` looks like a raw SQL statement or driver/engine dump that
 * must not be returned to an API client.
 *
 * Matches: dialect error codes (`SQLSTATE`, `sqlite_*`), bare statements
 * (a message that *starts* as `SELECT`/`INSERT INTO`/`UPDATE`/`DELETE FROM` —
 * drivers prefix the offending SQL to their message), constraint-violation
 * dumps, which name physical tables and columns, and the
 * {@link DIALECT_LEAK_PHRASINGS} of the engines this repo ships.
 *
 * Does NOT match ordinary business or validation messages, which is why the
 * statement forms are anchored with `startsWith` and the dialect phrasings on
 * the driver's template: a legitimate message may *mention* "update", or say
 * "does not exist" about a business record, without being either.
 */
export function looksLikeInternalErrorLeak(message: string | undefined | null): boolean {
  if (!message) return false;
  const lower = String(message).toLowerCase();
  return (
    lower.includes('sqlite_') ||
    lower.includes('sqlstate') ||
    lower.startsWith('insert into ') ||
    lower.startsWith('update ') ||
    lower.startsWith('select ') ||
    lower.startsWith('delete from ') ||
    lower.includes('constraint failed') ||
    lower.includes('unique constraint') ||
    lower.includes('foreign key') ||
    DIALECT_LEAK_PHRASINGS.some((pattern) => pattern.test(lower))
  );
}

/**
 * Whether the thrown error **declares a server fault** in the ADR-0112 envelope:
 * `status >= 500` *and* a non-empty `code`.
 *
 * The counterpart to {@link looksLikeInternalErrorLeak}, and deliberately not a
 * message test at all. Some server faults are dangerous to echo while saying
 * nothing a phrasing heuristic can recognise — the motivating family is
 * `service-analytics`' `read-scope-sql.ts`, whose ten fail-closed RLS lowering
 * refusals name the FIELD NAMES AND COMPARANDS OF THE RLS POLICY:
 *
 * ```
 * [read-scope-sql] unsafe field identifier "secret_policy_field" — refusing to
 * build read scope (fail-closed).
 * ```
 *
 * That text comes from an administrator's sharing rule compiled by the security
 * service; the tenant who receives it never wrote it and must not be able to read
 * it out of an error body. Measured, all eleven of its message shapes return
 * FALSE from `looksLikeInternalErrorLeak` — they look nothing like a driver dump —
 * so a boundary that only ran the heuristic echoed every one of them verbatim
 * (#5811 measured 11/11 through `errorResponseBase`). Teaching the heuristic to
 * recognise `[read-scope-sql]` would have been *more* message sniffing, which is
 * the mechanism #5352/#5367 exist to remove. So the withhold keys on the
 * DECLARATION instead: a producer that says `status >= 500` with a `code` has
 * declared that this is the server's fault, and a server fault's detail belongs in
 * the operator's log, not in the caller's body.
 *
 * **Both halves are required, and it is deliberately NOT "any 5xx".** #5667 kept
 * UNDECLARED 5xx errors legible on purpose — a bare `Error` from our own code
 * ("no strategy can handle query …") is the operator's own bug report, carries
 * nothing tenant-sensitive, and still falls to `looksLikeInternalErrorLeak`.
 * Widening this to every 500 would delete that decision.
 *
 * **Reads `status`, not `statusCode`.** `status` is the channel ADR-0112 declares;
 * `statusCode` is an alternate spelling some boundaries tolerate when *deriving*
 * an HTTP status. Accepting it here would make the disclosure rule depend on which
 * spelling a producer happened to use — consumer-side leniency of exactly the kind
 * Prime Directive #12 removes. A producer that wants its detail withheld declares
 * the envelope.
 *
 * Costs no diagnostics: every boundary that applies this still logs the untouched
 * error and hands it to the error reporter.
 *
 * @param err - the thrown value, of any shape (a non-object is simply not a
 *   declaration).
 */
export function declaresServerFault(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { status, code } = err as { status?: unknown; code?: unknown };
  return typeof status === 'number' && status >= 500 && typeof code === 'string' && code.length > 0;
}
