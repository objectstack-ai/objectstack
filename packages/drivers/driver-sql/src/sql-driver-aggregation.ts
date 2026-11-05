// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Aggregation" section of `SqlDriver`: the bodies of
 * `aggregate`, `aggregandColumnClassOf`, `foldEmptyAggregateAnswers` moved out
 * of `sql-driver.ts` whole by `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link AggregationFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link AggregationHost}: exactly the
 * `SqlDriver` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `aggregationHost` in
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

import { emptyGroupValueFor } from '@objectstack/spec/data';
import type { DriverOptions } from '@objectstack/spec/data';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { AGGREGATE_ANSWER_KIND, aggregandOperandSql } from '@objectstack/core';
import type { AggregandColumnClass } from '@objectstack/core';
import {
  refuseDateBucketedGroupBy, refuseDistinctAggregateWithoutField, unsupportedAggregationFilterError,
} from './sql-driver-top-level.js';
import type { ReadPresentationKind } from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link AggregationFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface AggregationHost {
  aggregandColumnClassOf: SqlDriver['aggregandColumnClassOf'];
  aggregateBackendFault: SqlDriver['aggregateBackendFault'];
  aliasIdentifierSql: SqlDriver['aliasIdentifierSql'];
  applyFilters: SqlDriver['applyFilters'];
  applyTenantScope: SqlDriver['applyTenantScope'];
  readonly booleanFields: SqlDriver['booleanFields'];
  buildDateBucketExpr: SqlDriver['buildDateBucketExpr'];
  coercionKey: SqlDriver['coercionKey'];
  readonly config: SqlDriver['config'];
  readonly dateGranularityCapabilities: SqlDriver['dateGranularityCapabilities'];
  readonly dialectName: SqlDriver['dialectName'];
  foldEmptyAggregateAnswers: SqlDriver['foldEmptyAggregateAnswers'];
  readonly fractionalNumericFields: SqlDriver['fractionalNumericFields'];
  getBuilder: SqlDriver['getBuilder'];
  readonly knex: SqlDriver['knex'];
  mapAggregateFunc: SqlDriver['mapAggregateFunc'];
  readonly numericFields: SqlDriver['numericFields'];
  presentReadColumns: SqlDriver['presentReadColumns'];
  readPresentationKind: SqlDriver['readPresentationKind'];
}

/** The bodies of the "Aggregation" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class AggregationFacet {
  /** The body of `SqlDriver#aggregate`; the method's docblock there is its contract. */
  static async aggregate(this: Pick<AggregationHost, 'aggregandColumnClassOf' | 'aggregateBackendFault' | 'aliasIdentifierSql' | 'applyFilters' | 'applyTenantScope' | 'buildDateBucketExpr' | 'coercionKey' | 'config' | 'dateGranularityCapabilities' | 'dialectName' | 'foldEmptyAggregateAnswers' | 'getBuilder' | 'knex' | 'mapAggregateFunc' | 'presentReadColumns' | 'readPresentationKind'>, object: string, query: DriverQuery, options?: DriverOptions): Promise<Record<string, unknown>[]> {
    const builder = this.getBuilder(object, options);
    this.applyTenantScope(builder, object, options);

    if (query.where) {
      this.applyFilters(builder, query.where, options);
    }

    // The same coercion key `applyFilters` just used, so every part of this
    // statement agrees on how each column is stored — the WHERE window, the
    // GROUP BY bucket expression (#3773) and the result presentation (#3797).
    const table = this.coercionKey(builder);

    // Result columns and the presentation each takes, keyed by the column name
    // the caller will read: a raw column VALUE (a group key, `min`/`max`) takes
    // its column's presentation, and [#20335] a count or total derived from one
    // takes the `'number'` presentation (see `AGGREGATE_ANSWER_KIND`).
    // Collected while the statement is built because that is the only point
    // where a column name and its meaning are both known: a `min()` lands under
    // its alias (never under the field name), and a date-BUCKETED column lands
    // under the field name while holding a label (`'2026-01'`), not a value.
    // Matching on names after the fact gets both of those backwards.
    // See {@link presentReadColumns}.
    const presentedOutput = new Map<string, ReadPresentationKind>();

    // [#15546] Result columns whose NULL answer folds to the identity the
    // platform declares for that aggregate over NOTHING (`emptyGroupValueFor`,
    // spec `data/aggregation-policy.ts`), keyed like `presentedOutput` by the
    // column name the caller will read. See {@link foldEmptyAggregateAnswers}.
    const foldedOutput = new Map<string, number>();

    if (query.groupBy) {
      // groupBy items may be plain strings ('region') or structured objects
      // ({ field: 'closed_at', dateGranularity: 'quarter' }). For structured
      // items we emit a dialect-specific bucket expression aliased as the
      // projected column name so the resulting row keys match in-memory
      // bucketDateValue — see the `outKey` note below for what that name is.
      // [#6212] The element type is `GroupByNode` — the spec's own union — so
      // the local `Array<string | { field, dateGranularity? }>` restatement is
      // gone. It had drifted from the declaration it was restating: `alias` was
      // missing from it and `dateGranularity` was widened to `string`, which is
      // what forced the `as any` on the `buildDateBucketExpr` call below.
      for (const g of query.groupBy) {
        if (typeof g === 'string') {
          builder.groupBy(g);
          builder.select(g);
          const kind = this.readPresentationKind(table, g);
          if (kind) presentedOutput.set(g, kind);
        } else if (g && typeof g === 'object' && g.field) {
          // [#6401] The projected column is named `alias ?? field` — the rule
          // `AggregationNodeSchema.alias` already gets a few dozen lines below,
          // and the one `in-memory-aggregation.ts` has always applied
          // (`g.alias ?? g.field`). This face was the half that PARSED the key
          // and ignored it, so one aggregate came back keyed by `closed_at`
          // under pushdown and by `qtr` under the in-memory fallback — decided
          // by a driver capability bit and a timezone the caller cannot see
          // (`engine.ts`'s `allStructuredSupported && !tzRequiresInMemory`
          // fork). GROUP BY still keys on the FIELD; only the projection is
          // renamed, so the buckets are identical and only their column name
          // moves.
          const outKey = g.alias ?? g.field;
          if (g.dateGranularity) {
            const bucket = this.buildDateBucketExpr(g.field, g.dateGranularity, table);
            if (!bucket) {
              // [#6212] Was a bare `throw new Error(...)`; see
              // {@link refuseDateBucketedGroupBy} for why it now carries the
              // ADR-0112 envelope and what the remote face answers.
              refuseDateBucketedGroupBy(
                g.dateGranularity,
                Object.entries(this.dateGranularityCapabilities).filter(([, on]) => on).map(([k]) => k),
                `dialect '${(this.config as any).client}'`,
              );
            }
            builder.groupByRaw(bucket.sql, bucket.bindings);
            builder.select(this.knex.raw(`${bucket.sql} as ${this.aliasIdentifierSql(outKey)}`, [...bucket.bindings]));
          } else {
            builder.groupBy(g.field);
            // Aliased only when the name actually moves: an alias equal to
            // the field would otherwise rewrite `select "region"` into
            // `select "region" as "region"` on every dialect for no gain.
            // [#13714] The alias half is {@link aliasIdentifierSql}, never a
            // `??` binding — the FIELD stays a `??` reference (it may be
            // qualified), the alias is one identifier by definition.
            builder.select(outKey === g.field ? g.field : this.knex.raw(`?? as ${this.aliasIdentifierSql(outKey)}`, [g.field]));
            // Keyed by the OUTPUT column, like the aggregation branch below —
            // `presentReadColumns` matches on the name the row actually
            // carries, so an aliased group value went unpresented before.
            const kind = this.readPresentationKind(table, g.field);
            if (kind) presentedOutput.set(outKey, kind);
          }
        }
      }
    }

    // [#6321] Was `query.aggregations || query.aggregate` / `agg.function ||
    // agg.func`. Neither `aggregate` nor `func` is declared anywhere in the
    // Query Protocol — `QueryASTSchema` declares `aggregations` and
    // `AggregationNodeSchema` declares `function` — so those two limbs were a
    // private dialect this consumer tolerated, which is what PD#12 rejects. The
    // only writers were this package's own fixtures and driver-sqlite-wasm's
    // (#4984's family: a fixture spelling the alias keeps the lenient limb green
    // forever, and nothing ever measures that deleting it costs nothing). Both
    // fixture sets now spell the declared keys, the non-test writer count was
    // zero when measured, and ADR-0049 says an unenforced tolerance goes.
    const aggregates = query.aggregations;
    if (aggregates) {
      for (const agg of aggregates) {
        // [#10576] A per-aggregation `filter` this compiler cannot express is
        // refused before any statement is built — silently emitting the
        // UNFILTERED aggregate is the #10413 defect. Unreachable through
        // `engine.aggregate` (the engine lowers filtered aggregations in
        // memory); this is the direct-caller guard. `{}` is the vacuous filter,
        // same convention as `where` / `having`.
        if (agg.filter && Object.keys(agg.filter).length > 0) {
          throw unsupportedAggregationFilterError(agg.alias ?? agg.field ?? '(unaliased)', 'driver-sql');
        }
        const funcName = agg.function;
        const lowering = this.mapAggregateFunc(funcName);
        // Spec: `field` is optional for COUNT (means COUNT(*)).
        const fieldExpr = agg.field ?? '*';
        // [#6409] `count_distinct` lowers to `count(distinct ??)`. The keyword
        // goes in the SQL FRAGMENT, never in a binding: `??` still binds the
        // column as a knex identifier exactly as it did for the other five, so
        // the caller's field name has no path into the statement text. And
        // `COUNT(DISTINCT *)` is not valid SQL anywhere — a distinct aggregate
        // with no field is refused rather than emitted, so the caller reads
        // their own mistake instead of a dialect's syntax error wrapped in a
        // 500 (see {@link refuseDistinctAggregateWithoutField}).
        if (lowering.distinct && fieldExpr === '*') refuseDistinctAggregateWithoutField(funcName);
        // [#11635] A boolean aggregand is CAST for the arithmetic/order
        // aggregates on Postgres — the one dialect that stores `Field.boolean`
        // as a real `boolean` column and defines no `sum`/`avg`/`min`/`max`
        // over it (SQLSTATE `42883`, measured on PG 16.13; SQLite stores 0/1
        // INTEGER and MySQL `tinyint(1)`, so both compute natively). The
        // answers are ruled: this face must ANSWER — refusing cannot satisfy
        // the contract — and [#11152] (maintainer 2026-08-28, superseding
        // #11249's `false`/`true` for the order statistics) pins ALL FOUR as
        // numbers: `sum`/`avg` arithmetic over 1/0, `min`/`max` the `0`/`1`
        // the cast computes, presented as-is (see the presentation note
        // below). `count`/`count_distinct` are deliberately NOT cast (both
        // lower to `count`, defined over boolean everywhere — their answers
        // were correct before this and must not move).
        // [#20387] `sum` / `avg` accumulate in double on PostgreSQL and MySQL,
        // the arithmetic SQLite and the engine's rows path already use, so one
        // query answers one number on every face (`AGGREGATE_ACCUMULATION`).
        // [#21042] Both policies, and the order they compose in, are
        // `aggregandOperandSql` (`@objectstack/core`), read with this column's
        // class from the registries below — the rule the analytics native-SQL
        // face applies too. Still one `??` binding: the cast and the wrap are
        // SQL text around it, so the column stays a knex identifier binding.
        const aggregandClass = fieldExpr === '*' ? undefined : this.aggregandColumnClassOf(table, fieldExpr);
        const argExpr = aggregandOperandSql(funcName, aggregandClass, this.dialectName, '??');
        const rawFunc = lowering.distinct
          ? `${lowering.sql}(distinct ${argExpr})`
          : `${lowering.sql}(${argExpr})`;
        if (agg.alias) {
          if (fieldExpr === '*') {
            builder.select(this.knex.raw(`${lowering.sql}(*) as ${this.aliasIdentifierSql(agg.alias)}`));
          } else {
            builder.select(this.knex.raw(`${rawFunc} as ${this.aliasIdentifierSql(agg.alias)}`, [fieldExpr]));
          }
          // [#15546] What this aggregate answers over NOTHING, read from the
          // policy rather than restated: `sum` (and the two counts, which never
          // arrive as NULL) fold to `0`; `avg`/`min`/`max` have no identity and
          // their NULL passes through. See {@link foldEmptyAggregateAnswers}.
          const identity = emptyGroupValueFor(funcName);
          if (identity !== undefined) foldedOutput.set(agg.alias, identity);
          // [#20335] A count or a total is presented as the number it is, on
          // every dialect: node-postgres hands `bigint` / `numeric` back as a
          // string and mysql2 `DECIMAL`, so without this the native path
          // answered `"2"` where the rows path and SQLite answer `2`. Keyed on
          // the function asked for; the precision policy (one JS double, the
          // loss above a double's precision declared) is stated on
          // `AGGREGATE_ANSWER_KIND`. The fold above runs first, so a folded
          // `0` is already a number and passes through.
          if (AGGREGATE_ANSWER_KIND[funcName] === 'number') {
            presentedOutput.set(agg.alias, 'number');
          }
          // `min`/`max` are the only supported functions that hand back a value
          // OF the column rather than a count/total derived from it, so they are
          // the only ones whose result still needs the column's presentation.
          // `alias` is required by `AggregationNodeSchema`; the unaliased branch
          // below lands under a dialect-dependent column name
          // (`max("closed_at")` on SQLite, `max` on Postgres) and is defensive
          // only, so it is deliberately not tracked.
          if (AGGREGATE_ANSWER_KIND[funcName] === 'column' && agg.field) {
            // [#11152] A BOOLEAN aggregand is the ruled exception to "the
            // result still needs the column's presentation": the maintainer's
            // 2026-08-28 ruling (superseding #11249's `false`/`true`, which
            // #11635 implemented here) pins that booleans aggregate as NUMBERS
            // on every face, with no per-aggregate exception — `min`/`max`
            // answer `0`/`1`, the same numeric domain `sum`/`avg` answer in.
            // Every dialect's backend already computes exactly that number
            // (SQLite 0/1 INTEGER storage, MySQL `tinyint(1)`, Postgres via
            // the `cast(?? as int)` above), so the ruled answer is the value
            // with NO boolean presentation — the `'boolean'` kind is skipped
            // rather than mapped. ROW reads are untouched: `find()` still
            // presents a declared boolean as a JSON boolean; it is the
            // AGGREGATION context that is numeric by rule. Temporal kinds
            // still present (`sql-driver-aggregate-temporal-output.test.ts`),
            // and the SQLite-only numeric repair still applies.
            const kind = this.readPresentationKind(table, agg.field);
            if (kind && kind !== 'boolean') presentedOutput.set(agg.alias, kind);
          }
        } else {
          if (fieldExpr === '*') {
            builder.select(this.knex.raw(`${lowering.sql}(*)`));
          } else {
            builder.select(this.knex.raw(rawFunc, [fieldExpr]));
          }
        }
      }
    }

    // [#11455] The third read exit joins the other two. `find()` and `count()`
    // have carried the terminal envelope since #8931; this door executed BARE,
    // so any dialect error the statement raised left the driver as the
    // backend's own object — a raw SQLSTATE in `code`, `status` UNDEFINED, and
    // the compiled statement as the message. Measured on live PostgreSQL 16.13:
    //
    //   sum(flag) => THREW code=42883 status=undefined
    //                msg=select sum("flag") as "n" from "…" -
    //                    function sum(boolean) does not exist
    //
    // A raw `42883` is on no list `@objectstack/rest` reads, so an ordinary
    // analytics shape — a rate measure over a flag column — was logged as an
    // UNHANDLED server fault. `mapDataError` then had nothing declared to
    // forward, which is the #1116/#1117 gap {@link mapAggregateFunc} closed for
    // the FUNCTION NAME while leaving the STATEMENT half open.
    //
    // When #11455 landed, whether a boolean aggregate should ANSWER or REFUSE
    // was deliberately left to #11152 / #11249 — the envelope was the half
    // that could land first. #11249 has since RULED (maintainer 2026-08-23):
    // the face answers, and [#11635] delivered the Postgres cast in the
    // statement builder above, so a boolean aggregand no longer reaches this
    // exit at all. The envelope itself is unchanged — it never recognised
    // `42883`, so removing one of its inputs removes nothing from it.
    //
    // ⛔ And no boolean-specific recognizer: the envelope comes from the EXIT,
    // not from matching `42883` or the words `does not exist`. That is the
    // #8926 lesson applied in advance — a predicate arm that matches a WORDING
    // is an arm that silently fails to fire on the dialect nobody measured.
    //
    // [#11541] The unresolvable-column arm that {@link SqlDriver.count} runs
    // first is here too now — but ⛔ NOT as the blanket arm #11455 refused to
    // add. That refusal's words are "Filter on 'x' names a column that object
    // 'o' has no column for", and THIS door names columns in three clauses —
    // the WHERE, the `groupBy` fields and the aggregation `field`s. A blanket
    // arm would tell the author of `avg('nosuchcol')` that their FILTER was
    // wrong, which is the unsupportable claim the #8931 ruling refuses to
    // make. So the dialect-named column is attributed to the clause the
    // CALLER'S OWN QUERY names it in — see
    // {@link SqlDriver.aggregateBackendFault}, which holds the three arms and
    // the reason the no-name case keeps this terminal unchanged.
    //
    // Only the EXECUTION is guarded. Every refusal this method composes —
    // {@link refuseAggregateFunction}, {@link refuseDistinctAggregateWithoutField},
    // {@link unsupportedAggregationFilterError}, {@link refuseDateBucketedGroupBy}
    // — is raised while the statement is BUILT, upstream of this line, so the
    // catch-all cannot bury a precise refusal under a generic 500.
    let rows: unknown[];
    try {
      rows = await builder;
    } catch (error) {
      // [#8931, #11541] Attribute what the caller's own query supports, then
      // fall to the terminal catch-all — see
      // {@link SqlDriver.aggregateBackendFault}.
      throw this.aggregateBackendFault(object, query, error);
    }
    return this.presentReadColumns(this.foldEmptyAggregateAnswers(rows, foldedOutput), presentedOutput);
  }

  /** The body of `SqlDriver#aggregandColumnClassOf`; the method's docblock there is its contract. */
  static aggregandColumnClassOf(this: Pick<AggregationHost, 'booleanFields' | 'fractionalNumericFields' | 'numericFields'>, table: string | null, field: string): AggregandColumnClass | undefined {
    if (table === null) return undefined;
    if (this.booleanFields[table]?.includes(field)) return 'boolean';
    if (this.fractionalNumericFields[table]?.includes(field)) return 'fractional';
    if (this.numericFields[table]?.includes(field)) return 'integral';
    return undefined;
  }

  /** The body of `SqlDriver#foldEmptyAggregateAnswers`; the method's docblock there is its contract. */
  static foldEmptyAggregateAnswers(rows: any, identities: Map<string, number>): any {
    if (identities.size === 0 || !Array.isArray(rows)) return rows;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      for (const [column, identity] of identities) {
        if (row[column] === null) row[column] = identity;
      }
    }
    return rows;
  }
}
