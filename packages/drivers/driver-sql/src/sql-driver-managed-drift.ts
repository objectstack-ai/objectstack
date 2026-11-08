// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Managed-schema drift & reconcile (#2186)" section of
 * `SqlDriver`: the bodies of `dialectName`, `isProductionEnv`,
 * `probeNullSafeUniqueDuplicates`, `buildRebuiltColumn`, `buildIndexName`,
 * `getExistingIndexNames`, `uniqueIndexesFromFields`, `dropIndexIfExists`,
 * `syncTableIndexes` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link ManagedDriftFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link ManagedDriftHost}: exactly the
 * `SqlDriver` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `managedDriftHost` in
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

import { GLOBAL_TENANT, buildIndexName, uniqueIndexesFromFields } from './schema-drift.js';
import type { SqlDialectName } from './schema-drift.js';
import type { Knex } from 'knex';
import { uniqueProbeNotNullClause } from './sql-driver-top-level.js';
import type { IntrospectedColumn } from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link ManagedDriftFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface ManagedDriftHost {
  introspectIndexes: SqlDriver['introspectIndexes'];
  readonly isMysql: SqlDriver['isMysql'];
  readonly isOracle: SqlDriver['isOracle'];
  readonly isPostgres: SqlDriver['isPostgres'];
  readonly isSqlite: SqlDriver['isSqlite'];
  readonly knex: SqlDriver['knex'];
  syncDeclaredIndexes: SqlDriver['syncDeclaredIndexes'];
  uniqueIndexesFromFields: SqlDriver['uniqueIndexesFromFields'];
}

