// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Managed-datasource schema drift (issue #2186).
 *
 * The driver's `initObjects` sync is *additive-only*: it creates missing
 * tables and adds missing columns, but never alters or drops existing ones.
 * So a non-additive metadata change (relax `required`, change a type/length,
 * drop or rename a field) silently diverges from an existing database — the
 * served metadata says one thing and the physical column enforces another.
 *
 * This module is the single source of truth for *detecting* that divergence
 * (metadata is authoritative on a `managed` datasource) and for *categorising*
 * each divergence by how dangerous it is to reconcile:
 *
 *   - `safe`         — loosening that cannot lose data and cannot fail:
 *                      relax NOT NULL → NULL, widen a varchar. Applied
 *                      automatically by dev auto-reconcile (P2).
 *   - `needs_confirm`— a change a human should eyeball but that does not
 *                      destroy data (e.g. a non-narrowing type change).
 *   - `destructive`  — drops or tightenings that can lose data or fail:
 *                      drop an orphaned column, narrow a varchar, add a
 *                      NOT NULL constraint over possibly-null data. Only
 *                      applied by `os migrate apply --allow-destructive`.
 *
 * The detector reuses {@link SchemaDiffEntry} (the same shape the external /
 * federated validator emits, ADR-0015 §5.2) so CLI / Studio / audit can render
 * managed and external drift uniformly.
 */

import type { SchemaDiffEntry } from '@objectstack/spec/shared';

export type SqlDialectName = 'sqlite' | 'postgres' | 'mysql' | 'unknown';

export type DriftCategory = 'safe' | 'needs_confirm' | 'destructive';

/** A reconcilable schema operation, machine-readable for the reconciler. */
export type DriftOp =
  | { type: 'relax_not_null'; table: string; column: string }
  | { type: 'tighten_not_null'; table: string; column: string }
  | { type: 'widen_varchar'; table: string; column: string; to: number; from?: number }
  | { type: 'narrow_varchar'; table: string; column: string; to: number; from?: number }
  | { type: 'drop_column'; table: string; column: string };

/**
 * A managed-schema drift finding: a {@link SchemaDiffEntry} enriched with the
 * owning table, a reconcile {@link DriftOp}, and a {@link DriftCategory}.
 */
export interface ManagedDriftEntry extends SchemaDiffEntry {
  table: string;
  category: DriftCategory;
  op: DriftOp;
  /** Human one-liner with an actionable hint. */
  message: string;
}

/** Columns the driver creates unconditionally — never metadata fields. */
export const BUILTIN_COLUMNS = new Set(['id', 'created_at', 'updated_at']);

/** Minimal shape of an introspected physical column (see SqlDriver.introspectColumns). */
export interface PhysicalColumn {
  name: string;
  type: string;
  nullable: boolean;
  maxLength?: number;
}

/** Minimal shape of a metadata field definition. */
export interface FieldDef {
  type?: string;
  required?: boolean;
  multiple?: boolean;
  maxLength?: number;
}

/**
 * Does this metadata field materialise a physical column? Mirrors
 * `SqlDriver.createColumn` exactly: `formula` is virtual (computed, no column);
 * everything else — including `multiple` (a JSON column) — gets one.
 */
export function fieldHasColumn(field: FieldDef): boolean {
  if (field?.multiple) return true;
  return (field?.type ?? 'string') !== 'formula';
}

/** Whether the dialect physically enforces varchar length (SQLite does not). */
function enforcesVarcharLength(dialect: SqlDialectName): boolean {
  return dialect === 'postgres' || dialect === 'mysql';
}

/**
 * Diff one table's metadata fields against its physical columns and return the
 * set of *drift* findings. Metadata is authoritative.
 *
 * Note: a metadata field with no physical column is NOT reported — the
 * additive sync (`ALTER TABLE ADD COLUMN`) already covers added fields, so by
 * the time this runs every expected column exists. We only surface the
 * non-additive divergences the additive sync can never fix.
 */
