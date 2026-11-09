// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Schema Sync (syncSchema / init)" section of
 * `SqlDriver`: the bodies of `syncSchema`, `dropTable`, `reclaimSpace` moved
 * out of `sql-driver.ts` whole by `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link SchemaSyncSectionFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link SchemaSyncSectionHost}: exactly the
 * `SqlDriver` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `schemaSyncSectionHost` in
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
import { reclaimBetterSqlite3 } from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link SchemaSyncSectionFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface SchemaSyncSectionHost {
  assertSchemaMutable: SqlDriver['assertSchemaMutable'];
  initObjects: SqlDriver['initObjects'];
  readonly isSqlite: SqlDriver['isSqlite'];
  readonly knex: SqlDriver['knex'];
}

/** The bodies of the "Schema Sync (syncSchema / init)" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class SchemaSyncSectionFacet {
  /** The body of `SqlDriver#syncSchema`; the method's docblock there is its contract. */
  static async syncSchema(this: Pick<SchemaSyncSectionHost, 'initObjects'>, object: string, schema: unknown, _options?: DriverOptions): Promise<void> {
    const objectDef = schema as { name: string; fields?: Record<string, any> };
    // The caller passes the resolved physical table name as `object`. Override
    // the def's `name` to ensure DDL targets the physical table even if the
    // schema's `name` is the canonical object name (e.g. 'account').
    await this.initObjects([{ ...objectDef, name: object }]);
  }

  /** The body of `SqlDriver#dropTable`; the method's docblock there is its contract. */
  static async dropTable(this: Pick<SchemaSyncSectionHost, 'assertSchemaMutable' | 'knex'>, object: string, _options?: DriverOptions): Promise<void> {
    this.assertSchemaMutable('dropTable');
    await this.knex.schema.dropTableIfExists(object);
  }

  /** The body of `SqlDriver#reclaimSpace`; the method's docblock there is its contract. */
  static async reclaimSpace(this: Pick<SchemaSyncSectionHost, 'isSqlite' | 'knex'>, _options?: DriverOptions): Promise<void> {
    if (!this.isSqlite) return;
    const client = this.knex.client;
    if (client.driverName === 'better-sqlite3') {
      const connection = await client.acquireConnection();
      try {
        reclaimBetterSqlite3(connection);
      } finally {
        await client.releaseConnection(connection);
      }
      return;
    }
    await this.knex.raw('PRAGMA incremental_vacuum');
  }
}
