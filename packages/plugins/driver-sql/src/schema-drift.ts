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

import { createHash } from 'node:crypto';

import { isGlobalUnique, isUniqueDeclared } from '@objectstack/spec/data';
import type { SchemaDiffEntry } from '@objectstack/spec/shared';

export type SqlDialectName = 'sqlite' | 'postgres' | 'mysql' | 'unknown';

export type DriftCategory = 'safe' | 'needs_confirm' | 'destructive';

/**
 * A reconcilable schema operation, machine-readable for the reconciler.
 *
 * Column ops name a single `column`; index ops (#3728) name the index and may
 * span several columns, so their `column` carries only the leading one — set so
 * the sorting / rendering already keyed on it keeps working.
 */
export type DriftOp =
  | { type: 'relax_not_null'; table: string; column: string }
  | { type: 'tighten_not_null'; table: string; column: string }
  | { type: 'widen_varchar'; table: string; column: string; to: number; from?: number }
  | { type: 'narrow_varchar'; table: string; column: string; to: number; from?: number }
  | { type: 'drop_column'; table: string; column: string }
  /**
   * Retire the legacy platform-wide UNIQUE index on a now-tenant-scoped field
   * and put the composite `(tenantField, field)` in its place (#3696). The two
   * names differ, so the reconciler creates before it drops — uniqueness is
   * never unenforced in between — and because the old index is strictly
   * stronger than the new one, the replacement can neither fail nor lose data.
   */
  | {
      type: 'replace_unique_index';
      table: string;
      column?: string;
      dropIndexNames: string[];
      createIndexName: string;
      createColumns: string[];
    }
  /** Materialize a declared index that has no physical counterpart. */
  | {
      type: 'create_index';
      table: string;
      column?: string;
      indexName: string;
      columns: string[];
      unique: boolean;
    }
  /** Drop an index ObjectStack generated that metadata no longer declares. */
  | { type: 'drop_index'; table: string; column?: string; indexName: string }
  /**
   * An index exists under the declared name but with a different definition.
   * `syncDeclaredIndexes` is name-idempotent and would skip it forever, so the
   * only fix is drop-then-create under the same name.
   */
  | {
      type: 'recreate_index';
      table: string;
      column?: string;
      indexName: string;
      columns: string[];
      unique: boolean;
    };

/**
 * Physical schema work the *additive* boot sync is holding back (#3917).
 *
 * Distinct from {@link DriftOp}: drift is divergence between metadata and an
 * EXISTING column/index that only a deliberate reconcile may resolve, whereas
 * this is the create-table / add-column work `initObjects` performs on its own
 * — captured rather than executed while the driver runs with DDL deferred, so
 * `os migrate plan` can show it and `os migrate apply` can gate it behind the
 * confirmation prompt.
 */
export interface PendingSchemaWork {
  table: string;
  kind: 'create_table' | 'add_columns';
  /** Declared columns for a create; the missing ones for an add. */
  columns: string[];
}

/** Ops that act on an index rather than a column — reconciled without a table rebuild. */
export const INDEX_DRIFT_OPS: ReadonlySet<DriftOp['type']> = new Set([
  'replace_unique_index',
  'create_index',
  'drop_index',
  'recreate_index',
]);

export type IndexDriftOp = Extract<
  DriftOp,
  { type: 'replace_unique_index' | 'create_index' | 'drop_index' | 'recreate_index' }
>;
/** Ops that act on a single column — the only ones with a guaranteed `column`. */
export type ColumnDriftOp = Exclude<DriftOp, IndexDriftOp>;

/** True when this op mutates an index rather than a column. */
export function isIndexDriftOp(op: DriftOp): op is IndexDriftOp {
  return INDEX_DRIFT_OPS.has(op.type);
}

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
  const op: any = d.op;
  // Several index findings can share a table+column+kind (a table can have more
  // than one index over the same leading column), so the index name has to be
  // part of the key or the boot-time warn de-dup swallows all but the first.
  const idx = op.indexName ?? op.createIndexName ?? '';
  return `${d.table}.${d.column ?? ''}:${d.kind}:${d.op.type}${idx ? `:${idx}` : ''}`;
}

// ───────────────────────────────────────────────────────────────────────
// Index dimension (#3728)
//
// `diffManagedTable` above is column-only, which left one whole class of
// divergence invisible to `os migrate plan`: indexes. The #3696 unique-scope
// migration used to paper over that by executing its DROP + CREATE inline at
// boot — DDL nobody could pre-inspect, in every environment, in violation of
// the #2186 rule that a managed schema is never auto-altered in production.
// Everything below exists so that migration (and declared-index drift
// generally) is *detected* rather than silently performed, and reconciled
// through the same `os migrate plan` / `apply` path as column drift.
// ───────────────────────────────────────────────────────────────────────

