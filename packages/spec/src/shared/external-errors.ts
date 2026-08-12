// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * External Datasource Federation — shared error contract.
 *
 * Implements the error surface of ADR-0015 (External Datasource
 * Federation). These are protocol-level error *types* and stable `code`
 * strings shared by every layer that enforces the three runtime gates
 * (DDL gate, boot-validation gate, write gate). No runtime/business logic
 * lives here beyond pure message rendering — consistent with
 * `error-map.zod.ts` in the same directory.
 *
 * @see docs/adr/0015-external-datasource-federation.md §4.4, §5
 */

/**
 * Stable error codes for the federation gates. Mirrored on each error
 * class's `code` field so callers can branch without `instanceof` across
 * package boundaries.
 */
export const EXTERNAL_ERROR_CODES = {
  schemaMismatch: 'EXTERNAL_SCHEMA_MISMATCH',
  writeForbidden: 'EXTERNAL_WRITE_FORBIDDEN',
  schemaModeViolation: 'EXTERNAL_SCHEMA_MODE_VIOLATION',
} as const;

export type ExternalErrorCode =
  (typeof EXTERNAL_ERROR_CODES)[keyof typeof EXTERNAL_ERROR_CODES];

/**
 * [#7739] The HTTP status each federation refusal is reported with — the whole
 * family in ONE table, beside the codes it keys on.
 *
 * ## Why this exists
 *
 * Every gate above throws an error carrying a stable, ledgered `code`
 * (`ERROR_CODE_LEDGER`, ADR-0112 D3) and, until now, no status. No HTTP exit
 * can invent one for it, so a write refused by Gate 3 left `/api/v1/data` as
 * `500 INTERNAL_ERROR` with no `code` at all — through `mapDataError`'s
 * terminal `UNCLASSIFIED_FAULT`, indistinguishable from the server falling
 * over, even though the refusal was correct and nothing was applied. The
 * `code` the client needed existed the whole way down and was dropped at the
 * boundary for want of a status to carry it.
 *
 * ## Why HERE and not in a REST error map
 *
 * ADR-0112: the PRODUCER names the condition. This repo's HTTP exits already
 * agree on how to read one — `status` then `statusCode`, 400-599 — in
 * `mapDataError`'s `declaredHttpStatus` (#7525), `resolveErrorResponse`
 * (#5437/#5582), `HttpDispatcher.errorFromThrown` (#3867),
 * `dispatcher-plugin.errorResponseBase`, `endpoint-executor`,
 * `domains/actions` and `plugin-hono-server`. So declaring the status on the
 * error is what routes the family through one place *for every door at once*;
 * a branch in `rest-server.ts` would fix one door and leave the runtime
 * dispatcher, the endpoint executor and the CLI answering 500 for the same
 * throw. Same shape as `service-analytics`'s `dataset-refusal.ts` (#5367) and
 * `storage-service.ts`'s `storageListRefusal` — "one condition, one wire
 * shape, chosen by the producer that knows".
 *
 * ## Why these three statuses
 *
 *  - **`writeForbidden` → 403.** A POLICY refusal, not malformed input: the
 *    identical body succeeds the moment `datasource.external.allowWrites` and
 *    `object.external.writable` are both on, so 400/422 ("fix your request")
 *    would be a lie, and 409 ("conflict with current state") promises a retry
 *    that cannot help. 403 is what this platform already answers for a
 *    capability a flag switched off for the object — `FEEDS_DISABLED`,
 *    `FILES_DISABLED`, `CLONE_DISABLED`, `RECORD_NOT_ACCESSIBLE` in
 *    `mapDataError`, and the standard catalog's `FORBIDDEN`.
 *  - **`schemaModeViolation` → 403.** The same sentence about DDL rather than
 *    rows: `schemaMode !== 'managed'` forbids it, and no request the caller
 *    can rewrite changes that.
 *  - **`schemaMismatch` → 503.** Deliberately NOT 4xx. Nothing about the
 *    request is wrong — the deployment's metadata and the remote table have
 *    diverged, only an operator can reconcile them, and it may clear. That is
 *    the reading `ERR_DATASOURCE_UNAVAILABLE` already gets ("the deployment
 *    cannot serve this object right now"), and both are `isExpectedDataStatus`
 *    lifecycle outcomes rather than crashes. The 5xx band withholds the
 *    message by design, so the structured `diffs` stay operator-side (where
 *    this gate's audience already is — it aborts boot) while the client still
 *    gets a `code` it can branch on instead of a bare 500.
 *
 * Exported so a consumer can assert the mapping rather than hardcode it, and
 * `satisfies` so adding a fourth code without a status is a compile error —
 * which is what stops the next gate from re-opening #7739 under a new code.
 */
export const EXTERNAL_ERROR_HTTP_STATUS = {
  [EXTERNAL_ERROR_CODES.schemaMismatch]: 503,
  [EXTERNAL_ERROR_CODES.writeForbidden]: 403,
  [EXTERNAL_ERROR_CODES.schemaModeViolation]: 403,
} as const satisfies Record<ExternalErrorCode, number>;

