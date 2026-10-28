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
 * [#25521 cut 12] The canonical-encoding convergence that schema sync runs at
 * init joined them the same way: `backfillCanonicalDatetimes`,
 * `backfillCanonicalTimes` and `backfillCanonicalJsonEncoding`, the SQLite
 * backfills that rewrite stored datetime, time and JSON cells into their
 * canonical form, with `countNonTemporalTextRows` and `convergeJsonColumn`,
 * which they call; and, of the MySQL widening of legacy zero-precision columns,
 * the two `information_schema` reads (`legacyMysqlTimestampColumns`,
 * `legacyMysqlTimeColumns`) and `runWideningAlters`, which runs the ALTERs.
 * The class keeps all eight methods, and `SchemaSyncHost` grew by exactly the
 * members these bodies read that it did not list yet; the fields among them
 * (`canonicalDatetimeFields`, `canonicalTimeFields`, `datetimeFields`,
 * `flushingDeferredDdl`, `jsonFields`, `timeFields`) go as getters too.
 * `migrateMysqlDatetimeColumns` and `migrateMysqlTimeColumns` stay whole in
 * the class: each catch around `runWideningAlters` reports through
 * `logDurabilityFailure`, which `check:durability-log-level` reads as a loud
 * report only when the helper is declared in the same file as the catch.
 *
 * The module-level declarations only these bodies read moved here with them
 * and stay module-local: `SQLITE_JSON_BACKFILL_PAGE_SIZE`, and the #9354
 * lock-wait bound, its recognizer and its refusal
 * (`DEFERRED_DDL_LOCK_WAIT_TIMEOUT_SECONDS`, `isMysqlLockWaitTimeout`,
 * `deferredDdlLockWaitError`). The ones they share with members that stay
 * (`AUDIT_TIMESTAMP_COLUMNS`, `SQLITE_NON_TEMPORAL_TEXT_REFS`,
 * `SQLITE_TIME_EXPR_REFS`, `isMultiValuedColumn`, and `LOCK_WAIT_REFUSAL`, the
 * marker the refusal sets and `isDeferredDdlLockWaitRefusal` reads in the two
 * migrate catches) stay in `sql-driver.ts`, which exports them, and are
 * imported from there; this module reads them only inside function bodies, so
 * the import cycle is evaluation-safe. Three lines of the MySQL
 * `information_schema` queries sit inside template literals and keep their
 * bytes, indentation included, because they are the statement's own text.
 * `sql-driver.ts` no longer reads `recoverUnencodedJsonText`.
 *
 * [#25521 cut 17] The movable members of the class's data-lifecycle rotation
 * sub-banner joined them the same way: `ensureRotation`, which inventories a
 * rotation-managed table's shards, adopts a legacy base table, column-syncs
 * the retained shards, drops the expired ones and rebuilds the read view, with
 * `rotationShardKey` and `rotationColumnList`, which it calls;
 * `warnBuiltinColumnCollisions`, the warning the create, alter and shard paths
 * share when a declared field collides with a builtin column; and
 * `registerExternalObject`, the DDL-free registration of a federated object.
 * The class keeps all five methods, and `SchemaSyncHost` grew by exactly the
 * members these bodies read that it did not list yet; the fields among them
 * go as getters too. `rotationShardKey` and `rotationColumnList` read no member
 * of the driver, so their methods call them directly. `rotateShards`,
 * `ensureShardTable`, `aliasShardBookkeeping` and the two tenant-field
 * resolvers stay in the class. The module-level declarations these bodies read
 * are imported from where they are declared: `declaredValueShapes` (which now
 * carries `export`), `NUMERIC_SCALAR_TYPES` and `isMultiValuedColumn` from
 * `sql-driver.ts`, the attribute check and its formatter from
 * `builtin-column-collision.ts`, and the field-type sets and autonumber
 * parsers from `@objectstack/spec/data` and `@objectstack/core`.
 * `sql-driver.ts` no longer reads `formatAttribute` or `UndeliveredAttribute`.
 *
 * [#25521 cut 18] The deferred-DDL previews joined them the same way:
 * `previewDeferredSchemaWork`, which renders what the deferred schema sync
 * would do into the `os migrate` plan, with `previewDatetimeConvergence` and
 * `previewTimeConvergence`, which it calls to measure the datetime and time
 * storage-convergence work. The class keeps all three methods, and
 * `SchemaSyncHost` grew by exactly the members these bodies read that it did
 * not list yet; the fields among them go as getters too. `setDeferredDdl`,
 * `getSchemaSyncStats`, `flushDeferredSchemaDdl` and the
 * `deferredSchemaObjectCount` accessor of that sub-banner stay in the class.
 * The module-level declarations these bodies read are imported
 * from where they are declared: `fieldHasColumn` and the type
 * `PendingSchemaWork` from `schema-drift.ts`, and the two `SQLITE_*`
 * reference counts from `sql-driver.ts`, as before. `sql-driver.ts` no longer
 * reads `fieldHasColumn` as a value.
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
import { carriesNullSafeTenantKeyPart, ceremonyOwnedDropFinding, describeMissingIndexColumns, diffManagedIndexes, diffManagedTable, diffUnbuildableIndexes, driftKey, expectedIndexes, fieldHasColumn, GLOBAL_TENANT, indexedKeyColumns, isCeremonyOwnedColumnDrop, isIndexDriftOp, legacyUniqueReplacements, normalizeDeclaredIndex, type DeclaredIndexInput, type DriftOp, type ManagedDriftEntry, type PendingSchemaWork, type PhysicalColumn } from './schema-drift.js';
import { isJsonColumnType, mediaColumnMoveDialect, mediaColumnMovePlan, type MediaColumnMovePlan, type MediaColumnMoveRefusal, type MediaColumnMoveScan } from './media-column-move.js';
import { StandardErrorCode } from '@objectstack/spec/api';
import { recoverUnencodedJsonText } from './unencoded-json-text.js';
import { aggregandColumnClass } from '@objectstack/core';
import { FILE_REFERENCE_TYPES, NUMERIC_VALUE_TYPES, parseAutonumberFormat, resolveAutonumberFormat, type AutonumberToken } from '@objectstack/spec/data';
import { formatAttribute, undeliveredStorageAttributes, type UndeliveredAttribute } from './builtin-column-collision.js';
import { AUDIT_TIMESTAMP_COLUMNS, declaredValueShapes, type IntrospectedColumn, isMultiValuedColumn, LOCK_WAIT_REFUSAL, NUMERIC_SCALAR_TYPES, type SqlDriver, SQLITE_NON_TEMPORAL_TEXT_REFS, SQLITE_TIME_EXPR_REFS } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface SchemaSyncHost {
  aliasShardBookkeeping: SqlDriver['aliasShardBookkeeping'];
  applyDeclaredColumnDefault: SqlDriver['applyDeclaredColumnDefault'];
  applyDriftOpInPlace: SqlDriver['applyDriftOpInPlace'];
  applyIndexDriftOp: SqlDriver['applyIndexDriftOp'];
  applyMigrationEntries: SqlDriver['applyMigrationEntries'];
  applyNullSafeUniquePreflight: SqlDriver['applyNullSafeUniquePreflight'];
  assertSchemaMutable: SqlDriver['assertSchemaMutable'];
  readonly autoMigrate: SqlDriver['autoMigrate'];
  readonly autoNumberFields: SqlDriver['autoNumberFields'];
  readonly booleanFields: SqlDriver['booleanFields'];
  buildRebuiltColumn: SqlDriver['buildRebuiltColumn'];
  readonly canonicalDatetimeFields: SqlDriver['canonicalDatetimeFields'];
  readonly canonicalTimeFields: SqlDriver['canonicalTimeFields'];
  readonly columnFieldByObject: SqlDriver['columnFieldByObject'];
  computeAndRecordTenantField: SqlDriver['computeAndRecordTenantField'];
  convergeJsonColumn: SqlDriver['convergeJsonColumn'];
  countNonTemporalTextRows: SqlDriver['countNonTemporalTextRows'];
  createHashShadowUniqueIndex: SqlDriver['createHashShadowUniqueIndex'];
  createNullSafeUniqueIndex: SqlDriver['createNullSafeUniqueIndex'];
  readonly dateFields: SqlDriver['dateFields'];
  readonly datetimeFields: SqlDriver['datetimeFields'];
  readonly deferredSchemaObjects: SqlDriver['deferredSchemaObjects'];
  detectTableDrift: SqlDriver['detectTableDrift'];
  detectTableIndexDrift: SqlDriver['detectTableIndexDrift'];
  readonly dialectName: SqlDriver['dialectName'];
  readonly driftWarned: SqlDriver['driftWarned'];
  dropIndexIfExists: SqlDriver['dropIndexIfExists'];
  dropOrphanedHashShadowColumn: SqlDriver['dropOrphanedHashShadowColumn'];
  ensureShardTable: SqlDriver['ensureShardTable'];
  explainUnkeyableTextColumn: SqlDriver['explainUnkeyableTextColumn'];
  readonly fieldColumnByObject: SqlDriver['fieldColumnByObject'];
  readonly fileColumnsMoved: SqlDriver['fileColumnsMoved'];
  readonly flushingDeferredDdl: SqlDriver['flushingDeferredDdl'];
  readonly fractionalNumericFields: SqlDriver['fractionalNumericFields'];
  getExistingIndexNames: SqlDriver['getExistingIndexNames'];
  introspectColumns: SqlDriver['introspectColumns'];
  introspectIndexes: SqlDriver['introspectIndexes'];
  isJsonField: SqlDriver['isJsonField'];
  readonly isMysql: SqlDriver['isMysql'];
  readonly isPostgres: SqlDriver['isPostgres'];
  isProductionEnv: SqlDriver['isProductionEnv'];
  readonly isSqlite: SqlDriver['isSqlite'];
  isTenantKeyCertified: SqlDriver['isTenantKeyCertified'];
  readonly jsonFields: SqlDriver['jsonFields'];
  readonly knex: SqlDriver['knex'];
  legacyMysqlTimeColumns: SqlDriver['legacyMysqlTimeColumns'];
  legacyMysqlTimestampColumns: SqlDriver['legacyMysqlTimestampColumns'];
  logDurabilityFailure: SqlDriver['logDurabilityFailure'];
  readonly logger: SqlDriver['logger'];
  readonly managedObjectFields: SqlDriver['managedObjectFields'];
  readonly managedObjectIndexes: SqlDriver['managedObjectIndexes'];
  readonly mediaFields: SqlDriver['mediaFields'];
  nowColumnDefault: SqlDriver['nowColumnDefault'];
  readonly numericFields: SqlDriver['numericFields'];
  readonly numericValueFields: SqlDriver['numericValueFields'];
  readonly objectByPhysicalTable: SqlDriver['objectByPhysicalTable'];
  readonly physicalSchemaByObject: SqlDriver['physicalSchemaByObject'];
  readonly physicalTableByObject: SqlDriver['physicalTableByObject'];
  previewDatetimeConvergence: SqlDriver['previewDatetimeConvergence'];
  previewTimeConvergence: SqlDriver['previewTimeConvergence'];
  probeNullSafeUniqueDuplicates: SqlDriver['probeNullSafeUniqueDuplicates'];
  rebuildSqliteTablePatched: SqlDriver['rebuildSqliteTablePatched'];
  resolveTenantField: SqlDriver['resolveTenantField'];
  restoreBareIndexAfterFailedTighten: SqlDriver['restoreBareIndexAfterFailedTighten'];
  rotationColumnList: SqlDriver['rotationColumnList'];
  rotationShardKey: SqlDriver['rotationShardKey'];
  readonly rotationStateByTable: SqlDriver['rotationStateByTable'];
  readonly runtimeCreatedIndexes: SqlDriver['runtimeCreatedIndexes'];
  readonly schemaMode: SqlDriver['schemaMode'];
  sqliteCanonicalDatetimeSql: SqlDriver['sqliteCanonicalDatetimeSql'];
  sqliteCanonicalTimeSql: SqlDriver['sqliteCanonicalTimeSql'];
  sqliteNonTemporalTextSql: SqlDriver['sqliteNonTemporalTextSql'];
  readonly supportsRotation: SqlDriver['supportsRotation'];
  syncDeclaredIndexes: SqlDriver['syncDeclaredIndexes'];
  syncTableIndexes: SqlDriver['syncTableIndexes'];
  readonly tenantFieldByTable: SqlDriver['tenantFieldByTable'];
  readonly timeFields: SqlDriver['timeFields'];
  readonly valueShapeFields: SqlDriver['valueShapeFields'];
  varcharColumnChars: SqlDriver['varcharColumnChars'];
  withPinnedSession: SqlDriver['withPinnedSession'];
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

/**
 * How many candidate cells {@link SqlDriver.backfillCanonicalJsonEncoding}
 * reads per page. It bounds the memory one column's pass holds, never how much
 * of the column one pass converges: the pass walks every page.
 */
const SQLITE_JSON_BACKFILL_PAGE_SIZE = 500;

/**
 * [#9354] How long a widening ALTER waits for a metadata lock, in seconds.
 *
 * Named for the seam it arrived on; since commit 8bbf45947 it governs BOTH callers of
 * {@link SqlDriver.runWideningAlters} — the deferred-DDL flush and boot
 * schema-sync.
 *
 * MySQL's own default for `lock_wait_timeout` is **31,536,000 — one year**. A
 * widening `ALTER … MODIFY COLUMN` needs an exclusive metadata lock on the
 * table, so a single long-running transaction elsewhere (an open REPEATABLE
 * READ snapshot, a forgotten `BEGIN` in a psql-style shell, a stuck report
 * query) parks the ALTER in `Waiting for table metadata lock` for that long.
 * Nothing prints. `os migrate apply` looks like it hung, and no operator can
 * tell that from a crash — which is the condition this bound exists to end.
 *
 * # Why 120 seconds
 *
 * The bound is a diagnosis deadline, not a capacity knob: its job is to end the
 * silence, not to decide how patient a migration may be. So it is chosen as the
 * shortest wait that still clears the legitimate blockers, and no longer.
 *
 *   - **Above the noise.** Normal OLTP transactions on a table being migrated
 *     hold their metadata lock for milliseconds. Two minutes is three orders of
 *     magnitude above that, so an ordinary busy table never trips it — the bound
 *     does not convert a working migration into a failing one.
 *   - **Below an operator's patience.** A command that has printed nothing for
 *     two minutes is still within the window where the operator is watching it.
 *     At ten minutes they have already reached for `SHOW PROCESSLIST` or killed
 *     it, so a bound that fires later than that arrives after the diagnosis it
 *     was supposed to provide.
 *   - **Minutes-scale, per the ruling**, and deliberately at the low end of it:
 *     failing fast is cheap here. `os migrate apply` is re-runnable and the
 *     widening is idempotent (`migrateMysqlDatetimeColumns` re-reads
 *     `information_schema` and does nothing when the column is already
 *     `DATETIME(3)`), so the cost of a bound that fires too eagerly is one
 *     re-run once the blocker is gone — against an unbounded hang as the cost of
 *     one that never fires.
 *
 * # The same number on boot (commit 8bbf45947)
 *
 * Boot schema-sync arms this bound too, at the same value rather than a longer
 * one. Everything above is reasoning about how long a legitimate metadata-lock
 * holder can plausibly hold it — a property of the lock, not of who is waiting
 * on it. Boot's difference from the flush is what happens when the bound fires
 * (boot reports at `error` and carries on; the flush refuses), never how long
 * it waits.
 *
 * ⛔ Deliberately NOT configurable, and deliberately NOT retried — the 2026-08-17
 * ruling's explicit minimality. Both wait for measured demand. A knob added now
 * would have to be supported forever on the evidence of one CI stall.
 */
const DEFERRED_DDL_LOCK_WAIT_TIMEOUT_SECONDS = 120;

/**
 * [#9354] MySQL's lock-wait timeout, as it arrives through mysql2 and knex.
 *
 * `ER_LOCK_WAIT_TIMEOUT` (**errno 1205**) is what BOTH lock waits raise — the
 * InnoDB row-lock timeout (`innodb_lock_wait_timeout`) and the metadata-lock
 * timeout (`lock_wait_timeout`) this bound arms. The ALTER path can only be
 * blocked by the second, so on this seam 1205 means the metadata lock.
 *
 * Both spellings are checked because the two layers carry different ones:
 * mysql2 sets a string `code` (`'ER_LOCK_WAIT_TIMEOUT'`) alongside the numeric
 * `errno`, and a wrapper that rebuilds the error commonly keeps one and drops
 * the other. `cause` is followed because knex re-throws the driver error with
 * the original attached — the same cause-chaining
 * {@link backendStatementFaultError} relies on, and the reason a recognizer
 * that inspected only the top-level error would go quietly blind.
 *
 * ⛔ Message text is NOT sniffed. MySQL and MariaDB word this differently and
 * both translate it, so a prose match is a recognizer that fails in another
 * locale — silently, back to the year-long hang.
 */
function isMysqlLockWaitTimeout(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== 'object' || depth > 4) return false;
  const e = err as { errno?: unknown; code?: unknown; cause?: unknown };
  if (Number(e.errno) === 1205) return true;
  if (e.code === 'ER_LOCK_WAIT_TIMEOUT') return true;
  return isMysqlLockWaitTimeout(e.cause, depth + 1);
}

/**
 * [#9354] The refusal a blocked deferred-DDL widening ALTER fails with.
 *
 * # Why this is thrown at all, when every sibling here is swallowed
 *
 * {@link SqlDriver.migrateMysqlDatetimeColumns} logs and swallows its failures
 * on purpose: correctness never depends on the widening having run, and a
 * migration must not take boot down. That policy is right for boot and wrong
 * for the flush. `os migrate apply` is a command an operator RAN, whose whole
 * contract is to report what it did; a swallowed lock wait there prints
 * "Applied 0 change(s)" and reports success while the widening silently did not
 * happen. So the escape is scoped exactly to this condition on exactly that
 * path — every other failure keeps the swallow it has today.
 *
 * # `DATABASE_ERROR` / 500
 *
 * The 2026-08-17 ruling requires a code from the CLOSED standard vocabulary
 * (ADR-0112), from the `DATABASE_ERROR` family, naming the lock wait. That is
 * the catalog's own "database operation failed", and it is the same pair
 * {@link backendStatementFaultError} answers with one refusal over — so this
 * mints nothing and adds no code to the catalog. 500 rather than 4xx: nothing
 * about the operator's request is at fault. The blocker is another session.
 *
 * # The message carries the diagnosis, because it is the only thing shown
 *
 * `os migrate apply` prints `error.message` and exits 1 — `code` and `status`
 * reach programmatic consumers, but the operator reads this sentence and
 * nothing else. So it names the lock wait, the table, the bound it hit, and the
 * one thing that resolves it. The table name is the operator's own schema
 * (the line beside it already logs it), so naming it discloses nothing new —
 * and unlike the query-refusal envelope there is no caller-bound literal here
 * to leak: the statement's only bindings are the table and column.
 */
function deferredDdlLockWaitError(table: string, seconds: number, cause: unknown): Error {
  const err = new Error(
    `Migration of table '${table}' timed out after ${seconds}s waiting for a MySQL metadata ` +
      'lock (lock_wait_timeout). Another session is holding a lock on the table — a long-running ' +
      'transaction or an open, uncommitted session. No schema change was made. Identify the ' +
      "holder with `SHOW PROCESSLIST` or by querying `performance_schema.metadata_locks`, end " +
      'it, then re-run `os migrate apply` — the widening is idempotent, so re-running is safe.',
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.DATABASE_ERROR;
  err.status = 500;
  Object.defineProperty(err, LOCK_WAIT_REFUSAL, { value: true, enumerable: false });
  // Non-enumerable, like every sibling refusal in this file: the carrier must be
  // readable by cause-following predicates and invisible to `JSON.stringify`.
  Object.defineProperty(err, 'cause', {
    value: cause,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return err;
}

/** The body of `SqlDriver#backfillCanonicalDatetimes`; the method's docblock there is its contract. */
export async function backfillCanonicalDatetimes(this: Pick<SchemaSyncHost, 'canonicalDatetimeFields' | 'countNonTemporalTextRows' | 'datetimeFields' | 'isSqlite' | 'knex' | 'logger' | 'sqliteCanonicalDatetimeSql' | 'sqliteNonTemporalTextSql'>, table: string, tableExisted: boolean): Promise<void> {
  const fields = this.datetimeFields[table];
  if (!this.isSqlite || !fields || fields.size === 0) return;

  const clean = (this.canonicalDatetimeFields[table] ??= new Set<string>());
  // A table created by this very call is empty, so every datetime column in it
  // is canonical without a single row being read.
  if (!tableExisted) {
    for (const field of fields) clean.add(field);
    return;
  }

  const canonical = this.sqliteCanonicalDatetimeSql('??');
  // The expression spells `??` 4×, and the statement uses it twice (the SET
  // value and the WHERE guard) — hence the column name repeated per use.
  const exprBindings = (field: string) => [field, field, field, field];
  // #6009: the rows whose only reading is the julian-day limb.
  const guard = this.sqliteNonTemporalTextSql('??');
  const guardBindings = (field: string): string[] =>
    Array(SQLITE_NON_TEMPORAL_TEXT_REFS).fill(field);
  for (const field of fields) {
    try {
      const withheld = await this.countNonTemporalTextRows(table, field, canonical, exprBindings(field));
      const res = await this.knex.raw(
        `update ?? set ?? = ${canonical} where ?? is not null and ?? is not ${canonical} and not ${guard}`,
        [
          table, field, ...exprBindings(field),
          field, field, ...exprBindings(field), ...guardBindings(field),
        ],
      );
      const converted = (res as any)?.changes ?? 0;
      if (converted) {
        this.logger.info?.(
          `[sql-driver] canonicalised datetime storage for ${table}.${field}: every value is now one ` +
            `UTC ISO-8601 text form, so filters and sorts compare instants rather than mixed encodings`,
          { rowsConverted: converted },
        );
      }
      if (withheld > 0) {
        // #6009 — the tracker id stays in this comment, never in the string:
        // an operator reading the log has no way to resolve one.
        this.logger.warn(
          `[sql-driver] left ${withheld} row(s) of ${table}.${field} unconverted: ` +
          `their stored value is a bare number, which SQLite's date functions read as a ` +
          `JULIAN DAY, so canonicalising them would overwrite the original bytes with a ` +
          `date nobody wrote. Reads are unchanged — the column keeps its (unindexed) ` +
          `read-side repair until the values are corrected or cleared at the source`,
          { table, field, rowsWithheld: withheld },
        );
        continue;
      }
      clean.add(field);
    } catch (err) {
      // Correctness does not depend on this succeeding — only performance does.
      this.logger.warn(
        `[sql-driver] could not canonicalise datetime storage for ${table}.${field}; ` +
        `queries stay correct via the read-side repair`,
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }
}

/** The body of `SqlDriver#countNonTemporalTextRows`; the method's docblock there is its contract. */
export async function countNonTemporalTextRows(this: Pick<SchemaSyncHost, 'knex' | 'sqliteNonTemporalTextSql'>, table: string, field: string, canonicalSql: string, exprBindings: string[]): Promise<number> {
  const guard = this.sqliteNonTemporalTextSql('??');
  const res: any = await this.knex.raw(
    `select count(*) as n from ?? where ?? is not null and ?? is not ${canonicalSql} and ${guard}`,
    [
      table, field, field, ...exprBindings,
      ...Array(SQLITE_NON_TEMPORAL_TEXT_REFS).fill(field),
    ],
  );
  return Number((Array.isArray(res) ? res[0] : res)?.n ?? 0);
}

/** The body of `SqlDriver#backfillCanonicalJsonEncoding`; the method's docblock there is its contract. */
export async function backfillCanonicalJsonEncoding(this: Pick<SchemaSyncHost, 'convergeJsonColumn' | 'isSqlite' | 'jsonFields' | 'logger'>, table: string, tableExisted: boolean): Promise<void> {
  const fields = this.jsonFields[table];
  if (!this.isSqlite || !fields || fields.length === 0) return;
  // A table created by this very call is empty, so every json column in it is
  // canonical without a single row being read.
  if (!tableExisted) return;

  for (const field of fields) {
    const tally = { converted: 0, withheld: 0 };
    try {
      await this.convergeJsonColumn(table, field, tally);
    } catch (err) {
      // Correctness does not depend on this succeeding: `formatOutput` keeps
      // its parse fallback precisely so an un-migrated row still reads back
      // as the string it is.
      this.logger.warn(
        `[sql-driver] could not canonicalise json storage for ${table}.${field}; ` +
        `reads stay correct via formatOutput's parse fallback`,
        { error: err instanceof Error ? err.message : String(err), rowsConverted: tally.converted },
      );
      continue;
    }
    if (tally.converted) {
      this.logger.info?.(
        `[sql-driver] canonicalised json storage for ${table}.${field}: plain-text cells are now ` +
          `JSON-encoded strings, the one encoding a json column holds on every dialect`,
        { rowsConverted: tally.converted },
      );
    }
    if (tally.withheld) {
      this.logger.info?.(
        `[sql-driver] left ${tally.withheld} json cell(s) of ${table}.${field} as stored: ` +
        `SQLite's json_valid() rejects them but they parse as JSON (e.g. nested past ` +
        `SQLite's JSON depth limit), so they already read back as the value they encode`,
        { rowsWithheld: tally.withheld },
      );
    }
  }
}

/** The body of `SqlDriver#convergeJsonColumn`; the method's docblock there is its contract. */
export async function convergeJsonColumn(this: Pick<SchemaSyncHost, 'knex'>, table: string, field: string, tally: { converted: number; withheld: number }): Promise<void> {
  let cursor: number | undefined;
  for (;;) {
    const page = this.knex(table)
      .select(this.knex.raw('rowid as ??', ['rid']), this.knex.raw('?? as ??', [field, 'val']))
      .whereRaw(`typeof(??) = 'text' and json_valid(??) = 0`, [field, field]);
    if (cursor !== undefined) page.andWhereRaw('rowid > ?', [cursor]);
    const rows = (await page.orderByRaw('rowid').limit(SQLITE_JSON_BACKFILL_PAGE_SIZE)) as Array<{
      rid: number;
      val: unknown;
    }>;

    const writes: Array<{ rid: number; stored: string; next: string }> = [];
    for (const row of rows) {
      const next = typeof row.val === 'string' ? recoverUnencodedJsonText(row.val) : null;
      if (next === null) tally.withheld++;
      else writes.push({ rid: row.rid, stored: row.val as string, next });
    }
    if (writes.length > 0) {
      tally.converted += await this.knex.transaction(async (trx) => {
        let changed = 0;
        for (const w of writes) {
          changed += await trx(table)
            .whereRaw(`rowid = ? and typeof(??) = 'text' and ?? = ?`, [w.rid, field, field, w.stored])
            .update({ [field]: w.next });
        }
        return changed;
      });
    }

    if (rows.length < SQLITE_JSON_BACKFILL_PAGE_SIZE) return;
    const last = rows[rows.length - 1].rid;
    // The cursor must advance, or the same page would be read forever. A
    // rowid past 2^53 comes back rounded and can stall it; the rest of the
    // column then stays legacy, which reads the same.
    if (cursor !== undefined && !(last > cursor)) return;
    cursor = last;
  }
}

/** The body of `SqlDriver#backfillCanonicalTimes`; the method's docblock there is its contract. */
export async function backfillCanonicalTimes(this: Pick<SchemaSyncHost, 'canonicalTimeFields' | 'countNonTemporalTextRows' | 'isSqlite' | 'knex' | 'logger' | 'sqliteCanonicalTimeSql' | 'sqliteNonTemporalTextSql' | 'timeFields'>, table: string, tableExisted: boolean): Promise<void> {
  const fields = this.timeFields[table];
  if (!this.isSqlite || !fields || fields.size === 0) return;

  const clean = (this.canonicalTimeFields[table] ??= new Set<string>());
  if (!tableExisted) {
    for (const field of fields) clean.add(field);
    return;
  }

  const canonical = this.sqliteCanonicalTimeSql('??');
  const exprBindings = (field: string) => Array(SQLITE_TIME_EXPR_REFS).fill(field);
  // #6009: the rows whose only reading is the julian-day limb.
  const guard = this.sqliteNonTemporalTextSql('??');
  const guardBindings = (field: string): string[] =>
    Array(SQLITE_NON_TEMPORAL_TEXT_REFS).fill(field);
  for (const field of fields) {
    try {
      const withheld = await this.countNonTemporalTextRows(table, field, canonical, exprBindings(field));
      const res = await this.knex.raw(
        `update ?? set ?? = ${canonical} where ?? is not null and ?? is not ${canonical} and not ${guard}`,
        [
          table, field, ...exprBindings(field),
          field, field, ...exprBindings(field), ...guardBindings(field),
        ],
      );
      const converted = (res as any)?.changes ?? 0;
      if (converted) {
        this.logger.info?.(
          `[sql-driver] canonicalised time-of-day storage for ${table}.${field}: every value is now one ` +
            `HH:MM:SS[.sss] text form, so filters and sorts compare times rather than mixed encodings`,
          { rowsConverted: converted },
        );
      }
      if (withheld > 0) {
        // #6009 — the tracker id stays in this comment, never in the string:
        // an operator reading the log has no way to resolve one.
        this.logger.warn(
          `[sql-driver] left ${withheld} row(s) of ${table}.${field} unconverted: ` +
          `their stored value is a bare number, which SQLite's date functions read as a ` +
          `JULIAN DAY, so canonicalising them would overwrite the original bytes with a ` +
          `time nobody wrote. Reads are unchanged — the column keeps its (unindexed) ` +
          `read-side repair until the values are corrected or cleared at the source`,
          { table, field, rowsWithheld: withheld },
        );
        continue;
      }
      clean.add(field);
    } catch (err) {
      this.logger.warn(
        `[sql-driver] could not canonicalise time storage for ${table}.${field}; ` +
        `queries stay correct via the read-side repair`,
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }
}

/** The body of `SqlDriver#legacyMysqlTimestampColumns`; the method's docblock there is its contract. */
export async function legacyMysqlTimestampColumns(this: Pick<SchemaSyncHost, 'isMysql' | 'knex'>, table: string, fields: Record<string, any>): Promise<Array<{ name: string; nullable: boolean }>> {
  if (!this.isMysql) return [];
  const candidates = new Set<string>(AUDIT_TIMESTAMP_COLUMNS);
  for (const [name, field] of Object.entries(fields)) {
    if ((field?.type ?? 'string') === 'datetime' && !isMultiValuedColumn('datetime', field)) candidates.add(name);
  }
  if (candidates.size === 0) return [];

  const res: any = await this.knex.raw(
    `select column_name, is_nullable from information_schema.columns
       where table_schema = database() and table_name = ? and data_type = 'timestamp'`,
    [table],
  );
  // mysql2 returns [rows, fields]; column names vary in case by server.
  const rows: any[] = Array.isArray(res?.[0]) ? res[0] : (res?.rows ?? res ?? []);
  return rows
    .map((r) => ({
      name: String(r.COLUMN_NAME ?? r.column_name ?? ''),
      nullable: String(r.IS_NULLABLE ?? r.is_nullable ?? 'YES').toUpperCase() !== 'NO',
    }))
    .filter((c) => c.name && candidates.has(c.name));
}

/** The body of `SqlDriver#runWideningAlters`; the method's docblock there is its contract. */
export async function runWideningAlters(this: Pick<SchemaSyncHost, 'flushingDeferredDdl' | 'isMysql' | 'knex' | 'withPinnedSession'>, table: string, statements: ReadonlyArray<{ sql: string; bindings: unknown[] }>): Promise<void> {
  if (!this.isMysql) {
    for (const s of statements) await this.knex.raw(s.sql, s.bindings as any);
    return;
  }
  await this.withPinnedSession(async (run) => {
    let prior: unknown;
    try {
      const res: any = await run('select @@session.lock_wait_timeout as v');
      const rows = Array.isArray(res?.[0]) ? res[0] : (res?.rows ?? res ?? []);
      prior = (rows?.[0] as any)?.v;
    } catch {
      // Unreadable prior value only costs the restore below; it must not stop
      // the bound from being armed, which is the point of the whole seam.
    }
    await run('set session lock_wait_timeout = ?', [DEFERRED_DDL_LOCK_WAIT_TIMEOUT_SECONDS]);
    try {
      for (const s of statements) {
        try {
          await run(s.sql, s.bindings);
        } catch (err) {
          // Commit 8bbf45947: the bound is armed on both callers, the ESCAPE is not.
          // Off the flush this rethrows the server's own error, which the
          // widening's catch reports and swallows — boot's policy
          // unchanged, now reached by a wait that ends.
          if (this.flushingDeferredDdl && isMysqlLockWaitTimeout(err)) {
            throw deferredDdlLockWaitError(table, DEFERRED_DDL_LOCK_WAIT_TIMEOUT_SECONDS, err);
          }
          throw err;
        }
      }
    } finally {
      if (prior !== undefined && prior !== null) {
        try {
          await run('set session lock_wait_timeout = ?', [Number(prior)]);
        } catch {
          // Best-effort: never mask the refusal being thrown past this block.
        }
      }
    }
  });
}

/** The body of `SqlDriver#legacyMysqlTimeColumns`; the method's docblock there is its contract. */
export async function legacyMysqlTimeColumns(this: Pick<SchemaSyncHost, 'isMysql' | 'knex'>, table: string, fields: Record<string, any>): Promise<Array<{ name: string; nullable: boolean }>> {
  if (!this.isMysql) return [];
  const candidates = new Set<string>();
  for (const [name, field] of Object.entries(fields)) {
    if ((field?.type ?? 'string') === 'time' && !isMultiValuedColumn('time', field)) candidates.add(name);
  }
  if (candidates.size === 0) return [];

  const res: any = await this.knex.raw(
    `select column_name, is_nullable from information_schema.columns
       where table_schema = database() and table_name = ? and data_type = 'time'
         and coalesce(datetime_precision, 0) = 0`,
    [table],
  );
  const rows: any[] = Array.isArray(res) ? res[0] : (res?.rows ?? []);
  return rows
    .map((r) => ({
      name: String(r.COLUMN_NAME ?? r.column_name ?? ''),
      nullable: String(r.IS_NULLABLE ?? r.is_nullable ?? 'YES').toUpperCase() !== 'NO',
    }))
    .filter((c) => c.name && candidates.has(c.name));
}

/** The body of `SqlDriver#rotationShardKey`; the method's docblock there is its contract. */
export function rotationShardKey(nowMs: number, unit: 'day' | 'week' | 'month'): string {
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  if (unit === 'month') return ymd(nowMs).slice(0, 6);
  if (unit === 'week') {
    const dow = (new Date(nowMs).getUTCDay() + 6) % 7; // Monday = 0
    return ymd(nowMs - dow * 86_400_000);
  }
  return ymd(nowMs);
}

/** The body of `SqlDriver#ensureRotation`; the method's docblock there is its contract. */
export async function ensureRotation(this: Pick<SchemaSyncHost, 'aliasShardBookkeeping' | 'ensureShardTable' | 'knex' | 'logger' | 'rotationColumnList' | 'rotationShardKey' | 'rotationStateByTable'>, tableName: string, obj: { name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[] }, policy: { shards: number; unit: 'day' | 'week' | 'month' }, nowMs: number = Date.now()): Promise<{ object: string; current: string; shards: string[]; dropped: string[] }> {
  const current = `${tableName}__r${this.rotationShardKey(nowMs, policy.unit)}`;

  // Physical inventory: the base name (table before adoption, view after)
  // and every existing shard.
  const esc = tableName.replace(/[\\%_]/g, '\\$&');
  const raw: any = await this.knex.raw(
    `SELECT name, type FROM sqlite_master WHERE name = ? OR (name LIKE ? ESCAPE '\\')`,
    [tableName, `${esc}\\_\\_r%`],
  );
  const rows: Array<{ name: string; type: string }> = Array.isArray(raw) ? raw : raw?.rows ?? [];
  const baseType = rows.find((r) => r.name === tableName)?.type as 'table' | 'view' | undefined;
  const shardNames = new Set(
    rows.map((r) => r.name).filter((n) => n !== tableName && /__r\d{6,8}$/.test(n)),
  );

  // Adopt a legacy pre-rotation table: its whole history becomes the
  // current shard (coarse, but safe — it then ages out of the window).
  if (baseType === 'table') {
    if (!shardNames.has(current)) {
      await this.knex.schema.renameTable(tableName, current);
    } else {
      // Partial-failure recovery: both exist — merge, then drop the base.
      await this.knex.raw(`INSERT INTO "${current}" SELECT * FROM "${tableName}"`);
      await this.knex.schema.dropTable(tableName);
    }
    shardNames.add(current);
  }
  shardNames.add(current);

  // Time-based window: retain shards whose period falls inside the last
  // `shards × unit` (ends at the current period); everything older is the
  // O(1) reclaim. Count-based retention would silently stretch the window
  // when rotation cadence has gaps.
  const unitMs = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 }[policy.unit];
  const oldestRetainedKey = this.rotationShardKey(nowMs - (Math.max(1, policy.shards) - 1) * unitMs, policy.unit);
  const parsed = [...shardNames].sort((a, b) => b.localeCompare(a));
  const keyOf = (n: string) => n.slice(tableName.length + 3);
  const retained = parsed.filter((n) => keyOf(n) >= oldestRetainedKey);
  const dropped = parsed.filter((n) => keyOf(n) < oldestRetainedKey);

  // Column-sync every retained shard (creates the current one; adds any
  // newly declared columns to older shards so the UNION stays uniform).
  for (const shard of retained) {
    await this.ensureShardTable(shard, obj, tableName);
    this.aliasShardBookkeeping(tableName, shard);
  }

  for (const d of dropped) {
    await this.knex.schema.dropTableIfExists(d);
  }

  // Rebuild the read view over the retained set, newest shard first. An
  // explicit column list (not `*`) keeps the view stable when old shards
  // carry orphaned columns.
  const cols = this.rotationColumnList(obj);
  await this.knex.raw(`DROP VIEW IF EXISTS "${tableName}"`);
  await this.knex.raw(
    `CREATE VIEW "${tableName}" AS ` + retained.map((s) => `SELECT ${cols} FROM "${s}"`).join(' UNION ALL '),
  );

  this.rotationStateByTable.set(tableName, { shards: retained, current });
  if (dropped.length > 0) {
    (this.logger as { info?: (msg: string) => void }).info?.(
      `[sql-driver] rotated ${tableName}: ${retained.length} shard(s) live, dropped ${dropped.join(', ')}`,
    );
  }
  return { object: tableName, current, shards: retained, dropped };
}

/** The body of `SqlDriver#warnBuiltinColumnCollisions`; the method's docblock there is its contract. */
export function warnBuiltinColumnCollisions(this: Pick<SchemaSyncHost, 'logger'>, tableName: string, fields: Record<string, any> | undefined, builtinColumns: ReadonlySet<string>, phase: 'create' | 'alter' | 'shard'): string[] {
  const where = {
    create: `while creating table "${tableName}"`,
    alter: `while syncing existing table "${tableName}"`,
    shard: `while syncing shard "${tableName}"`,
  }[phase];

  const warned: string[] = [];
  for (const [field, declaration] of Object.entries(fields ?? {})) {
    if (!builtinColumns.has(field)) continue;
    const undelivered: UndeliveredAttribute[] = undeliveredStorageAttributes(
      field,
      declaration as Record<string, unknown>,
    );
    // Declared, colliding, and yet nothing was lost — the honoured half only.
    if (undelivered.length === 0) continue;

    this.logger.warn(
      `[sql-driver] ${where}: declared field '${field}' asks for storage the platform's own ` +
        `'${field}' column does not provide — ${undelivered.map(formatAttribute).join('; ')}. ` +
        `The platform emits id/created_at/updated_at itself, so THOSE attributes are not applied; ` +
        `the rest of the declaration (label, help text, the ADR-0113 write contract, and everything ` +
        `other layers read) is honoured as written. Drop the storage attribute(s) named above, or ` +
        `rename the field if you meant a column of your own.`,
      { table: tableName, field, phase, undelivered: undelivered.map((a) => a.key) },
    );
    warned.push(field);
  }
  return warned;
}

/** The body of `SqlDriver#rotationColumnList`; the method's docblock there is its contract. */
export function rotationColumnList(obj: { fields?: Record<string, any> }): string {
  const builtin = ['id', 'created_at', 'updated_at'];
  const declared = Object.keys(obj.fields ?? {}).filter((f) => !builtin.includes(f));
  return [...builtin, ...declared].map((c) => `"${c}"`).join(', ');
}

/** The body of `SqlDriver#registerExternalObject`; the method's docblock there is its contract. */
export function registerExternalObject(this: Pick<SchemaSyncHost, 'autoNumberFields' | 'booleanFields' | 'columnFieldByObject' | 'computeAndRecordTenantField' | 'dateFields' | 'datetimeFields' | 'fieldColumnByObject' | 'fractionalNumericFields' | 'isJsonField' | 'isSqlite' | 'jsonFields' | 'logger' | 'mediaFields' | 'numericFields' | 'numericValueFields' | 'objectByPhysicalTable' | 'physicalSchemaByObject' | 'physicalTableByObject' | 'tenantFieldByTable' | 'timeFields' | 'valueShapeFields'>, schema: {
  name: string;
  fields?: Record<string, any>;
  tenancy?: any;
  external?: { remoteName?: string; remoteSchema?: string; columnMap?: Record<string, string> };
}): void {
  const key = schema.name;
  const remoteName = schema.external?.remoteName || schema.name;
  const remoteSchema = schema.external?.remoteSchema;
  this.physicalTableByObject[key] = remoteName;
  this.objectByPhysicalTable[remoteName] = key;
  if (remoteSchema) {
    if (this.isSqlite) {
      this.logger.warn(
        `[sql-driver] external object "${key}" declares remoteSchema="${remoteSchema}" but SQLite has no schema namespace; ignoring (treating "${remoteName}" as a bare table).`,
      );
    } else {
      this.physicalSchemaByObject[key] = remoteSchema;
    }
  }

  // External columnMap (ADR-0015) is declared as { remoteColumn -> localField }.
  // Keep it for read-output remap, and invert to { localField -> remoteColumn }
  // for WHERE/ORDER BY/write translation. Absent => managed-identical behavior.
  const columnMap = schema.external?.columnMap;
  if (columnMap && typeof columnMap === 'object' && Object.keys(columnMap).length > 0) {
    const fieldToCol: Record<string, string> = {};
    const colToField: Record<string, string> = {};
    for (const [remoteCol, localField] of Object.entries(columnMap)) {
      if (typeof localField === 'string' && localField) {
        fieldToCol[localField] = remoteCol;
        colToField[remoteCol] = localField;
      }
    }
    this.fieldColumnByObject[key] = fieldToCol;
    this.columnFieldByObject[key] = colToField;
  }

  const jsonCols: string[] = [];
  const mediaCols: string[] = [];
  const booleanCols: string[] = [];
  const numericCols: string[] = [];
  const numericValueCols: string[] = [];
  const fractionalCols: string[] = [];
  const dateCols: string[] = [];
  const datetimeCols: string[] = [];
  const timeCols: string[] = [];
  const autoNumberCols: Array<{ name: string; format: string; tokens: AutonumberToken[]; tenantField: string | null }> = [];

  const tenantField = this.computeAndRecordTenantField(key, schema);
  if (schema.fields) {
    for (const [name, field] of Object.entries<any>(schema.fields)) {
      const type = field.type || 'string';
      if (this.isJsonField(type, field)) jsonCols.push(name);
      // Unconditional, on BOTH arms — see {@link mediaFields}. The read-side
      // legacy-encoding repair runs on a deployment that has not moved too.
      if (!isMultiValuedColumn(type, field) && FILE_REFERENCE_TYPES.has(type)) mediaCols.push(name);
      // [commit d46deba19] SCALAR only — the house spelling its three neighbours in
      // this block already carry, and this line was the single omission. See
      // {@link booleanFields}: every reader of this registry presents its
      // entry as ONE JS boolean, which for a multi-valued (JSON) column
      // collapses the parsed array to `true`. [#17469] The exclusion asks
      // {@link isMultiValuedColumn}, so "excluded from the scalar registries"
      // and "stored as a JSON column" stay the SAME population.
      if ((type === 'boolean' || type === 'toggle') && !isMultiValuedColumn(type, field)) booleanCols.push(name);
      if (NUMERIC_SCALAR_TYPES.has(type) && !isMultiValuedColumn(type, field)) numericCols.push(name);
      // [#16318] The authorable half only — see {@link numericValueFields}.
      if (NUMERIC_VALUE_TYPES.has(type) && !isMultiValuedColumn(type, field)) numericValueCols.push(name);
      // [#20387, #21042] See {@link fractionalNumericFields}: the predicate's
      // `'fractional'` class, scalar only by the predicate's own reading.
      if (aggregandColumnClass({ type, multiple: field?.multiple }) === 'fractional') fractionalCols.push(name);
      if (type === 'date') dateCols.push(name);
      if (type === 'datetime') datetimeCols.push(name);
      if (type === 'time') timeCols.push(name);
      if (type === 'auto_number' || type === 'autonumber') {
        const fmt = resolveAutonumberFormat(field);
        autoNumberCols.push({ name, format: fmt, tokens: parseAutonumberFormat(fmt), tenantField });
      }
    }
  }
  this.jsonFields[key] = jsonCols;
  // [#20444] The declared value shapes `$empty` expands — see {@link valueShapeFields}.
  this.valueShapeFields[key] = declaredValueShapes(schema.fields);
  this.mediaFields[key] = mediaCols;
  this.booleanFields[key] = booleanCols;
  this.numericFields[key] = numericCols;
  this.numericValueFields[key] = numericValueCols;
  this.fractionalNumericFields[key] = fractionalCols;
  this.autoNumberFields[key] = autoNumberCols;
  this.tenantFieldByTable[key] = tenantField;
  if (dateCols.length) this.dateFields[key] = new Set(dateCols);
  if (datetimeCols.length) this.datetimeFields[key] = new Set(datetimeCols);
  if (timeCols.length) this.timeFields[key] = new Set(timeCols);
}

/** The body of `SqlDriver#previewDeferredSchemaWork`; the method's docblock there is its contract. */
export async function previewDeferredSchemaWork(this: Pick<SchemaSyncHost, 'deferredSchemaObjects' | 'knex' | 'previewDatetimeConvergence' | 'previewTimeConvergence' | 'rotationShardKey' | 'supportsRotation'>): Promise<PendingSchemaWork[]> {
  const out: PendingSchemaWork[] = [];
  for (const [tableName, obj] of this.deferredSchemaObjects) {
    const declared = Object.entries<any>(obj.fields ?? {})
      .filter(([, field]) => fieldHasColumn(field ?? {}))
      .map(([name]) => name);
    // [#22506] A rotation-declared object (ADR-0057 P2) is not a table under
    // its base name: the rotator keeps it as the CURRENT shard
    // (`<table>__r<key>`) plus a read VIEW under the base name, so the
    // `hasTable` probe below — false for a view — listed it as `create_table`
    // on every plan, and the flush (which takes the sync's rotation branch)
    // then created nothing: a finding no apply could clear. It is answered
    // from the rotator's own facts instead — its shard key for now, and the
    // two names in `sqlite_master`: the current shard and the read view
    // present means nothing is pending. Anything else falls through to the
    // probes below (no shard yet: `create_table`, which the flush performs).
    // The deferral stores the whole definition (`{ ...obj, name }`), so its
    // `lifecycle` is here even though the map's declared value type omits it.
    const rotation = (obj as { lifecycle?: { storage?: { strategy?: string; unit?: 'day' | 'week' | 'month' } } })
      .lifecycle?.storage;
    if (rotation?.strategy === 'rotation' && rotation.unit && this.supportsRotation) {
      const current = `${tableName}__r${this.rotationShardKey(Date.now(), rotation.unit)}`;
      const raw: any = await this.knex.raw(
        'SELECT name, type FROM sqlite_master WHERE name IN (?, ?)',
        [tableName, current],
      );
      const rows: Array<{ name: string; type: string }> = Array.isArray(raw) ? raw : raw?.rows ?? [];
      const readView = rows.some((r) => r.name === tableName && r.type === 'view');
      const currentShard = rows.some((r) => r.name === current && r.type === 'table');
      if (readView && currentShard) continue;
    }
    if (!(await this.knex.schema.hasTable(tableName))) {
      // A table that does not exist yet is created empty, so nothing to converge.
      out.push({ table: tableName, kind: 'create_table', columns: declared });
      continue;
    }
    const existing = new Set(Object.keys(await this.knex(tableName).columnInfo()));
    const missing = declared.filter((c) => !existing.has(c));
    if (missing.length > 0) {
      out.push({ table: tableName, kind: 'add_columns', columns: missing });
    }
    out.push(...(await this.previewDatetimeConvergence(tableName, obj.fields ?? {}, existing)));
    out.push(...(await this.previewTimeConvergence(tableName, obj.fields ?? {}, existing)));
  }
  out.sort((a, b) => a.table.localeCompare(b.table) || a.kind.localeCompare(b.kind));
  return out;
}

/** The body of `SqlDriver#previewDatetimeConvergence`; the method's docblock there is its contract. */
export async function previewDatetimeConvergence(this: Pick<SchemaSyncHost, 'datetimeFields' | 'isMysql' | 'isSqlite' | 'knex' | 'legacyMysqlTimestampColumns' | 'sqliteCanonicalDatetimeSql' | 'sqliteNonTemporalTextSql'>, table: string, fields: Record<string, any>, existingColumns: Set<string>): Promise<PendingSchemaWork[]> {
  try {
    if (this.isSqlite) {
      const declared = [...(this.datetimeFields[table] ?? [])].filter((c) => existingColumns.has(c));
      if (declared.length === 0) return [];
      const canonical = this.sqliteCanonicalDatetimeSql('??');
      const guard = this.sqliteNonTemporalTextSql('??');
      const columns: string[] = [];
      let rows = 0;
      for (const field of declared) {
        const res: any = await this.knex.raw(
          `select count(*) as n from ?? where ?? is not null and ?? is not ${canonical} and not ${guard}`,
          [
            table, field, field, field, field, field, field,
            ...Array(SQLITE_NON_TEMPORAL_TEXT_REFS).fill(field),
          ],
        );
        const n = Number((Array.isArray(res) ? res[0] : res)?.n ?? 0);
        if (n > 0) { columns.push(field); rows += n; }
      }
      return columns.length === 0
        ? []
        : [{ table, kind: 'normalize_datetime_storage', columns, rows }];
    }

    if (this.isMysql) {
      const legacy = await this.legacyMysqlTimestampColumns(table, fields);
      if (legacy.length === 0) return [];
      const res: any = await this.knex.raw(`select count(*) as n from ??`, [table]);
      const counted = Array.isArray(res?.[0]) ? res[0] : (res?.rows ?? res ?? []);
      const rows = Number((counted[0] as any)?.n ?? (counted as any)?.n ?? 0);
      return [{ table, kind: 'widen_datetime_columns', columns: legacy.map((c) => c.name), rows }];
    }

    return [];
  } catch {
    return [];
  }
}

/** The body of `SqlDriver#previewTimeConvergence`; the method's docblock there is its contract. */
export async function previewTimeConvergence(this: Pick<SchemaSyncHost, 'isMysql' | 'isSqlite' | 'knex' | 'legacyMysqlTimeColumns' | 'sqliteCanonicalTimeSql' | 'sqliteNonTemporalTextSql' | 'timeFields'>, table: string, fields: Record<string, any>, existingColumns: Set<string>): Promise<PendingSchemaWork[]> {
  try {
    if (this.isSqlite) {
      const declared = [...(this.timeFields[table] ?? [])].filter((c) => existingColumns.has(c));
      if (declared.length === 0) return [];
      const canonical = this.sqliteCanonicalTimeSql('??');
      const guard = this.sqliteNonTemporalTextSql('??');
      const columns: string[] = [];
      let rows = 0;
      for (const field of declared) {
        const res: any = await this.knex.raw(
          `select count(*) as n from ?? where ?? is not null and ?? is not ${canonical} and not ${guard}`,
          [
            table, field, field, ...Array(SQLITE_TIME_EXPR_REFS).fill(field),
            ...Array(SQLITE_NON_TEMPORAL_TEXT_REFS).fill(field),
          ],
        );
        const n = Number((Array.isArray(res) ? res[0] : res)?.n ?? 0);
        if (n > 0) { columns.push(field); rows += n; }
      }
      return columns.length === 0
        ? []
        : [{ table, kind: 'normalize_time_storage', columns, rows }];
    }

    if (this.isMysql) {
      const legacy = await this.legacyMysqlTimeColumns(table, fields);
      if (legacy.length === 0) return [];
      const res: any = await this.knex.raw(`select count(*) as n from ??`, [table]);
      const counted = Array.isArray(res?.[0]) ? res[0] : (res?.rows ?? res ?? []);
      const rows = Number((counted[0] as any)?.n ?? (counted as any)?.n ?? 0);
      return [{ table, kind: 'widen_time_columns', columns: legacy.map((c) => c.name), rows }];
    }

    return [];
  } catch {
    return [];
  }
}