/** Identifier budget for generated index names (Postgres caps at 63, MySQL 64). */
const INDEX_NAME_MAX = 60;
/** Chars kept from `<prefix>_<table>` before the `_<hash8>` suffix of a truncated name. */
const INDEX_NAME_HEAD = INDEX_NAME_MAX - 9;

/**
 * Build a deterministic index name so repeated syncs converge on the same
 * identifier (and an already-materialized index is recognisable by name).
 * Long names are hash-suffixed to stay inside the dialect identifier limits.
 *
 * This is the single definition — `SqlDriver.buildIndexName` delegates here, so
 * the names the driver *creates* and the names the differ *looks for* cannot
 * drift apart.
 */
export function buildIndexName(table: string, columns: string[], unique: boolean): string {
  const prefix = unique ? 'uniq' : 'idx';
  const base = `${prefix}_${table}_${columns.join('_')}`;
  if (base.length <= INDEX_NAME_MAX) return base;
  const hash = createHash('sha1').update(base).digest('hex').slice(0, 8);
  return `${`${prefix}_${table}`.slice(0, INDEX_NAME_HEAD)}_${hash}`;
}

/** An index metadata says should exist. */
export interface ExpectedIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

/** An index that physically exists (see `SqlDriver.introspectIndexes`). */
export interface PhysicalIndex {
  name: string;
  columns: string[];
  unique: boolean;
  /** Backing index of the PRIMARY KEY — never metadata-managed. */
  primary?: boolean;
}

/**
 * Translate field-level `unique` declarations into concrete index descriptors,
 * applying tenant scoping (#3696).
 *
 * This is the ONLY place field-level uniqueness becomes an index, so the
 * create-table, alter-table, SQLite-rebuild and drift-detection paths cannot
 * disagree about what a `unique: true` field is supposed to produce.
 *
 * Scoping rule:
 *   - `unique: 'global'` → single-column `(field)`, platform-wide.
 *   - `unique: true` on a tenant-scoped table → composite `(tenantField,
 *     field)`: unique *within* the tenant, matching the per-tenant autonumber
 *     sequence, the RLS read predicate and the write-path tenant stamp.
 *   - `unique: true` with no tenant column → single-column `(field)`.
 *     Single-tenant deployments therefore see byte-identical DDL to before.
 *
 * The tenant column comes FIRST in the composite so the index also serves the
 * `WHERE tenant = ?` prefix scans every tenant-scoped read issues.
 */
export function uniqueIndexesFromFields(
  table: string,
  fields: Record<string, any>,
  tenantField: string | null,
): ExpectedIndex[] {
  const out: ExpectedIndex[] = [];
  for (const [name, field] of Object.entries<any>(fields ?? {})) {
    if (!isUniqueDeclared(field?.unique)) continue;
    // A unique declaration ON the tenant column itself ("one row per tenant")
    // cannot be tenant-scoped — `(organization_id, organization_id)` is not a
    // constraint. Keep it single-column.
    const scoped = !isGlobalUnique(field.unique) && tenantField != null && tenantField !== name;
    const columns = scoped ? [tenantField, name] : [name];
    out.push({ name: buildIndexName(table, columns, true), columns, unique: true });
  }
  return out;
}

/** Normalize one entry of an object's declared `indexes[]`, or null if unusable. */
export function normalizeDeclaredIndex(
  table: string,
  idx: { name?: string; fields?: string[]; unique?: boolean | 'global' } | undefined,
): ExpectedIndex | null {
  const columns = Array.isArray(idx?.fields)
    ? idx.fields.filter((f): f is string => typeof f === 'string' && f.length > 0)
    : [];
  if (columns.length === 0) return null;
  const unique = isUniqueDeclared(idx?.unique);
  const name =
    typeof idx?.name === 'string' && idx.name.trim()
      ? idx.name.trim()
      : buildIndexName(table, columns, unique);
  return { name, columns, unique };
}

/**
 * The full index set metadata asks for on a table: field-level `unique`
 * (tenancy-aware) plus the object's declared `indexes[]`, taken verbatim.
 *
 * Indexes referencing a column that was never materialized (a virtual `formula`
 * field, a column an earlier sync skipped) are dropped from the expected set —
 * the sync skips creating them, so reporting them as drift would be a finding
 * `os migrate apply` could never clear.
 */
