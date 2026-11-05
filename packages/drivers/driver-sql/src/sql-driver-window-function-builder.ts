// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Window function builder" section of `SqlDriver`: the
 * bodies of `buildWindowFunction` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link WindowFunctionBuilderFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link WindowFunctionBuilderHost}: exactly
 * the `SqlDriver` members they read, private ones included. Every stub hands
 * its body, by a `.call`, the same host: `windowFunctionBuilderHost` in
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

import {
  SQL_WINDOW_FUNCTIONS, SQL_WINDOW_SORT_DIRECTIONS, invalidWindowFunctionQueryError,
} from './sql-driver-top-level.js';
import type { SqlWindowFunctionSpec } from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link WindowFunctionBuilderFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface WindowFunctionBuilderHost {
  readonly knex: SqlDriver['knex'];
  mapSortField: SqlDriver['mapSortField'];
}

/** The bodies of the "Window function builder" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class WindowFunctionBuilderFacet {
  /** The body of `SqlDriver#buildWindowFunction`; the method's docblock there is its contract. */
  static buildWindowFunction(this: Pick<WindowFunctionBuilderHost, 'knex' | 'mapSortField'>, spec: SqlWindowFunctionSpec): string {
    const func = SQL_WINDOW_FUNCTIONS.get(String(spec.function).toLowerCase());
    if (func === undefined) {
      throw invalidWindowFunctionQueryError(
        `Window function ${JSON.stringify(String(spec.function))} is not one this door compiles. ` +
        `Supported (argument-less, any case): ${[...SQL_WINDOW_FUNCTIONS.keys()].join(', ')}. ` +
        `Fix the "function" key of the windowFunctions[] entry.`,
      );
    }
    const column = (field: string) => this.knex.ref(this.mapSortField(String(field))).toQuery();
    let sql = `${func}()`;

    const overParts: string[] = [];

    if (spec.partitionBy && Array.isArray(spec.partitionBy) && spec.partitionBy.length > 0) {
      overParts.push(`PARTITION BY ${spec.partitionBy.map(column).join(', ')}`);
    }

    if (spec.orderBy && Array.isArray(spec.orderBy) && spec.orderBy.length > 0) {
      const orderFields = spec.orderBy
        .map((s) => {
          const order = SQL_WINDOW_SORT_DIRECTIONS.get(String(s.order || 'asc').toLowerCase());
          if (order === undefined) {
            throw invalidWindowFunctionQueryError(
              `Window sort direction ${JSON.stringify(String(s.order))} is not "asc" or "desc". ` +
              `Fix the "order" key of the windowFunctions[].orderBy entry.`,
            );
          }
          return `${column(s.field)} ${order}`;
        })
        .join(', ');
      overParts.push(`ORDER BY ${orderFields}`);
    }

    sql += overParts.length > 0 ? ` OVER (${overParts.join(' ')})` : ` OVER ()`;
    return sql;
  }
}
