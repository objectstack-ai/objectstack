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
 * Whether `message` looks like a raw SQL statement or driver/engine dump that
 * must not be returned to an API client.
 *
 * Matches: dialect error codes (`SQLSTATE`, `sqlite_*`), bare statements
 * (a message that *starts* as `SELECT`/`INSERT INTO`/`UPDATE`/`DELETE FROM` —
 * drivers prefix the offending SQL to their message), and constraint-violation
 * dumps, which name physical tables and columns.
 *
 * Does NOT match ordinary business or validation messages, which is why the
 * statement forms are anchored with `startsWith`: a legitimate message may
 * *mention* "update" without being one.
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
    lower.includes('foreign key')
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