/**
 * The kinds of divergence the schema validator can report between a
 * federated `Object` definition and the remote table it binds to.
 */
export type SchemaDiffEntryKind =
  | 'missing_table'
  | 'missing_column'
  | 'type_mismatch'
  | 'nullability_mismatch'
  | 'unmapped_column'
  | 'pk_mismatch'
  /** A declared index is absent, or the index under that name has a different
   *  definition than metadata declares (#3728). */
  | 'index_mismatch'
  /** A physical index ObjectStack generated that metadata no longer declares. */
  | 'unmapped_index'
  /**
   * The column's physical DEFAULT is not the one metadata calls for — including
   * "metadata calls for none". A column DEFAULT is data the DATABASE writes on
   * the platform's behalf, so a wrong one is silently wrong rows, not a
   * rejected write: a `defaultValue` runtime token emitted as a literal DEFAULT
   * stamped the token's own spelling into every omitted insert (#4560).
   */
  | 'default_mismatch';

/**
 * A single divergence entry. Produced by the validation gate (ADR §5.2)
 * and carried by {@link ExternalSchemaMismatchError}.
 */
export interface SchemaDiffEntry {
  kind: SchemaDiffEntryKind;
  /** Remote schema/database qualifier, when known. */
  remoteSchema?: string;
  /** Remote table/view name, when known. */
  remoteName?: string;
  /** Affected column/field name, for column-scoped diffs. */
  column?: string;
  /** What the local object declared. */
  expected?: string;
  /** What the remote table actually has. */
  actual?: string;
  severity: 'error' | 'warning';
}

/** Human-readable one-line summary of a single diff entry. */
function renderDiffEntry(entry: SchemaDiffEntry): string {
  const where = [entry.remoteSchema, entry.remoteName]
    .filter(Boolean)
    .join('.');
  const col = entry.column ? `.${entry.column}` : '';
  const detail =
    entry.expected !== undefined || entry.actual !== undefined
      ? ` (expected ${entry.expected ?? '—'}, actual ${entry.actual ?? '—'})`
      : '';
  const mark = entry.severity === 'error' ? '✗' : '⚠';
  return `  ${mark} ${entry.kind}: ${where}${col}${detail}`;
}

/**
 * Render a multi-line, actionable diff message. Kept pure so it can be
 * unit-tested independently of the runtime gates.
 */
export function renderDiffMessage(
  datasource: string,
  object: string,
  diffs: SchemaDiffEntry[],
): string {
  const header = `Object '${object}' does not match its remote table on datasource '${datasource}':`;
  if (diffs.length === 0) return header;
  return [header, ...diffs.map(renderDiffEntry)].join('\n');
}

/**
 * Thrown by the boot-validation gate when a federated object diverges
 * from the remote table (ADR §5.2). Carries the structured diff so
 * callers (CLI, Studio, audit) can render it however they like.
 */
export class ExternalSchemaMismatchError extends Error {
  readonly code = EXTERNAL_ERROR_CODES.schemaMismatch;
  /** [#7739] See {@link EXTERNAL_ERROR_HTTP_STATUS} — 503, not a client error. */
  readonly status = EXTERNAL_ERROR_HTTP_STATUS[EXTERNAL_ERROR_CODES.schemaMismatch];

  constructor(
    readonly datasource: string,
    readonly object: string,
    readonly diffs: SchemaDiffEntry[],
  ) {
    super(renderDiffMessage(datasource, object, diffs));
    this.name = 'ExternalSchemaMismatchError';
  }
}

/**
 * Thrown by the write gate when a write is attempted against an external
 * datasource without the required double opt-in
 * (`datasource.external.allowWrites` **and** `object.external.writable`)
 * — ADR §5.3.
 */
export class ExternalWriteForbiddenError extends Error {
  readonly code = EXTERNAL_ERROR_CODES.writeForbidden;
  /** [#7739] See {@link EXTERNAL_ERROR_HTTP_STATUS} — 403, a policy refusal. */
  readonly status = EXTERNAL_ERROR_HTTP_STATUS[EXTERNAL_ERROR_CODES.writeForbidden];

  constructor(message = 'Writes are forbidden on this external datasource.') {
    super(message);
    this.name = 'ExternalWriteForbiddenError';
  }
}

/**
 * Thrown by the DDL gate when schema-mutating DDL (createTable,
 * alterTable, dropTable, applyMigrations) is attempted against a
 * datasource whose `schemaMode !== 'managed'` — ADR §5.1.
 */
export class ExternalSchemaModeViolationError extends Error {
  readonly code = EXTERNAL_ERROR_CODES.schemaModeViolation;
  /** [#7739] See {@link EXTERNAL_ERROR_HTTP_STATUS} — 403, a policy refusal. */
  readonly status = EXTERNAL_ERROR_HTTP_STATUS[EXTERNAL_ERROR_CODES.schemaModeViolation];

  constructor(
    message = 'DDL is forbidden on a non-managed datasource (schemaMode != "managed").',
  ) {
    super(message);
    this.name = 'ExternalSchemaModeViolationError';
  }
}
