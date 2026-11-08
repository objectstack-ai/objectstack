// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Field mapping" section of `SqlDriver`: the bodies of
 * `mapSortField`, `paginationTieBreaker`, `orderKeysFor`, `remoteColumn`,
 * `applyWriteColumnMap`, `mapAggregateFunc` moved out of `sql-driver.ts` whole
 * by `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link FieldMappingFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link FieldMappingHost}: exactly the
 * `SqlDriver` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `fieldMappingHost` in
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

import type { DriverQuery } from '@objectstack/spec/contracts';
import { StorageNameMapping } from '@objectstack/spec/system';
import { SQL_AGGREGATE_FUNCTIONS, refuseAggregateFunction } from './sql-driver-top-level.js';
import type { SqlAggregateLowering } from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link FieldMappingFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface FieldMappingHost {
  readonly columnFieldByObject: SqlDriver['columnFieldByObject'];
  readonly fieldColumnByObject: SqlDriver['fieldColumnByObject'];
  introspectPrimaryKeys: SqlDriver['introspectPrimaryKeys'];
  readonly logger: SqlDriver['logger'];
  readonly managedObjectFields: SqlDriver['managedObjectFields'];
  readonly mssqlPagingKeyByObject: SqlDriver['mssqlPagingKeyByObject'];
  readonly nondeterministicPagingWarned: SqlDriver['nondeterministicPagingWarned'];
  paginationTieBreaker: SqlDriver['paginationTieBreaker'];
  readonly physicalSchemaByObject: SqlDriver['physicalSchemaByObject'];
  readonly physicalTableByObject: SqlDriver['physicalTableByObject'];
}

/** The bodies of the "Field mapping" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class FieldMappingFacet {
  /** The body of `SqlDriver#mapSortField`; the method's docblock there is its contract. */
  static mapSortField(field: string): string {
    if (field === 'createdAt') return 'created_at';
    if (field === 'updatedAt') return 'updated_at';
    return field;
  }

  /** The body of `SqlDriver#paginationTieBreaker`; the method's docblock there is its contract. */
  static paginationTieBreaker(this: Pick<FieldMappingHost, 'fieldColumnByObject' | 'managedObjectFields' | 'mssqlPagingKeyByObject'>, object: string): string | null {
    const tableName = StorageNameMapping.resolveTableName({ name: object } as any);
    const managed =
      this.managedObjectFields.has(tableName) || this.managedObjectFields.has(object);
    if (managed) return 'id';
    // A federated object whose binding NAMES its key column — `external.columnMap`
    // mapping a remote column to `id` — is not a guess: the binding declares
    // which remote column identifies a row, the column the by-id doors already
    // address.
    if (this.fieldColumnByObject[object]?.id) return 'id';
    // [#31327] Otherwise, a federated SQL Server table's own single-column key,
    // read from its catalog by `primeMssqlPagingKey` — not a guess either: an
    // entry exists only when the remote catalog named the key. Without one of
    // the three, nothing is known and nothing is imposed.
    return this.mssqlPagingKeyByObject.get(object) ?? null;
  }

  /** The body of `SqlDriver#primeMssqlPagingKey`; the method's docblock there is its contract. */
  static async primeMssqlPagingKey(this: Pick<FieldMappingHost, 'columnFieldByObject' | 'introspectPrimaryKeys' | 'mssqlPagingKeyByObject' | 'physicalSchemaByObject' | 'physicalTableByObject'>, object: string): Promise<void> {
    if (this.mssqlPagingKeyByObject.has(object)) return;
    const remoteTable = this.physicalTableByObject[object];
    if (remoteTable === undefined) return;
    const remoteSchema = this.physicalSchemaByObject[object];
    let keyColumns: string[];
    try {
      keyColumns = await this.introspectPrimaryKeys(
        remoteSchema ? `${remoteSchema}.${remoteTable}` : remoteTable,
      );
    } catch {
      return;
    }
    const keyColumn = keyColumns.length === 1 ? keyColumns[0]! : null;
    const field = keyColumn === null ? null : (this.columnFieldByObject[object]?.[keyColumn] ?? keyColumn);
    this.mssqlPagingKeyByObject.set(object, field);
  }

  /** The body of `SqlDriver#orderKeysFor`; the method's docblock there is its contract. */
  static orderKeysFor(this: Pick<FieldMappingHost, 'logger' | 'nondeterministicPagingWarned' | 'paginationTieBreaker'>, object: string, query: DriverQuery, opts?: { singleRowLookup?: boolean }): Array<{ field: string; direction: 'asc' | 'desc' }> {
    const keys: Array<{ field: string; direction: 'asc' | 'desc' }> = [];
    if (Array.isArray(query.orderBy)) {
      for (const item of query.orderBy) {
        if (item.field) {
          keys.push({ field: item.field, direction: item.order === 'desc' ? 'desc' : 'asc' });
        }
      }
    }

    const paged =
      !opts?.singleRowLookup && (query.limit !== undefined || query.offset !== undefined);
    if (keys.length === 0 && !paged) return keys;

    const tieBreaker = this.paginationTieBreaker(object);
    if (tieBreaker && !keys.some((k) => k.field === tieBreaker)) {
      keys.push({ field: tieBreaker, direction: keys[keys.length - 1]?.direction ?? 'asc' });
    } else if (!tieBreaker && keys.length === 0) {
      // Paged, unsorted, and no column this driver can trust to order by: the
      // read goes out exactly as before, and its pages are not a partition.
      // Say so once per object rather than leave it to be discovered by a user
      // counting records — a guarantee the contract states as MUST, quietly
      // unavailable, is the same invisible failure it was written against.
      // (Sorted reads on such a table keep the caller's own ORDER BY, so only
      // the ties within it reshuffle; this case has nothing at all.)
      if (!this.nondeterministicPagingWarned.has(object)) {
        this.nondeterministicPagingWarned.add(object);
        this.logger.warn(
          `Paged read of '${object}' is NOT deterministic: this driver did not create the table, `
            + 'so it cannot name a unique column to order by, and the query asked for no sort of '
            + 'its own. Walking the pages may serve one row twice and never serve another. '
            + 'Give the query an `orderBy` on a unique column, or declare the '
            + 'object so this driver manages its table.',
        );
      }
    }
    return keys;
  }

  /** The body of `SqlDriver#remoteColumn`; the method's docblock there is its contract. */
  static remoteColumn(this: Pick<FieldMappingHost, 'fieldColumnByObject'>, object: string | null | undefined, field: string, fallback: string): string {
    const m = object ? this.fieldColumnByObject[object] : undefined;
    return (m && m[field]) || fallback;
  }

  /** The body of `SqlDriver#applyWriteColumnMap`; the method's docblock there is its contract. */
  static applyWriteColumnMap(this: Pick<FieldMappingHost, 'fieldColumnByObject'>, object: string, data: any): any {
    const m = this.fieldColumnByObject[object];
    if (!m || !data || typeof data !== 'object') return data;
    const out: any = {};
    for (const [k, v] of Object.entries(data)) out[m[k] ?? k] = v;
    return out;
  }

  /** The body of `SqlDriver#mapAggregateFunc`; the method's docblock there is its contract. */
  static mapAggregateFunc(func: string): SqlAggregateLowering {
    const lowering = SQL_AGGREGATE_FUNCTIONS.get(func);
    if (lowering !== undefined) return lowering;
    refuseAggregateFunction(func);
  }
}
