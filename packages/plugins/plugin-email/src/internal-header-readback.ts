// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8149] The `sys_email.headers_json` readback seam — the durable delivery
 * paths get the `internal`-stripped header column back, through the engine's
 * privileged accessor, at the one layer this package owns.
 *
 * ## Why a seam is needed at all
 *
 * `sys_email.headers_json` is declared `internal: true`, so the engine omits
 * it from every generic read — with NO system carve-out (#7728's explicit
 * design). That is the fix #8149 exists for. But this plugin's durable
 * delivery does not send from the in-memory message: it sends FROM THE ROW.
 * Three paths re-read a persisted row and hand it to
 * `EmailService.deliverPersistedRow`:
 *
 *  - the after-insert outbox drain hook (`email-plugin.ts`), which re-reads
 *    the committed row under `SYSTEM_CTX`;
 *  - the `email.send.async` queue subscriber, which re-reads by `rowId`;
 *  - the boot outbox sweep (`outbox-sweep.ts`), which re-reads stranded rows.
 *
 * All three read through `engine.find`, which is exactly what the strip
 * empties. Without this seam the flag would not merely hide the headers from
 * the data API — it would drop them from the mail actually sent, on every
 * durable path, while every row still reported `sent`. That is the failure
 * mode the flag must not create, so the readback ships WITH the flag.
 *
 * ## The probe: the schema flag, never key-absence
 *
 * This seam decides "did the engine redact?" by asking the OBJECT SCHEMA
 * whether the column is flagged — never by noticing the key is missing from a
 * result row. The distinction is load-bearing and was measured on a sibling
 * card: `sys_email.headers_json` is `required: false`, and the overwhelming
 * majority of real rows have no custom headers at all. Under a key-absence
 * inference every ordinary header-less email would look like a redacted row
 * and force a privileged read, and an engine without the accessor would fail
 * every ordinary send. (PR #8675 hit exactly this on `sys_account`'s optional
 * token columns: inheriting "key missing ⇒ the strip ran" from a
 * `required: true` column broke ordinary sign-in, 16 red tests.) The schema
 * flag is cardinality-independent: it is true when the engine redacts and
 * false when it does not, whatever any individual row happens to carry —
 * which is why #8118's `SqlHttpOutbox.claim()` probes the same way, and why
 * this seam needs no `absenceProvesStrip` discriminator.
 *
 * ## Fail-closed, loudly
 *
 * The one combination that must not pass silently is "the column is flagged,
 * so the row came back without it, and the engine cannot dereference it":
 * headers are stored but unrecoverable. Delivering then would put a message
 * on the wire missing headers it was authored with — and a missing header is
 * not self-announcing: an SMTP relay or API endpoint that does not require it
 * ACCEPTS the message, so the send succeeds while silently deviating from the
 * authored configuration, and nothing records that it went out incomplete.
 * So that combination THROWS. The row stays `queued` (the delivery paths do
 * not mark it `failed` for this class of error), so a healthy process — the
 * queue's own retry, or the next boot's outbox sweep — delivers it intact,
 * the same posture as #8118's claim-TTL revert.
 *
 * Engines that never redacted are left completely alone: no schema, or an
 * unflagged column, means nothing was withheld and the row's own value is
 * authoritative. The seam is therefore inert against the in-memory fakes and
 * minimal test engines this package is exercised with, and triggers no
 * privileged read there at all.
 */

/** The object this seam reads, and the one column it recovers. */
export const SYS_EMAIL_OBJECT = 'sys_email';
export const HEADERS_COLUMN = 'headers_json';

/**
 * The engine surface this seam needs. Structural, not nominal: this package
 * depends on the data-engine contract, and the privileged verb is separately
 * named (#8118) precisely so it cannot be reached from a query string. An
 * engine implementing neither method is an engine whose `find` does not
 * redact either.
 */
export interface InternalFieldResolvingEngine {
  resolveInternalField?(
    object: string,
    recordIds: readonly string[],
    field: string,
  ): Promise<Map<string, unknown>>;
  getSchema?(objectName: string): unknown;
}

/**
 * Is `sys_email.headers_json` declared `internal: true` on this engine — i.e.
 * does the generic read path hand rows back without it?
 *
 * Strict `=== true`, matching the engine's own collector: a truthy-but-not-
 * `true` value does not enrol a field in the redaction, so it must not enrol
 * one in the recovery either.
 */
export function isHeadersColumnRedacted(engine: InternalFieldResolvingEngine): boolean {
  if (typeof engine?.getSchema !== 'function') return false;
  let schema: { fields?: Record<string, { internal?: unknown } | undefined> } | undefined;
  try {
    schema = engine.getSchema(SYS_EMAIL_OBJECT) as typeof schema;
  } catch {
    // An engine that cannot describe the object cannot be redacting it on a
    // path this package controls; treat the row's own value as authoritative.
    return false;
  }
  return schema?.fields?.[HEADERS_COLUMN]?.internal === true;
}

/**
 * Recover `headers_json` for a batch of `sys_email` row ids.
 *
 * Returns `undefined` — "nothing was redacted, use each row's own value" —
 * when the column is not flagged on this engine, or when the batch is empty.
 *
 * @throws when the column IS flagged but the engine exposes no
 * `resolveInternalField`: the headers are stored and unrecoverable, and the
 * message must not go out without them (see the module header).
 */
export async function readInternalHeadersJson(
  engine: InternalFieldResolvingEngine | undefined,
  rowIds: readonly string[],
): Promise<Map<string, unknown> | undefined> {
  if (!engine || rowIds.length === 0) return undefined;
  if (!isHeadersColumnRedacted(engine)) return undefined;
  if (typeof engine.resolveInternalField !== 'function') {
    throw new Error(
      `EmailService: ${SYS_EMAIL_OBJECT}.${HEADERS_COLUMN} is declared \`internal: true\`, but this `
      + 'data engine does not implement resolveInternalField() — the custom headers this message was '
      + 'authored with are stored but cannot be recovered, and a message must not be sent missing them '
      + '(#8149). The row stays `queued`: the queue retry or the next boot outbox sweep delivers it '
      + 'intact once an engine that implements the privileged accessor is mounted.',
    );
  }
  return engine.resolveInternalField(SYS_EMAIL_OBJECT, rowIds, HEADERS_COLUMN);
}

/**
 * Re-attach the recovered `headers_json` to one row, returning the row a
 * delivery path should normalize.
 *
 * A row whose id is absent from the map keeps whatever it already carried —
 * "no such row" belongs to the caller (the delivery paths already re-check
 * the row's existence and status), and an unset column resolves to `null`,
 * which decodes to "no custom headers" exactly as a stored empty column does.
 */
export function withRecoveredHeaders(
  row: Record<string, any>,
  recovered: Map<string, unknown> | undefined,
): Record<string, any> {
  if (!recovered) return row;
  const id = row?.id != null ? String(row.id) : '';
  if (!id || !recovered.has(id)) return row;
  return { ...row, [HEADERS_COLUMN]: recovered.get(id) ?? null };
}