export function expectedIndexes(args: {
  table: string;
  fields: Record<string, any>;
  tenantField: string | null;
  declaredIndexes?: Array<{ name?: string; fields?: string[]; unique?: boolean | 'global' }>;
  physicalColumns: Set<string>;
}): ExpectedIndex[] {
  const { table, fields, tenantField, declaredIndexes, physicalColumns } = args;
  const out = uniqueIndexesFromFields(table, fields, tenantField);
  for (const idx of Array.isArray(declaredIndexes) ? declaredIndexes : []) {
    const norm = normalizeDeclaredIndex(table, idx);
    if (norm) out.push(norm);
  }
  return out.filter((i) => i.columns.every((c) => physicalColumns.has(c)));
}

/**
 * The two names a tenant-scoped field's *legacy* single-column unique index
 * could have been materialized under before #3696:
 *
 *   - `<table>_<column>_unique` — knex's default name for `col.unique()`,
 *     emitted by the old `createColumn`. A real CONSTRAINT on Postgres, a plain
 *     index on SQLite/MySQL.
 *   - `uniq_<table>_<column>` — {@link buildIndexName}, emitted by the old
 *     SQLite rebuild path.
 */
export function legacyUniqueIndexNames(table: string, column: string): string[] {
  return [`${table}_${column}_unique`, buildIndexName(table, [column], true)];
}

/** A tenant-scoped unique field, plus the legacy index names that would supersede it. */
export interface LegacyUniqueReplacement {
  column: string;
  legacyNames: string[];
  replacement: ExpectedIndex;
}

/**
 * For every field whose `unique` is now tenant-scoped, the legacy global index
 * names to look for and the composite that replaces them. `unique: 'global'`
 * fields are excluded — their single-column index is the declared intent now,
 * not legacy debt.
 */
export function legacyUniqueReplacements(args: {
  table: string;
  fields: Record<string, any>;
  tenantField: string | null;
  physicalColumns: Set<string>;
}): LegacyUniqueReplacement[] {
  const { table, fields, tenantField, physicalColumns } = args;
  if (!tenantField) return []; // Nothing was ever mis-scoped on a tenant-less table.
  // Without a physical tenant column there is no composite to replace the
  // legacy index with, and dropping it unreplaced would remove the constraint
  // outright rather than relax it. Leave it alone.
  if (!physicalColumns.has(tenantField)) return [];
  const out: LegacyUniqueReplacement[] = [];
  for (const [name, field] of Object.entries<any>(fields ?? {})) {
    if (!isUniqueDeclared(field?.unique)) continue;
    if (isGlobalUnique(field.unique)) continue;
    if (name === tenantField || !physicalColumns.has(name)) continue;
    const columns = [tenantField, name];
    out.push({
      column: name,
      legacyNames: legacyUniqueIndexNames(table, name),
      replacement: { name: buildIndexName(table, columns, true), columns, unique: true },
    });
  }
  return out;
}

/**
 * Is this index one ObjectStack generated from metadata?
 *
 * Orphan detection is deliberately restricted to *our* naming conventions. A
 * DBA's hand-rolled covering index is not drift — reporting every undeclared
 * index would drown the plan in false positives and invite `os migrate apply
 * --allow-destructive` to delete someone's carefully tuned index. Only the
 * shapes {@link buildIndexName} and the pre-#3696 `createColumn` could have
 * emitted are candidates.
 */
export function isManagedIndexName(table: string, index: PhysicalIndex): boolean {
  const { name, columns, unique } = index;
  for (const prefix of ['uniq', 'idx']) {
    if (name.startsWith(`${prefix}_${table}_`)) return true;
    // Hash-suffixed long form: `<prefix>_<table>` truncated, then `_<hash8>`.
    if (
      name.length > 9 &&
      /^_[0-9a-f]{8}$/.test(name.slice(-9)) &&
      name.slice(0, -9) === `${prefix}_${table}`.slice(0, INDEX_NAME_HEAD)
    ) {
      return true;
    }
  }
  // knex's default name for the `col.unique()` the pre-#3696 `createColumn` emitted.
  return unique && columns.length === 1 && name === `${table}_${columns[0]}_unique`;
}

/** `(a, b)` UNIQUE vs `(a, b)` — the identity a physical index is compared on. */
function indexSignature(columns: string[], unique: boolean): string {
  return `${unique ? 'UNIQUE ' : ''}(${columns.join(', ')})`;
}

/**
 * Diff a table's expected index set against the physical one.
 *
 * Presence is matched by NAME, not by column signature, because that is exactly
 * what `syncDeclaredIndexes` does when deciding whether to skip a create. Using
 * a different rule here would produce findings the reconciler could never
 * clear (or, worse, hide ones it will never fix on its own).
 */
