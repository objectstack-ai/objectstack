// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8682] Keep the CALLER'S VALUES out of the server log when a driver-level
 * write fault is logged.
 *
 * ## The exposure this closes
 *
 * A SQL driver builds its error message by prefixing the offending statement —
 * fully bound, values inlined — to the database's own diagnostic. knex's shape
 * is `<statement> - <native message>`. The engine's write paths log that error,
 * and `Logger` serializes exactly two of its fields (`message`, `stack`), so a
 * single mistyped field name in a client request wrote an entire row's values
 * to disk at ERROR level, twice:
 *
 * ```
 * ERROR Insert operation failed {"object":"crm_account","error":{"message":
 *   "insert into `crm_account` (`account_number`, …, `zzz_nonexistent_field`)
 *    values ('ACC-000011', …, 'SENSITIVE-CANARY-9f3a2b') returning *
 *    - table crm_account has no column named zzz_nonexistent_field", "stack":
 *   "SqliteError: insert into `crm_account` (…) values (…) returning * - …"}}
 * ```
 *
 * Measured with planted canaries: the row's values, the organization id and
 * the acting user id all landed in the log, and `stack` re-opened with the
 * whole statement a second time — so redacting `message` alone would have
 * moved the leak rather than closed it. Both fields are rebuilt here.
 *
 * ## What is KEPT, deliberately
 *
 * The driver's own diagnostic — the tail — is the half that names the failing
 * column and the condition (`table crm_account has no column named
 * zzz_nonexistent_field`, `NOT NULL constraint failed: sys_team.name`). It is
 * kept verbatim, and the log site keeps the `object` it already carried. ⛔ The
 * remedy for this exposure is NOT to lower the level or drop the entry: a
 * driver-level fault that logs nothing is a fault nobody can debug, which is
 * strictly worse than one logged too loudly. This narrows WHAT is written; the
 * level, the message and the entry are untouched.
 *
 * ## Why the cut is at the separator, and not at a statement keyword
 *
 * "Is this a driver dump?" already has ONE owner in this repo —
 * {@link looksLikeInternalErrorLeak} in `@objectstack/types`, applied by both
 * HTTP boundaries and tested from both directions (it catches dialect codes,
 * bare statements and constraint dumps; it deliberately does NOT fire on
 * ordinary business or validation prose). Re-deriving a second statement-head
 * keyword list here is exactly the drift that module exists to prevent, so this
 * asks it the verdict and adds only the one thing it does not answer: WHERE the
 * statement ends.
 *
 * That answer is structural, not lexical. Every value a driver inlines sits in
 * the statement, and the statement always comes FIRST — so the last ` - ` in a
 * message the shared predicate has already called a driver dump separates the
 * part that may carry values from the part that may not. The cut takes the
 * LAST separator rather than the first on purpose: a bound value may itself
 * contain ` - ` (`'2026 - Q3 plan'`), and cutting at the first would leave a
 * fragment of that value standing in the tail. Cutting at the last can only
 * ever discard MORE than necessary, which is the safe direction — and when a
 * native message legitimately contains ` - `, what is lost is a prefix of the
 * diagnostic, never the failing identifier the database names at the end.
 *
 * A driver dump with no separator carries no statement to cut (`UNIQUE
 * constraint failed: sys_user.email`, `SQLITE_CONSTRAINT_NOTNULL: …`) and is
 * returned untouched — there is nothing there but the diagnostic already.
 *
 * ## Not a change to the thrown error
 *
 * This never mutates and never replaces what the engine rethrows. The REST
 * boundary reads the driver's raw message to answer `400 INVALID_FIELD` with
 * the failing field name (`mapDataError`), and that answer is correct and must
 * stay byte-identical. The redaction applies to the LOG SLOT only — one
 * argument at one call site — so the caller's answer and the operator's log
 * diverge exactly where they should.
 */

import { looksLikeInternalErrorLeak } from '@objectstack/types';

/**
 * knex joins the bound statement to the database's own message with this
 * separator. It is the only structural marker the shape offers, and it is
 * stable across the dialects this repo runs (`driver-sql`, `driver-turso`,
 * `driver-sqlite-wasm` all reach knex).
 */
const STATEMENT_SEPARATOR = ' - ';

/** What replaces a statement that carried nothing but values. */
const REDACTED_STATEMENT = '[statement and bound values redacted]';

/**
 * The first stack FRAME line (`    at …`). Everything above it is the header
 * that repeats `name: message` — and therefore repeats the statement.
 */
const FIRST_STACK_FRAME = /^[ \t]*at\s/m;

/**
 * Strip the bound statement from a driver error's `message` and `stack`,
 * keeping the database's own diagnostic.
 *
 * Returns the input UNCHANGED (same reference) when there is nothing to
 * redact — not a driver dump, or a dump that carries no statement — so a
 * validation error, a hook's business error and a bare `Error` from our own
 * code all reach the log exactly as before, stack frames included.
 *
 * Otherwise returns a NEW `Error` carrying the redacted text and the original
 * frames. It must be a real `Error`: `ObjectLogger.error` routes its second
 * argument by `instanceof Error`, and a plain object would silently land in
 * the meta slot instead.
 *
 * @param error - the thrown value, of any shape.
 */
export function redactBoundStatement(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const redactedMessage = redactStatementFromMessage(error.message);
  if (redactedMessage === error.message) return error;

  const redacted = new Error(redactedMessage);
  redacted.name = error.name;
  redacted.stack = redactStack(error.stack, error.name, redactedMessage);
  return redacted;
}

/**
 * The message half, exported for the cases that pin the cut directly.
 * Returns the input string unchanged when nothing is cut.
 */
export function redactStatementFromMessage(message: string): string {
  if (!message || !looksLikeInternalErrorLeak(message)) return message;
  const cut = message.lastIndexOf(STATEMENT_SEPARATOR);
  if (cut === -1) return message;
  const diagnostic = message.slice(cut + STATEMENT_SEPARATOR.length).trim();
  // A dump whose tail is empty still had its head removed: report the
  // redaction rather than an empty message, so the entry never reads as a
  // fault with no detail at all.
  return diagnostic.length > 0
    ? `${diagnostic} ${REDACTED_STATEMENT}`
    : REDACTED_STATEMENT;
}

/**
 * Rebuild `stack` so its header carries the redacted message instead of the
 * statement, keeping every frame.
 *
 * The header is located by the first FRAME line, not by matching the message:
 * a bound statement can contain newlines, so the header is not reliably one
 * line and a `replace(message, …)` would leave the remainder standing.
 */
function redactStack(stack: string | undefined, name: string, redactedMessage: string): string | undefined {
  const header = `${name}: ${redactedMessage}`;
  if (stack === undefined) return undefined;
  const frame = FIRST_STACK_FRAME.exec(stack);
  if (!frame) return header;
  return `${header}\n${stack.slice(frame.index)}`;
}
