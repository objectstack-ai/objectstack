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

import { isAppResolvedDefaultToken, isUniqueDeclared } from '@objectstack/spec/data';
import type { SchemaDiffEntry } from '@objectstack/spec/shared';

// ───────────────────────────────────────────────────────────────────────
// Unique-scope vocabulary (ADR-0120)
// ───────────────────────────────────────────────────────────────────────

/**
 * Sentinel naming the NULL-organization ("platform") bucket — ADR-0120 D3.
 *
 * Every organization-scoped unique index materializes its organization key
 * part as `COALESCE(organization_id, '__global__')` instead of the raw column:
 * SQL UNIQUE is NULL-distinct, so the raw column enforced NOTHING on rows
 * whose organization is NULL — which is every row on a single-tenant stack
 * (#5030). The COALESCE folds all NULL-organization rows into one bucket,
 * unique among themselves, without touching the other rows.
 *
 * Three invariants, all deliberate (ADR-0120 D3, maintainer-resolved):
 *  - **Storage stays NULL.** Only the index folds NULL into the bucket; a
 *    `WHERE organization_id = '__global__'` matches nothing, by design.
 *  - **The word is the platform's existing name for this bucket** — the
 *    autonumber sequence table keys global rows by the same sentinel
 *    (`SqlDriver`'s `GLOBAL_TENANT`), so a constraint-violation error reading
 *    `(__global__, a@b.com)` says "platform bucket", not "corrupt data".
 *  - **The token is reserved**: an organization id may never equal it
 *    (guarded at the organization-creation seam in plugin-auth).
 */
export const GLOBAL_TENANT = '__global__';

/**
 * Driver-side unique-scope vocabulary — ADR-0120 D1.
 *
 * `'organization'` is accepted here AHEAD of the spec schema: #4986 lands the
 * spec/lint token separately, and the merge order is deliberately driver first
 * so spec-side acceptance never outruns driver-side enforcement. Until then,
 * spec's `isUniqueDeclared` / `isGlobalUnique` know nothing of
 * `'organization'`, so these wrappers are the single judgment point inside
 * driver-sql — every scope decision in this package reads them, never the
 * spec helpers directly.
 */
export function isUniqueScopeDeclared(unique: unknown): boolean {
  return unique === 'organization' || isUniqueDeclared(unique);
}

/**
 * The organization-scoped spellings of a FIELD-level `unique`: bare `true`
 * (the positional synonym, unchanged since #3696) and the explicit
 * `'organization'` word (ADR-0120 D1). Pass a field's `unique`; do NOT pass a
 * declared index's.
 *
 * This is NOT the scope judgment for a declared index, and it must not be
 * reached for there. {@link normalizeDeclaredIndex} decides with a strict
 * `idx?.unique === 'organization'` instead, so a declared index's bare `true`
 * is taken VERBATIM as global — the `'global'` arm. That the two paths judge
 * the same token differently is the answer to #4986, not an oversight: the
 * spellings were authored under different contracts, and both halves are
 * pinned (`sql-driver-declared-index-organization-respelling.test.ts`).
 *
 * Routing the declared-index branch through this predicate so code and comment
 * agree is REJECTED — maintainer ruling 2026-08-13, option 1 of #8323. It
 * would silently reinterpret every existing declared `unique: true` on
 * deployed databases as organization-scoped: an unannounced index migration,
 * landing a release BEFORE #5082 refuses the bare spelling — the
 * two-migrations-with-contradictory-meanings sequence that ruling exists to
 * avoid. Whether a declared index's bare `true` should be refused at all is
 * PARKED on #5082 (v18 D2: bare `true` → `'global'` plus a loud refusal).
 * Until that lands the divergence stays, surfaced to authors rather than
 * silently repaired: lint `unique/unscoped-declared-index` warns on it
 * (`packages/lint/src/data-model-rules.ts`) and `IndexSchema.unique`'s
 * `describe()` states it (`packages/spec/src/data/object.zod.ts`).
 */
export function isOrganizationScopedUnique(unique: unknown): boolean {
  return unique === true || unique === 'organization';
}

/**
 * The organization key part of an organization-scoped unique index, spelled
 * once (ADR-0120 D3). Display/signature form — DDL emission quotes the
 * identifier per dialect in `SqlDriver.syncDeclaredIndexes`.
 */
