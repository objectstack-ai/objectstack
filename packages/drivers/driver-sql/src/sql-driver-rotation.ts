// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Data-lifecycle rotation (ADR-0057 P2)" section of
 * `SqlDriver`: the bodies of `rotationShardsOf`, `rotationWriteTarget`,
 * `rotateShards`, `ensureShardTable`, `aliasShardBookkeeping`,
 * `computeTenantField`, `computeAndRecordTenantField`,
 * `registerManagedObjectMetadata`, `registerObjectMetadata`, `initObjects`,
 * `withPinnedSession`, `migrateMysqlDatetimeColumns`, `migrateMysqlTimeColumns`
 * moved out of `sql-driver.ts` whole by `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link RotationFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link RotationHost}: exactly the
 * `SqlDriver` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `rotationHost` in
 * `sql-driver-facet-hosts.ts`, built once per driver by the class's static
 * block. Methods go as closures that call them on the driver at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * driver.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { FILE_REFERENCE_TYPES, NUMERIC_VALUE_TYPES, isTenancyDisabled, parseAutonumberFormat, resolveAutonumberFormat } from '@objectstack/spec/data';
import type { AutonumberToken } from '@objectstack/spec/data';
import { aggregandColumnClass } from '@objectstack/core';
import { StorageNameMapping, SystemObjectName } from '@objectstack/spec/system';
import { ExistingTableAdoptionRefusal } from './existing-table-refusal.js';
import { indexedKeyColumns, isUniqueScopeDeclared } from './schema-drift.js';
import {
  AUDIT_TIMESTAMP_COLUMNS, MYSQL_DATETIME_PRECISION, NUMERIC_SCALAR_TYPES, declaredValueShapes,
  isDeferredDdlLockWaitRefusal, isMultiValuedColumn, isNowDefaultValue,
} from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link RotationFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface RotationHost {
  assertSchemaMutable: SqlDriver['assertSchemaMutable'];
  readonly autoNumberFields: SqlDriver['autoNumberFields'];
  backfillCanonicalDatetimes: SqlDriver['backfillCanonicalDatetimes'];
  backfillCanonicalJsonEncoding: SqlDriver['backfillCanonicalJsonEncoding'];
  backfillCanonicalTimes: SqlDriver['backfillCanonicalTimes'];
  readonly booleanFields: SqlDriver['booleanFields'];
  carryDeclaredRenames: SqlDriver['carryDeclaredRenames'];
  computeAndRecordTenantField: SqlDriver['computeAndRecordTenantField'];
  computeTenantField: SqlDriver['computeTenantField'];
  createAuditTimestampColumn: SqlDriver['createAuditTimestampColumn'];
  createColumn: SqlDriver['createColumn'];
  readonly dateFields: SqlDriver['dateFields'];
  readonly datetimeFields: SqlDriver['datetimeFields'];
  readonly deferredDdl: SqlDriver['deferredDdl'];
  readonly deferredSchemaObjects: SqlDriver['deferredSchemaObjects'];
  readonly dialectName: SqlDriver['dialectName'];
  ensureDatabaseExists: SqlDriver['ensureDatabaseExists'];
  ensureRotation: SqlDriver['ensureRotation'];
  ensureSequencesTable: SqlDriver['ensureSequencesTable'];
  readonly fractionalNumericFields: SqlDriver['fractionalNumericFields'];
  isJsonField: SqlDriver['isJsonField'];
  readonly isMysql: SqlDriver['isMysql'];
  readonly jsonFields: SqlDriver['jsonFields'];
  readonly knex: SqlDriver['knex'];
  legacyMysqlTimeColumns: SqlDriver['legacyMysqlTimeColumns'];
  legacyMysqlTimestampColumns: SqlDriver['legacyMysqlTimestampColumns'];
  logDurabilityFailure: SqlDriver['logDurabilityFailure'];
  readonly logger: SqlDriver['logger'];
  readonly managedObjectFields: SqlDriver['managedObjectFields'];
  readonly managedObjectIndexes: SqlDriver['managedObjectIndexes'];
  readonly mediaFields: SqlDriver['mediaFields'];
  migrateMysqlDatetimeColumns: SqlDriver['migrateMysqlDatetimeColumns'];
  migrateMysqlTimeColumns: SqlDriver['migrateMysqlTimeColumns'];
  nowColumnDefault: SqlDriver['nowColumnDefault'];
  readonly numericFields: SqlDriver['numericFields'];
  readonly numericValueFields: SqlDriver['numericValueFields'];
  organizationObjectRegistered: SqlDriver['organizationObjectRegistered'];
  readonly physicalKeyIndexes: SqlDriver['physicalKeyIndexes'];
  reconcileAndWarnDrift: SqlDriver['reconcileAndWarnDrift'];
  registerManagedObjectMetadata: SqlDriver['registerManagedObjectMetadata'];
  registerObjectMetadata: SqlDriver['registerObjectMetadata'];
  resolveFileColumnsMoved: SqlDriver['resolveFileColumnsMoved'];
  resolveTenantField: SqlDriver['resolveTenantField'];
  rethrowWithRowSizeExplanation: SqlDriver['rethrowWithRowSizeExplanation'];
  retireIndexesNamedForOldKeys: SqlDriver['retireIndexesNamedForOldKeys'];
  readonly rotationStateByTable: SqlDriver['rotationStateByTable'];
  runWideningAlters: SqlDriver['runWideningAlters'];
  readonly supportsRotation: SqlDriver['supportsRotation'];
  syncDeclaredIndexes: SqlDriver['syncDeclaredIndexes'];
  syncTableIndexes: SqlDriver['syncTableIndexes'];
  readonly tablesCreatedHere: SqlDriver['tablesCreatedHere'];
  readonly tablesFoundExisting: SqlDriver['tablesFoundExisting'];
  readonly tablesWithTimestamps: SqlDriver['tablesWithTimestamps'];
  readonly tenantFieldByTable: SqlDriver['tenantFieldByTable'];
  readonly tenantOptOutByTable: SqlDriver['tenantOptOutByTable'];
  readonly timeFields: SqlDriver['timeFields'];
  readonly undeclaredAuditTimestampFields: SqlDriver['undeclaredAuditTimestampFields'];
  readonly updatedAtColumnState: SqlDriver['updatedAtColumnState'];
  readonly valueShapeFields: SqlDriver['valueShapeFields'];
  warnBuiltinColumnCollisions: SqlDriver['warnBuiltinColumnCollisions'];
}

/** The bodies of the "Data-lifecycle rotation (ADR-0057 P2)" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class RotationFacet {
  /** The body of `SqlDriver#rotationShardsOf`; the method's docblock there is its contract. */
  static rotationShardsOf(this: Pick<RotationHost, 'rotationStateByTable'>, object: string): string[] | undefined {
    return this.rotationStateByTable.get(object)?.shards;
  }

  /** The body of `SqlDriver#rotationWriteTarget`; the method's docblock there is its contract. */
  static rotationWriteTarget(this: Pick<RotationHost, 'rotationStateByTable'>, object: string): string | undefined {
    return this.rotationStateByTable.get(object)?.current;
  }

  /** The body of `SqlDriver#rotateShards`; the method's docblock there is its contract. */
  static async rotateShards(this: Pick<RotationHost, 'assertSchemaMutable' | 'dialectName' | 'ensureRotation' | 'supportsRotation'>, objectDef: { name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[]; lifecycle?: any }, nowMs: number = Date.now()): Promise<{ object: string; current: string; shards: string[]; dropped: string[] }> {
    this.assertSchemaMutable('rotateShards');
    const policy = objectDef.lifecycle?.storage;
    if (!policy || policy.strategy !== 'rotation') {
      throw new Error(`[sql-driver] rotateShards: '${objectDef.name}' declares no lifecycle.storage rotation policy`);
    }
    if (!this.supportsRotation) {
      throw new Error(`[sql-driver] rotateShards: rotation is not supported on dialect '${this.dialectName}'`);
    }
    const tableName = StorageNameMapping.resolveTableName(objectDef as any);
    return this.ensureRotation(tableName, objectDef, policy, nowMs);
  }

  /** The body of `SqlDriver#ensureShardTable`; the method's docblock there is its contract. */
  static async ensureShardTable(this: Pick<RotationHost, 'computeAndRecordTenantField' | 'createAuditTimestampColumn' | 'createColumn' | 'knex' | 'resolveTenantField' | 'syncDeclaredIndexes' | 'warnBuiltinColumnCollisions'>, shardName: string, obj: { fields?: Record<string, any>; tenancy?: any; indexes?: any[] }, baseTable: string = shardName): Promise<void> {
    const builtinColumns = new Set(['id', 'created_at', 'updated_at']);
    // [#12015] Both branches below drop a declared field named after a builtin
    // column — the create branch skips it explicitly, the column-sync branch
    // finds the column already present — so the shard path warns once here,
    // ahead of either.
    this.warnBuiltinColumnCollisions(shardName, obj.fields, builtinColumns, 'shard');
    const exists = await this.knex.schema.hasTable(shardName);
    // ADR-0131 D1: a shard is created from the BASE's declaration, so it takes
    // the base's tenant column NOT NULL — asked of the base through the
    // recording resolver, the same answer the declared-index sync below uses
    // (the shard has no bookkeeping of its own until `aliasShardBookkeeping`).
    // A shard that already exists keeps the nullability it has: the
    // organization-ownership ceremony reports such a shard, it never rebuilds it.
    const baseTenantField = this.computeAndRecordTenantField(baseTable, obj);
    // Commit d0e3a885b: a shard carries the base table's declared indexes (below), so its
    // columns need the same keyable-text decision the managed path makes.
    const keyedColumns = indexedKeyColumns({
      table: shardName,
      fields: obj.fields ?? {},
      tenantField: this.resolveTenantField(shardName),
      declaredIndexes: obj.indexes,
    });
    if (!exists) {
      await this.knex.schema.createTable(shardName, (table) => {
        table.string('id').primary();
        this.createAuditTimestampColumn(table, 'created_at');
        this.createAuditTimestampColumn(table, 'updated_at');
        for (const [name, field] of Object.entries(obj.fields ?? {})) {
          if (builtinColumns.has(name)) continue;
          this.createColumn(table, name, field, keyedColumns.get(name), name === baseTenantField);
        }
      });
    } else {
      const columnInfo = await this.knex(shardName).columnInfo();
      const existingColumns = Object.keys(columnInfo);
      await this.knex.schema.alterTable(shardName, (table) => {
        for (const [name, field] of Object.entries(obj.fields ?? {})) {
          if (!existingColumns.includes(name)) {
            this.createColumn(table, name, field, keyedColumns.get(name));
          }
        }
      });
    }

    // Declared indexes per shard. Auto-derived names already embed the shard
    // name; explicit names get a shard prefix so they can't collide across
    // shards in the same database.
    const declared = obj.indexes;
    if (Array.isArray(declared) && declared.length > 0) {
      const colInfo = await this.knex(shardName).columnInfo();
      const perShard = declared.map((idx: any) => ({
        ...idx,
        name: typeof idx?.name === 'string' && idx.name.trim() ? `${shardName}__${idx.name.trim()}` : undefined,
      }));
      // Shard bookkeeping is aliased AFTER this method runs, so `shardName` has
      // no entry of its own yet — a declared `unique: 'organization'` index
      // (ADR-0120 D1) must scope identically on every shard of the base table,
      // so the answer has to come from the base.
      //
      // [commit 0f38ab084] Keyed by `baseTable`, and through the RECORDING resolver, not
      // the bare `computeTenantField`. The bare one reads this call's schema
      // alone, so a shard synced from a partial re-registration — one carrying
      // no `tenancy` block — fell through to the implicit `organization_id`
      // heuristic and gave the shard an organization key part the base table's
      // own index does not have. `tenantOptOutByTable` already holds the base's
      // explicit opt-out (`initObjects` recorded it under exactly this key, and
      // `aliasShardBookkeeping` propagates it to the shard afterwards), so
      // consulting it here is what makes the two paths answer the same.
      await this.syncDeclaredIndexes(
        shardName,
        perShard,
        new Set(Object.keys(colInfo)),
        baseTenantField,
        obj.fields ?? {},
      );
    }
  }

  /** The body of `SqlDriver#aliasShardBookkeeping`; the method's docblock there is its contract. */
  static aliasShardBookkeeping(this: Pick<RotationHost, 'autoNumberFields' | 'booleanFields' | 'dateFields' | 'datetimeFields' | 'fractionalNumericFields' | 'jsonFields' | 'mediaFields' | 'numericFields' | 'numericValueFields' | 'tablesWithTimestamps' | 'tenantFieldByTable' | 'tenantOptOutByTable' | 'timeFields' | 'valueShapeFields'>, base: string, shard: string): void {
    this.jsonFields[shard] = this.jsonFields[base] ?? [];
    this.valueShapeFields[shard] = this.valueShapeFields[base] ?? {};
    this.mediaFields[shard] = this.mediaFields[base] ?? [];
    this.booleanFields[shard] = this.booleanFields[base] ?? [];
    this.numericFields[shard] = this.numericFields[base] ?? [];
    this.numericValueFields[shard] = this.numericValueFields[base] ?? [];
    this.fractionalNumericFields[shard] = this.fractionalNumericFields[base] ?? [];
    this.autoNumberFields[shard] = this.autoNumberFields[base] ?? [];
    if (this.dateFields[base]) this.dateFields[shard] = this.dateFields[base];
    if (this.datetimeFields[base]) this.datetimeFields[shard] = this.datetimeFields[base];
    if (this.timeFields[base]) this.timeFields[shard] = this.timeFields[base];
    this.tenantFieldByTable[shard] = this.tenantFieldByTable[base] ?? null;
    if (this.tenantOptOutByTable.has(base)) this.tenantOptOutByTable.add(shard);
    this.tablesWithTimestamps.add(shard);
  }

  /** The body of `SqlDriver#computeTenantField`; the method's docblock there is its contract. */
  static computeTenantField(schema: { fields?: Record<string, any>; tenancy?: any }): string | null {
    const tenancyDecl = (schema as any)?.tenancy;
    // Explicit opt-out wins over any column-presence heuristic.
    if (isTenancyDisabled(schema)) return null;
    const fields = schema?.fields;
    if (tenancyDecl?.tenantField) {
      const declared = String(tenancyDecl.tenantField);
      if (fields && Object.prototype.hasOwnProperty.call(fields, declared)) return declared;
    }
    if (fields && Object.prototype.hasOwnProperty.call(fields, 'organization_id')) return 'organization_id';
    return null;
  }

  /** The body of `SqlDriver#computeAndRecordTenantField`; the method's docblock there is its contract. */
  static computeAndRecordTenantField(this: Pick<RotationHost, 'computeTenantField' | 'organizationObjectRegistered' | 'tenantOptOutByTable'>, key: string, schema: { fields?: Record<string, any>; tenancy?: any }): string | null {
    if (key === SystemObjectName.ORGANIZATION) this.organizationObjectRegistered = true;
    if (schema?.tenancy != null) {
      if (isTenancyDisabled(schema)) this.tenantOptOutByTable.add(key);
      else this.tenantOptOutByTable.delete(key);
      return this.computeTenantField(schema);
    }
    if (this.tenantOptOutByTable.has(key)) return null;
    return this.computeTenantField(schema);
  }

  /** The body of `SqlDriver#registerManagedObjectMetadata`; the method's docblock there is its contract. */
  static registerManagedObjectMetadata(this: Pick<RotationHost, 'autoNumberFields' | 'booleanFields' | 'computeAndRecordTenantField' | 'dateFields' | 'datetimeFields' | 'fractionalNumericFields' | 'isJsonField' | 'jsonFields' | 'managedObjectFields' | 'managedObjectIndexes' | 'mediaFields' | 'numericFields' | 'numericValueFields' | 'physicalKeyIndexes' | 'tenantFieldByTable' | 'timeFields' | 'undeclaredAuditTimestampFields' | 'updatedAtColumnState' | 'valueShapeFields'>, obj: { name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[] }): { tableName: string; tenantField: string | null } {
    const tableName = StorageNameMapping.resolveTableName(obj);
    // #2186: remember the authoritative metadata field set for this table so
    // drift detection / `os migrate` can diff the physical schema against it.
    this.managedObjectFields.set(tableName, obj.fields ?? {});
    // [#21259] Recomputed on every registration, so a re-registration that now
    // declares a column stops treating it as undeclared.
    this.undeclaredAuditTimestampFields[tableName] = AUDIT_TIMESTAMP_COLUMNS.filter(
      (col) => !Object.prototype.hasOwnProperty.call(obj.fields ?? {}, col),
    );
    // Always overwrite — a metadata change that REMOVES `indexes` must clear
    // the previous entry, or drift detection keeps expecting an index nobody
    // declares any more (and never reports it as orphaned).
    if (Array.isArray(obj.indexes)) {
      this.managedObjectIndexes.set(tableName, obj.indexes);
    } else {
      this.managedObjectIndexes.delete(tableName);
    }
    // [#8621] This call may create the table, or add a unique index to one
    // that already exists, so whatever the upsert pre-flight introspected
    // before it is stale. Dropping the entry is enough — the entry is
    // re-read lazily, and a refusal re-reads unconditionally.
    this.physicalKeyIndexes.delete(tableName);

    const jsonCols: string[] = [];
    const mediaCols: string[] = [];
    const booleanCols: string[] = [];
    const numericCols: string[] = [];
    const numericValueCols: string[] = [];
    const fractionalCols: string[] = [];
    const autoNumberCols: Array<{ name: string; format: string; tokens: AutonumberToken[]; tenantField: string | null }> = [];
    // Tenant-isolation column: explicit tenancy opt-out → declared field →
    // implicit `organization_id`. See {@link computeAndRecordTenantField}
    // (shared with registerExternalObject so the two paths can't drift).
    const tenantField = this.computeAndRecordTenantField(tableName, obj);
    if (obj.fields) {
      for (const [name, field] of Object.entries<any>(obj.fields)) {
        const type = field.type || 'string';
        if (this.isJsonField(type, field)) {
          jsonCols.push(name);
        }
        // Unconditional, on BOTH arms — see {@link mediaFields}. The read-side
        // legacy-encoding repair runs on a deployment that has not moved too.
        if (!isMultiValuedColumn(type, field) && FILE_REFERENCE_TYPES.has(type)) {
          mediaCols.push(name);
        }
        // `toggle` shares boolean storage/affinity, so it needs the same
        // read coercion (stored 1/0 → JS true/false) or it leaks back as a
        // number/string instead of a boolean (#field-zoo).
        // [commit d46deba19] SCALAR only, like the three neighbours below: a
        // `multiple: true` boolean/toggle is a JSON column, and the read
        // coercion this registry exists for presents ONE JS boolean — which
        // collapses the parsed array to `true` whatever it holds. See
        // {@link booleanFields}.
        if ((type === 'boolean' || type === 'toggle') && !isMultiValuedColumn(type, field)) {
          booleanCols.push(name);
        }
        // Numeric scalars are coerced back to JS numbers on read so legacy
        // TEXT-affinity columns (created before they were mapped to a numeric
        // column) still return numbers, not strings — see NUMERIC_SCALAR_TYPES.
        if (NUMERIC_SCALAR_TYPES.has(type) && !isMultiValuedColumn(type, field)) {
          numericCols.push(name);
        }
        // [#16318] The authorable half only — see {@link numericValueFields}.
        if (NUMERIC_VALUE_TYPES.has(type) && !isMultiValuedColumn(type, field)) {
          numericValueCols.push(name);
        }
        // [#20387, #21042] See {@link fractionalNumericFields}: the predicate's
        // `'fractional'` class, scalar only by the predicate's own reading.
        if (aggregandColumnClass({ type, multiple: field?.multiple }) === 'fractional') {
          fractionalCols.push(name);
        }
        if (type === 'date') {
          (this.dateFields[tableName] ??= new Set()).add(name);
        }
        if (type === 'datetime') {
          (this.datetimeFields[tableName] ??= new Set()).add(name);
        }
        if (type === 'time') {
          (this.timeFields[tableName] ??= new Set()).add(name);
        }
        if (type === 'auto_number' || type === 'autonumber') {
          const fmt = resolveAutonumberFormat(field);
          // Tokenize once: the renderer resolves date tokens (`{YYYYMMDD}`),
          // field interpolation (`{island_zone}`) and the sequence slot at
          // fill time. The counter scopes to whatever renders before the slot.
          const tokens = parseAutonumberFormat(fmt);
          autoNumberCols.push({ name, format: fmt, tokens, tenantField });
        }
      }
    }
    this.jsonFields[tableName] = jsonCols;
    // [#20444] The declared value shapes `$empty` expands — see {@link valueShapeFields}.
    this.valueShapeFields[tableName] = declaredValueShapes(obj.fields);
    this.mediaFields[tableName] = mediaCols;
    this.booleanFields[tableName] = booleanCols;
    this.numericFields[tableName] = numericCols;
    this.numericValueFields[tableName] = numericValueCols;
    this.fractionalNumericFields[tableName] = fractionalCols;
    this.autoNumberFields[tableName] = autoNumberCols;
    this.tenantFieldByTable[tableName] = tenantField;
    // [commit 479fba50d] The declared shape's answer to "does this table carry
    // `updated_at`?", installed here because here is the one place a managed
    // object reaches the driver on EVERY boot posture — `initObjects` calls
    // this first, and a `skipSchemaSync` boot calls it and stops. Presumed
    // rather than asserted (see {@link updatedAtColumnState}); DDL that
    // OBSERVES the column still records the stronger fact in
    // `tablesWithTimestamps`, so a table this driver built is never in the
    // speculative state at all. Never downgrades an answer already resolved
    // from the database — re-registration is idempotent metadata assignment
    // and must not throw away a `columnInfo()` result.
    if (!this.updatedAtColumnState.has(tableName)) {
      this.updatedAtColumnState.set(tableName, 'presumed');
    }
    return { tableName, tenantField };
  }

  /** The body of `SqlDriver#registerObjectMetadata`; the method's docblock there is its contract. */
  static registerObjectMetadata(this: Pick<RotationHost, 'registerManagedObjectMetadata'>, objects: Array<{ name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[] }>): void {
    for (const obj of objects) this.registerManagedObjectMetadata(obj);
  }

  /** The body of `SqlDriver#initObjects`; the method's docblock there is its contract. */
  static async initObjects(this: Pick<RotationHost, 'assertSchemaMutable' | 'autoNumberFields' | 'backfillCanonicalDatetimes' | 'backfillCanonicalJsonEncoding' | 'backfillCanonicalTimes' | 'carryDeclaredRenames' | 'createAuditTimestampColumn' | 'createColumn' | 'deferredDdl' | 'deferredSchemaObjects' | 'ensureDatabaseExists' | 'ensureRotation' | 'ensureSequencesTable' | 'knex' | 'migrateMysqlDatetimeColumns' | 'migrateMysqlTimeColumns' | 'reconcileAndWarnDrift' | 'registerObjectMetadata' | 'resolveFileColumnsMoved' | 'rethrowWithRowSizeExplanation' | 'retireIndexesNamedForOldKeys' | 'supportsRotation' | 'syncTableIndexes' | 'tablesCreatedHere' | 'tablesFoundExisting' | 'tablesWithTimestamps' | 'tenantFieldByTable' | 'warnBuiltinColumnCollisions'>, objects: Array<{ name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[]; lifecycle?: any }>): Promise<void> {
    // The ADR-0104 media arm, resolved BEFORE registration because
    // `registerObjectMetadata` below freezes `isJsonField`'s answer into
    // `jsonFields` for every media column it sees. Memoized, and every failure
    // path lands on the JSON arm — see {@link resolveFileColumnsMoved}.
    await this.resolveFileColumnsMoved();

    // In-memory registration FIRST, and deliberately ahead of the DDL gate
    // below: being refused permission to alter a schema is not a reason to stay
    // ignorant of the objects we were just told about. On a datasource we are a
    // guest in (`schemaMode !== 'managed'`) the gate throws — and before this
    // line ran here, it threw with every coercion registry still empty, so the
    // very next write to a JSON field on that datasource was bound by the
    // client's per-type defaults (see {@link registerObjectMetadata} for what
    // node-postgres does with an array and with `[]`). Nothing in this call
    // touches the database; the refusal it precedes is unchanged.
    this.registerObjectMetadata(objects);

    // DDL gate (ADR-0015 §5.1): createTable/alterTable below mutate schema.
    // Also covers `syncSchema`, which delegates here.
    this.assertSchemaMutable('initObjects');

    // [#13028] …and NOT while DDL is deferred. Under {@link deferredDdl} every
    // branch below is skipped in favour of recording the work, so there is no
    // DDL for a database to exist FOR — while `ensureDatabaseExists()` is the
    // one line here that can WRITE: it `mkdir -p`s a sqlite parent directory
    // and, on Postgres/MySQL, issues `SELECT 1` and CREATEs THE DATABASE when
    // that comes back `3D000` / `ER_BAD_DB_ERROR`.
    //
    // That made a declared dry run able to create a database (#6743 closed the
    // sqlite half by opening an absent file in memory; this is the same
    // promise, kept at the source and for every dialect), and it charged one
    // round-trip per object to do it — on a control plane at ~300ms RTT × ~80
    // objects, a `plan` that computes in seconds would have spent minutes
    // asking a database it was never going to touch whether it existed.
    //
    // ⛔ NOT a relaxation of the guarantee for real DDL: `flushDeferredSchemaDdl`
    // clears `deferredDdl` BEFORE re-entering this method with the deferred
    // objects, so the confirmed `os migrate apply` still ensures the database
    // ahead of the first `CREATE TABLE`.
    if (!this.deferredDdl) await this.ensureDatabaseExists();

    for (const obj of objects) {
      // Re-read what the registration above recorded, rather than recomputing:
      // `computeAndRecordTenantField` carries a sticky explicit-opt-out, so the
      // recorded answer IS the answer.
      const tableName = StorageNameMapping.resolveTableName(obj);
      const tenantField = this.tenantFieldByTable[tableName] ?? null;

      // Deferred-DDL mode (#3917): the call above is in-memory metadata
      // registration — coercion maps, tenancy, and the `managedObjectFields`
      // entry `detectManagedDrift()` diffs against. Everything below issues
      // DDL. `os migrate plan` / `apply` boot with the deferral armed so the
      // plan is computed against the database as it actually is, and nothing
      // is created until the operator has seen (and confirmed) the plan.
      if (this.deferredDdl) {
        this.deferredSchemaObjects.set(tableName, { ...obj, name: tableName });
        continue;
      }

      // ADR-0057 P2: rotation-declared telemetry is physically time-sharded —
      // the Rotator owns its DDL (shard tables + a read view under the base
      // name); the plain create/alter path below would collide with the view.
      const rotationPolicy = obj.lifecycle?.storage;
      if (rotationPolicy?.strategy === 'rotation' && this.supportsRotation) {
        this.tablesWithTimestamps.add(tableName);
        await this.ensureRotation(tableName, obj, rotationPolicy);
        continue;
      }

      let exists = await this.knex.schema.hasTable(tableName);
      // Recorded BEFORE the legacy-`_id` rebuild below can flip `exists`: a
      // table that was here when we arrived stays "found" even if we then drop
      // and recreate it (or refuse it). Re-syncing a table we made ourselves this boot — boot
      // runs the sync more than once, and objects registered later sync on
      // demand — is not evidence of anything preceding us, so it is ignored.
      // See `getSchemaSyncStats`.
      if (!exists) this.tablesCreatedHere.add(tableName);
      else if (!this.tablesCreatedHere.has(tableName)) this.tablesFoundExisting.add(tableName);

      if (exists) {
        const columnInfo = await this.knex(tableName).columnInfo();
        const existingColumns = Object.keys(columnInfo);

        // A table keyed by `_id` with no `id` (the ObjectQL driver's storage
        // key) is the one shape the additive path below cannot adopt, so it is
        // rebuilt — but only while it is EMPTY. [#30562] Schema sync never
        // drops a table that holds rows: on a managed datasource over an
        // existing database that table is the customer's, and the drop deleted
        // its rows behind a save that answered success. Refused here, before
        // any DDL, so nothing about the table changes. See
        // `existing-table-refusal.ts`.
        if (existingColumns.includes('_id') && !existingColumns.includes('id')) {
          const [{ rows }] = await this.knex(tableName).count({ rows: '*' });
          if (Number(rows) > 0) throw new ExistingTableAdoptionRefusal(tableName, '_id', Number(rows));
          await this.knex.schema.dropTable(tableName);
          exists = false;
        }
      }

      // Columns created unconditionally by initObjects — skip them when
      // iterating obj.fields to avoid duplicate-column errors (e.g. SQLite
      // rejects CREATE TABLE with two columns of the same name).
      const builtinColumns = new Set(['id', 'created_at', 'updated_at']);

      // Commit d0e3a885b: which columns this object's indexes will KEY ON, resolved before
      // any DDL runs. `createColumn` needs it to decide whether a bounded text
      // field takes `varchar(maxLength)` (keyable) or TEXT — a decision that is
      // only makeable at CREATE time, since no dialect turns a TEXT column into
      // a keyable one afterwards.
      const keyedColumns = indexedKeyColumns({
        table: tableName,
        fields: obj.fields ?? {},
        tenantField,
        declaredIndexes: obj.indexes,
      });

      if (!exists) {
        // [#12015] The `continue` below drops a declared field that collides
        // with a builtin column. Said BEFORE the DDL runs, so the author hears
        // it even when the CREATE goes on to fail for an unrelated reason.
        this.warnBuiltinColumnCollisions(tableName, obj.fields, builtinColumns, 'create');
        try {
          await this.knex.schema.createTable(tableName, (table) => {
            table.string('id').primary();
            this.createAuditTimestampColumn(table, 'created_at');
            this.createAuditTimestampColumn(table, 'updated_at');
            if (obj.fields) {
              for (const [name, field] of Object.entries(obj.fields)) {
                if (builtinColumns.has(name)) continue;
                // ADR-0131 D1: a fresh table's tenant column is NOT NULL.
                this.createColumn(table, name, field, keyedColumns.get(name), name === tenantField);
              }
            }
          });
        } catch (e: any) {
          // #11565: MySQL charges every bounded column's DECLARED width against
          // a per-ROW budget, and refuses the CREATE naming no column and no
          // declaration — about a table its author described entirely in
          // metadata. Re-throw the SAME failure carrying the field-level fix;
          // anything that is not that refusal is re-thrown untouched.
          await this.rethrowWithRowSizeExplanation(tableName, obj.fields, keyedColumns, null, e);
        }
        this.tablesWithTimestamps.add(tableName);
      } else {
        // [cloud#3652 D3 「写进清单 renamedFrom」] A field that declares
        // `renamedFrom` takes its old column, values and all, BEFORE the
        // additive diff below — which would otherwise add the new key as an
        // empty column beside the old one. A declaration the carry cannot
        // honour throws `DeclaredRenameRefusal` here, before any DDL on this
        // table (`declared-rename.ts`). Idempotent: once carried there is
        // nothing to plan. No-op, and no read, for an object declaring none.
        await this.carryDeclaredRenames(tableName, obj);

        const columnInfo = await this.knex(tableName).columnInfo();
        const existingColumns = Object.keys(columnInfo);

        if (existingColumns.includes('updated_at')) {
          this.tablesWithTimestamps.add(tableName);
        }

        // [#12015] The ADD COLUMN diff is keyed on "column not already there",
        // so a declared `id`/`created_at`/`updated_at` is dropped on this path
        // too — the builtin is already in `existingColumns`, so the diff below
        // never proposes it and `addedColumns` excludes it by name. Silent on
        // every boot of an existing table until now.
        this.warnBuiltinColumnCollisions(tableName, obj.fields, builtinColumns, 'alter');

        // #11565: the row budget is a property of the WHOLE row, so adding one
        // ordinary column to a wide table is refused by the width of columns
        // nobody is touching — with the same column-less server error. Named
        // here so the ADD COLUMN path is not the one that keeps it.
        const addedColumns = Object.keys(obj.fields ?? {}).filter(
          (name) => !builtinColumns.has(name) && !existingColumns.includes(name),
        );
        try {
          await this.knex.schema.alterTable(tableName, (table) => {
            if (obj.fields) {
              for (const [name, field] of Object.entries(obj.fields)) {
                if (!existingColumns.includes(name)) {
                  this.createColumn(table, name, field, keyedColumns.get(name));
                }
              }
            }
          });
        } catch (e: any) {
          await this.rethrowWithRowSizeExplanation(tableName, obj.fields, keyedColumns, addedColumns, e);
        }
      }

      // Materialize the table's index set: field-level `unique` (tenancy-aware
      // — #3696) plus object-level declared indexes (`indexes: [{ fields,
      // unique }]`, carrying the multi-column UNIQUE guarantees dedup/
      // convergence paths rely on, ADR-0030). Both go through one path so the
      // create and alter branches above cannot produce different constraints
      // for the same metadata. Done after the table is created/altered so every
      // referenced column physically exists — which is also why field-level
      // `unique` can no longer be emitted inline by `createColumn`: a composite
      // needs the tenant column to already be there.
      const declaredIndexes = obj.indexes;
      const uniqueFields = Object.values<any>(obj.fields ?? {}).some((f) =>
        isUniqueScopeDeclared(f?.unique),
      );
      if (uniqueFields || (Array.isArray(declaredIndexes) && declaredIndexes.length > 0)) {
        const colInfo = await this.knex(tableName).columnInfo();
        const physicalColumns = new Set(Object.keys(colInfo));
        await this.syncTableIndexes(
          tableName,
          obj.fields ?? {},
          declaredIndexes,
          tenantField,
          physicalColumns,
        );
        // [cloud#3652 D3] A carried column is keyed twice now: under the index
        // name of its old key and under the one the declaration names. Drop
        // the first once the second holds the same key.
        if (exists) await this.retireIndexesNamedForOldKeys(tableName, obj, tenantField);
      }

      // #2186: the additive sync above only ever ADDs tables/columns/indexes.
      // For a table that already existed, detect (and in dev, auto-reconcile)
      // any non-additive divergence between metadata and the physical schema —
      // relaxed NOT NULL, widened varchar, orphaned column, and since #3728 the
      // index dimension too (a legacy global unique that is now tenant-scoped,
      // a redefined or orphaned index).
      if (exists) {
        await this.reconcileAndWarnDrift(tableName, obj.fields ?? {}, declaredIndexes);
      }

      // #3912: converge this table's `Field.datetime` columns on the canonical
      // UTC-text storage form. A table this call just CREATED has no rows, so it
      // is canonical by construction — record that without touching the disk.
      await this.backfillCanonicalDatetimes(tableName, exists);
      // #3994: the `Field.time` twin of the line above.
      await this.backfillCanonicalTimes(tableName, exists);
      // Commit 4045b954d: converge this table's `Field.json` columns on the injective
      // JSON-text storage form the rewritten `formatInput` now writes.
      await this.backfillCanonicalJsonEncoding(tableName, exists);
      // #3942: the MySQL twin — widen legacy `TIMESTAMP` columns to `DATETIME(3)`.
      if (exists) await this.migrateMysqlDatetimeColumns(tableName, obj.fields ?? {});
      // #3994: widen legacy MySQL `TIME` columns to `TIME(3)`.
      if (exists) await this.migrateMysqlTimeColumns(tableName, obj.fields ?? {});
    }

    // Pre-create the auto_number counter table now, while we hold a fresh pooled
    // connection and are NOT inside any data transaction. Creating it lazily on
    // the first autonumber INSERT dead-locks a `/api/v1/batch` write on SQLite
    // (pool max=1: the open batch transaction owns the only connection, so the
    // lazy `ensureSequencesTable` blocks forever acquiring a second one) and
    // risks the same pool exhaustion under concurrent first-writes on
    // Postgres/MySQL. Idempotent and skipped entirely when nothing uses
    // auto_number, so it costs one `hasTable` at boot in the common case.
    const usesAutoNumber = Object.values(this.autoNumberFields).some(
      (cols) => Array.isArray(cols) && cols.length > 0,
    );
    if (usesAutoNumber && !this.deferredDdl) {
      await this.ensureSequencesTable();
    }
  }

  /** The body of `SqlDriver#withPinnedSession`; the method's docblock there is its contract. */
  static async withPinnedSession<T>(this: Pick<RotationHost, 'knex'>, fn: (run: (sql: string, bindings?: unknown[]) => Promise<unknown>) => Promise<T>): Promise<T> {
    return await this.knex.transaction(async (trx) =>
      fn((sql, bindings) => trx.raw(sql, (bindings ?? []) as any)));
  }

  /** The body of `SqlDriver#migrateMysqlDatetimeColumns`; the method's docblock there is its contract. */
  static async migrateMysqlDatetimeColumns(this: Pick<RotationHost, 'isMysql' | 'legacyMysqlTimestampColumns' | 'logDurabilityFailure' | 'logger' | 'nowColumnDefault' | 'runWideningAlters'>, table: string, fields: Record<string, any>): Promise<void> {
    if (!this.isMysql) return;
    try {
      const legacy = await this.legacyMysqlTimestampColumns(table, fields);
      if (legacy.length === 0) return;

      // #9354: built as a list, then run as one unit, so the whole widening of a
      // table shares the ONE pinned session the bounded lock wait needs.
      const statements = legacy.map((col) => {
        // The default is re-stated because MySQL drops a column's DEFAULT when
        // MODIFY does not repeat it, and an audit column without
        // `CURRENT_TIMESTAMP(3)` would start inserting NULL.
        //
        // A declared `defaultValue: 'NOW()'` column is the same case (#21241),
        // and the TIME twin ({@link migrateMysqlTimeColumns}) already restates
        // it. Measured on MySQL 8.0.46 before this line: a legacy
        // `timestamp null default current_timestamp` NOW() column came out of
        // the widening as `datetime(3)` with NO default, and an insert omitting
        // it answered `null`. Both take the expression a fresh column gets,
        // from {@link nowColumnDefault}, so the widening cannot spell a third.
        const isAudit = (AUDIT_TIMESTAMP_COLUMNS as readonly string[]).includes(col.name);
        const isNowDefault = isNowDefaultValue(fields[col.name]?.defaultValue);
        const nullClause = col.nullable ? 'null' : 'not null';
        const defaultClause = isAudit || isNowDefault ? ` default ${this.nowColumnDefault('datetime').toString()}` : '';
        return {
          sql: `alter table ?? modify column ?? datetime(${MYSQL_DATETIME_PRECISION}) ${nullClause}${defaultClause}`,
          bindings: [table, col.name] as unknown[],
        };
      });
      await this.runWideningAlters(table, statements);
      this.logger.info?.(
        `[sql-driver] widened MySQL TIMESTAMP → DATETIME(3) on ${table}: TIMESTAMP ends at 2038-01-19, ` +
          `keeps no milliseconds and converts through the session timezone`,
        { columns: legacy.map((c) => c.name) },
      );
    } catch (err) {
      // #9354: the ONE failure that must not be swallowed. Everything else on
      // this path keeps the policy the doc comment above describes; a metadata
      // lock wait that the flush bounded is the operator's answer to a command
      // they ran, and dropping it would report success for work not done.
      if (isDeferredDdlLockWaitRefusal(err)) throw err;
      this.logDurabilityFailure(
        `[sql-driver] FAILED to widen MySQL datetime columns on ${table} — the DDL did not run and boot ` +
        `continued: the columns are still legacy TIMESTAMP, so every write to them keeps truncating ` +
        `milliseconds and keeps the 2038 ceiling, while reads return exactly what was stored and nothing ` +
        `else reports the table as un-widened. Fix: identify the metadata-lock holder with ` +
        '`SHOW PROCESSLIST` or `performance_schema.metadata_locks` (or resolve the error in this ' +
        'record\'s meta), end it, then re-run `os migrate apply` or restart — the widening is ' +
        're-detected from `information_schema` and is idempotent, so re-running is safe.',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  /** The body of `SqlDriver#migrateMysqlTimeColumns`; the method's docblock there is its contract. */
  static async migrateMysqlTimeColumns(this: Pick<RotationHost, 'isMysql' | 'legacyMysqlTimeColumns' | 'logDurabilityFailure' | 'logger' | 'runWideningAlters'>, table: string, fields: Record<string, any>): Promise<void> {
    if (!this.isMysql) return;
    try {
      const legacy = await this.legacyMysqlTimeColumns(table, fields);
      if (legacy.length === 0) return;

      // #9354: the datetime twin's seam, for the same reason — this ALTER takes
      // the same exclusive metadata lock and blocks on the same holder.
      const statements = legacy.map((col) => {
        // MODIFY drops a default it does not restate. A `defaultValue: 'NOW()'`
        // column gets the canonical UTC expression default (`nowColumnDefault`);
        // its legacy `current_timestamp()` default read the SESSION's zone, so
        // dropping-and-replacing it is a fix, not collateral.
        const isNowDefault = isNowDefaultValue(fields[col.name]?.defaultValue);
        const defaultClause = isNowDefault ? ' default (cast(utc_timestamp(3) as time(3)))' : '';
        return {
          sql: `alter table ?? modify column ?? time(3) ${col.nullable ? 'null' : 'not null'}${defaultClause}`,
          bindings: [table, col.name] as unknown[],
        };
      });
      await this.runWideningAlters(table, statements);
      this.logger.info?.(
        `[sql-driver] widened MySQL TIME → TIME(3) on ${table}: a zero-precision TIME rounds the ` +
          `canonical milliseconds to the nearest second, changing the stored wall clock`,
        { columns: legacy.map((c) => c.name) },
      );
    } catch (err) {
      // #9354: the ONE failure that must not be swallowed. Everything else on
      // this path keeps the policy the doc comment above describes; a metadata
      // lock wait that the flush bounded is the operator's answer to a command
      // they ran, and dropping it would report success for work not done.
      if (isDeferredDdlLockWaitRefusal(err)) throw err;
      this.logDurabilityFailure(
        `[sql-driver] FAILED to widen MySQL time columns on ${table} — the DDL did not run and boot ` +
        `continued: the columns are still zero-precision TIME, so every fractional-second write to them ` +
        `keeps being ROUNDED to whole seconds — the stored wall clock is not the one that was asked for — ` +
        `while reads return exactly what was stored and nothing else reports the table as un-widened. ` +
        'Fix: identify the metadata-lock holder with `SHOW PROCESSLIST` or ' +
        '`performance_schema.metadata_locks` (or resolve the error in this record\'s meta), end it, then ' +
        're-run `os migrate apply` or restart — the widening is re-detected from `information_schema` ' +
        'and is idempotent, so re-running is safe.',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }
}
