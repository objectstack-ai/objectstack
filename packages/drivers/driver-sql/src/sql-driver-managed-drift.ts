// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Managed-schema drift & reconcile (#2186)" section of
 * `SqlDriver`: the bodies of `isProductionEnv`, `buildRebuiltColumn`,
 * `dropIndexIfExists` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link ManagedDriftHost}: exactly the
 * `SqlDriver` members they read. Each method hands its body one literal of the
 * members that body reads, plus a `.call`: methods go as closures that call
 * them on the driver at call time, so a subclass override or an instance spy
 * is still the one reached; fields and accessors go as GETTERS, read when the
 * body reads them, as they were on the class.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form
 * no evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { Knex } from 'knex';
import type { SqlDriver, IntrospectedColumn } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface ManagedDriftHost {
  readonly isMysql: SqlDriver['isMysql'];
  readonly isPostgres: SqlDriver['isPostgres'];
  readonly knex: SqlDriver['knex'];
}

/** The body of `SqlDriver#isProductionEnv`; the method's docblock there is its contract. */
export function isProductionEnv(): boolean {
    try {
      return (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
    } catch {
      return false;
    }
  }

/** The body of `SqlDriver#buildRebuiltColumn`; the method's docblock there is its contract. */
export function buildRebuiltColumn(t: Knex.CreateTableBuilder, c: IntrospectedColumn): any {
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

/** The body of `SqlDriver#dropIndexIfExists`; the method's docblock there is its contract. */
export async function dropIndexIfExists(this: Pick<ManagedDriftHost, 'isMysql' | 'isPostgres' | 'knex'>, tableName: string, indexName: string): Promise<boolean> {
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
