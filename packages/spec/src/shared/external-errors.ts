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
  | 'unmapped_index';

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

  constructor(
    message = 'DDL is forbidden on a non-managed datasource (schemaMode != "managed").',
  ) {
    super(message);
    this.name = 'ExternalSchemaModeViolationError';
  }
}
