// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Data-lifecycle rotation (ADR-0057 P2)" section of
 * `SqlDriver`: the bodies of `rotationShardsOf`, `rotationWriteTarget`,
 * `rotateShards`, `aliasShardBookkeeping`, `computeTenantField`,
 * `computeAndRecordTenantField`, `registerManagedObjectMetadata`,
 * `registerObjectMetadata`, `withPinnedSession` moved out of `sql-driver.ts`
 * whole by `scripts/codemod-split-sql-driver.mjs`.
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
import {
  AUDIT_TIMESTAMP_COLUMNS, NUMERIC_SCALAR_TYPES, declaredValueShapes, isMultiValuedColumn,
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
  readonly booleanFields: SqlDriver['booleanFields'];
  computeAndRecordTenantField: SqlDriver['computeAndRecordTenantField'];
  computeTenantField: SqlDriver['computeTenantField'];
  readonly dateFields: SqlDriver['dateFields'];
  readonly datetimeFields: SqlDriver['datetimeFields'];
  readonly dialectName: SqlDriver['dialectName'];
  ensureRotation: SqlDriver['ensureRotation'];
  readonly fractionalNumericFields: SqlDriver['fractionalNumericFields'];
  isJsonField: SqlDriver['isJsonField'];
  readonly jsonFields: SqlDriver['jsonFields'];
  readonly knex: SqlDriver['knex'];
  readonly managedObjectFields: SqlDriver['managedObjectFields'];
  readonly managedObjectIndexes: SqlDriver['managedObjectIndexes'];
  readonly mediaFields: SqlDriver['mediaFields'];
  readonly numericFields: SqlDriver['numericFields'];
  readonly numericValueFields: SqlDriver['numericValueFields'];
  organizationObjectRegistered: SqlDriver['organizationObjectRegistered'];
  readonly physicalKeyIndexes: SqlDriver['physicalKeyIndexes'];
  registerManagedObjectMetadata: SqlDriver['registerManagedObjectMetadata'];
  readonly rotationStateByTable: SqlDriver['rotationStateByTable'];
  readonly supportsRotation: SqlDriver['supportsRotation'];
  readonly tablesWithTimestamps: SqlDriver['tablesWithTimestamps'];
  readonly tenantFieldByTable: SqlDriver['tenantFieldByTable'];
  readonly tenantOptOutByTable: SqlDriver['tenantOptOutByTable'];
  readonly timeFields: SqlDriver['timeFields'];
  readonly undeclaredAuditTimestampFields: SqlDriver['undeclaredAuditTimestampFields'];
  readonly updatedAtColumnState: SqlDriver['updatedAtColumnState'];
  readonly valueShapeFields: SqlDriver['valueShapeFields'];
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

  /** The body of `SqlDriver#withPinnedSession`; the method's docblock there is its contract. */
  static async withPinnedSession<T>(this: Pick<RotationHost, 'knex'>, fn: (run: (sql: string, bindings?: unknown[]) => Promise<unknown>) => Promise<T>): Promise<T> {
    return await this.knex.transaction(async (trx) =>
      fn((sql, bindings) => trx.raw(sql, (bindings ?? []) as any)));
  }
}
