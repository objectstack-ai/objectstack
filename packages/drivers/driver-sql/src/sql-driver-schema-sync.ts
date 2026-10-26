// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25521 cut 6] The two in-place drift reconcilers of `SqlDriver`'s schema
 * sync — `applyDriftOpInPlace`, which applies one column drift op as a dialect
 * `ALTER` on Postgres and MySQL, and `rebuildSqliteTablePatched`, the SQLite
 * table rebuild that applies a set of them — moved out of `sql-driver.ts`
 * whole. `applyMigrationEntries`, which calls both, stays in the class, as do
 * the members the two bodies call (`applyIndexDriftOp`, `buildRebuiltColumn`,
 * `syncTableIndexes` and the rest).
 *
 * [#25521 cut 8] `applyIndexDriftOp`, which applies one index drift op on
 * every dialect, and `restoreBareIndexAfterFailedTighten`, the restore it runs
 * when a NULL-safe tightening cannot be created after the old index is gone,
 * moved here beside them the same way. The class keeps both methods too, and
 * `SchemaSyncHost` grew by exactly the members these two bodies read. The
 * ADR-0120 tightening ceremony these bodies carry is anchored on this module
 * (`scripts/adr-anchors/`).
 *
 * [#25521 cut 9] The rest of that tightening's machinery joined them the same
 * way: `applyNullSafeUniquePreflight`, the plan-side duplicate pre-flight that
 * clears or blocks a unique index op, and `syncDeclaredIndexes` with
 * `createNullSafeUniqueIndex`, which materialize a table's declared indexes
 * and the expression key of an organization-scoped unique. The class keeps
 * all three methods, and `SchemaSyncHost` grew by exactly the members these
 * bodies read that it did not list yet. `formatDuplicateGroups`, the
 * module-level helper the pre-flight and the sync share for their
 * duplicate-row reports, moved here with its only two callers and stays
 * module-local; the probe itself (`probeNullSafeUniqueDuplicates`) stays in
 * the class. The other declarations these bodies read are imported from the
 * modules that declare them: `normalizeDeclaredIndex`,
 * `describeMissingIndexColumns`, `GLOBAL_TENANT` and `DeclaredIndexInput`
 * from `schema-drift.ts`, `isUniqueViolationError` from `@objectstack/types`.
 *
 * [#25521 cut 10] The drift pipeline that drives all of the above joined them
 * the same way: `detectTableDrift` and `detectTableIndexDrift`, which diff one
 * table's columns and indexes against its physical schema,
 * `detectManagedDrift`, which runs that diff over every managed table,
 * `planMediaColumnMove`, the read-only plan of the media column move,
 * `reconcileAndWarnDrift`, the boot-time reconcile-or-warn, and
 * `applyMigrationEntries`, which applies a set of drift entries. The class
 * keeps all six methods, and `SchemaSyncHost` grew by exactly the members
 * these bodies read that it did not list yet; the fields among them
 * (`autoMigrate`, `driftWarned`, `fileColumnsMoved`, `mediaFields`,
 * `runtimeCreatedIndexes`, `schemaMode`) and the getter `isSqlite` go as
 * getters too. The other declarations these bodies read are imported from the
 * modules that declare them: the differs and their helpers from
 * `schema-drift.ts`, the media column move's statements from
 * `media-column-move.ts`, `StorageNameMapping` from `@objectstack/spec/system`
 * and the type `IntrospectedColumn` from `sql-driver.ts`. `sql-driver.ts` no
 * longer reads `isIndexDriftOp`; its last reader there was
 * `applyMigrationEntries`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name as it stood, re-indented one level and otherwise
 * unedited: the same dialect statements, the same rebuild procedure, the same
 * honoured-entries contract.
 *
 * ## How the moved bodies reach the class
 *
 * The shape `sql-driver-introspection.ts` (cut 1) applies, after #23050. The
 * class keeps both methods, because the published `dist/*.d.ts` lists each
 * one's name, docblock and position, and tests call both on the driver. Each
 * body is now one literal of exactly the {@link SchemaSyncHost} members that
 * method reads, plus a `.call`. The methods are no longer `async`: each
 * returns the moved function's own promise, so a caller awaits the same
 * promise the body settles, with no extra wrapper.
 *
 * The methods the bodies call go as closures that call them on the driver at
 * call time, so a subclass override or a test spy on the instance is still the
 * one the body reaches. The fields `knex`, `logger`, `managedObjectFields` and
 * `managedObjectIndexes`, the getter `dialectName` and the two dialect getters
 * go as GETTERS, so each read happens when the body makes it, as it did on the
 * class; `this.logger.warn(...)` still calls `warn` on the logger itself.
 *
 * The module-level declarations the bodies read, `isIndexDriftOp` and the
 * types `DriftOp` and `ManagedDriftEntry`, live in `schema-drift.ts`, which
 * exports them, and are imported from there; `sql-driver.ts` still reads all
 * three. `index.ts` re-exports nothing from this module, so the published
 * surface does not move.
 */

import { isUniqueViolationError } from '@objectstack/types';
import { StorageNameMapping } from '@objectstack/spec/system';
import { carriesNullSafeTenantKeyPart, ceremonyOwnedDropFinding, describeMissingIndexColumns, diffManagedIndexes, diffManagedTable, diffUnbuildableIndexes, driftKey, expectedIndexes, GLOBAL_TENANT, indexedKeyColumns, isCeremonyOwnedColumnDrop, isIndexDriftOp, legacyUniqueReplacements, normalizeDeclaredIndex, type DeclaredIndexInput, type DriftOp, type ManagedDriftEntry, type PhysicalColumn } from './schema-drift.js';
import { isJsonColumnType, mediaColumnMoveDialect, mediaColumnMovePlan, type MediaColumnMovePlan, type MediaColumnMoveRefusal, type MediaColumnMoveScan } from './media-column-move.js';
import type { IntrospectedColumn, SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface SchemaSyncHost {
  applyDeclaredColumnDefault: SqlDriver['applyDeclaredColumnDefault'];
  applyDriftOpInPlace: SqlDriver['applyDriftOpInPlace'];
  applyIndexDriftOp: SqlDriver['applyIndexDriftOp'];
  applyMigrationEntries: SqlDriver['applyMigrationEntries'];
  applyNullSafeUniquePreflight: SqlDriver['applyNullSafeUniquePreflight'];
  assertSchemaMutable: SqlDriver['assertSchemaMutable'];
  readonly autoMigrate: SqlDriver['autoMigrate'];
  buildRebuiltColumn: SqlDriver['buildRebuiltColumn'];
  createHashShadowUniqueIndex: SqlDriver['createHashShadowUniqueIndex'];
  createNullSafeUniqueIndex: SqlDriver['createNullSafeUniqueIndex'];
  detectTableDrift: SqlDriver['detectTableDrift'];
  detectTableIndexDrift: SqlDriver['detectTableIndexDrift'];
  readonly dialectName: SqlDriver['dialectName'];
  readonly driftWarned: SqlDriver['driftWarned'];
  dropIndexIfExists: SqlDriver['dropIndexIfExists'];
  dropOrphanedHashShadowColumn: SqlDriver['dropOrphanedHashShadowColumn'];
  explainUnkeyableTextColumn: SqlDriver['explainUnkeyableTextColumn'];
  readonly fileColumnsMoved: SqlDriver['fileColumnsMoved'];
  getExistingIndexNames: SqlDriver['getExistingIndexNames'];
  introspectColumns: SqlDriver['introspectColumns'];
  introspectIndexes: SqlDriver['introspectIndexes'];
  readonly isMysql: SqlDriver['isMysql'];
  readonly isPostgres: SqlDriver['isPostgres'];
  isProductionEnv: SqlDriver['isProductionEnv'];
  readonly isSqlite: SqlDriver['isSqlite'];
  isTenantKeyCertified: SqlDriver['isTenantKeyCertified'];
  readonly knex: SqlDriver['knex'];
  logDurabilityFailure: SqlDriver['logDurabilityFailure'];
  readonly logger: SqlDriver['logger'];
  readonly managedObjectFields: SqlDriver['managedObjectFields'];
  readonly managedObjectIndexes: SqlDriver['managedObjectIndexes'];
  readonly mediaFields: SqlDriver['mediaFields'];
  nowColumnDefault: SqlDriver['nowColumnDefault'];
  probeNullSafeUniqueDuplicates: SqlDriver['probeNullSafeUniqueDuplicates'];
  rebuildSqliteTablePatched: SqlDriver['rebuildSqliteTablePatched'];
  resolveTenantField: SqlDriver['resolveTenantField'];
  restoreBareIndexAfterFailedTighten: SqlDriver['restoreBareIndexAfterFailedTighten'];
  readonly runtimeCreatedIndexes: SqlDriver['runtimeCreatedIndexes'];
  readonly schemaMode: SqlDriver['schemaMode'];
  syncDeclaredIndexes: SqlDriver['syncDeclaredIndexes'];
  syncTableIndexes: SqlDriver['syncTableIndexes'];
  varcharColumnChars: SqlDriver['varcharColumnChars'];
}

/**
 * Render the duplicate groups a unique pre-flight probe found, for an operator
 * message: at most five groups, then a count of the rest.
 *
 * Module-local on purpose (commit 61821e54c). The two sites that report a blocked unique
 * — the drift entry and the boot-time durability log — must name the SAME rows
 * in the SAME shape, and a second hand-rolled `.slice(0, 5).join('; ')` is
 * exactly how the plain and the NULL-safe path drifted apart in the first
 * place. Not a method, and not exported: `SqlDriver`'s `.d.ts` carries its
 * protected members, so a new method there would move a published entry point
 * for a string helper.
 */
function formatDuplicateGroups(duplicates: ReadonlyArray<{ key: string; rows: number }>): string {
  const shown = duplicates
    .slice(0, 5)
    .map((g) => `(${g.key}) \u00d7 ${g.rows} rows`)
    .join('; ');
  return duplicates.length > 5 ? `${shown}; \u2026and ${duplicates.length - 5} more group(s)` : shown;
}

/** The body of `SqlDriver#applyNullSafeUniquePreflight`; the method's docblock there is its contract. */
export async function applyNullSafeUniquePreflight(this: Pick<SchemaSyncHost, 'logger' | 'probeNullSafeUniqueDuplicates'>, entries: ManagedDriftEntry[]): Promise<void> {
  for (const d of entries) {
    const op = d.op;
    if (op.type !== 'recreate_index' && op.type !== 'create_index') continue;
    if (!op.unique) continue;
    const nullSafeColumns = op.nullSafeColumns ?? [];
    const nullSafeKey = nullSafeColumns.length > 0;
    const tighten = op.type === 'recreate_index' && op.tightenNullSafeOnly === true;
    // A generic unique recreate (columns differ beyond the key-part form)
    // keeps its pre-ADR-0120 semantics untouched.
    if (op.type === 'recreate_index' && !tighten) continue;
    // …and a PLAIN unique has no tightening shape at all, so only its CREATE
    // reaches the probe (commit 61821e54c).
    if (!nullSafeKey && op.type !== 'create_index') continue;

    let duplicates: Array<{ key: string; rows: number }>;
    try {
      duplicates = await this.probeNullSafeUniqueDuplicates(op.table, op.columns, nullSafeColumns);
    } catch (e: any) {
      // Probe failure must fail SAFE: without evidence the data is clean the
      // op may not claim eligibility for auto-apply.
      this.logger.warn(
        `[schema-drift] duplicate pre-flight for '${op.indexName}' on '${op.table}' failed — leaving the op gated`,
        e?.message ?? e,
      );
      continue;
    }

    const signature = d.expected;
    if (duplicates.length === 0) {
      if (tighten) {
        d.category = 'safe';
        d.severity = 'warning';
        d.message =
          `${op.table}: index '${op.indexName}' tightens to ${signature} — the organization key part becomes ` +
          `NULL-safe (ADR-0120 D3), so rows without an organization are constrained too. The duplicate ` +
          `pre-flight probe found no conflicting rows: pure tightening, applied by "os migrate apply" ` +
          `(auto-applied at boot under dev autoMigrate: 'safe').`;
      }
      continue;
    }

    const report = formatDuplicateGroups(duplicates);
    d.category = 'destructive';
    d.severity = 'error';
    // The block, declared on the entry: `os migrate plan` / `apply` read it
    // here and never offer `--allow-destructive` for an op the apply refuses
    // on this data however it is confirmed.
    d.applyLimit = `existing rows already violate the unique key: ${report}`;
    d.message = nullSafeKey
      ? `${op.table}: cannot ${tighten ? 'tighten' : 'create'} '${op.indexName}' as ${signature} — existing rows ` +
        `already violate the NULL-safe unique constraint (duplicates the old index wrongly admitted: SQL ` +
        `UNIQUE is NULL-distinct, so it never constrained rows without an organization): ` +
        `${report}. The op is BLOCKED: apply re-probes and refuses, and the existing index stays in place ` +
        `(ADR-0120 D4). Deduplicate the listed rows, then re-run "os migrate plan".`
      : // Commit 61821e54c: the plain unique has no #5030 history behind it — nothing
        // ever admitted these rows, the constraint is simply newly declared
        // over data that does not satisfy it. So the message says what IS
        // true, and above all withdraws the `safe` claim: this op is not
        // applied by `os migrate apply` and not auto-applied at boot.
        `${op.table}: cannot create '${op.indexName}' as ${signature} — existing rows already violate it: ` +
        `${report}. The op is BLOCKED: neither "os migrate apply" nor dev autoMigrate: 'safe' will create it, ` +
        `so the constraint is NOT enforced. Deduplicate the listed rows, then re-run "os migrate plan" ` +
        `(ADR-0120 D4).`;
  }
}

/** The body of `SqlDriver#applyIndexDriftOp`; the method's docblock there is its contract. */
export async function applyIndexDriftOp(this: Pick<SchemaSyncHost, 'dropIndexIfExists' | 'dropOrphanedHashShadowColumn' | 'getExistingIndexNames' | 'knex' | 'logDurabilityFailure' | 'logger' | 'probeNullSafeUniqueDuplicates' | 'restoreBareIndexAfterFailedTighten' | 'syncDeclaredIndexes'>, op: DriftOp): Promise<boolean> {
  // REPORT ONLY: there is no column to build the index over, so no DDL can
  // apply it and the remedy is a metadata edit. Answered before any read, and
  // on every dialect, so `applyMigrationEntries` reports it `skipped`. The
  // `default` arm below would say the same; this names the reason.
  if (op.type === 'unbuildable_index') return false;
  const physicalColumns = new Set(Object.keys(await this.knex(op.table).columnInfo()));
  const ensure = (name: string, columns: string[], unique: boolean, nullSafeColumns?: string[]) =>
    this.syncDeclaredIndexes(op.table, [{ name, fields: columns, unique, nullSafeColumns }], physicalColumns);

  switch (op.type) {
    case 'replace_unique_index': {
      // CREATE before DROP: the composite and the legacy index have different
      // names, so uniqueness is never unenforced in between. If the create
      // fails we have not dropped anything yet and the schema is untouched.
      await ensure(op.createIndexName, op.createColumns, true, op.nullSafeColumns);
      // …and only drop once the replacement is confirmed present. This is a
      // relaxation, not a removal: if `syncDeclaredIndexes` skipped the create
      // (a column it references is not materialized), dropping the legacy
      // index would leave the field with NO uniqueness at all.
      if (!(await this.getExistingIndexNames(op.table)).has(op.createIndexName)) {
        this.logger.warn(
          `[schema-drift] keeping legacy unique index(es) ${op.dropIndexNames.join(', ')} on '${op.table}' — ` +
            `the replacement '${op.createIndexName}' could not be created.`,
        );
        return false;
      }
      for (const name of op.dropIndexNames) {
        await this.dropIndexIfExists(op.table, name);
      }
      return true;
    }
    case 'create_index':
      await ensure(op.indexName, op.columns, op.unique, op.nullSafeColumns);
      // Honest applied-reporting: `syncDeclaredIndexes` degrades some
      // failures (a NULL-safe unique over data that still violates it) into
      // a loud log instead of a throw, so presence is the only proof.
      return (await this.getExistingIndexNames(op.table)).has(op.indexName);
    case 'drop_index': {
      // #13056: a TERMINAL removal — the name is retired, nothing will
      // re-declare it, and the #11627 hash shadow derived from that name is
      // dead the moment the index goes. Index FIRST, then the column it
      // keyed: MySQL refuses to drop a column a key still uses, and the
      // reverse order would take the constraint down with the column while
      // the operator was told only that an index was dropped.
      //
      // ⚠️ Deliberately HERE and not inside `dropIndexIfExists`. That helper
      // has two other callers and neither is terminal: `recreate_index`
      // drops in order to re-create under the SAME name — routing it through
      // this cleanup would destroy the survivor commit cd1348802's `reusable` branch
      // exists to re-key in place, turning every rebuild into a full
      // regeneration of a STORED generated column — and
      // `replace_unique_index` cannot reach a shadow at all (its legacy
      // detection excludes `isHashShadowCarrier`, stated outright in
      // `diffManagedIndexes` precisely because that op DROPS the legacy
      // name). "Which caller" is the wrong axis; "is this name coming back"
      // is the right one, and only the op knows.
      const dropped = await this.dropIndexIfExists(op.table, op.indexName);
      // Applied when EITHER half changed the table. A half-applied migration
      // leaves the index gone and the column behind, so an already-absent
      // index is exactly the state whose leftover column still needs
      // collecting — reporting that as `skipped` would claim the apply did
      // nothing to a table it had just rewritten.
      const shadowDropped = await this.dropOrphanedHashShadowColumn(op.table, op.indexName);
      return dropped || shadowDropped;
    }
    case 'recreate_index': {
      // Same name on both sides — the drop has to come first, and a UNIQUE
      // target can fail on existing duplicates. That is why this op is
      // categorised destructive when unique (see `diffManagedIndexes`).
      //
      // ADR-0120 D4: the NULL-safe tightening re-runs the duplicate
      // pre-flight HERE, immediately before the drop — the plan-time probe
      // may be stale, and at no point may a constraint be dropped without
      // its replacement being creatable. Duplicates → refuse, old index
      // untouched.
      const nullSafe = op.unique && (op.nullSafeColumns?.length ?? 0) > 0;
      if (nullSafe) {
        const duplicates = await this.probeNullSafeUniqueDuplicates(
          op.table,
          op.columns,
          op.nullSafeColumns!,
        );
        if (duplicates.length > 0) {
          this.logDurabilityFailure(
            `[schema-drift] REFUSING to rebuild '${op.indexName}' on '${op.table}' as a NULL-safe unique — ` +
              `${duplicates.length} duplicate group(s) violate it (e.g. ${duplicates[0].key} × ${duplicates[0].rows} rows). ` +
              `The existing index is left in place; deduplicate and re-run "os migrate plan" (ADR-0120 D4).`,
          );
          return false;
        }
      }
      await this.dropIndexIfExists(op.table, op.indexName);
      try {
        await ensure(op.indexName, op.columns, op.unique, op.nullSafeColumns);
      } catch (e) {
        if (nullSafe) await this.restoreBareIndexAfterFailedTighten(op, e);
        throw e;
      }
      const present = (await this.getExistingIndexNames(op.table)).has(op.indexName);
      if (!present && nullSafe) await this.restoreBareIndexAfterFailedTighten(op, undefined);
      return present;
    }
    default:
      return false;
  }
}

/** The body of `SqlDriver#restoreBareIndexAfterFailedTighten`; the method's docblock there is its contract. */
export async function restoreBareIndexAfterFailedTighten(this: Pick<SchemaSyncHost, 'getExistingIndexNames' | 'knex' | 'logDurabilityFailure' | 'syncDeclaredIndexes'>, op: Extract<DriftOp, { type: 'recreate_index' }>, cause: unknown): Promise<void> {
  try {
    await this.syncDeclaredIndexes(
      op.table,
      [{ name: op.indexName, fields: op.columns, unique: op.unique }],
      new Set(Object.keys(await this.knex(op.table).columnInfo())),
    );
  } catch {
    /* the error below reports the state either way */
  }
  const restored = (await this.getExistingIndexNames(op.table)).has(op.indexName);
  this.logDurabilityFailure(
    `[schema-drift] could not create the NULL-safe unique '${op.indexName}' on '${op.table}' after dropping ` +
      `the old index${restored ? ' — restored the previous bare composite' : ' — AND the restore failed, so the ' +
      'constraint is currently NOT enforced'}. Rows without an organization are ${restored ? 'still ' : ''}not ` +
      `constrained, because SQL UNIQUE is NULL-distinct; re-run "os migrate plan" and apply the reported op (ADR-0120 D4).`,
    (cause as any)?.message ?? cause,
  );
}

/** The body of `SqlDriver#applyDriftOpInPlace`; the method's docblock there is its contract. */
export async function applyDriftOpInPlace(this: Pick<SchemaSyncHost, 'applyIndexDriftOp' | 'dialectName' | 'isMysql' | 'isPostgres' | 'knex' | 'logger'>, op: DriftOp): Promise<boolean> {
  // Index ops need no dialect-specific ALTER — route them to the portable path.
  if (isIndexDriftOp(op)) return this.applyIndexDriftOp(op);
  const { table, column } = op;
  if (this.isPostgres) {
    switch (op.type) {
      case 'relax_not_null':
        await this.knex.raw('ALTER TABLE ?? ALTER COLUMN ?? DROP NOT NULL', [table, column]);
        return true;
      case 'tighten_not_null':
        await this.knex.raw('ALTER TABLE ?? ALTER COLUMN ?? SET NOT NULL', [table, column]);
        return true;
      case 'widen_varchar':
      case 'narrow_varchar':
        await this.knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? TYPE varchar(${op.to})`, [table, column]);
        return true;
      case 'drop_column':
        await this.knex.raw('ALTER TABLE ?? DROP COLUMN ??', [table, column]);
        return true;
      case 'drop_column_default':
        await this.knex.raw('ALTER TABLE ?? ALTER COLUMN ?? DROP DEFAULT', [table, column]);
        return true;
    }
  }
  if (this.isMysql) {
    // MySQL MODIFY restates the FULL column definition — reconstruct the
    // type (with length for char types, so a nullability change never
    // silently drops a varchar's declared length) from columnInfo.
    const info: any = await this.knex(table).columnInfo();
    const ci: any = info?.[column];
    const colType: string | undefined = ci?.type
      ? (/char/i.test(ci.type) && ci.maxLength ? `${ci.type}(${ci.maxLength})` : ci.type)
      : undefined;
    switch (op.type) {
      case 'relax_not_null':
        if (!colType) return false;
        await this.knex.raw(`ALTER TABLE ?? MODIFY ?? ${colType} NULL`, [table, column]);
        return true;
      case 'tighten_not_null':
        if (!colType) return false;
        await this.knex.raw(`ALTER TABLE ?? MODIFY ?? ${colType} NOT NULL`, [table, column]);
        return true;
      case 'widen_varchar':
      case 'narrow_varchar':
        await this.knex.raw(`ALTER TABLE ?? MODIFY ?? varchar(${op.to})`, [table, column]);
        return true;
      case 'drop_column':
        await this.knex.raw('ALTER TABLE ?? DROP COLUMN ??', [table, column]);
        return true;
      case 'drop_column_default':
        // `ALTER … ALTER COLUMN … DROP DEFAULT` — the one ALTER COLUMN form
        // MySQL accepts without restating the type, so it cannot lose a
        // varchar length the way MODIFY can.
        await this.knex.raw('ALTER TABLE ?? ALTER COLUMN ?? DROP DEFAULT', [table, column]);
        return true;
    }
  }
  this.logger.warn(`[schema-drift] ${op.type} on ${table}.${column} is unsupported on dialect '${this.dialectName}' — skipped`);
  return false;
}

/** The body of `SqlDriver#rebuildSqliteTablePatched`; the method's docblock there is its contract. */
export async function rebuildSqliteTablePatched(this: Pick<SchemaSyncHost, 'applyDeclaredColumnDefault' | 'buildRebuiltColumn' | 'introspectColumns' | 'knex' | 'logger' | 'managedObjectFields' | 'managedObjectIndexes' | 'nowColumnDefault' | 'resolveTenantField' | 'syncTableIndexes'>, table: string, ents: ManagedDriftEntry[]): Promise<ManagedDriftEntry[]> {
  const relax = new Set<string>();
  const tighten = new Set<string>();
  const drop = new Set<string>();
  const dropDefault = new Set<string>();
  // The entries this rebuild ACTS on, filled by the same pass that fills the
  // four sets — deliberately not a second list of op types to keep in sync
  // with the branches below. An entry is honoured if and only if one of those
  // branches took it, so the returned set cannot drift from the work done.
  const honoured: ManagedDriftEntry[] = [];
  for (const e of ents) {
    if (e.op.type === 'relax_not_null') relax.add(e.op.column);
    else if (e.op.type === 'tighten_not_null') tighten.add(e.op.column);
    else if (e.op.type === 'drop_column') drop.add(e.op.column);
    else if (e.op.type === 'drop_column_default') dropDefault.add(e.op.column);
    // Everything else is IGNORED here and must be reported as such (#11722):
    // widen/narrow varchar (SQLite ignores declared length — nothing to do),
    // `manual_column_type_change` (no reconciler arm on ANY dialect, by
    // decision), and any column op added later, which lands in this branch by
    // default rather than being silently absorbed into `honoured`.
    else continue;
    honoured.push(e);
  }

  const physical = await this.introspectColumns(table);
  const kept = physical.filter((c) => !drop.has(c.name));
  const keptNames = kept.map((c) => c.name);
  const fields = this.managedObjectFields.get(table) ?? {};
  const tmp = `__os_mig_${table}`;

  // FK enforcement must be toggled OUTSIDE the transaction (SQLite ignores
  // the PRAGMA inside one). Off during the swap so the rename doesn't trip
  // any dangling references mid-flight.
  await this.knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await this.knex.transaction(async (trx) => {
      await trx.schema.dropTableIfExists(tmp);
      await trx.schema.createTable(tmp, (t) => {
        for (const c of kept) {
          const col = this.buildRebuiltColumn(t, c);
          if (!col) continue;
          const nullable = relax.has(c.name) ? true : tighten.has(c.name) ? false : c.nullable;
          if (!nullable && c.name !== 'id') col.notNullable();
          if (c.name === 'created_at' || c.name === 'updated_at') {
            // #11321: the SAME canonical default {@link createAuditTimestampColumn}
            // emits, not `knex.fn.now()`. This method is SQLite-only (see the
            // `isSqlite` branch in `applyMigrationEntries`), where
            // `knex.fn.now()` is the zone-naive `CURRENT_TIMESTAMP` — so
            // re-emitting it here would silently REVERT a table that was
            // created with the canonical default the moment any unrelated
            // drift (a relaxed NOT NULL, a dropped column) triggered a
            // rebuild. A rebuild must hand back the column `initObjects`
            // would have built.
            col.defaultTo(this.nowColumnDefault('datetime'));
          } else if (!dropDefault.has(c.name)) {
            // Re-emit the METADATA-declared default. The rebuild dropped the
            // original table, so a column whose default is not restated here
            // comes back without one — which is precisely what a
            // `drop_column_default` op wants, and precisely what a
            // `defaultValue: 'NOW()'` sibling must not suffer.
            const f = (fields as Record<string, any>)[c.name];
            if (f) this.applyDeclaredColumnDefault(col, f, f.type || 'string');
          }
        }
      });
      const colList = keptNames.map((n) => `"${n}"`).join(', ');
      await trx.raw(`INSERT INTO "${tmp}" (${colList}) SELECT ${colList} FROM "${table}"`);
      await trx.schema.dropTable(table);
      await trx.schema.renameTable(tmp, table);
    });
  } finally {
    await this.knex.raw('PRAGMA foreign_keys = ON');
  }

  // Recreate unique constraints + declared indexes from metadata. The rebuild
  // dropped the original table, so every index went with it — this is a fresh
  // materialization, and it must produce the SAME constraints as
  // `initObjects` would. It used to inline its own `uniq_<table>_<col>`
  // single-column DDL, which is how a tenant-scoped field could silently
  // regain a global unique index after any drift rebuild (#3696); both paths
  // now share {@link syncTableIndexes}.
  try {
    const keptSet = new Set(keptNames);
    await this.syncTableIndexes(
      table,
      fields,
      this.managedObjectIndexes.get(table),
      this.resolveTenantField(table),
      keptSet,
    );
  } catch (e: any) {
    this.logger.warn(`[schema-drift] could not fully recreate indexes for '${table}' after rebuild`, e?.message ?? e);
  }

  return honoured;
}

/** The body of `SqlDriver#syncDeclaredIndexes`; the method's docblock there is its contract. */
export async function syncDeclaredIndexes(this: Pick<SchemaSyncHost, 'createHashShadowUniqueIndex' | 'createNullSafeUniqueIndex' | 'explainUnkeyableTextColumn' | 'getExistingIndexNames' | 'knex' | 'logDurabilityFailure' | 'probeNullSafeUniqueDuplicates' | 'resolveTenantField'>, tableName: string, indexes: DeclaredIndexInput[], physicalColumns: Set<string>, tenantField?: string | null, fields?: Record<string, any>): Promise<void> {
  const existing = await this.getExistingIndexNames(tableName);
  const resolvedTenantField = tenantField !== undefined ? tenantField : this.resolveTenantField(tableName);

  for (const idx of indexes) {
    const norm = normalizeDeclaredIndex(tableName, idx, resolvedTenantField);
    if (!norm) continue;
    const { name, columns, unique } = norm;
    const nullSafe = new Set(norm.nullSafeColumns ?? []);

    const missing = columns.filter((f) => !physicalColumns.has(f));
    if (missing.length > 0) {
      // Durability, not function (AGENTS.md "Degradation log levels"): the
      // sync goes on and the object serves normally, while DDL the metadata
      // declares did not run. For a UNIQUE index, that means duplicate rows
      // are accepted. So this goes on the durability channel, like the
      // duplicate-row arms further down this loop. One line per skipped index
      // per sync. It states the consequence and the fix, and says whether
      // the index was UNIQUE (the prose, and `unique` in the meta).
      this.logDurabilityFailure(
        `[sql-driver] declared ${unique ? 'UNIQUE ' : ''}index '${name}' on "${tableName}" was NOT created: ` +
          `no column for ${describeMissingIndexColumns(missing, fields)}. ` +
          (unique
            ? `The uniqueness it declares is NOT enforced: duplicate rows are accepted, and the object keeps ` +
              `working as if the constraint existed. `
            : `The index does not exist, and the object keeps working as if it did. `) +
          `Fix the metadata so every column in the index's fields is a stored field of the object, or ` +
          `remove the index ("os validate" refuses a name that is not a field).`,
        { tableName, index: name, fields: columns, missing, unique },
      );
      continue;
    }

    if (existing.has(name)) continue;

    try {
      if (nullSafe.size > 0) {
        await this.createNullSafeUniqueIndex(tableName, name, columns, nullSafe);
      } else {
        await this.knex.schema.alterTable(tableName, (table) => {
          if (unique) {
            table.unique(columns, { indexName: name });
          } else {
            table.index(columns, name);
          }
        });
      }
      existing.add(name);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      // A concurrent creator or a pre-existing equivalent index under a
      // different name can race us here — both are benign for our intent
      // (the index exists). Anything else is a real failure.
      if (/already exists|duplicate key name|exists/i.test(msg)) continue;
      // The ERROR OBJECT, not `msg` (#6543). This used to be a private
      // inline regex over the message alone, which is the only channel the
      // SQLite family reliably fills — but Postgres answers this exact
      // failure with `could not create unique index "…"` and puts the
      // verdict on `code` (SQLSTATE 23505) instead, so a message-only read
      // missed the dialect entirely and took the boot down on the very case
      // the branch below exists to absorb. The shared predicate reads
      // `code` / `errno` / `message` / `cause`; see
      // `@objectstack/types`' `unique-violation.ts` for why it is the one
      // name for this question.
      // Commit d0e3a885b: MySQL's refusal of a TEXT key part names a column in a table
      // that was just created successfully, which reads as an index quirk
      // rather than what it is — the object is now registered with its
      // declared uniqueness absent. Re-throw the SAME failure carrying the
      // field-level fix; the boot still fails loudly, it just says why.
      const unkeyable = await this.explainUnkeyableTextColumn(tableName, name, columns, e);
      if (unkeyable) {
        // #11627: a UNIQUE index MySQL cannot key directly is expressible
        // after all — over a SHA-256 shadow of the same values. Attempted
        // only AFTER the server has refused the direct index, deliberately:
        // the same reasoning `explainRowSizeOverflow` records for the row
        // budget. A pre-flight would have to reproduce MySQL's 3072-byte key
        // arithmetic and, wrong in the strict direction, would move an object
        // to a shadow key on a server that would have taken the real index —
        // a physical schema decided by our arithmetic rather than by the
        // server's. Reacting to the refusal cannot over-apply, and it is what
        // keeps Postgres and SQLite (which never refuse) byte-identical to
        // before: the dialect divergence is selected BY THE ERROR CODE, never
        // by a dialect getter.
        //
        // ⛔ UNIQUE only. A non-unique index exists for an ACCESS PATH, and an
        // index over a hash serves no lookup the planner can find on its own
        // — `WHERE col = ?` cannot use it without rewriting the read side to
        // filter on the digest too. Silently creating one would turn a loud
        // refusal into a table that syncs, costs writes, and accelerates
        // nothing. Those cases stay refused below, and stay tracked.
        if (unique) {
          try {
            // Commit df1c75c4b: the shadow must hash the DECLARED key, so the NULL-safe
            // organization key parts (ADR-0120 D3) ride along — without them
            // the generation expression hashed the RAW columns, `CONCAT`
            // returned NULL for every NULL-organization row, and the rows the
            // COALESCE bucket exists to constrain were constrained by nothing
            // (#5030's shape, reintroduced by the fallback while the boot log
            // reported the constraint as carried).
            if (await this.createHashShadowUniqueIndex(tableName, name, columns, nullSafe)) {
              existing.add(name);
              continue;
            }
          } catch (shadowErr: any) {
            const shadowMsg = String(shadowErr?.message ?? shadowErr);
            if (/already exists|duplicate key name/i.test(shadowMsg)) {
              existing.add(name);
              continue;
            }
            if (nullSafe.size > 0 && isUniqueViolationError(shadowErr)) {
              // Commit df1c75c4b: the shadow ALTER computes the generated column for the
              // EXISTING rows, so a database that accumulated duplicates under
              // the NULL-safe key while the constraint was void fails here
              // with a uniqueness violation — the same data-dependent
              // #5030-made-visible case the direct route handles below. Same
              // disposition: do not take the boot down, name what collided
              // and what fixes it, and let the ADR-0120 D4 drift pre-flight
              // keep reporting the exact rows.
              let report = '';
              try {
                const duplicates = await this.probeNullSafeUniqueDuplicates(tableName, columns, [
                  ...nullSafe,
                ]);
                if (duplicates.length > 0) {
                  report = ` Conflicting group(s): ${formatDuplicateGroups(duplicates)}.`;
                }
              } catch {
                // The probe is a diagnostic; the refusal below stands without it.
              }
              this.logDurabilityFailure(
                `[sql-driver] cannot create hash-shadow unique index '${name}' on "${tableName}" — ` +
                  `existing rows violate the NULL-safe key (duplicates the previous void constraint ` +
                  `admitted: SQL UNIQUE is NULL-distinct, so it never constrained rows without an organization).${report} The constraint '${columns
                    .map((c) => (nullSafe.has(c) ? `COALESCE(${c}, '${GLOBAL_TENANT}')` : c))
                    .join(', ')}' is NOT enforced until the data is deduplicated: run "os migrate plan" ` +
                  `for the conflicting rows (ADR-0120 D4).`,
                shadowMsg,
              );
              continue;
            }
            if (isUniqueViolationError(shadowErr)) {
              // #15479 — the PLAIN unique on the SHADOW route: no
              // organization key part at all (`tenancy: { enabled: false }`
              // or an explicit `unique: 'global'`), reached here because
              // MySQL refused to key the column directly. The uniqueness
              // limb is supplied by the enclosing `if (unique)` a few lines
              // above, which is why this asks only the violation question --
              // the same load-bearing role the explicit `unique &&` limb
              // plays on the direct arm below, where no enclosing block
              // supplies it.
              //
              // This branch used to be part of the NULL-safe one above,
              // behind `nullSafe.size > 0`, so with no organization key part
              // NOTHING fired: the code fell through to
              // `logDurabilityFailure(unkeyable, msg)` + `throw` and the boot
              // DIED carrying `ER_BLOB_KEY_WITHOUT_LENGTH` -- a message about
              // an unkeyable TEXT column, telling the operator to declare a
              // `maxLength` the field already declares, naming NO rows and NO
              // remedy -- while the actual cause was duplicate rows. Commit 61821e54c
              // fixed exactly that on the direct arm; the two arms of one
              // `catch` then disagreed about one question.
              //
              // The message is deliberately NOT the NULL-safe one above.
              // Neither of its clauses is true here: nothing "admitted" these
              // rows (there was no previous void constraint, #5030), and
              // there is no NULL-safe key. Widening the guard while keeping
              // one message would ship a factually FALSE durability log --
              // worse than the throw it replaces, because it sends the
              // operator hunting a NULL-distinct index that never existed.
              // The sentence below is the direct arm's, verbatim; only the
              // route noun ("hash-shadow") is this arm's own, because it is
              // what honestly names which physical route was attempted, and
              // the NULL-safe branch above already spells it that way.
              let report = '';
              try {
                const duplicates = await this.probeNullSafeUniqueDuplicates(tableName, columns, []);
                if (duplicates.length > 0) {
                  report = ` Conflicting group(s): ${formatDuplicateGroups(duplicates)}.`;
                }
              } catch {
                // The probe is a diagnostic; the report below stands without it.
              }
              this.logDurabilityFailure(
                `[sql-driver] cannot create hash-shadow unique index '${name}' on "${tableName}" — existing ` +
                  `rows violate it.${report} The constraint '${columns.join(', ')}' is NOT enforced until the ` +
                  `data is deduplicated: run "os migrate plan" for the conflicting rows.`,
                shadowMsg,
              );
              continue;
            }
            // Fall through to the named refusal, which is still the honest
            // outcome — but say that the shadow route was tried and why it
            // did not land, so this does not read as never having been
            // attempted.
            this.logDurabilityFailure(
              `[sql-driver] hash-shadow UNIQUE index '${name}' on "${tableName}" could not be created; ` +
                `falling back to the refusal below.`,
              shadowMsg,
            );
          }
        }
        this.logDurabilityFailure(unkeyable, msg);
        throw Object.assign(new Error(`${unkeyable} (server said: ${msg})`), {
          code: (e as { code?: string }).code,
          cause: e,
        });
      }
      if (nullSafe.size > 0 && isUniqueViolationError(e)) {
        // Existing rows violate the NULL-safe unique — the #5030 defect made
        // visible. Do not take the boot down: the declared constraint is not
        // enforced yet, say so at `error` (from the outside everything looks
        // normal), and let the D4 drift pre-flight report the exact rows.
        this.logDurabilityFailure(
          `[sql-driver] cannot create NULL-safe unique index '${name}' on "${tableName}" — existing rows ` +
            `violate it (duplicates the previous NULL-distinct index admitted: it never constrained rows ` +
            `without an organization). The constraint ` +
            `'${columns.join(', ')}' is NOT enforced until the data is deduplicated: run "os migrate plan" ` +
            `for the conflicting rows (ADR-0120 D4).`,
          msg,
        );
        continue;
      }
      if (unique && isUniqueViolationError(e)) {
        // Commit 61821e54c — the PLAIN unique: no organization key part at all, reached
        // by `tenancy: { enabled: false }` or by an explicit
        // `unique: 'global'`. It used to fall through to `throw e`, so the
        // boot DIED carrying the database's own error, which names the index
        // and the column and NO rows and NO remedy — while the arm above,
        // one branch away, kept the boot up and told the operator exactly
        // what to do. Same defect, same disposition: the declared constraint
        // is not enforced, say so on the durability channel, name the
        // conflicting groups, and let the boot continue. The D4 pre-flight
        // reports the same rows in `os migrate plan`.
        //
        // ⚠️ The `unique` limb is load-bearing, not decoration. A NON-unique
        // index cannot raise a uniqueness violation, so a failure that reads
        // as one while creating a non-unique index is something else
        // entirely and must keep failing loudly rather than being absorbed
        // into a log line here.
        let report = '';
        try {
          const duplicates = await this.probeNullSafeUniqueDuplicates(tableName, columns, []);
          if (duplicates.length > 0) {
            report = ` Conflicting group(s): ${formatDuplicateGroups(duplicates)}.`;
          }
        } catch {
          // The probe is a diagnostic; the report below stands without it.
        }
        this.logDurabilityFailure(
          `[sql-driver] cannot create unique index '${name}' on "${tableName}" — existing rows violate ` +
            `it.${report} The constraint '${columns.join(', ')}' is NOT enforced until the data is ` +
            `deduplicated: run "os migrate plan" for the conflicting rows.`,
          msg,
        );
        continue;
      }
      throw e;
    }
  }
}

/** The body of `SqlDriver#createNullSafeUniqueIndex`; the method's docblock there is its contract. */
export async function createNullSafeUniqueIndex(this: Pick<SchemaSyncHost, 'isMysql' | 'knex' | 'logDurabilityFailure'>, tableName: string, name: string, columns: string[], nullSafe: ReadonlySet<string>): Promise<void> {
  const q = (id: string) => this.knex.ref(id).toQuery();
  const parts = columns.map((c) => {
    if (!nullSafe.has(c)) return q(c);
    const expr = `COALESCE(${q(c)}, '${GLOBAL_TENANT}')`;
    return this.isMysql ? `(${expr})` : expr;
  });
  const sql = `CREATE UNIQUE INDEX ${q(name)} ON ${q(tableName)} (${parts.join(', ')})`;
  try {
    await this.knex.raw(sql);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // The positive limb is this site's own question — "does this server
    // reject functional key parts?" — and stays a message test, because
    // that is the only channel the answer is on. The NEGATIVE limb was a
    // seventh spelling of the unique-violation vocabulary (`/duplicate/i`)
    // and is now the shared predicate (#6543): a conflict must never be
    // read as a syntax rejection and silently degraded to the bare
    // composite, and on the `errno`-only shape mysql2 can hand back, a
    // message-only exclusion did not fire.
    const functionalUnsupported =
      this.isMysql && /syntax|functional|not supported|near '\(/i.test(msg) && !isUniqueViolationError(e);
    if (!functionalUnsupported) throw e;
    this.logDurabilityFailure(
      `[sql-driver] this MySQL/MariaDB server rejects functional key parts — created '${name}' on ` +
        `"${tableName}" over the BARE columns instead. Rows without an organization are NOT constrained ` +
        `by it (SQL UNIQUE is NULL-distinct): upgrade to MySQL >= 8.0.13 and re-run "os migrate plan" to tighten it (ADR-0120 D3).`,
      msg,
    );
    await this.knex.schema.alterTable(tableName, (table) => {
      table.unique(columns, { indexName: name });
    });
  }
}

/** The body of `SqlDriver#detectTableDrift`; the method's docblock there is its contract. */
export async function detectTableDrift(this: Pick<SchemaSyncHost, 'detectTableIndexDrift' | 'dialectName' | 'fileColumnsMoved' | 'introspectColumns' | 'resolveTenantField' | 'varcharColumnChars'>, tableName: string, fields: Record<string, any>, declaredIndexes?: any[]): Promise<ManagedDriftEntry[]> {
  const cols = await this.introspectColumns(tableName);
  const physical: PhysicalColumn[] = cols.map((c) => ({
    name: c.name,
    type: c.type,
    nullable: c.nullable,
    maxLength: c.maxLength,
    // The raw, dialect-decorated DEFAULT — the only evidence that a column was
    // created by a build which turned a `defaultValue` runtime token into a
    // literal (#4560).
    defaultValue: c.defaultValue,
  }));
  // #12732: `diffManagedTable`'s varchar-length branch asks `createColumn`'s
  // own read-only mirror (`varcharColumnChars`) whether it would even build
  // a varchar for a given field — and for the text family that answer needs
  // keyedness (commit d0e3a885b), the same input `initObjects` / `ensureShardTable`
  // already resolve via `indexedKeyColumns` before any DDL. Resolved here
  // too so the DIFFER'S expectation, not only the DDL, agrees with keyed
  // columns.
  const keyedColumns = indexedKeyColumns({
    table: tableName,
    fields,
    tenantField: this.resolveTenantField(tableName),
    declaredIndexes,
  });
  const out = diffManagedTable({
    table: tableName,
    fields,
    columns: physical,
    dialect: this.dialectName,
    keyedColumns,
    varcharColumnChars: (field, keyed) => this.varcharColumnChars(field, keyed),
    // ADR-0104: the media family's column shape is this deployment's fact,
    // not the type's — the differ must ask the arm the emitter just used.
    fileColumnsMoved: this.fileColumnsMoved,
    // ADR-0131 D10 (ruling record 6269955919, ② A): the tenant column's
    // NOT NULL is the organization-ownership ceremony's, not drift.
    ceremonyOwnedNullability: this.resolveTenantField(tableName),
  });
  // [ADR-0131 D1] A physically NOT NULL tenant column is its own proof that
  // the NULL-safe and the plain tenant key part are one constraint here.
  const tenantField = this.resolveTenantField(tableName);
  const tenantColumnNotNull = !!tenantField && cols.some((c) => c.name === tenantField && c.nullable === false);
  out.push(
    ...(await this.detectTableIndexDrift(
      tableName,
      fields,
      declaredIndexes,
      new Set(cols.map((c) => c.name)),
      tenantColumnNotNull,
    )),
  );
  return out;
}

/** The body of `SqlDriver#detectTableIndexDrift`; the method's docblock there is its contract. */
export async function detectTableIndexDrift(this: Pick<SchemaSyncHost, 'applyNullSafeUniquePreflight' | 'introspectIndexes' | 'isTenantKeyCertified' | 'resolveTenantField' | 'runtimeCreatedIndexes'>, tableName: string, fields: Record<string, any>, declaredIndexes: any[] | undefined, physicalColumns: Set<string>, tenantColumnNotNull = false): Promise<ManagedDriftEntry[]> {
  const tenantField = this.resolveTenantField(tableName);
  const physical = await this.introspectIndexes(tableName);
  const tenantKeyCertified =
    tenantColumnNotNull ||
    (carriesNullSafeTenantKeyPart(physical, tenantField) && (await this.isTenantKeyCertified()));
  const entries = diffManagedIndexes({
    table: tableName,
    expected: expectedIndexes({ table: tableName, fields, tenantField, declaredIndexes, physicalColumns }),
    // `declaredIndexes` goes to BOTH: it is what the table should have, and
    // therefore also what must never be mistaken for legacy debt (#3955).
    legacy: legacyUniqueReplacements({ table: tableName, fields, tenantField, physicalColumns, declaredIndexes }),
    physical,
    // Indexes the framework built through raw DDL on this boot are its own to
    // manage — never this differ's to propose dropping (#4884).
    runtimeCreated: this.runtimeCreatedIndexes.get(tableName),
    // Lets the differ recognise the NULL-safe organization key part as the
    // sync's own vocabulary (ADR-0120 D3).
    tenantField,
    tenantKeyCertified,
  });
  // ADR-0120 D4: the duplicate pre-flight probe decides each NULL-safe
  // unique op's fate — clean data upgrades the pure tightening to `safe`
  // (dev autoMigrate may apply it); duplicates block the op with a row
  // report. Data-dependent, so it runs HERE, not in the pure differ.
  await this.applyNullSafeUniquePreflight(entries);
  // The declared indexes `expectedIndexes` leaves out because a key column
  // will never materialize (a misspelt name, a virtual `formula` field).
  // `syncDeclaredIndexes` skips each one at `error` on every sync, and this
  // is its plan-side face: a report-only entry, so `os migrate plan` shows
  // the unenforced declaration instead of reporting nothing.
  entries.push(...diffUnbuildableIndexes({ table: tableName, fields, tenantField, declaredIndexes, physicalColumns }));
  return entries;
}

/** The body of `SqlDriver#detectManagedDrift`; the method's docblock there is its contract. */
export async function detectManagedDrift(this: Pick<SchemaSyncHost, 'detectTableDrift' | 'knex' | 'managedObjectFields' | 'managedObjectIndexes'>, objects?: Array<{ name: string; fields?: Record<string, any>; indexes?: any[] }>): Promise<ManagedDriftEntry[]> {
  const tables = new Map<string, { fields: Record<string, any>; indexes?: any[] }>();
  if (objects) {
    for (const o of objects) {
      tables.set(StorageNameMapping.resolveTableName(o), {
        fields: o.fields ?? {},
        indexes: o.indexes,
      });
    }
  } else {
    for (const [t, f] of this.managedObjectFields) {
      tables.set(t, { fields: f, indexes: this.managedObjectIndexes.get(t) });
    }
  }

  const out: ManagedDriftEntry[] = [];
  for (const [tableName, meta] of tables) {
    if (!(await this.knex.schema.hasTable(tableName))) continue;
    out.push(...(await this.detectTableDrift(tableName, meta.fields, meta.indexes)));
  }
  out.sort((a, b) => (a.table === b.table ? (a.column ?? '').localeCompare(b.column ?? '') : a.table.localeCompare(b.table)));
  return out;
}

/** The body of `SqlDriver#planMediaColumnMove`; the method's docblock there is its contract. */
export async function planMediaColumnMove(this: Pick<SchemaSyncHost, 'dialectName' | 'introspectColumns' | 'knex' | 'managedObjectFields' | 'mediaFields'>): Promise<MediaColumnMoveScan> {
  const dialect = mediaColumnMoveDialect(this.dialectName);
  if (!dialect) {
    return {
      dialect: this.dialectName,
      plans: [],
      refusals: [
        {
          table: '*',
          column: '*',
          reason: 'dialect_not_supported',
          // ⛔ No tracker id in the string: this `detail` reaches an operator
          // reading a migration report, who has no tracker to resolve one
          // against (`check:doc-authoring`). The card that owns the MySQL
          // leg is #17788; the reader who can resolve that reads this line.
          detail:
            `the ADR-0104 column step has no measured statement for dialect '${this.dialectName}'. ` +
            'The MySQL leg is tracked separately and is settled against a real instance, because ' +
            'its statement ORDER is what the ADR leaves open; no other dialect has been ' +
            'rehearsed. Nothing was planned and nothing ran.',
        },
      ],
    };
  }

  const plans: MediaColumnMovePlan[] = [];
  const refusals: MediaColumnMoveRefusal[] = [];

  for (const [tableName] of this.managedObjectFields) {
    const columns = this.mediaFields[tableName];
    if (!columns || columns.length === 0) continue;
    if (!(await this.knex.schema.hasTable(tableName))) continue;

    let physical: IntrospectedColumn[];
    try {
      physical = await this.introspectColumns(tableName);
    } catch (e: any) {
      refusals.push({
        table: tableName,
        column: '*',
        reason: 'introspection_failed',
        detail:
          `could not read the physical columns of '${tableName}' (${e?.message ?? e}), so the ` +
          'shape of its media columns is unknown and no statement can be chosen for them.',
      });
      continue;
    }
    const byName = new Map(physical.map((c) => [c.name, c]));

    for (const column of columns) {
      const found = byName.get(column);
      if (!found) {
        refusals.push({
          table: tableName,
          column,
          reason: 'column_absent',
          detail:
            `'${tableName}.${column}' is declared as a media field but the datastore has no such ` +
            'column, so there is nothing here to move and nothing that could be verified moved.',
        });
        continue;
      }
      plans.push(
        mediaColumnMovePlan(
          dialect,
          isJsonColumnType(found.type) ? 'retype' : 'unquote',
          tableName,
          column,
        ),
      );
    }
  }

  plans.sort((a, b) => (a.table === b.table ? a.column.localeCompare(b.column) : a.table.localeCompare(b.table)));
  refusals.sort((a, b) => (a.table === b.table ? a.column.localeCompare(b.column) : a.table.localeCompare(b.table)));
  return { dialect, plans, refusals };
}

/** The body of `SqlDriver#reconcileAndWarnDrift`; the method's docblock there is its contract. */
export async function reconcileAndWarnDrift(this: Pick<SchemaSyncHost, 'applyMigrationEntries' | 'autoMigrate' | 'detectTableDrift' | 'driftWarned' | 'isProductionEnv' | 'isTenantKeyCertified' | 'logger' | 'schemaMode'>, tableName: string, fields: Record<string, any>, declaredIndexes?: any[]): Promise<void> {
  let drift: ManagedDriftEntry[];
  try {
    drift = await this.detectTableDrift(tableName, fields, declaredIndexes);
  } catch (e: any) {
    this.logger.warn(`[schema-drift] could not introspect '${tableName}' for drift detection`, e?.message ?? e);
    return;
  }
  if (drift.length === 0) return;

  const autoOn = this.autoMigrate === 'safe' && this.schemaMode === 'managed';
  if (autoOn && this.isProductionEnv()) {
    this.logger.warn(
      `[schema-drift] autoMigrate='safe' is ignored under NODE_ENV=production — schema is never auto-altered in production. Run 'os migrate' deliberately.`,
    );
  } else if (autoOn) {
    const safe = drift.filter((d) => d.category === 'safe');
    if (safe.length > 0) {
      try {
        const { applied } = await this.applyMigrationEntries(safe, { allowDestructive: false });
        for (const d of applied) {
          // ⛔ Call through the PROPERTY, never an extracted `(a ?? b)(…)`
          // reference: that evaluates to the bare function and invokes it with
          // `this === undefined`, which `@objectstack/core`'s class-based
          // `ObjectLogger` throws on — its `info`/`warn` reach for `this.write`
          // (#12792). ⛔ And NOT routed through {@link logDurabilityFailure}:
          // this line reports a reconcile that SUCCEEDED, so its channel is
          // `info`, and the durability channel would escalate a functional
          // report to `error` — the over-application AGENTS.md warns trains
          // everyone to skim `error`. Keep the level, the fallback AND the
          // receiver.
          const reconciled = `[schema-drift] auto-reconciled ${d.op.type} on ${d.table}.${d.column ?? ''}`;
          if (this.logger.info) this.logger.info(reconciled);
          else this.logger.warn(reconciled);
        }
        // Re-detect so the warnings below reflect the post-reconcile state.
        drift = await this.detectTableDrift(tableName, fields, declaredIndexes);
      } catch (e: any) {
        this.logger.warn(`[schema-drift] dev auto-reconcile failed for '${tableName}' — falling back to warning`, e?.message ?? e);
      }
    }
  }

  // [ADR-0131 D10 item 5] An `organization_id` drop is the ownership
  // ceremony's until the database is certified: `--allow-destructive` is
  // refused there, so the line names the ceremony instead. Asked once per
  // table, and only when such a drop is about to be warned.
  let certified: boolean | undefined;
  for (const d of drift) {
    const k = driftKey(d);
    if (this.driftWarned.has(k)) continue;
    this.driftWarned.add(k);
    if (isCeremonyOwnedColumnDrop(d) && !(certified ??= await this.isTenantKeyCertified())) {
      this.logger.warn(`[schema-drift] ${ceremonyOwnedDropFinding(d)}`);
      continue;
    }
    this.logger.warn(`[schema-drift] ${d.message}`);
  }
}

/** The body of `SqlDriver#applyMigrationEntries`; the method's docblock there is its contract. */
export async function applyMigrationEntries(this: Pick<SchemaSyncHost, 'applyDriftOpInPlace' | 'applyIndexDriftOp' | 'assertSchemaMutable' | 'dialectName' | 'isSqlite' | 'logger' | 'rebuildSqliteTablePatched'>, entries: ManagedDriftEntry[], opts: { allowDestructive?: boolean } = {}): Promise<{ applied: ManagedDriftEntry[]; skipped: ManagedDriftEntry[] }> {
  this.assertSchemaMutable('reconcileManagedSchema');
  const allowDestructive = opts.allowDestructive === true;

  const applied: ManagedDriftEntry[] = [];
  const skipped: ManagedDriftEntry[] = [];

  const candidates = entries.filter((d) => {
    if (d.category === 'destructive' && !allowDestructive) {
      skipped.push(d);
      return false;
    }
    return true;
  });
  if (candidates.length === 0) return { applied, skipped };

  // Index ops (#3728) are portable DDL on every dialect — no ALTER COLUMN, no
  // SQLite table rebuild — so they take their own path. Column ops run FIRST:
  // a `drop_column` takes its indexes with it, and on SQLite the rebuild
  // re-materializes the whole index set from metadata, which may already
  // satisfy the index entries below (they are idempotent, so that is fine).
  const columnEntries = candidates.filter((d) => !isIndexDriftOp(d.op));
  const indexEntries = candidates.filter((d) => isIndexDriftOp(d.op));

  // Group by table — SQLite reconciles a whole table in one rebuild.
  const byTable = new Map<string, ManagedDriftEntry[]>();
  for (const d of columnEntries) {
    (byTable.get(d.table) ?? byTable.set(d.table, []).get(d.table)!).push(d);
  }

  for (const [table, ents] of byTable) {
    try {
      if (this.isSqlite) {
        // `applied` means "this op happened", not "a rebuild ran" — every
        // consumer reads it that way (`reconcileAndWarnDrift` logs
        // "auto-reconciled <op> on <table>", the artifact boot gate prints
        // "↪ migrated <op>"). The rebuild honours four op types and
        // IGNORES the rest (#11722), so reporting the whole batch applied
        // turned an op that never happened into a green log line: the
        // finding is still there on the next boot, reports as drift again,
        // and is "migrated" again — a loop with no failing signal anywhere
        // in it. So only the entries the rebuild actually acted on are
        // reported applied, and the remainder is skipped and logged in the
        // SAME words the in-place arm uses for an op its dialect cannot do
        // ({@link applyDriftOpInPlace}).
        const honoured = new Set(await this.rebuildSqliteTablePatched(table, ents));
        for (const d of ents) {
          if (honoured.has(d)) {
            applied.push(d);
            continue;
          }
          this.logger.warn(
            `[schema-drift] ${d.op.type} on ${d.table}.${d.column ?? ''} is unsupported on dialect '${this.dialectName}' — skipped`,
          );
          skipped.push(d);
        }
      } else {
        for (const d of ents) {
          const ok = await this.applyDriftOpInPlace(d.op);
          (ok ? applied : skipped).push(d);
        }
      }
    } catch (e: any) {
      this.logger.warn(`[schema-drift] failed to reconcile '${table}'`, e?.message ?? e);
      for (const d of ents) if (!applied.includes(d)) skipped.push(d);
    }
  }

  for (const d of indexEntries) {
    try {
      const ok = await this.applyIndexDriftOp(d.op);
      (ok ? applied : skipped).push(d);
    } catch (e: any) {
      this.logger.warn(`[schema-drift] failed to reconcile index on '${d.table}'`, e?.message ?? e);
      skipped.push(d);
    }
  }
  return { applied, skipped };
}
