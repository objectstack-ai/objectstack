// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Query Plan Analysis" section of `SqlDriver`: the bodies
 * of `explain`, `analyzeQuery` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link QueryPlanFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link QueryPlanHost}: exactly the
 * `SqlDriver` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `queryPlanHost` in
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

import type { DriverOptions } from '@objectstack/spec/data';
import type { DriverQuery } from '@objectstack/spec/contracts';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link QueryPlanFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface QueryPlanHost {
  analyzeQuery: SqlDriver['analyzeQuery'];
  applyFilters: SqlDriver['applyFilters'];
  applyTenantScope: SqlDriver['applyTenantScope'];
  readonly config: SqlDriver['config'];
  getBuilder: SqlDriver['getBuilder'];
  readonly isMysql: SqlDriver['isMysql'];
  readonly isPostgres: SqlDriver['isPostgres'];
  readonly isSqlite: SqlDriver['isSqlite'];
  readonly knex: SqlDriver['knex'];
  mapSortField: SqlDriver['mapSortField'];
}

/** The bodies of the "Query Plan Analysis" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class QueryPlanFacet {
  /** The body of `SqlDriver#explain`; the method's docblock there is its contract. */
  static async explain(this: Pick<QueryPlanHost, 'analyzeQuery'>, object: string, query: DriverQuery, options?: DriverOptions): Promise<unknown> {
    return this.analyzeQuery(object, query, options);
  }

  /** The body of `SqlDriver#analyzeQuery`; the method's docblock there is its contract. */
  static async analyzeQuery(this: Pick<QueryPlanHost, 'applyFilters' | 'applyTenantScope' | 'config' | 'getBuilder' | 'isMysql' | 'isPostgres' | 'isSqlite' | 'knex' | 'mapSortField'>, object: string, query: DriverQuery, options?: DriverOptions): Promise<any> {
    const builder = this.getBuilder(object, options);
    // A PLAN, not rows — so this is a smaller fix than the one above, and it is
    // made on its own merits rather than riding in on that one (#6792). It is
    // the SAME defect #6577 fixed on this method one builder line lower: a plan
    // is only worth reading if it explains the statement `find()` would
    // actually run, and a missing tenant predicate is not a cosmetic
    // difference — it changes selectivity and therefore which index the planner
    // picks, so the EXPLAIN answers for a query nobody will execute.
    // Measured on `main` at `6595262`, `tenantId: 'org_a'`:
    //   analyze -> select * from `os6792_account`
    //   find    -> select * from `os6792_account`
    //              where (`organization_id` = ? or `organization_id` is null)
    //              order by `id` asc
    this.applyTenantScope(builder, object, options);

    if (query.fields) {
      builder.select(query.fields);
    } else {
      builder.select('*');
    }

    if (query.where) {
      this.applyFilters(builder, query.where, options);
    }

    if (query.orderBy && Array.isArray(query.orderBy)) {
      for (const sort of query.orderBy) {
        builder.orderBy(this.mapSortField(sort.field), sort.order || 'asc');
      }
    }

    // PRESENCE, not truthiness — see `findWithWindowFunctions()` above (#6577).
    // The stake is different here and no smaller: this door returns a PLAN, and
    // a plan is only worth reading if it explains the statement `find()` would
    // actually run. Measured on `main` before this line changed: `{ limit: 0 }`
    // compiled to `select * from `orders`` while `find()` sent
    // `select * from `orders` order by `id` asc limit ?` — an EXPLAIN for a
    // different query, which is the one thing an EXPLAIN must never be.
    if (query.limit !== undefined) builder.limit(query.limit);
    if (query.offset !== undefined) builder.offset(query.offset);

    const sql = builder.toSQL();
    const client = (this.config as any).client;
    let explainResults: any;

    try {
      if (this.isPostgres) {
        explainResults = await this.knex.raw(`EXPLAIN (FORMAT JSON, ANALYZE) ${sql.sql}`, sql.bindings);
      } else if (this.isMysql) {
        explainResults = await this.knex.raw(`EXPLAIN FORMAT=JSON ${sql.sql}`, sql.bindings);
      } else if (this.isSqlite) {
        explainResults = await this.knex.raw(`EXPLAIN QUERY PLAN ${sql.sql}`, sql.bindings);
      } else {
        return {
          sql: sql.sql,
          bindings: sql.bindings,
          client,
          note: 'EXPLAIN not supported for this database client',
        };
      }

      return { sql: sql.sql, bindings: sql.bindings, client, plan: explainResults };
    } catch (error: any) {
      return {
        sql: sql.sql,
        bindings: sql.bindings,
        client,
        error: error.message,
        note: 'Failed to execute EXPLAIN.',
      };
    }
  }
}
