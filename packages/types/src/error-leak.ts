// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared "does this error message leak server internals?" heuristic (#3867).
 *
 * ObjectStack has more than one HTTP boundary. `@objectstack/rest` guards the
 * REST data routes inside `mapDataError`; the dispatcher-plugin routes
 * (`/analytics`, `/packages`, `/i18n`, `/storage`, `/automation`, …) exit
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
