// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Managed-datasource schema drift (issue #2186).
 *
 * The driver's `initObjects` sync is *additive-only*: it creates missing
 * tables and adds missing columns, but never alters or drops existing ones.
 * So a non-additive metadata change (relax `storage.notNull`, change a type/length,
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

import { isAppResolvedDefaultToken, isGlobalUnique, isUniqueDeclared } from '@objectstack/spec/data';
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
   * Strip a column DEFAULT metadata never asked for (#4560).
   *
   * Today's only source is a `defaultValue` runtime token that a pre-fix build
   * emitted as a literal (`DEFAULT 'current_user'`), so every insert that
   * omitted the field got the token's own spelling instead of the engine's
   * deliberate "leave it unset". Dropping it cannot fail and cannot lose data —
   * stored rows keep whatever they hold; only FUTURE omitted inserts change,
   * from a bogus literal to NULL. Rows already carrying the bogus value are NOT
   * rewritten: they stay visible to the dangling-reference audit (#4551), whose
   * standing rule is report, never rewrite.
   */
  | { type: 'drop_column_default'; table: string; column: string }
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
 * Physical work the boot sync is holding back (#3917).
 *
 * Distinct from {@link DriftOp}: drift is divergence between metadata and an
 * EXISTING column/index that only a deliberate reconcile may resolve, whereas
 * this is the work `initObjects` performs on its own — captured rather than
 * executed while the driver runs with DDL deferred, so `os migrate plan` can
 * show it and `os migrate apply` can gate it behind the confirmation prompt.
 *
 * The plan's promise is that it shows what `apply` will do, so **anything added
 * to `initObjects`' physical path has to be representable here** — otherwise an
 * operator confirms a two-column plan and `apply` additionally rewrites a table.
 * That is the gap #3954 closed for the datetime convergence; keep it closed.
 */
export interface PendingSchemaWork {
  table: string;
  kind: PendingSchemaWorkKind;
  /**
   * Declared columns for a create; the missing ones for an add; the columns
   * being converged for the two datetime steps.
   *
   * The additive kinds name only fields that MATERIALIZE a column
   * ({@link fieldHasColumn}) — a virtual `formula` field never appears. The
   * promise above cuts both ways: a plan may not promise work `apply` cannot
   * deliver either, or the finding can never be cleared (#3978).
   */
  columns: string[];
  /**
   * How much data the step touches, when that is knowable up front and worth
   * knowing — absent for the additive kinds, which touch none.
   *
   * For `normalize_datetime_storage` it is the number of row-writes (summed
   * across `columns`, since each is its own `UPDATE`). For
   * `widen_datetime_columns` it is the table's row count, because MySQL's
   * `ALTER … MODIFY` is a full rebuild holding a metadata lock — which is the
   * number that decides "now" versus "in a maintenance window".
   */
  rows?: number;
}

/**
 * What kind of physical work a {@link PendingSchemaWork} entry represents.
 *
 * The first two are purely additive and never touch existing rows. The rest are
 * NOT: `normalize_datetime_storage` / `normalize_time_storage` rewrite rows in
 * place (the SQLite canonical-text backfills, #3912/#3994) and
 * `widen_datetime_columns` / `widen_time_columns` rebuild a column (the MySQL
 * `TIMESTAMP` → `DATETIME(3)` and `TIME` → `TIME(3)` widenings, #3942/#3994).
 * They are rendered under their own heading for that reason: the additive
 * section tells the operator the work is never data-losing, and that claim must
 * not silently come to cover a row rewrite.
 */
export type PendingSchemaWorkKind =
  | 'create_table'
  | 'add_columns'
  | 'normalize_datetime_storage'
  | 'normalize_time_storage'
  | 'widen_datetime_columns'
  | 'widen_time_columns';

/** True for the kinds that rewrite or rebuild existing data rather than adding to it. */
export function isInPlaceSchemaWork(kind: PendingSchemaWorkKind): boolean {
  return kind !== 'create_table' && kind !== 'add_columns';
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
  /**
   * The column's raw DEFAULT as the dialect reports it (knex `columnInfo`), or
   * `null`/`undefined` when it has none. Dialect-decorated — SQLite and Postgres
   * quote a string literal and Postgres appends a `::type` cast — so compare it
   * through {@link physicalDefaultIsToken}, never with `===`.
   */
  defaultValue?: unknown;
}

/** Minimal shape of a metadata field definition. */
export interface FieldDef {
  type?: string;
  required?: boolean;
  multiple?: boolean;
  maxLength?: number;
  /** ADR-0113: the explicit physical constraint — nullability drift reads THIS, not `required`. */
  storage?: { notNull?: boolean };
  /**
   * The declared default. Only consulted for the runtime-token dimension
   * (#4560): a token is an instruction, so it must never appear as a physical
   * column DEFAULT. Literal defaults are deliberately NOT diffed — a hand-edited
   * DEFAULT on a column is a DBA's business, and reporting every one of them
   * would drown the plan the same way undeclared indexes would.
   */
  defaultValue?: unknown;
}

/**
 * Does the physical column DEFAULT literally spell out `token`?
 *
 * Each dialect decorates the literal it reports differently — SQLite
 * `'current_user'`, Postgres `'current_user'::character varying`, MySQL a bare
 * `current_user` — so the raw string is stripped of one layer of quoting and of
 * a trailing cast before comparing. Deliberately EXACT after that: this is the
 * fingerprint of a DEFAULT the platform itself emitted from a token spelling,
 * and matching loosely would let it drop a default that merely resembles one.
 */
export function physicalDefaultIsToken(raw: unknown, token: string): boolean {
  if (typeof raw !== 'string') return false;
  let s = raw.trim();
  const cast = s.indexOf('::');
  if (cast > 0) s = s.slice(0, cast).trim();
  if (s.length >= 2 && ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"')))) {
    s = s.slice(1, -1);
  }
  return s === token;
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

    // ── nullability (ADR-0113: compared against `storage.notNull`, the
    // explicit physical constraint — NOT against `required`, which is the
    // write-time contract and implies nothing about the column) ──────────
    const expectNullable = field.storage?.notNull !== true;
    if (expectNullable && !col.nullable && field.required !== true) {
      // Column STRICTER than its declaration — and the field is not even
      // write-gated, so an omitting write reaches the DB and dies as a raw
      // driver error instead of a clean validation 400. That surprise is
      // worth a human decision; never auto-applied (a `safe` categorisation
      // would let dev auto-reconcile strip a protection someone added).
      //
      // The `required: true` + NOT NULL + no storage declaration case is
      // deliberately SILENT: that is every pre-protocol-17 source after a
      // runtime upgrade, the write gate makes the column constraint
      // unreachable (harmless belt-and-suspenders), and nagging every legacy
      // required field would bury real drift. `os migrate meta` ratifies it
      // whenever the source is next migrated.
      out.push({
        kind: 'nullability_mismatch',
        remoteName: table,
        table,
        column: fieldName,
        expected: 'NULL',
        actual: 'NOT NULL',
        severity: 'warning',
        category: 'needs_confirm',
        op: { type: 'relax_not_null', table, column: fieldName },
        message:
          `${table}.${fieldName}: the column is NOT NULL but the metadata declares no ` +
          `storage constraint. Ratify it by declaring \`storage: { notNull: true }\` ` +
          `(pre-protocol-17 sources: \`os migrate meta\` stamps it for every ` +
          `previously-required field), or deliberately relax the column via "os migrate".`,
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
          `${table}.${fieldName}: metadata declares \`storage.notNull\` but the column is ` +
          `nullable — existing nulls must be backfilled. Run "os migrate apply --allow-destructive".`,
      });
    }

    // ── runtime-token column DEFAULT (#4560) ──────────
    // A `defaultValue` the APPLICATION layer owns (`current_user`) must leave
    // the column with no DEFAULT at all. A build that predated the token family
    // passed it through to `col.defaultTo(...)`, so the database now supplies
    // the token's own spelling — a literal `'current_user'` in a
    // `lookup('sys_user')` column — for exactly the writes the engine
    // deliberately left unset. Detected here rather than fixed inline so it
    // travels the same plan/apply road as every other divergence.
    if (isAppResolvedDefaultToken(field.defaultValue) && physicalDefaultIsToken(col.defaultValue, field.defaultValue)) {
      out.push({
        kind: 'default_mismatch',
        remoteName: table,
        table,
        column: fieldName,
        expected: '(no column default)',
        actual: `DEFAULT '${field.defaultValue}'`,
        severity: 'warning',
        // Pure removal: stored rows are untouched and the statement cannot
        // fail, so dev auto-reconcile is welcome to apply it unattended.
        category: 'safe',
        op: { type: 'drop_column_default', table, column: fieldName },
        message:
          `${table}.${fieldName}: the column carries DEFAULT '${field.defaultValue}', but ` +
          `'${field.defaultValue}' is a runtime token the engine resolves per write — the database ` +
          `has been stamping the literal token into every insert that omitted the field (#4560). ` +
          `Dropping the default is non-destructive: run "os migrate apply". Rows already holding ` +
          `'${field.defaultValue}' are NOT rewritten — the dangling-reference audit reports them.`,
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

// ───────────────────────────────────────────────────────────────────────
// Physical index key parts (#4884)
//
// Introspection used to read an index's key from the dialect's *column* view
// (`PRAGMA index_info`, `pg_attribute`, `STATISTICS.COLUMN_NAME`), which
// reports NOTHING for an expression key. A four-column index whose last key is
// `COALESCE(package_id,'')` therefore read as three columns, and the differ
// reported a mismatch against a four-column declaration on a database that was
// exactly right. Everything below exists so the key is read as written, and so
// an expression that pins one column is recognised as that column.
// ───────────────────────────────────────────────────────────────────────

/** One key part of a physical index, as introspection recovered it. */
export type IndexKeyPart =
  | { kind: 'column'; column: string }
  /** `column` is the identity the expression pins, or null when unattributable. */
  | { kind: 'expression'; sql: string; column: string | null };

const BARE_IDENTIFIER = /^(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_$]*))$/;
/** A literal any dialect might print inside `COALESCE`, optional `::type` cast included. */
const SQL_LITERAL = /^(?:'(?:[^']|'')*'|-?\d+(?:\.\d+)?|null|true|false)(?:::[A-Za-z_][A-Za-z0-9_ ."]*)?$/i;

/** Unwrap `"x"` / `` `x` `` / `[x]`, or null when `s` is not a single identifier. */
function matchIdentifier(s: string): string | null {
  const m = BARE_IDENTIFIER.exec(s.trim());
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? m[4] ?? null;
}

/** Drop a trailing `::type` cast (Postgres prints them everywhere). */
function stripCast(s: string): string {
  const i = s.indexOf('::');
  return i > 0 ? s.slice(0, i).trim() : s.trim();
}

/** Peel redundant wrapping parens: `(package_id)` → `package_id`. */
function stripWrappingParens(s: string): string {
  let out = s.trim();
  while (out.startsWith('(') && out.endsWith(')')) {
    const inner = out.slice(1, -1).trim();
    if (splitTopLevelList(inner).length !== 1) break;
    out = inner;
  }
  return out;
}

/**
 * Peel casts and redundant parens until stable, then read the identifier.
 * Postgres nests both — a varchar column inside `COALESCE` prints as
 * `(package_id)::text` — so one pass in either order is not enough.
 */
function bareColumnOf(s: string): string | null {
  let cur = s.trim();
  for (let i = 0; i < 4; i++) {
    const next = stripWrappingParens(stripCast(stripWrappingParens(cur)));
    if (next === cur) break;
    cur = next;
  }
  return matchIdentifier(cur);
}

/**
 * Split a comma-separated SQL list at TOP level only — a comma inside nested
 * parens or inside a quoted literal/identifier belongs to the part, not to the
 * list. `a, b, COALESCE(c, '')` → `['a', 'b', "COALESCE(c, '')"]`.
 */
function splitTopLevelList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (quote) {
      // SQL escapes a quote by doubling it; skipping the pair keeps us in-quote.
      if (ch === quote) {
        if (list[i + 1] === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = list.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** Strip the per-key decorations `pg_get_indexdef` prints (`DESC`, `COLLATE …`). */
function stripKeyPartModifiers(part: string): string {
  let s = part.trim();
  s = s.replace(/\s+nulls\s+(?:first|last)$/i, '');
  s = s.replace(/\s+(?:asc|desc)$/i, '');
  s = s.replace(/\s+collate\s+(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$.]*)$/i, '');
  return s.trim();
}

/**
 * Classify one physical index key part.
 *
 * The single equivalence this recognises is `COALESCE(col, <literal>)` ≡ `col`,
 * and it is recognised deliberately, not liberally. ADR-0048 makes that form
 * the canonical spelling of the overlay key: a plain UNIQUE index treats NULLs
 * as distinct, so package-less globals would not be unique among themselves,
 * and `COALESCE(package_id,'')` is how the runtime pins them. The expression
 * therefore keys on *exactly* `package_id` — for identity purposes it is that
 * column, and a UNIQUE index over it is strictly STRONGER than the same key
 * spelled plainly. Reading it as a missing column is what produced the false
 * "declares 4 columns, has 3" warning in #4884.
 *
 * Nothing else is coerced. An expression this cannot attribute to one column
 * stays `{ column: null }`, which keeps the index out of every claim the
 * differ makes ({@link isSyncReproducibleIndex}) rather than guessing at it.
 */
export function classifyIndexKeyPart(rawPart: string): IndexKeyPart {
  const s = stripKeyPartModifiers(rawPart);
  const bare = matchIdentifier(s);
  if (bare !== null) return { kind: 'column', column: bare };

  const coalesce = /^coalesce\s*\(([\s\S]*)\)$/i.exec(stripWrappingParens(s));
  if (coalesce) {
    const args = splitTopLevelList(coalesce[1]);
    if (args.length >= 2) {
      const column = bareColumnOf(args[0]);
      const restAreLiterals = args.slice(1).every((a) => SQL_LITERAL.test(a.trim()));
      if (column !== null && restAreLiterals) return { kind: 'expression', sql: rawPart, column };
    }
  }
  return { kind: 'expression', sql: rawPart, column: null };
}

/** An index definition recovered from its `CREATE INDEX` text. */
export interface ParsedIndexDdl {
  /** Ordered key parts exactly as written — a column name, or an expression. */
  keyParts: string[];
  /** The definition carries a `WHERE` predicate (a partial index). */
  partial: boolean;
}

/**
 * Parse the key list and partial predicate out of a `CREATE INDEX` statement.
 *
 * Used for the two dialects that hand back the definition verbatim —
 * `sqlite_master.sql` and `pg_get_indexdef()` — because their per-column
 * catalogue views cannot express an expression key at all. Quote-aware, so a
 * comma or paren inside a string literal never splits a key part.
 */
export function parseIndexDdl(sql: string): ParsedIndexDdl | null {
  if (typeof sql !== 'string' || sql.length === 0) return null;
  let depth = 0;
  let quote: string | null = null;
  let open = -1;
  let close = -1;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) {
        if (sql[i + 1] === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') {
      if (depth === 0) open = i;
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (open < 0 || close < 0) return null;
  const keyParts = splitTopLevelList(sql.slice(open + 1, close));
  if (keyParts.length === 0) return null;
  return { keyParts, partial: /(?:^|[\s)])where[\s(]/i.test(sql.slice(close + 1)) };
}

/**
 * Fold parsed key parts into a {@link PhysicalIndex}, in key order: attributable
 * parts land in `columns`, expression parts are additionally recorded verbatim
 * so {@link isSyncReproducibleIndex} can see them.
 */
export function applyIndexKeyParts(index: PhysicalIndex, rawParts: string[]): void {
  for (const raw of rawParts) {
    const part = classifyIndexKeyPart(raw);
    if (part.kind === 'column') {
      index.columns.push(part.column);
      continue;
    }
    (index.expressions ??= []).push(part.sql);
    if (part.column !== null) index.columns.push(part.column);
  }
}

/** An index that physically exists (see `SqlDriver.introspectIndexes`). */
export interface PhysicalIndex {
  name: string;
  /**
   * The column identities the index keys on, in key order.
   *
   * An EXPRESSION key part contributes the column it resolves to when
   * {@link classifyIndexKeyPart} can attribute it to one (`COALESCE(pkg,'')` →
   * `pkg`, #4884) — the column IS in the key, it is merely written as an
   * expression, and dropping it here is what made a healthy database read as
   * three-column drift against a four-column declaration. A part that resolves
   * to no single column is omitted (and recorded in {@link expressions}).
   */
  columns: string[];
  unique: boolean;
  /** Backing index of the PRIMARY KEY — never metadata-managed. */
  primary?: boolean;
  /**
   * The index is restricted by a `WHERE` predicate (a SQLite / Postgres partial
   * index). See {@link isSyncReproducibleIndex} for why this is load-bearing.
   */
  partial?: boolean;
  /**
   * Key parts written as SQL EXPRESSIONS rather than bare columns, verbatim and
   * in key order. Empty/absent for an ordinary index. See
   * {@link isSyncReproducibleIndex}.
   */
  expressions?: string[];
}

/**
 * Could the additive index sync have produced this exact physical index — and,
 * decisively, could it RECREATE it after a drop? (#4884)
 *
 * Every remedy this module proposes for an index rests on that second half.
 * `drop_index` is safe only because a still-declared index would be
 * re-materialized on the next sync; `recreate_index` drops before it creates.
 * `syncDeclaredIndexes` builds indexes through knex's `table.unique(fields)` /
 * `table.index(fields)` — plain columns, no predicate, no expressions — so an
 * index carrying either is one it can NEITHER have created NOR rebuild. Naming
 * it drift asserts an authorship we do not have, and pointing
 * `--allow-destructive` at it proposes an unrecoverable drop.
 *
 * That is exactly what a fresh `app-showcase` boot did to
 * `idx_sys_metadata_overlay_draft`: the ADR-0048 partial UNIQUE index the
 * runtime creates for draft-overlay uniqueness matched no declaration, carried
 * ObjectStack's `idx_<table>_` naming, and was therefore reported as an orphan
 * to be dropped — i.e. the boot advised destroying a live data-integrity
 * guarantee the same boot had just created.
 */
export function isSyncReproducibleIndex(index: PhysicalIndex): boolean {
  return index.partial !== true && (index.expressions?.length ?? 0) === 0;
}

/**
 * Is this index the framework's to manage rather than the additive sync's?
 *
 * Two independent witnesses, either of which is sufficient:
 *  1. `runtimeCreated` — this very process executed the `CREATE INDEX` through
 *     the driver's raw `execute()` seam. A database created seconds ago by this
 *     build cannot be drifted from its own declaration, so a remedy here is
 *     false by construction.
 *  2. The index is not {@link isSyncReproducibleIndex} — durable across
 *     restarts, and the only witness available on the second boot, when the
 *     runtime ledger starts empty again.
 */
export function isRuntimeManagedIndex(
  index: PhysicalIndex,
  runtimeCreated?: ReadonlySet<string>,
): boolean {
  return runtimeCreated?.has(index.name) === true || !isSyncReproducibleIndex(index);
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
 *
 * `declaredIndexes` are excluded the same way, and for the same reason (#3955).
 * An object may declare a single-column unique index alongside a tenant-scoped
 * field-level `unique: true` — `email: { unique: true }` plus
 * `indexes: [{ fields: ['email'], unique: true }]`. That declared index
 * materializes under {@link buildIndexName}, which is *also* one of the two
 * spellings {@link legacyUniqueIndexNames} looks for, so without this filter the
 * detector reads an index metadata declares TODAY as pre-#3696 debt and proposes
 * dropping it. The plan then never converges: apply drops the declared index,
 * the next plan reports it missing and recreates it, and the one after that
 * calls it legacy again — an unbounded drop/create cycle on a live unique index.
 * An index the current metadata declares is by definition not legacy.
 */
export function legacyUniqueReplacements(args: {
  table: string;
  fields: Record<string, any>;
  tenantField: string | null;
  physicalColumns: Set<string>;
  declaredIndexes?: Array<{ name?: string; fields?: string[]; unique?: boolean | 'global' }>;
}): LegacyUniqueReplacement[] {
  const { table, fields, tenantField, physicalColumns, declaredIndexes } = args;
  if (!tenantField) return []; // Nothing was ever mis-scoped on a tenant-less table.
  // Without a physical tenant column there is no composite to replace the
  // legacy index with, and dropping it unreplaced would remove the constraint
  // outright rather than relax it. Leave it alone.
  if (!physicalColumns.has(tenantField)) return [];
  // Normalized through the same helper the create path uses, so "what the
  // declared index is named" is answered once, not guessed at twice.
  const declaredNames = new Set(
    (Array.isArray(declaredIndexes) ? declaredIndexes : [])
      .map((idx) => normalizeDeclaredIndex(table, idx)?.name)
      .filter((n): n is string => typeof n === 'string'),
  );
  const out: LegacyUniqueReplacement[] = [];
  for (const [name, field] of Object.entries<any>(fields ?? {})) {
    if (!isUniqueDeclared(field?.unique)) continue;
    if (isGlobalUnique(field.unique)) continue;
    if (name === tenantField || !physicalColumns.has(name)) continue;
    const legacyNames = legacyUniqueIndexNames(table, name).filter((n) => !declaredNames.has(n));
    if (legacyNames.length === 0) continue;
    const columns = [tenantField, name];
    out.push({
      column: name,
      legacyNames,
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
  /**
   * Index names THIS process created through the driver's raw `execute()` DDL
   * (#4884). Honoured as a runtime-managed marker — see
   * {@link isRuntimeManagedIndex}.
   */
  runtimeCreated?: ReadonlySet<string>;
}): ManagedDriftEntry[] {
  const { table, expected, legacy, physical, runtimeCreated } = args;
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
      if (!p || p.primary || isRuntimeManagedIndex(p, runtimeCreated)) return false;
      return p.unique && p.columns.length === 1 && p.columns[0] === l.column;
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
    // The framework's own runtime migrations own some declared names — ADR-0048
    // rebuilds `idx_sys_metadata_overlay_active` as a partial UNIQUE over
    // `COALESCE(package_id,'')`, and `sys-metadata.object.ts` says in so many
    // words that its four-column declaration is "the fallback shape for drivers
    // without the runtime migration". Proposing a rebuild FROM that fallback
    // would replace a stronger index with a weaker one, under a remedy
    // (`recreate_index` → drop first) this differ cannot undo. Not ours to
    // reconcile (#4884).
    if (isRuntimeManagedIndex(p, runtimeCreated)) continue;
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
    // "Generated naming" is a NAME heuristic; it cannot tell an index the sync
    // emitted from one the framework's runtime built under a similar name. The
    // orphan remedy is a DROP, so the claim has to be stronger than a prefix:
    // an index this differ could not recreate is never proposed for deletion
    // (#4884 — the boot advised dropping `idx_sys_metadata_overlay_draft`, the
    // partial UNIQUE enforcing draft-overlay uniqueness, on a healthy fresh DB).
    if (isRuntimeManagedIndex(p, runtimeCreated)) continue;
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