export function diffManagedTable(args: {
  table: string;
  fields: Record<string, FieldDef>;
  columns: PhysicalColumn[];
  dialect: SqlDialectName;
}): ManagedDriftEntry[] {
  const { table, fields, columns, dialect } = args;
  const out: ManagedDriftEntry[] = [];

  const columnsByName = new Map(columns.map((c) => [c.name, c]));
  // Field name → physical column it should produce. Built only for fields that
  // materialise a column, so orphan detection below treats virtual fields as
  // "no column expected".
  const expectedColumns = new Set<string>();

  for (const [fieldName, field] of Object.entries(fields ?? {})) {
    if (BUILTIN_COLUMNS.has(fieldName)) continue;
    if (!fieldHasColumn(field)) continue;
    expectedColumns.add(fieldName);

    const col = columnsByName.get(fieldName);
    if (!col) continue; // additive sync adds it; not drift

    // ── nullability ──────────────────────────────────────────────────
    const expectNullable = field.required !== true;
    if (expectNullable && !col.nullable) {
      out.push({
        kind: 'nullability_mismatch',
        remoteName: table,
        table,
        column: fieldName,
        expected: 'NULL',
        actual: 'NOT NULL',
        severity: 'warning',
        category: 'safe',
        op: { type: 'relax_not_null', table, column: fieldName },
        message:
          `${table}.${fieldName}: metadata is optional but the column is NOT NULL ` +
          `— writes that omit it fail. Run "os migrate" to relax it.`,
      });
    } else if (!expectNullable && col.nullable) {
      out.push({
        kind: 'nullability_mismatch',
        remoteName: table,
        table,
        column: fieldName,
        expected: 'NOT NULL',
        actual: 'NULL',
        severity: 'error',
        category: 'destructive',
        op: { type: 'tighten_not_null', table, column: fieldName },
        message:
          `${table}.${fieldName}: metadata is required but the column is nullable ` +
          `— existing nulls must be backfilled. Run "os migrate apply --allow-destructive".`,
      });
    }

    // ── varchar length (only where the dialect enforces it) ──────────
    if (
      enforcesVarcharLength(dialect) &&
      typeof field.maxLength === 'number' &&
      typeof col.maxLength === 'number' &&
      field.maxLength !== col.maxLength
    ) {
      if (field.maxLength > col.maxLength) {
        out.push({
          kind: 'type_mismatch',
          remoteName: table,
          table,
          column: fieldName,
          expected: `varchar(${field.maxLength})`,
          actual: `varchar(${col.maxLength})`,
          severity: 'warning',
          category: 'safe',
          op: { type: 'widen_varchar', table, column: fieldName, to: field.maxLength, from: col.maxLength },
          message: `${table}.${fieldName}: metadata allows ${field.maxLength} chars but the column caps at ${col.maxLength} — widen via "os migrate".`,
        });
      } else {
        out.push({
          kind: 'type_mismatch',
          remoteName: table,
          table,
          column: fieldName,
          expected: `varchar(${field.maxLength})`,
          actual: `varchar(${col.maxLength})`,
          severity: 'error',
          category: 'destructive',
          op: { type: 'narrow_varchar', table, column: fieldName, to: field.maxLength, from: col.maxLength },
          message: `${table}.${fieldName}: metadata caps at ${field.maxLength} chars but the column allows ${col.maxLength} — narrowing may truncate. "os migrate apply --allow-destructive".`,
        });
      }
    }
  }

  // ── orphaned columns (physical column, no metadata field) ──────────
  for (const col of columns) {
    if (BUILTIN_COLUMNS.has(col.name)) continue;
    if (expectedColumns.has(col.name)) continue;
    out.push({
      kind: 'unmapped_column',
      remoteName: table,
      table,
      column: col.name,
      expected: '(absent)',
      actual: col.type,
      severity: 'warning',
      category: 'destructive',
      op: { type: 'drop_column', table, column: col.name },
      message:
        `${table}.${col.name}: column exists in the database but not in metadata (orphaned) ` +
        `— "os migrate apply --allow-destructive" to drop it.`,
    });
  }

  return out;
}

/** Stable de-dup / sort key for a drift entry. */
export function driftKey(d: ManagedDriftEntry): string {
  return `${d.table}.${d.column ?? ''}:${d.kind}`;
}
