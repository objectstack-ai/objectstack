// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Distinct" section of `SqlDriver`: the bodies of
 * `distinct` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link DistinctHost}: exactly the
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

import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface DistinctHost {
  applyFilters: SqlDriver['applyFilters'];
  applyTenantScope: SqlDriver['applyTenantScope'];
  coercionKey: SqlDriver['coercionKey'];
  distinctBackendFault: SqlDriver['distinctBackendFault'];
  getBuilder: SqlDriver['getBuilder'];
  presentReadValue: SqlDriver['presentReadValue'];
  readPresentationKind: SqlDriver['readPresentationKind'];
}

/** The body of `SqlDriver#distinct`; the method's docblock there is its contract. */
export async function distinct(this: Pick<DistinctHost, 'applyFilters' | 'applyTenantScope' | 'coercionKey' | 'distinctBackendFault' | 'getBuilder' | 'presentReadValue' | 'readPresentationKind'>, object: string, field: string, filters?: FilterCondition, options?: DriverOptions): Promise<any[]> {
    const builder = this.getBuilder(object, options);
    // The third read door that skipped the chokepoint, and the one #6792 does
    // NOT name — the card asserts the opposite ("called at 13 sites — …,
    // `count`, `distinct`, …"). It is not among them; the 13th read site is
    // `aggregate()`. Found by the gate this change ships, not by the card.
    //
    // VALUES rather than rows, which lowers the volume and not the class:
    // measured on `main` at `6595262`, `distinct(account, 'name', undefined,
    // { tenantId: 'org_a' })` returned `[A1, A2, B1, B2, P1]` — every other
    // tenant's values for the named column. Documented with a runnable example
    // (`content/docs/protocol/objectql/query-syntax.mdx`), so it is exposed the
    // same way the window door is.
    this.applyTenantScope(builder, object, options);

    if (filters) {
      this.applyFilters(builder, filters, options);
    }

    builder.distinct(field);
    // [commit 7c2c5aedd] The THIRD read door joins the other two. `find()` and `count()`
    // have carried the terminal envelope since #8931 and `aggregate()` since
    // #11455; this one still executed BARE, so any dialect refusal the
    // statement raised left the driver as the backend's own object — a raw
    // SQLSTATE in `code`, `status` UNDEFINED, and the compiled statement as the
    // message. Measured on live PostgreSQL 16.13: this driver stores every
    // `multiple: true` column as `json`, and `json` defines no equality
    // operator, so `SELECT DISTINCT` over one is refused by the backend:
    //
    //   distinct(t, 'toggles') => THREW code=42883 status=undefined
    //                             msg=select distinct "toggles" from "…" -
    //                                 could not identify an equality operator
    //                                 for type json
    //
    // Class-wide across every JSON column — `toggle`/`boolean`/`number` with
    // `multiple: true` and `tags` all measured, with a scalar `boolean` column
    // in the same table answering normally as the lit control. A raw `42883` is
    // on no list `@objectstack/rest` reads, so `mapDataError` had nothing
    // declared to forward and an ordinary caller shape — list the distinct
    // values of this column — was logged as an UNHANDLED server fault.
    //
    // ⛔ NOT a decision about whether a JSON column should ANSWER a distinct
    // read; that question belonged to the card commit e04a0aff2 closed, on the same columns. Whatever this door
    // ends up doing, it must not leak the backend's own object — so the
    // envelope is the half that lands here, exactly as #11455 landed it for
    // `aggregate()` while its own answer question was still open.
    //
    // ⛔ And no `42883` recognizer: the envelope comes from the EXIT, not from
    // matching a SQLSTATE or the words `equality operator` — the #8926 lesson,
    // applied in advance. The all-dialect sweep in
    // `sql-driver-17639-distinct-fault-envelope.test.ts` asserts that on a
    // route (a table that was never provisioned) that has no JSON column in it.
    //
    // ⛔ And still NO BLANKET `isUnresolvableColumnError` arm — commit 9ccc4179e closed
    // the gap commit 7c2c5aedd left FILED, and it closed it the way #11541 closed the
    // `aggregate()` one: by ATTRIBUTING the column to a clause of the caller's
    // own request first. A blanket arm remains forbidden for the reason stated
    // here since commit 7c2c5aedd — it would tell the author of `distinct(o, 'nosuchcol')`,
    // who passed no filter at all, that their FILTER was wrong — and
    // {@link SqlDriver.distinctBackendFault} is what makes that claim
    // unnecessary rather than what makes it safe.
    //
    // Only the EXECUTION is guarded. Every refusal this method composes upstream
    // — `applyFilters`' `INVALID_FILTER` out of {@link assertCompilableComparand}
    // among them — is raised while the statement is BUILT, so the classifier
    // cannot bury a precise refusal under a generic 500.
    let results: unknown[];
    try {
      results = await builder;
    } catch (error) {
      throw this.distinctBackendFault(object, field, error, filters);
    }
    const values = results.map((row: any) => row[field]);

    // Same presentation `find()` gives the column (#3797, #3849) — a caller
    // listing a datetime's values should not get epoch integers here and ISO
    // strings there, nor `0`/`1` for a boolean. Re-deduplicate afterwards: SQL
    // `DISTINCT` compares STORED values, and one SQLite `Field.datetime` column
    // holds both INTEGER epoch ms and ISO TEXT, so two rows recording the same
    // instant survive as two rows and then collapse to the same presented value.
    const kind = this.readPresentationKind(this.coercionKey(builder), field);
    if (!kind) return values;
    return [...new Set(values.map((v: any) => this.presentReadValue(kind, v)))];
  }