export function diffManagedIndexes(args: {
  table: string;
  expected: ExpectedIndex[];
  legacy: LegacyUniqueReplacement[];
  physical: PhysicalIndex[];
}): ManagedDriftEntry[] {
  const { table, expected, legacy, physical } = args;
  const out: ManagedDriftEntry[] = [];
  const byName = new Map(physical.map((p) => [p.name, p]));
  /** Physical index names accounted for — either declared, or already reported. */
  const explained = new Set<string>();

  // ── 1. Legacy platform-wide unique superseded by a tenant composite ──
  for (const l of legacy) {
    // Only a *single-column unique on that very column* is the legacy shape.
    // Matching on the name alone would let an unrelated index that happens to
    // collide with the legacy spelling be dropped.
    const present = l.legacyNames.filter((n) => {
      const p = byName.get(n);
      return !!p && !p.primary && p.unique && p.columns.length === 1 && p.columns[0] === l.column;
    });
    if (present.length === 0) continue;
    for (const n of present) explained.add(n);
    out.push({
      kind: 'index_mismatch',
      remoteName: table,
      table,
      column: l.column,
      expected: indexSignature(l.replacement.columns, true),
      actual: indexSignature([l.column], true),
      severity: 'warning',
      category: 'safe',
      op: {
        type: 'replace_unique_index',
        table,
        column: l.column,
        dropIndexNames: present,
        createIndexName: l.replacement.name,
        createColumns: l.replacement.columns,
      },
      message:
        `${table}.${l.column}: a legacy platform-wide UNIQUE index (${present.join(', ')}) still enforces ` +
        `uniqueness across ALL tenants, but metadata scopes it per '${l.replacement.columns[0]}' — a second ` +
        `tenant reusing the value is rejected on insert (#3696). Replacing it with ${indexSignature(l.replacement.columns, true)} ` +
        `is a pure relaxation: run "os migrate apply".`,
    });
  }

  // ── 2. Declared index missing, or present with the wrong definition ──
  for (const e of expected) {
    explained.add(e.name);
    const p = byName.get(e.name);
    if (!p) {
      out.push({
        kind: 'index_mismatch',
        remoteName: table,
        table,
        column: e.columns[0],
        expected: indexSignature(e.columns, e.unique),
        actual: '(absent)',
        severity: 'warning',
        category: 'safe',
        op: {
          type: 'create_index',
          table,
          column: e.columns[0],
          indexName: e.name,
          columns: e.columns,
          unique: e.unique,
        },
        message:
          `${table}: metadata declares index '${e.name}' ${indexSignature(e.columns, e.unique)} but the database ` +
          `has no such index — run "os migrate apply" to create it.`,
      });
      continue;
    }
    if (p.unique === e.unique && p.columns.join(',') === e.columns.join(',')) continue;
    // Same name, different definition. `syncDeclaredIndexes` skips by name, so
    // this never self-heals: it has to be dropped and rebuilt. Tightening to
    // UNIQUE is destructive — the CREATE can fail on existing duplicates, and
    // by then the old index is already gone.
    out.push({
      kind: 'index_mismatch',
      remoteName: table,
      table,
      column: e.columns[0],
      expected: indexSignature(e.columns, e.unique),
      actual: indexSignature(p.columns, p.unique),
      severity: e.unique ? 'error' : 'warning',
      category: e.unique ? 'destructive' : 'needs_confirm',
      op: {
        type: 'recreate_index',
        table,
        column: e.columns[0],
        indexName: e.name,
        columns: e.columns,
        unique: e.unique,
      },
      message:
        `${table}: index '${e.name}' is ${indexSignature(p.columns, p.unique)} but metadata declares ` +
        `${indexSignature(e.columns, e.unique)} — the additive sync skips it by name, so it must be rebuilt` +
        (e.unique
          ? `. Creating the UNIQUE index can fail on existing duplicates: "os migrate apply --allow-destructive".`
          : ` via "os migrate apply".`),
    });
  }

  // ── 3. Orphans: an index WE generated that metadata no longer declares ──
  for (const p of physical) {
    if (p.primary || p.columns.length === 0 || explained.has(p.name)) continue;
    if (!isManagedIndexName(table, p)) continue;
    out.push({
      kind: 'unmapped_index',
      remoteName: table,
      table,
      column: p.columns[0],
      expected: '(absent)',
      actual: indexSignature(p.columns, p.unique),
      severity: 'warning',
      category: 'destructive',
      op: { type: 'drop_index', table, column: p.columns[0], indexName: p.name },
      message:
        `${table}: index '${p.name}' ${indexSignature(p.columns, p.unique)} carries ObjectStack's generated naming ` +
        `but matches no declared index (orphaned) — "os migrate apply --allow-destructive" to drop it.`,
    });
  }

  return out;
}
