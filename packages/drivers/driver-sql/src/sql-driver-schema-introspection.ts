// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Schema Introspection" section of `SqlDriver`: the
 * bodies of `listPhysicalColumns` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link SchemaIntrospectionFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link SchemaIntrospectionHost}: exactly
 * the `SqlDriver` members they read, private ones included. Every stub hands
 * its body, by a `.call`, the same host: `schemaIntrospectionHost` in
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
import type { Knex } from 'knex';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link SchemaIntrospectionFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface SchemaIntrospectionHost {
  readonly knex: SqlDriver['knex'];
  readonly physicalSchemaByObject: SqlDriver['physicalSchemaByObject'];
  readonly physicalTableByObject: SqlDriver['physicalTableByObject'];
}

/** The bodies of the "Schema Introspection" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class SchemaIntrospectionFacet {
  /** The body of `SqlDriver#listPhysicalColumns`; the method's docblock there is its contract. */
  static async listPhysicalColumns(this: Pick<SchemaIntrospectionHost, 'knex' | 'physicalSchemaByObject' | 'physicalTableByObject'>, object: string, options?: DriverOptions): Promise<string[]> {
    let catalog = this.knex(this.physicalTableByObject[object] ?? object);
    const remoteSchema = this.physicalSchemaByObject[object];
    if (remoteSchema) catalog = catalog.withSchema(remoteSchema);
    if (options?.transaction) catalog = catalog.transacting(options.transaction as Knex.Transaction);
    const info = (await catalog.columnInfo()) as Record<string, unknown>;
    return Object.keys(info ?? {});
  }
}
