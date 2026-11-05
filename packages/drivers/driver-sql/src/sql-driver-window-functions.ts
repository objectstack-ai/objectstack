// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Window Functions" section of `SqlDriver`: the bodies of
 * `findWithWindowFunctions` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link WindowFunctionsFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link WindowFunctionsHost}: exactly the
 * `SqlDriver` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `windowFunctionsHost` in
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
import type { SqlWindowFunctionQuery } from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link WindowFunctionsFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface WindowFunctionsHost {
  aliasIdentifierSql: SqlDriver['aliasIdentifierSql'];
  applyFilters: SqlDriver['applyFilters'];
  applyTenantScope: SqlDriver['applyTenantScope'];
  buildWindowFunction: SqlDriver['buildWindowFunction'];
  formatOutput: SqlDriver['formatOutput'];
  getBuilder: SqlDriver['getBuilder'];
  readonly knex: SqlDriver['knex'];
  mapSortField: SqlDriver['mapSortField'];
}

/** The bodies of the "Window Functions" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class WindowFunctionsFacet {
  /** The body of `SqlDriver#findWithWindowFunctions`; the method's docblock there is its contract. */
  static async findWithWindowFunctions(this: Pick<WindowFunctionsHost, 'aliasIdentifierSql' | 'applyFilters' | 'applyTenantScope' | 'buildWindowFunction' | 'formatOutput' | 'getBuilder' | 'knex' | 'mapSortField'>, object: string, query: SqlWindowFunctionQuery, options?: DriverOptions): Promise<any[]> {
    const builder = this.getBuilder(object, options);
    // ROWS, so this is the read-side wall itself — not a consistency tidy-up
    // (#6792). This door returned every tenant's rows to a caller that passed
    // `options.tenantId`, because it built through `getBuilder` and then simply
    // never reached the chokepoint all thirteen other doors route through.
    // Measured on `main` at `6595262` with two tenants seeded: `tenantId:
    // 'org_a'` returned `[a1, a2, b1, b2, p1]` here and `[a1, a2, p1]` through
    // `find()` — org_b's rows, handed to org_a, at the driver layer.
    //
    // Placed BESIDE `getBuilder` and above the caller's `where`, which is the
    // position `findRows()` uses: the predicate has to be on the builder before
    // anything reads it, and `applyTenantScope` is what owns the equality and
    // ADR-0105 D2 union semantics. Re-deriving either here
    // would be a second, worse copy of the wall.
    this.applyTenantScope(builder, object, options);

    builder.select('*');

    if (query.where) {
      this.applyFilters(builder, query.where, options);
    }

    if (query.windowFunctions && Array.isArray(query.windowFunctions)) {
      for (const wf of query.windowFunctions) {
        const windowFunc = this.buildWindowFunction(wf);
        builder.select(this.knex.raw(`${windowFunc} as ${this.aliasIdentifierSql(wf.alias)}`));
      }
    }

    if (query.orderBy && Array.isArray(query.orderBy)) {
      for (const sort of query.orderBy) {
        builder.orderBy(this.mapSortField(sort.field), sort.order || 'asc');
      }
    }

    // PRESENCE, not truthiness — the same test `findRows()` makes (#6577).
    // `limit: 0` means "return no records" (#6485), and `0` is falsy, so
    // `if (query.limit)` dropped the clause and answered a request for NOTHING
    // with the WHOLE table. Measured on `main` before this line changed: three
    // rows seeded, `{ limit: 0 }` returned 3 here and 0 through `find()` — one
    // driver, two answers to one `QueryAST`.
    if (query.limit !== undefined) builder.limit(query.limit);
    if (query.offset !== undefined) builder.offset(query.offset);

    const rows = await builder;
    if (!Array.isArray(rows)) return rows;

    // [commit 78bc4ad58] The last read door that returned STORAGE forms. It handed back
    // `await builder` with no presentation at all, while `find()`/`findOne()`
    // run every row through `formatOutput` and `aggregate()`/`distinct()` got
    // `presentReadValue` under #3797/#3849 — so one driver answered one
    // declared column two ways depending on which door you knocked on.
    // Measured on `main` at `2e6a2ea4c9`, one row through the two doors:
    //   find()   -> { ok: true, meta: { k: 1 } }
    //   window   -> { ok: 1,    meta: '{"k":1}' }
    // i.e. a declared `Field.boolean` answered `1` and a declared `Field.object`
    // answered the stored JSON TEXT. `formatOutput` rather than
    // `presentReadValue` is what runs here, and that choice is load-bearing:
    // {@link ReadPresentationKind} has no `json` member, so the per-value
    // helper the other two doors use cannot present `meta` at all. These are
    // ROWS, which is exactly what `formatOutput` takes.
    //
    // ── The alias columns are carved out, and that is the whole design ──────
    //
    // A window alias is a COMPUTED value, not a declared field, so no declared
    // field's presentation rule may touch it. The case that forces the rule to
    // be explicit is an alias that COLLIDES with a declared field name, and SQL
    // has already decided that one: `select *` plus `<window> as ok` projects
    // two columns named `ok` and the row object keeps the LAST, so the computed
    // value wins the key and the declared column's value is not in the row at
    // all. Measured on `main` at `2e6a2ea4c9` with `alias: 'ok'` over a
    // declared `Field.boolean ok`: rows came back `ok: 1` and `ok: 2` — the
    // ROW_NUMBERs, not the booleans (`true`/`false`), which is how you can tell
    // them apart. So the alias wins the key BEFORE this change and still wins
    // it after; what this carve-out prevents is presenting that computed number
    // as the declared type, which would have turned ROW_NUMBER 1 and 2 into
    // `true` and `true` and destroyed the very value the caller asked for.
    // Pinned by `sql-driver-window-function-output.test.ts`.
    //
    // Snapshot-and-restore rather than a "which keys would `formatOutput`
    // touch?" pre-computation: that question can only be answered by re-reading
    // the declared-field registries `formatOutput` reads, which would be a
    // second, worse copy of it — and one that goes silently stale the next time
    // `formatOutput` learns a new rule. Restoring a value the pass never
    // touched is a no-op, so the cheap-looking version buys nothing.
    const aliases = Array.isArray(query.windowFunctions)
      ? query.windowFunctions.map((wf) => String(wf.alias))
      : [];

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const computed: [string, any][] = [];
      for (const alias of aliases) {
        if (Object.prototype.hasOwnProperty.call(row, alias)) computed.push([alias, row[alias]]);
      }
      // Mutates in place and returns the same row, as `findRows()` relies on.
      this.formatOutput(object, row);
      for (const [alias, value] of computed) row[alias] = value;
    }

    return rows;
  }
}