export function organizationKeyPartSql(column: string): string {
  return `COALESCE(${column}, '${GLOBAL_TENANT}')`;
}

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
   * REPORT ONLY (#11535). The column's base type diverges from the one the
   * declaration materialises, and **the platform deliberately does not change
   * it** — an operator must, by hand.
   *
   * ⛔ There is NO reconciler arm for this op, and adding one is not a
   * refactor. Whether ObjectStack should perform the `ALTER TABLE … TYPE …
   * USING …` itself is a **live maintainer decision** (the other half of
   * #11535): it is a migration over existing rows plus an index drop/rebuild,
   * i.e. destructive and hard to roll back. This op exists so the divergence
   * can be SEEN travelling the same plan/report road as every other finding —
   * it is the absence of an automatic migration made explicit, not a
   * placeholder for one.
   *
   * Measured consequence of having no arm, on live Postgres 16.13 (the same on
   * MySQL 8.0.46): `applyDriftOpInPlace` matches no case and returns `false`,
   * so `applyMigrationEntries` reports the entry as **skipped, never applied**,
   * and logs it. That is the intended behaviour, not a gap to close.
   *
   * `from`/`to` are the physical and declared type words, carried so a renderer
   * can show the divergence without re-deriving it from the message.
   */
  | { type: 'manual_column_type_change'; table: string; column: string; to: string; from: string }
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
      /** Columns whose key part is the NULL-safe organization form (ADR-0120 D3). */
      nullSafeColumns?: string[];
    }
  /** Materialize a declared index that has no physical counterpart. */
  | {
      type: 'create_index';
      table: string;
      column?: string;
      indexName: string;
      columns: string[];
      unique: boolean;
      /** Columns whose key part is the NULL-safe organization form (ADR-0120 D3). */
      nullSafeColumns?: string[];
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
      /** Columns whose key part is the NULL-safe organization form (ADR-0120 D3). */
      nullSafeColumns?: string[];
      /**
       * ADR-0120 D4: the divergence is EXACTLY the bare organization column
       * tightening into its NULL-safe COALESCE form — same column identities,
       * same uniqueness, physical index fully plain. This is the one recreate
       * whose danger is data-dependent rather than structural, so it goes
       * through the duplicate pre-flight probe: clean → `safe` (dev
       * `autoMigrate: 'safe'` may apply it), duplicates found → blocked with a
       * row report, old index left in place.
       */
      tightenNullSafeOnly?: boolean;
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
  /**
   * Raw as knex `columnInfo()` reports it — a number on some dialects, a
   * STRING on SQLite (measured: `"255"`). The varchar differ below narrows
   * via `typeof` before comparing, which is the pattern for any new reader.
   */
  maxLength?: number | string;
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
 * Is this physical column a `varchar`/`char` — the only kind that HAS a
 * declared length to compare against (#11431)?
 *
 * Without this the length branch below read a MySQL **TEXT** column as a
 * varchar 65535 wide, because that is literally what the server reports for it.
 * Measured on MySQL 8.0.46 and Postgres 16, same two columns:
 *
 *   MySQL     `text`              character_maximum_length = 65535
 *   Postgres  `text`              character_maximum_length = NULL
 *   both      `varchar(30)`       character_maximum_length = 30
 *
 * So the defect was MySQL-only and invisible on Postgres. Every bounded,
 * unkeyed text field — the shape `createColumn` deliberately leaves as TEXT —
 * diffed as "declared 4000, column allows 65535" and produced a
 * `narrow_varchar` op at severity `error`, category **destructive**, against a
 * table the driver had just created and which held no rows. Measured on live
 * MySQL: `sys_email`'s envelope alone accounts for seven such findings, each
 * inviting `os migrate apply --allow-destructive` to rewrite a TEXT column into
 * a varchar for no reason.
 *
 * A TEXT column refuses nothing a `maxLength` allows, so there is no
 * divergence to plan an ALTER for; the bound is enforced at the write seam.
 * Spelled as a substring test rather than an equality because the three
 * dialects disagree on the word — Postgres says `character varying`, MySQL and
 * SQLite say `varchar` — matching the predicate `introspectSchema` already
 * uses for the same question.
 */
function isCharacterColumn(type: string | undefined): boolean {
  return /char/i.test(String(type ?? ''));
}

/**
 * Is this physical column one that ACCEPTS a stringified JSON array without
 * complaint — i.e. `varchar`/`char`/`text` in any dialect's spelling (#11535)?
 *
 * Wider than {@link isCharacterColumn} by exactly the TEXT family, and that
 * width is the point rather than an accident: the write path stringifies a
 * multi-value field's array, and a text column takes the literal as happily as
 * a varchar does. Both are the silent-corruption shape.
 *
 * Deliberately NOT "anything that is not json". A stale `integer` or
 * `timestamp` column under a now-multi-value field is already LOUD — Postgres
 * refuses `'["a","b"]'` with `22P02 invalid input syntax`, MySQL with
 * `ER_TRUNCATED_WRONG_VALUE` — so it needs no finding to become visible, and
 * matching it here would report a divergence the database itself already
 * refuses. The textual family is the one that says yes and corrupts.
 */
function acceptsStringifiedJson(type: string | undefined): boolean {
  return /char|text/i.test(String(type ?? ''));
}

/**
 * Does a multi-value field's JSON column carry its type on THIS dialect — i.e.
 * does a stale textual column silently corrupt the value (#11535)?
 *
 * Postgres and MySQL: yes. Measured end to end on live Postgres 16.13 and MySQL
 * 8.0.46 — a field that gained `multiple: true` over a pre-existing
 * `varchar(255)` column round-trips as the LITERAL STRING `["a","b"]`
 * (`typeof === 'string'`, `Array.isArray === false`), because the write path
 * stringifies for a json field on every non-SQLite dialect while the read path
 * relies on the driver's column-type-based decoding, which a stale textual
 * column defeats.
 *
 * SQLite: **no**, and the exclusion is measured rather than assumed. The same
 * stale column reads back as a real `['a','b']` array there (the read path
 * `JSON.parse`s on SQLite regardless of what the column calls itself), so there
 * is no corruption to report — reporting it anyway would put a permanent
 * `error` finding on every long-lived SQLite development database for a
 * divergence that changes no value. SQLite's column type is an affinity label,
 * not an enforced type, which is the same reason
 * {@link enforcesVarcharLength} excludes it.
 */
function multiValueColumnTypeIsLoadBearing(dialect: SqlDialectName): boolean {
  return dialect === 'postgres' || dialect === 'mysql';
}

/**
 * The operator-run command that repairs a stale multi-value column (#11535).
 *
 * Named in the finding's `message` because a message that only DESCRIBES a
 * problem leaves the operator to invent the repair. Until `os migrate
 * multi-value-columns` shipped (#11733) there was nothing else to say, so the
 * message told them to run raw SQL by hand — and the sentence it opened with,
 * "ObjectStack will NOT change this column for you", became false the moment
 * that command landed. The hand-run route is still printed below it, because
 * the statement is what the command runs and an operator without the CLI still
 * needs it; it is no longer the FIRST thing offered.
 *
 * ⛔ Module-exported so this package's own suites can pin the spelling, and
 * deliberately NOT added to `index.ts`: naming a CLI command in a warning is a
 * string, and a published export is the step that would let the CLI import its
 * own id back out of the driver it boots. `schema-drift.base-type-mismatch.test.ts`
 * asserts the emitted message contains it; the command id itself lives in
 * `packages/cli/src/commands/migrate/multi-value-columns.ts`.
 *
 * ⚠️ It changes NOTHING about how loud this finding is or what it gates:
 * `severity: 'error'` and `category: 'needs_confirm'` are untouched, so the
 * finding still refuses no boot (see the emission site's comment — the boot
 * gate reads CATEGORY, and `destructive` is the value that would stop an
 * already-serving database from starting).
 */
export const MULTI_VALUE_COLUMN_REMEDY_COMMAND = 'os migrate multi-value-columns';

/**
 * The hand-run statement that converts a stale textual column to `json`,
 * spelled for the dialect the operator is actually on.
 *
 * The Postgres form keeps the SHAPE of the reporter's own production workaround
 * (#11535) — the three-way CASE over the three states a stale column's rows are
 * actually in — with one arm changed, for a reason that was measured rather than
 * reasoned: the reporter's `to_json(col)` turns a legacy single value into the
 * JSON **scalar** `"a"`, under a field the metadata now declares MULTI-VALUE. On
 * live Postgres 16.13 that row read back as a string with `Array.isArray ===
 * false`, i.e. still not the shape the declaration promises, while live MySQL
 * 8.0.46's `JSON_ARRAY(col)` produced `["a"]`. `json_build_array` makes the two
 * dialects hand back the same value for the same row, which is the standing rule
 * here — one declaration with two enforcement answers is the defect class this
 * package's conformance matrices exist to close.
 *
 * Both forms are EXECUTED against live servers by
 * `schema-drift.base-type-mismatch.test.ts`, over rows in every state the column
 * can be in (legacy single value, already-stringified array, empty string,
 * NULL), and the finding is asserted to clear afterwards — an operator-facing
 * remedy nobody runs is a remedy that drifts into being wrong.
 */
export function manualJsonConversionSql(dialect: SqlDialectName, table: string, column: string): string {
  if (dialect === 'mysql') {
    // MySQL will not cast text to json implicitly: rows holding a legacy single
    // value have to become one-element arrays FIRST, or the ALTER fails with
    // `ER_INVALID_JSON_TEXT` on the first non-JSON row.
    return (
      `UPDATE \`${table}\` SET \`${column}\` = JSON_ARRAY(\`${column}\`) ` +
      `WHERE \`${column}\` IS NOT NULL AND \`${column}\` <> '' AND LEFT(\`${column}\`, 1) <> '['; ` +
      `UPDATE \`${table}\` SET \`${column}\` = NULL WHERE \`${column}\` = ''; ` +
      `ALTER TABLE \`${table}\` MODIFY \`${column}\` json;`
    );
  }
  return (
    `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE json USING ` +
    // The `IS NULL` arm is not redundant with the `= ''` one and is not
    // decoration: `json_build_array(NULL)` is `[null]`, a one-element array, so
    // without it every NULL row silently gains a value. Measured on live
    // Postgres 16.13 while writing this — the arm exists because the version
    // without it was run and produced `[null]`.
    `(CASE WHEN "${column}" IS NULL THEN NULL WHEN "${column}" = '' THEN NULL ` +
    `WHEN "${column}" LIKE '[%' THEN "${column}"::json ` +
    `ELSE json_build_array("${column}") END);`
  );
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

    // ── base type: a multi-value field over a stale textual column (#11535) ──
    //
    // `createColumn` materialises a multi-value field as `table.json(name)` —
    // its FIRST branch, taken before the field's type or `maxLength` is read at
    // all. On a database created while the field was single-value the column is
    // `varchar`/`text`, and the additive sync (`ALTER TABLE ADD COLUMN`) can
    // never revisit it: nothing here is missing, so nothing is added.
    //
    // Until this branch existed the divergence was reported by NOTHING.
    // Measured on live Postgres 16.13 and MySQL 8.0.46 on the pre-fix tree: a
    // `lookup` field that gained `multiple: true` over an existing
    // `character varying(255)` column produced `detectManagedDrift() === []` and
    // zero `[schema-drift]` log lines, while the very next write stored the
    // literal string `["user_A","user_B"]` into the column and read it back as a
    // string. Downstream code that copies the value into a single-value column
    // then writes that whole string as one id — the silent corruption reported
    // in #11535, which a display-layer glitch it is not.
    //
    // ## Severity `error`, category `needs_confirm` — both MEASURED, and the
    // ## category is load-bearing in a way the words do not suggest
    //
    // ⛔ Do NOT "correct" this to `destructive` to match how bad it sounds.
    // What consumes `category` was measured, not inferred:
    //
    //   - The artifact-pinned boot gate (`runArtifactBootMigrationGate`, on
    //     `kernel:ready` before the HTTP socket opens) refuses the boot for
    //     `category === 'destructive'` and nothing else. Measured: a
    //     `destructive` entry yields `ok=false`; this entry as written yields
    //     `ok=true`. Every database this finding describes is ALREADY SERVING —
    //     that is the premise of the report — so a `destructive` spelling would
    //     convert a running (if corrupt) deployment into a crash-loop on the
    //     next restart. Reporting a corruption must not be the thing that takes
    //     the app down.
    //   - Dev auto-reconcile takes `category === 'safe'` only, so
    //     `needs_confirm` is never applied unattended either.
    //   - `severity` is read by NO gate: the ordinary boot path warns on every
    //     entry regardless of it. It is the render weight (`✗` in
    //     `os migrate plan`), which is why `error` is both honest and free.
    //
    // The residue is stated rather than hidden: `os migrate apply` hands a
    // `needs_confirm` entry to the reconciler, which — having no arm for this op
    // by design — declines it (`applied=0, skipped=1`) and says so.
    //
    // ## The message NAMES the remedy, because there is now a remedy to name
    //
    // Ruled C on #11700 (maintainer, 2026-08-24): the platform warns and ships
    // an explicit, operator-run migration, and never runs it at boot.
    // ⛔ Quoted verbatim, not translated:
    // 「11700 11693 不需要考虑历史数据，其他按照你的建议继续」
    //
    // That command is `os migrate multi-value-columns` (#11733, landed
    // `0e5bea6`), which is what changes this message's job. Before it existed
    // the finding could only DESCRIBE the problem and hand over raw SQL; it
    // opened its remedy with "ObjectStack will NOT change this column for you",
    // a sentence the command falsified. It now names the command first — the
    // route with a dry run, a confirmation prompt, and a post-run re-detection
    // that exits non-zero if the finding has not cleared — and keeps the
    // hand-run statement after it for an operator without the CLI.
    //
    // ⚠️ The raw statement stays in the message VERBATIM, and that is a
    // contract, not prose: `planStaleColumnTargets`
    // (packages/cli/src/commands/migrate/multi-value-columns.ts) recovers the
    // DIALECT by testing `message.includes(manualJsonConversionSql(d, …))` for
    // each corrupting dialect — a `ManagedDriftEntry` carries no dialect of its
    // own. Reword this message so the statement no longer appears character for
    // character and the command refuses every finding with
    // `remedy_not_recognized`, i.e. the remedy this text points at stops
    // working. Pinned from this side by the `toContain(manualJsonConversionSql(…))`
    // cases in `schema-drift.base-type-mismatch.test.ts`.
    const declaresJsonColumn = field.multiple === true;
    if (declaresJsonColumn && multiValueColumnTypeIsLoadBearing(dialect) && acceptsStringifiedJson(col.type)) {
      out.push({
        kind: 'type_mismatch',
        remoteName: table,
        table,
        column: fieldName,
        expected: 'json',
        actual: col.type,
        severity: 'error',
        category: 'needs_confirm',
        op: { type: 'manual_column_type_change', table, column: fieldName, to: 'json', from: col.type },
        message:
          `${table}.${fieldName}: metadata declares a multi-value field (stored as \`json\`) but the ` +
          `column is \`${col.type}\` — the database was created while the field was single-value and the ` +
          `additive sync never migrates a column's type. Arrays are being written as the STRINGIFIED ` +
          `literal (e.g. '["a","b"]') and read back as a string, so anything consuming the value ` +
          `receives one opaque id instead of a list (#11535). REMEDY: run ` +
          `"${MULTI_VALUE_COLUMN_REMEDY_COMMAND}" — it is a DRY RUN by default that executes nothing ` +
          `and prints the statements; take a backup, then re-run it with --apply. ObjectStack never ` +
          `migrates this column on its own: the boot path only reports it and "os migrate apply" ` +
          `skips it, so nothing changes until you run that command. To do it by hand instead, in a ` +
          `transaction and with a backup taken first — dropping any index on the column first, since ` +
          `a json column cannot carry a plain btree: ` +
          `${manualJsonConversionSql(dialect, table, fieldName)} ` +
          `Rows written while the column was stale may already hold a stringified array in a RELATED ` +
          `single-value column; neither route repairs those.`,
      });
    }

    // ── varchar length (only where the dialect enforces it) ──────────
    //
    // `maxLength` must be a POSITIVE INTEGER to be a bound (#11431). Without
    // that predicate this branch read a malformed declaration as authoritative
    // and planned DDL no server will accept: `maxLength: 0` took the narrowing
    // arm (`0 > col.maxLength` is false) and asked for `varchar(0)`, and
    // `maxLength: 12.5` asked for `varchar(12.5)` — both reported at severity
    // `error`, category `destructive`, i.e. as work `os migrate apply
    // --allow-destructive` should go do.
    //
    // It is the same predicate the EMITTER applies
    // (`SqlDriver.declaredVarcharLength`, and `keyableTextLength` before it):
    // a malformed bound is treated as no bound at all, and the column keeps
    // its default width. Sharing the predicate is the point — the two halves
    // disagreeing about which declarations count is the defect class #11431
    // exists to close, and a differ that still honoured a malformed
    // `maxLength` would have re-opened it one case to the left.
    //
    // A MULTI-VALUE field is excluded for the same reason and by the same
    // authority: `createColumn` returns at `if (field.multiple) { table.json();
    // return; }` BEFORE `maxLength` is consulted, so the emitter provably never
    // gives such a field a declared width, and a differ that honours one is the
    // two-halves-disagree defect #11431 exists to close — one case to the left
    // again. Measured on the pre-fix tree, `{ multiple: true, maxLength: 50 }`
    // over a stale `varchar(255)` column reported `narrow_varchar` at severity
    // `error`, category **destructive** on both enforcing dialects: a finding
    // that refuses the artifact-pinned boot and invites `os migrate apply
    // --allow-destructive` to rewrite the column to `varchar(50)` — the exact
    // OPPOSITE of the repair the column needs, which is `json`. That shape is
    // now reported once, correctly, by the base-type branch above.
    const declaredMaxLength =
      typeof field.maxLength === 'number' && Number.isInteger(field.maxLength) && field.maxLength > 0
        ? field.maxLength
        : undefined;
    if (
      enforcesVarcharLength(dialect) &&
      !declaresJsonColumn &&
      declaredMaxLength !== undefined &&
      isCharacterColumn(col.type) &&
      typeof col.maxLength === 'number' &&
      declaredMaxLength !== col.maxLength
    ) {
      if (declaredMaxLength > col.maxLength) {
        out.push({
          kind: 'type_mismatch',
          remoteName: table,
          table,
          column: fieldName,
          expected: `varchar(${declaredMaxLength})`,
          actual: `varchar(${col.maxLength})`,
          severity: 'warning',
          category: 'safe',
          op: { type: 'widen_varchar', table, column: fieldName, to: declaredMaxLength, from: col.maxLength },
          message: `${table}.${fieldName}: metadata allows ${declaredMaxLength} chars but the column caps at ${col.maxLength} — widen via "os migrate".`,
        });
      } else {
        out.push({
          kind: 'type_mismatch',
          remoteName: table,
          table,
          column: fieldName,
          expected: `varchar(${declaredMaxLength})`,
          actual: `varchar(${col.maxLength})`,
          severity: 'error',
          category: 'destructive',
          op: { type: 'narrow_varchar', table, column: fieldName, to: declaredMaxLength, from: col.maxLength },
          message: `${table}.${fieldName}: metadata caps at ${declaredMaxLength} chars but the column allows ${col.maxLength} — narrowing may truncate. "os migrate apply --allow-destructive".`,
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
  /**
   * Columns (by identity, always a subset of {@link columns}) whose key part
   * materializes as the NULL-safe organization form
   * `COALESCE(<column>, '__global__')` rather than the bare column
   * (ADR-0120 D3). Practically this is the table's tenant column on every
   * organization-scoped unique. Absent/empty for plain indexes.
   */
  nullSafeColumns?: string[];
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
/**
 * A literal any dialect might print inside `COALESCE`, optional `::type` cast
 * included. MySQL's `information_schema.STATISTICS.EXPRESSION` decorates a
 * string literal with a charset introducer and backslash-escaped quotes
 * (`_utf8mb4\'__global__\'`), so both decorations are accepted too — the
 * attribution is deliberately literal-AGNOSTIC (#4884, ADR-0120 D3): what the
 * literal says never changes which column the key part pins.
 */
const SQL_LITERAL =
  /^(?:(?:_[A-Za-z][A-Za-z0-9]*\s*)?\\?'(?:[^'\\]|''|\\.)*\\?'|-?\d+(?:\.\d+)?|null|true|false)(?:::[A-Za-z_][A-Za-z0-9_ ."]*)?$/i;

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
    if (part.column !== null) {
      index.columns.push(part.column);
      // An attributable expression is by construction the COALESCE(col,
      // <literal>) form — record the column so the differ can compare the key
      // part's FORM, not just its identity (ADR-0120 D3: the NULL-safe
      // organization key part vs the bare column are different constraints).
      (index.nullSafeColumns ??= []).push(part.column);
    }
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
  /**
   * The columns that expression key parts ATTRIBUTE to — i.e. every key part
   * of the recognised `COALESCE(col, <literal>)` form contributes its column
   * here (and to {@link columns}). Lets the differ tell the NULL-safe
   * organization key part (ADR-0120 D3) apart from the bare column while
   * staying literal-agnostic. A subset of {@link columns}; absent when every
   * key part is a plain column.
   */
  nullSafeColumns?: string[];
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
 *
 * Since ADR-0120 D3 the sync's own vocabulary includes ONE expression shape:
 * the NULL-safe organization key part `COALESCE(<tenantField>, '__global__')`.
 * An index whose every expression is that form — attributed to the table's
 * OWN tenant column — is therefore reproducible again (pass `tenantField`).
 * The attribution is deliberately column-scoped: `COALESCE(package_id, '')`
 * (the ADR-0048 overlay key) attributes to a non-tenant column and stays out,
 * exactly as before — loosening this to "any attributable COALESCE" would
 * resurrect the #4884 false-orphan on the overlay indexes.
 */
export function isSyncReproducibleIndex(index: PhysicalIndex, tenantField?: string | null): boolean {
  if (index.partial === true) return false;
  const expressions = index.expressions?.length ?? 0;
  if (expressions === 0) return true;
  if (!tenantField) return false;
  const nullSafe = index.nullSafeColumns ?? [];
  return nullSafe.length === expressions && nullSafe.every((c) => c === tenantField);
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
  tenantField?: string | null,
): boolean {
  return runtimeCreated?.has(index.name) === true || !isSyncReproducibleIndex(index, tenantField);
}

/**
 * Translate field-level `unique` declarations into concrete index descriptors,
 * applying tenant scoping (#3696).
 *
 * This is the ONLY place field-level uniqueness becomes an index, so the
 * create-table, alter-table, SQLite-rebuild and drift-detection paths cannot
 * disagree about what a `unique: true` field is supposed to produce.
 *
 * Scoping rule (ADR-0120 D1/D3):
 *   - `unique: 'global'` → single-column `(field)`, platform-wide.
 *   - `unique: true` / `unique: 'organization'` on a tenant-scoped table →
 *     composite `(COALESCE(tenantField, '__global__'), field)`: unique
 *     *within* the organization, matching the per-tenant autonumber sequence,
 *     the RLS read predicate and the write-path tenant stamp. The organization
 *     key part is NULL-safe: rows without an organization form one platform
 *     bucket, unique among themselves — a bare `(tenantField, field)` under
 *     SQL's NULL-distinct UNIQUE enforced NOTHING on those rows, which on a
 *     single-tenant stack is every row (#5030).
 *   - `unique: true` / `'organization'` with no tenant column → single-column
 *     `(field)`.
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
    if (!isUniqueScopeDeclared(field?.unique)) continue;
    // A unique declaration ON the tenant column itself ("one row per tenant")
    // cannot be tenant-scoped — `(organization_id, organization_id)` is not a
    // constraint. Keep it single-column.
    const scoped =
      isOrganizationScopedUnique(field.unique) && tenantField != null && tenantField !== name;
    const columns = scoped ? [tenantField, name] : [name];
    out.push({
      name: buildIndexName(table, columns, true),
      columns,
      unique: true,
      ...(scoped ? { nullSafeColumns: [tenantField] } : {}),
    });
  }
  return out;
}

/** The declared-index shape this module normalizes (spec's `IndexSchema` + the driver-side extras). */
export interface DeclaredIndexInput {
  name?: string;
  fields?: string[];
  /** `'organization'` is the ADR-0120 D1 explicit per-organization scope; see {@link isUniqueScopeDeclared}. */
  unique?: boolean | 'global' | 'organization';
  /** Pre-resolved NULL-safe key parts — used by the drift-op apply path, which re-feeds already-normalized shapes. */
  nullSafeColumns?: string[];
}

/**
 * Normalize one entry of an object's declared `indexes[]`, or null if unusable.
 *
 * Scope handling (ADR-0120 D1/D3):
 *   - `unique: true` / `'global'` → the listed columns, VERBATIM — the #3696
 *     contract, now the `'global'` arm of the explicit vocabulary.
 *   - `unique: 'organization'` → the organization key part is PREPENDED to the
 *     listed columns in its NULL-safe form (`COALESCE(tenantField,
 *     '__global__')`), resolved against the table's tenant column at
 *     registration — the one place tenancy is knowable. With no tenant column
 *     the index degrades to the listed columns alone, mirroring field-level
 *     behavior (S11). A listed column that IS the tenant column is not
 *     prepended again — its own key part becomes the NULL-safe form instead
 *     (the hand-written S6 spelling, opted in).
 */
export function normalizeDeclaredIndex(
  table: string,
  idx: DeclaredIndexInput | undefined,
  tenantField?: string | null,
): ExpectedIndex | null {
  const listed = Array.isArray(idx?.fields)
    ? idx.fields.filter((f): f is string => typeof f === 'string' && f.length > 0)
    : [];
  if (listed.length === 0) return null;
  const unique = isUniqueScopeDeclared(idx?.unique);

  let columns = listed;
  let nullSafeColumns: string[] | undefined;
  if (Array.isArray(idx?.nullSafeColumns) && idx.nullSafeColumns.length > 0) {
    // Already-normalized shape (drift-op apply path) — honour it verbatim.
    nullSafeColumns = idx.nullSafeColumns.filter((c) => listed.includes(c));
    if (nullSafeColumns.length === 0) nullSafeColumns = undefined;
  } else if (idx?.unique === 'organization' && tenantField) {
    columns = listed.includes(tenantField) ? listed : [tenantField, ...listed];
    nullSafeColumns = [tenantField];
  }

  const name =
    typeof idx?.name === 'string' && idx.name.trim()
      ? idx.name.trim()
      : buildIndexName(table, columns, unique);
  return { name, columns, unique, ...(nullSafeColumns ? { nullSafeColumns } : {}) };
}

/**
 * The full index set metadata asks for on a table: field-level `unique`
 * (tenancy-aware) plus the object's declared `indexes[]` — `'global'`/bare
 * `true` taken verbatim, `'organization'` scoped through
 * {@link normalizeDeclaredIndex} (ADR-0120 D1).
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
  declaredIndexes?: DeclaredIndexInput[];
  physicalColumns: Set<string>;
}): ExpectedIndex[] {
  const { table, fields, tenantField, declaredIndexes, physicalColumns } = args;
  const out = uniqueIndexesFromFields(table, fields, tenantField);
  for (const idx of Array.isArray(declaredIndexes) ? declaredIndexes : []) {
    const norm = normalizeDeclaredIndex(table, idx, tenantField);
    if (norm) out.push(norm);
  }
  return out.filter((i) => i.columns.every((c) => physicalColumns.has(c)));
}

/**
 * Every column any declared index on this object will use as a KEY PART, mapped
 * to whether at least one of those indexes is UNIQUE.
 *
 * Computed from the same two normalizers {@link expectedIndexes} composes —
 * field-level `unique` through {@link uniqueIndexesFromFields}, object-level
 * `indexes[]` through {@link normalizeDeclaredIndex} — so "which columns end up
 * in a key" has ONE answer, shared by the index sync that creates them and by
 * the DDL that has to make them keyable in the first place (#11374).
 *
 * ⚠️ Deliberately NOT filtered by `physicalColumns`, unlike `expectedIndexes`:
 * its caller runs BEFORE the columns exist — deciding a column's TYPE is the
 * whole reason it asks — so a filter against the physical set would answer
 * "nothing is indexed" on exactly the CREATE TABLE path that needs the answer.
 *
 * The UNIQUE flag is carried because the two dispositions genuinely differ on
 * MySQL: a bounded key part is merely a storage choice for an ordinary index,
 * but it is the CONSTRAINT itself for a unique one (see
 * `mysqlKeyableTextLength` and the refusal it feeds).
 */
export function indexedKeyColumns(args: {
  table: string;
  fields: Record<string, any>;
  tenantField: string | null;
  declaredIndexes?: DeclaredIndexInput[];
}): Map<string, { unique: boolean }> {
  const { table, fields, tenantField, declaredIndexes } = args;
  const out = new Map<string, { unique: boolean }>();
  const record = (idx: ExpectedIndex) => {
    for (const column of idx.columns) {
      const prev = out.get(column);
      if (prev) prev.unique ||= idx.unique;
      else out.set(column, { unique: idx.unique });
    }
  };
  for (const idx of uniqueIndexesFromFields(table, fields, tenantField)) record(idx);
  for (const idx of Array.isArray(declaredIndexes) ? declaredIndexes : []) {
    const norm = normalizeDeclaredIndex(table, idx, tenantField);
    if (norm) record(norm);
  }
  return out;
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
  /**
   * The EXACT physical key columns the superseded index must have, in key
   * order — the shape the replacement relaxes away from.
   *
   * For a field-level unique this is `[column]`: the pre-#3696 single-column
   * global index. For a DECLARED index respelled from the global spelling to
   * `'organization'` (#8323) it is the index's listed columns, which may be
   * several — `sys_user_preference`'s `(user_id, key)` is the case that put
   * this here. Matching on the name alone is not enough (an unrelated index
   * may collide with the generated spelling), and matching on a single leading
   * column is not enough either: `(user_id, key)` and `(user_id, tenant)` share
   * one, and only one of them is the index being replaced.
   */
  legacyColumns: string[];
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
  declaredIndexes?: DeclaredIndexInput[];
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
      .map((idx) => normalizeDeclaredIndex(table, idx, tenantField)?.name)
      .filter((n): n is string => typeof n === 'string'),
  );
  const out: LegacyUniqueReplacement[] = [];
  for (const [name, field] of Object.entries<any>(fields ?? {})) {
    if (!isUniqueScopeDeclared(field?.unique)) continue;
    if (!isOrganizationScopedUnique(field.unique)) continue;
    if (name === tenantField || !physicalColumns.has(name)) continue;
    const legacyNames = legacyUniqueIndexNames(table, name).filter((n) => !declaredNames.has(n));
    if (legacyNames.length === 0) continue;
    const columns = [tenantField, name];
    out.push({
      column: name,
      legacyColumns: [name],
      legacyNames,
      // NULL-safe organization key part (ADR-0120 D3). Still a pure
      // relaxation to create from under the legacy GLOBAL single-column
      // unique: any two rows colliding in the new key already collided in the
      // old one, so the replacement can neither fail nor lose data.
      replacement: {
        name: buildIndexName(table, columns, true),
        columns,
        unique: true,
        nullSafeColumns: [tenantField],
      },
    });
  }

  // ── Declared indexes respelled from the global spelling to 'organization' ──
  //
  // #8323: the same retirement, one level up. A declared index's bare
  // `unique: true` is the positional spelling of `'global'` — the listed
  // columns VERBATIM — so respelling it `'organization'` changes the
  // materialized shape from `(…listed)` to `(COALESCE(tenant,'__global__'),
  // …listed)`, and with it the generated NAME. On a deployed database that
  // reads as two unrelated findings: the composite is missing (create, safe)
  // and the old global index is an orphan (drop, DESTRUCTIVE, opt-in). An
  // operator who applies only the safe half keeps the global index — and the
  // global index is the defect, so the migration would look applied while the
  // cross-organization refusal it exists to remove is still enforced.
  //
  // Routing it through the SAME `replace_unique_index` op the field-level
  // retirement uses states it as what it is: one pure relaxation, categorised
  // `safe`, applied CREATE-before-DROP so uniqueness is never unenforced in
  // between, and dropping the old index only once the replacement is confirmed
  // present. Any two rows colliding on `(tenant, …listed)` already collided on
  // `(…listed)`, so the create cannot fail on existing data and no data is lost.
  for (const idx of Array.isArray(declaredIndexes) ? declaredIndexes : []) {
    if (idx?.unique !== 'organization') continue;
    // An EXPLICITLY NAMED index keeps its name across the respelling, so there
    // is no second name to retire — same name, new definition, which is
    // `recreate_index`'s job (drop-then-create under one name). Emitting a
    // replacement here as well would propose dropping the very index the
    // recreate is rebuilding.
    if (typeof idx?.name === 'string' && idx.name.trim()) continue;
    const listed = Array.isArray(idx?.fields)
      ? idx.fields.filter((f): f is string => typeof f === 'string' && f.length > 0)
      : [];
    if (listed.length === 0) continue;
    // Every listed column must exist physically, or there is no index to match
    // and nothing the replacement could be created from.
    if (!listed.every((c) => physicalColumns.has(c))) continue;
    const replacement = normalizeDeclaredIndex(table, idx, tenantField);
    if (!replacement) continue;
    const legacyName = buildIndexName(table, listed, true);
    // The S6 hand-written composite already lists the tenant column, so
    // `normalizeDeclaredIndex` prepends nothing and the "legacy" name IS the
    // current name. Nothing was superseded; the D4 NULL-safe tightening path
    // owns that transition.
    if (legacyName === replacement.name) continue;
    // An index the CURRENT metadata declares is by definition not legacy
    // (#3955) — the same guard the field-level arm applies.
    if (declaredNames.has(legacyName)) continue;
    out.push({
      column: listed[0],
      legacyColumns: listed,
      legacyNames: [legacyName],
      replacement,
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

/**
 * `UNIQUE (a, b)` vs `(a, b)` — the display form of an index definition. A
 * NULL-safe organization key part (ADR-0120 D3) renders as its COALESCE form
 * so plan/warn messages describe the constraint that will actually exist.
 */
function indexSignature(
  columns: string[],
  unique: boolean,
  nullSafeColumns?: ReadonlyArray<string> | null,
): string {
  const ns = new Set(nullSafeColumns ?? []);
  const parts = columns.map((c) => (ns.has(c) ? organizationKeyPartSql(c) : c));
  return `${unique ? 'UNIQUE ' : ''}(${parts.join(', ')})`;
}

/**
 * Comparison identity of an index key — the SAME normalization for the
 * expected and the physical side (ADR-0120 D3; the #4884 lesson). A key
 * part's FORM matters (`COALESCE(organization_id, …)` is a different
 * constraint from bare `organization_id`), but the COALESCE literal does not:
 * any `COALESCE(col, <literal>)` folds NULL into one bucket, so two spellings
 * of the literal are the same constraint and must not read as drift.
 */
function canonicalIndexKey(columns: string[], nullSafeColumns?: ReadonlyArray<string> | null): string {
  const ns = new Set(nullSafeColumns ?? []);
  return columns.map((c) => (ns.has(c) ? `coalesce:${c}` : c)).join(',');
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
  /**
   * The table's tenant column, when it has one. Lets the differ recognise the
   * NULL-safe organization key part as the sync's OWN vocabulary
   * (ADR-0120 D3) — see {@link isSyncReproducibleIndex}.
   */
  tenantField?: string | null;
}): ManagedDriftEntry[] {
  const { table, expected, legacy, physical, runtimeCreated, tenantField } = args;
  const out: ManagedDriftEntry[] = [];
  const byName = new Map(physical.map((p) => [p.name, p]));
  /** Physical index names accounted for — either declared, or already reported. */
  const explained = new Set<string>();

  // ── 1. Legacy platform-wide unique superseded by a tenant composite ──
  for (const l of legacy) {
    // Only a *plain unique on exactly those columns, in key order* is the
    // legacy shape. Matching on the name alone would let an unrelated index
    // that happens to collide with the legacy spelling be dropped.
    //
    // `legacyColumns` is `[column]` for the field-level retirement and the
    // declared index's listed columns for the #8323 respelling — the same
    // question either way, asked once. The plainness guards matter for the
    // multi-column arm: an index carrying an expression key part, a NULL-safe
    // organization part or a WHERE predicate is NOT the verbatim global shape
    // being relaxed, whatever its column identities read as.
    const present = l.legacyNames.filter((n) => {
      const p = byName.get(n);
      if (!p || p.primary || isRuntimeManagedIndex(p, runtimeCreated, tenantField)) return false;
      if (!p.unique || p.partial === true) return false;
      if ((p.expressions?.length ?? 0) > 0 || (p.nullSafeColumns?.length ?? 0) > 0) return false;
      return (
        p.columns.length === l.legacyColumns.length &&
        p.columns.every((c, i) => c === l.legacyColumns[i])
      );
    });
    if (present.length === 0) continue;
    for (const n of present) explained.add(n);
    out.push({
      kind: 'index_mismatch',
      remoteName: table,
      table,
      column: l.column,
      expected: indexSignature(l.replacement.columns, true, l.replacement.nullSafeColumns),
      actual: indexSignature(l.legacyColumns, true),
      severity: 'warning',
      category: 'safe',
      op: {
        type: 'replace_unique_index',
        table,
        column: l.column,
        dropIndexNames: present,
        createIndexName: l.replacement.name,
        createColumns: l.replacement.columns,
        ...(l.replacement.nullSafeColumns ? { nullSafeColumns: l.replacement.nullSafeColumns } : {}),
      },
      message:
        `${table}.${l.legacyColumns.join('+')}: a legacy platform-wide UNIQUE index (${present.join(', ')}) still enforces ` +
        `uniqueness across ALL tenants, but metadata scopes it per '${l.replacement.columns[0]}' — a second ` +
        `tenant reusing the value is rejected on insert (#3696). Replacing it with ${indexSignature(l.replacement.columns, true, l.replacement.nullSafeColumns)} ` +
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
        expected: indexSignature(e.columns, e.unique, e.nullSafeColumns),
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
          ...(e.nullSafeColumns ? { nullSafeColumns: e.nullSafeColumns } : {}),
        },
        message:
          `${table}: metadata declares index '${e.name}' ${indexSignature(e.columns, e.unique, e.nullSafeColumns)} but the database ` +
          `has no such index — run "os migrate apply" to create it.`,
      });
      continue;
    }
    // Same normalization on BOTH sides (#4884, ADR-0120 D3): column identity
    // AND key-part form, literal-agnostic on the COALESCE literal.
    if (
      p.unique === e.unique &&
      canonicalIndexKey(p.columns, p.nullSafeColumns) === canonicalIndexKey(e.columns, e.nullSafeColumns)
    ) {
      continue;
    }
    // The framework's own runtime migrations own some declared names — ADR-0048
    // rebuilds `idx_sys_metadata_overlay_active` as a partial UNIQUE over
    // `COALESCE(package_id,'')`, and `sys-metadata.object.ts` says in so many
    // words that its four-column declaration is "the fallback shape for drivers
    // without the runtime migration". Proposing a rebuild FROM that fallback
    // would replace a stronger index with a weaker one, under a remedy
    // (`recreate_index` → drop first) this differ cannot undo. Not ours to
    // reconcile (#4884).
    if (isRuntimeManagedIndex(p, runtimeCreated, tenantField)) continue;
    // Same name, different definition. `syncDeclaredIndexes` skips by name, so
    // this never self-heals: it has to be dropped and rebuilt. Tightening to
    // UNIQUE is destructive — the CREATE can fail on existing duplicates, and
    // by then the old index is already gone.
    //
    // ADR-0120 D4: ONE redefinition is data-dependent rather than structural —
    // the bare organization composite tightening into its NULL-safe COALESCE
    // form (same identities, same uniqueness, physical fully plain). It is
    // marked so the driver can run the duplicate pre-flight probe on it:
    // clean → recategorised `safe` (dev autoMigrate may apply); duplicates →
    // blocked with a row report, the old index left in place.
    const tightenNullSafeOnly =
      e.unique &&
      p.unique &&
      (e.nullSafeColumns?.length ?? 0) > 0 &&
      (p.expressions?.length ?? 0) === 0 &&
      p.partial !== true &&
      p.columns.join(',') === e.columns.join(',');
    out.push({
      kind: 'index_mismatch',
      remoteName: table,
      table,
      column: e.columns[0],
      expected: indexSignature(e.columns, e.unique, e.nullSafeColumns),
      actual: indexSignature(p.columns, p.unique, p.nullSafeColumns),
      severity: e.unique ? 'error' : 'warning',
      category: e.unique ? 'destructive' : 'needs_confirm',
      op: {
        type: 'recreate_index',
        table,
        column: e.columns[0],
        indexName: e.name,
        columns: e.columns,
        unique: e.unique,
        ...(e.nullSafeColumns ? { nullSafeColumns: e.nullSafeColumns } : {}),
        ...(tightenNullSafeOnly ? { tightenNullSafeOnly: true } : {}),
      },
      message: tightenNullSafeOnly
        ? `${table}: index '${e.name}' is ${indexSignature(p.columns, p.unique, p.nullSafeColumns)} but metadata declares ` +
          `${indexSignature(e.columns, e.unique, e.nullSafeColumns)} (ADR-0120 D3: the organization key part is NULL-safe, ` +
          `so rows without an organization are constrained too). Pure tightening — eligibility is decided by the ` +
          `duplicate pre-flight probe.`
        : `${table}: index '${e.name}' is ${indexSignature(p.columns, p.unique, p.nullSafeColumns)} but metadata declares ` +
          `${indexSignature(e.columns, e.unique, e.nullSafeColumns)} — the additive sync skips it by name, so it must be rebuilt` +
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
    if (isRuntimeManagedIndex(p, runtimeCreated, tenantField)) continue;
    out.push({
      kind: 'unmapped_index',
      remoteName: table,
      table,
      column: p.columns[0],
      expected: '(absent)',
      actual: indexSignature(p.columns, p.unique, p.nullSafeColumns),
      severity: 'warning',
      category: 'destructive',
      op: { type: 'drop_index', table, column: p.columns[0], indexName: p.name },
      message:
        `${table}: index '${p.name}' ${indexSignature(p.columns, p.unique, p.nullSafeColumns)} carries ObjectStack's generated naming ` +
        `but matches no declared index (orphaned) — "os migrate apply --allow-destructive" to drop it.`,
    });
  }

  return out;
}