/** The bodies of the "Managed-schema drift & reconcile (#2186)" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class ManagedDriftFacet {
  /** The body of `SqlDriver#dialectName`; the method's docblock there is its contract. */
  static dialectName(this: Pick<ManagedDriftHost, 'isMysql' | 'isOracle' | 'isPostgres' | 'isSqlite'>): SqlDialectName {
    if (this.isSqlite) return 'sqlite';
    if (this.isPostgres) return 'postgres';
    if (this.isMysql) return 'mysql';
    if (this.isOracle) return 'oracle';
    return 'unknown';
  }

  /** The body of `SqlDriver#isProductionEnv`; the method's docblock there is its contract. */
  static isProductionEnv(): boolean {
    try {
      return (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
    } catch {
      return false;
    }
  }

  /** The body of `SqlDriver#probeNullSafeUniqueDuplicates`; the method's docblock there is its contract. */
  static async probeNullSafeUniqueDuplicates(this: Pick<ManagedDriftHost, 'knex'>, table: string, columns: string[], nullSafeColumns: string[]): Promise<Array<{ key: string; rows: number }>> {
    const ns = new Set(nullSafeColumns);
    const q = (id: string) => this.knex.ref(id).toQuery();
    const parts = columns.map((c) =>
      ns.has(c) ? `COALESCE(${q(c)}, '${GLOBAL_TENANT}')` : q(c),
    );
    const selectList = parts.map((p, i) => `${p} AS k${i}`).join(', ');
    const groupList = parts.join(', ');
    const sql =
      `SELECT ${selectList}, COUNT(*) AS n FROM ${q(table)}` +
      `${uniqueProbeNotNullClause(columns, ns, q)} ` +
      `GROUP BY ${groupList} HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 20`;
    const res: any = await this.knex.raw(sql);
    const rows: any[] = Array.isArray(res) ? (Array.isArray(res[0]) ? res[0] : res) : (res?.rows ?? []);
    return rows.map((r: any) => ({
      key: columns.map((c, i) => `${c}=${JSON.stringify(r[`k${i}`])}`).join(', '),
      rows: Number(r.n ?? r.N ?? 0),
    }));
  }

  /** The body of `SqlDriver#buildRebuiltColumn`; the method's docblock there is its contract. */
  static buildRebuiltColumn(t: Knex.CreateTableBuilder, c: IntrospectedColumn): any {
    if (c.name === 'id') return t.string('id').primary();
    const ty = (c.type || 'text').toLowerCase();
    if (ty.includes('int')) return t.integer(c.name);
    if (/(real|floa|doub|num|dec)/.test(ty)) return t.float(c.name);
    if (ty.includes('bool')) return t.boolean(c.name);
    if (ty.includes('datetime') || ty.includes('timestamp')) return t.timestamp(c.name);
    if (ty === 'date') return t.date(c.name);
    if (ty === 'time') return t.time(c.name);
    if (ty.includes('json')) return t.json(c.name);
    if (ty.includes('blob') || ty.includes('binary')) return t.binary(c.name);
    if (ty.includes('text')) return t.text(c.name);
    return t.string(c.name);
  }

  /** The body of `SqlDriver#buildIndexName`; the method's docblock there is its contract. */
  static buildIndexName(tableName: string, fields: string[], unique: boolean): string {
    return buildIndexName(tableName, fields, unique);
  }

  /** The body of `SqlDriver#getExistingIndexNames`; the method's docblock there is its contract. */
  static async getExistingIndexNames(this: Pick<ManagedDriftHost, 'introspectIndexes'>, tableName: string): Promise<Set<string>> {
    return new Set((await this.introspectIndexes(tableName, { onFailure: 'partial' })).map((i) => i.name));
  }

  /** The body of `SqlDriver#uniqueIndexesFromFields`; the method's docblock there is its contract. */
  static uniqueIndexesFromFields(tableName: string, fields: Record<string, any>, tenantField: string | null): Array<{ name: string; fields: string[]; unique: true; nullSafeColumns?: string[] }> {
    return uniqueIndexesFromFields(tableName, fields, tenantField).map((i) => ({
      name: i.name,
      fields: i.columns,
      unique: true as const,
      ...(i.nullSafeColumns ? { nullSafeColumns: i.nullSafeColumns } : {}),
    }));
  }

  /** The body of `SqlDriver#dropIndexIfExists`; the method's docblock there is its contract. */
  static async dropIndexIfExists(this: Pick<ManagedDriftHost, 'isMysql' | 'isPostgres' | 'knex'>, tableName: string, indexName: string): Promise<boolean> {
    const attempts: string[] = this.isPostgres
      ? [
          `ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??`,
          `DROP INDEX IF EXISTS ??`,
        ]
      : this.isMysql
        ? [`ALTER TABLE ?? DROP INDEX ??`]
        : [`DROP INDEX IF EXISTS ??`];

    let dropped = false;
    for (const sql of attempts) {
      try {
        const bindings = sql.startsWith('ALTER TABLE') ? [tableName, indexName] : [indexName];
        await this.knex.raw(sql, bindings);
        dropped = true;
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        // "does not exist" / "check that column/key exists" — nothing to drop.
        if (/does not exist|doesn't exist|no such index|check that column/i.test(msg)) continue;
        throw e;
      }
    }
    return dropped;
  }

  /** The body of `SqlDriver#syncTableIndexes`; the method's docblock there is its contract. */
  static async syncTableIndexes(this: Pick<ManagedDriftHost, 'syncDeclaredIndexes' | 'uniqueIndexesFromFields'>, tableName: string, fields: Record<string, any>, declaredIndexes: any[] | undefined, tenantField: string | null, physicalColumns: Set<string>): Promise<void> {
    const fromFields = this.uniqueIndexesFromFields(tableName, fields, tenantField);
    const declared = Array.isArray(declaredIndexes) ? declaredIndexes : [];
    if (fromFields.length === 0 && declared.length === 0) return;
    // Pass the tenant column through rather than letting `syncDeclaredIndexes`
    // re-resolve it: every caller of this method already holds the value the
    // registration recorded, and a declared `unique: 'organization'` index
    // (ADR-0120 D1) must scope against exactly that column.
    await this.syncDeclaredIndexes(tableName, [...fromFields, ...declared], physicalColumns, tenantField, fields);
  }
}
