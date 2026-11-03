// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Data-lifecycle rotation (ADR-0057 P2)" section of
 * `SqlDriver`: the bodies of `computeTenantField`,
 * `registerManagedObjectMetadata`, `migrateMysqlDatetimeColumns`,
 * `migrateMysqlTimeColumns` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link RotationHost}: exactly the
 * `SqlDriver` members they read. Each method hands its body one literal of the
 * members that body reads, plus a `.call`: methods go as closures that call
 * them on the driver at call time (the builder factory as a bound reference),
 * so a subclass override or an instance spy is still the one reached; fields
 * and accessors go as GETTERS, read when the body reads them, as they were on
 * the class.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form
 * no evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { FILE_REFERENCE_TYPES, NUMERIC_VALUE_TYPES, isTenancyDisabled, parseAutonumberFormat, resolveAutonumberFormat } from '@objectstack/spec/data';
import type { AutonumberToken } from '@objectstack/spec/data';
import { aggregandColumnClass } from '@objectstack/core';
import { StorageNameMapping } from '@objectstack/spec/system';
import {
  AUDIT_TIMESTAMP_COLUMNS, MYSQL_DATETIME_PRECISION, NUMERIC_SCALAR_TYPES, declaredValueShapes,
  isDeferredDdlLockWaitRefusal, isMultiValuedColumn, isNowDefaultValue,
} from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface RotationHost {
  readonly autoNumberFields: SqlDriver['autoNumberFields'];
  readonly booleanFields: SqlDriver['booleanFields'];
  computeAndRecordTenantField: SqlDriver['computeAndRecordTenantField'];
  readonly dateFields: SqlDriver['dateFields'];
  readonly datetimeFields: SqlDriver['datetimeFields'];
  readonly fractionalNumericFields: SqlDriver['fractionalNumericFields'];
  isJsonField: SqlDriver['isJsonField'];
  readonly isMysql: SqlDriver['isMysql'];
  readonly jsonFields: SqlDriver['jsonFields'];
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
  readonly physicalKeyIndexes: SqlDriver['physicalKeyIndexes'];
  runWideningAlters: SqlDriver['runWideningAlters'];
  readonly tenantFieldByTable: SqlDriver['tenantFieldByTable'];
  readonly timeFields: SqlDriver['timeFields'];
  readonly undeclaredAuditTimestampFields: SqlDriver['undeclaredAuditTimestampFields'];
  readonly updatedAtColumnState: SqlDriver['updatedAtColumnState'];
  readonly valueShapeFields: SqlDriver['valueShapeFields'];
}

/** The body of `SqlDriver#computeTenantField`; the method's docblock there is its contract. */
export function computeTenantField(schema: { fields?: Record<string, any>; tenancy?: any }): string | null {
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

/** The body of `SqlDriver#registerManagedObjectMetadata`; the method's docblock there is its contract. */
export function registerManagedObjectMetadata(this: Pick<RotationHost, 'autoNumberFields' | 'booleanFields' | 'computeAndRecordTenantField' | 'dateFields' | 'datetimeFields' | 'fractionalNumericFields' | 'isJsonField' | 'jsonFields' | 'managedObjectFields' | 'managedObjectIndexes' | 'mediaFields' | 'numericFields' | 'numericValueFields' | 'physicalKeyIndexes' | 'tenantFieldByTable' | 'timeFields' | 'undeclaredAuditTimestampFields' | 'updatedAtColumnState' | 'valueShapeFields'>, obj: { name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[] }): { tableName: string; tenantField: string | null } {
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

/** The body of `SqlDriver#migrateMysqlDatetimeColumns`; the method's docblock there is its contract. */
export async function migrateMysqlDatetimeColumns(this: Pick<RotationHost, 'isMysql' | 'legacyMysqlTimestampColumns' | 'logDurabilityFailure' | 'logger' | 'nowColumnDefault' | 'runWideningAlters'>, table: string, fields: Record<string, any>): Promise<void> {
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
export async function migrateMysqlTimeColumns(this: Pick<RotationHost, 'isMysql' | 'legacyMysqlTimeColumns' | 'logDurabilityFailure' | 'logger' | 'runWideningAlters'>, table: string, fields: Record<string, any>): Promise<void> {
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
