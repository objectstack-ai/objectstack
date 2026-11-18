// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Aggregation" section of `SqlDriver`: the bodies of
 * `aggregate`, `aggregandColumnClassOf`, `foldEmptyAggregateAnswers` moved out
 * of `sql-driver.ts` whole (split by #29598 and #30139).
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

import { coreSqlDialectOf } from './sql-driver-oracle-dialect.js';
import { emptyGroupValueFor, isComposedReadableIds } from '@objectstack/spec/data';
import type { Knex } from 'knex';
import type { ComposedReadableIds, DriverOptions } from '@objectstack/spec/data';
import type { DriverAggregateQuery, DriverQuery } from '@objectstack/spec/contracts';
import { AGGREGATE_ACCUMULATION, AGGREGATE_ANSWER_KIND, aggregandOperandSql } from '@objectstack/core';
import type { AggregandColumnClass } from '@objectstack/core';
import {
  refuseDateBucketedGroupBy, refuseDistinctAggregateWithoutField, refuseZonedDateBucket, unsupportedAggregationFilterError,
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
  readonly isMssql: SqlDriver['isMssql'];
  readonly isOracle: SqlDriver['isOracle'];
  readonly isPostgres: SqlDriver['isPostgres'];
  readonly knex: SqlDriver['knex'];
  mapAggregateFunc: SqlDriver['mapAggregateFunc'];
  readonly numericFields: SqlDriver['numericFields'];
  presentReadColumns: SqlDriver['presentReadColumns'];
  primeMssqlGuidColumns: SqlDriver['primeMssqlGuidColumns'];
  primeOracleRawUuidColumns: SqlDriver['primeOracleRawUuidColumns'];
  readPresentationKind: SqlDriver['readPresentationKind'];
  remoteColumn: SqlDriver['remoteColumn'];
}

/** The bodies of the "Aggregation" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class AggregationFacet {
  /** The body of `SqlDriver#aggregate`; the method's docblock there is its contract. */
  static async aggregate(this: Pick<AggregationHost, 'aggregandColumnClassOf' | 'aggregateBackendFault' | 'aliasIdentifierSql' | 'applyFilters' | 'applyTenantScope' | 'buildDateBucketExpr' | 'coercionKey' | 'config' | 'dateGranularityCapabilities' | 'dialectName' | 'foldEmptyAggregateAnswers' | 'getBuilder' | 'isMssql' | 'isOracle' | 'isPostgres' | 'knex' | 'mapAggregateFunc' | 'presentReadColumns' | 'primeMssqlGuidColumns' | 'primeOracleRawUuidColumns' | 'readPresentationKind' | 'remoteColumn'>, object: string, query: DriverAggregateQuery, options?: DriverOptions): Promise<Record<string, unknown>[]> {
    // [relation group join] The related rows each relation joins, handed by
    // the engine (`objectql` `relation-group-join.ts`); read once, judged
    // before anything compiles.
    const relationJoins = relationGroupJoinsOf(query);
    // [aggregate order and cut] The order, cut and group count the engine
    // hands (`objectql` `aggregate-order-cut.ts`); read once, judged before
    // anything compiles.
    const orderCut = aggregateOrderCutOf(query);
    // [#33697] The reference zone the date buckets are read in
    // (`DriverAggregateQuery.timezone`, ADR-0053 Phase 2 D2 as amended), judged
    // before anything compiles. Absent or `UTC` is the UTC bucket every dialect
    // has always run. Any other zone is bucketed only on PostgreSQL (the
    // dialect `supports.zonedDateBucketing` names) and only as the runtime's
    // resolved IANA area/location name for itself — the one spelling the
    // database and the in-memory path read alike; the engine sends exactly
    // that. Everything else is refused, never read as UTC. A query with no date
    // bucket reads no zone, so it is not judged.
    const bucketZone = zonedBucketOf(query);
    if (bucketZone !== undefined) {
      if (!this.isPostgres) refuseZonedDateBucket(bucketZone, 'dialect', `dialect '${(this.config as any).client}'`);
      if (resolvedAreaZone(bucketZone) !== bucketZone) refuseZonedDateBucket(bucketZone, 'unresolved', 'driver-sql');
    }
    // [#33698] The per-measure `filter`s that carry a condition (`{}` is the
    // vacuous filter, same convention as `where` / `having`): each compiles
    // with the where compiler below, so each is primed and read like a `where`.
    const measureFilters = (query.aggregations ?? [])
      .map((agg) => agg.filter)
      .filter((filter): filter is NonNullable<typeof filter> => !!filter && Object.keys(filter).length > 0);
    // [#31395] SQL Server: which columns are GUIDs, before a text operator compiles.
    if (this.isMssql) {
      await this.primeMssqlGuidColumns(
        object,
        measureFilters.length > 0 ? { $and: [...(query.where ? [query.where] : []), ...measureFilters] } : query.where,
      );
    }
    // [#31390] On Oracle a federated object's RAW(16) uuid columns are read from
    // the remote catalog before a comparand or a written value is bound.
    if (this.isOracle) await this.primeOracleRawUuidColumns(object);
    // …and the same two primes for each joined related object, whose scope
    // compiles against its own table.
    for (const join of relationJoins ?? []) {
      if (join.parent === null) continue;
      if (this.isMssql) await this.primeMssqlGuidColumns(join.parent.object, join.parent.scope);
      if (this.isOracle) await this.primeOracleRawUuidColumns(join.parent.object);
    }
    const builder = this.getBuilder(object, options);
    // The column a FIELD names in this statement: its `external.columnMap`
    // remote column on a federated object, the field itself otherwise. Every
    // identifier below is spelled through it, while every registry lookup
    // (`readPresentationKind`, `aggregandColumnClassOf`, the bucket's
    // `temporalFieldKind`) and every output key stays the FIELD — the name the
    // caller asked for and reads back. `find()` / `count()` / the WHERE have
    // always mapped (`remoteColumn` in `findRows`, `applyFilters`); this door
    // named the field verbatim, so a mapped object's GROUP BY / aggregand /
    // `distinct` asked the remote table for a column it does not have.
    const columnOf = (field: string): string => this.remoteColumn(object, field, field);
    // [#33698] A measure filter's predicate, compiled by the SAME where
    // compiler a `where` goes through (`applyFilters`: the same comparand
    // gates, refusals, coercion and column map), on a builder of the same
    // table carrying the same tenant scope as the statement, then lifted out
    // of `select * from t [where <tenant>] (where|and) <pred>`. It goes inside
    // the aggregate as `CASE WHEN (pred) THEN … END`, so it only NARROWS the
    // rows the statement already reads: the tenant wall and the read scope
    // stay on the statement's own WHERE, never in a measure. Neither builder
    // here is executed; each is scoped like every other builder of a read
    // door, so the reference statement and the filtered one differ by exactly
    // the predicate. `undefined` = the filter compiled to no condition at all
    // (a vacuous tree), so the measure is the unfiltered aggregate — what the
    // in-memory path answers for it.
    // The lift is guarded rather than trusted: a statement that is not the
    // reference plus one predicate, whose leading bindings are not the
    // reference's, or whose predicate's `?` placeholders do not pair one to
    // one with its own bindings (a `??` or an escaped `\?` would be re-read by
    // `knex.raw`), is refused (NOT_IMPLEMENTED/501), never guessed at.
    const compileMeasureFilter = (filter: NonNullable<DriverQuery['where']>, alias: string): { sql: string; bindings: readonly Knex.Value[] } | undefined => {
      const reference = this.getBuilder(object, options);
      this.applyTenantScope(reference, object, options);
      const filtered = this.getBuilder(object, options);
      this.applyTenantScope(filtered, object, options);
      this.applyFilters(filtered, filter, options);
      const bare = reference.toSQL();
      const compiled = filtered.toSQL();
      if (compiled.sql === bare.sql && compiled.bindings.length === bare.bindings.length) return undefined;
      const prefix = [`${bare.sql} where `, `${bare.sql} and `].find((p) => compiled.sql.startsWith(p));
      const sql = prefix === undefined ? '' : compiled.sql.slice(prefix.length);
      const bindings = compiled.bindings.slice(bare.bindings.length);
      if (
        prefix === undefined
        || bare.bindings.some((b, i) => b !== compiled.bindings[i])
        || /\?\?|\\\?/.test(sql)
        || (sql.match(/\?/g) ?? []).length !== bindings.length
      ) {
        throw unsupportedAggregationFilterError(alias, 'driver-sql');
      }
      return { sql, bindings };
    };
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

    // [aggregate order and cut] Every column the grouped statement projects,
    // under the name the caller reads: the only names an order key may name.
    const projected = new Set<string>();

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
      // [#33697] The 1-based position of the select-list column the item
      // being compiled projects: every item below adds exactly one column,
      // and nothing is selected before the group keys.
      let selectPosition = 0;
      for (const g of query.groupBy) {
        if (typeof g === 'string' || (g && typeof g === 'object' && g.field)) selectPosition += 1;
        if (typeof g === 'string') {
          const column = columnOf(g);
          builder.groupBy(column);
          builder.select(column === g ? g : this.knex.raw(`?? as ${this.aliasIdentifierSql(g)}`, [column]));
          projected.add(g);
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
          projected.add(outKey);
          if (g.dateGranularity) {
            const bucket = this.buildDateBucketExpr(g.field, g.dateGranularity, table, columnOf(g.field), bucketZone);
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
            builder.select(this.knex.raw(`${bucket.sql} as ${this.aliasIdentifierSql(outKey)}`, [...bucket.bindings]));
            if (bucketZone !== undefined) {
              // [#33697] Review item (a): a zoned bucket binds the zone as a
              // VALUE, and PostgreSQL numbers each `?` as its own parameter,
              // so spelling the expression again in the GROUP BY would leave
              // `$1` in the select list and `$2` in the GROUP BY — two
              // expressions to the planner, refused 42803. The bucket is
              // stated once, in the select list, and grouped by its position
              // there. Only this arm does it: ordinal GROUP BY is PostgreSQL's
              // (and MySQL's / SQLite's), not SQL Server's or Oracle's, and
              // the UTC buckets bind identifiers only.
              builder.groupByRaw(String(selectPosition));
            } else {
              builder.groupByRaw(bucket.sql, bucket.bindings);
            }
          } else {
            const column = columnOf(g.field);
            builder.groupBy(column);
            // Aliased only when the name actually moves: an alias equal to
            // the column would otherwise rewrite `select "region"` into
            // `select "region" as "region"` on every dialect for no gain.
            // [#13714] The alias half is {@link aliasIdentifierSql}, never a
            // `??` binding — the COLUMN stays a `??` reference (it may be
            // qualified), the alias is one identifier by definition.
            builder.select(outKey === column ? column : this.knex.raw(`?? as ${this.aliasIdentifierSql(outKey)}`, [column]));
            // Keyed by the OUTPUT column, like the aggregation branch below —
            // `presentReadColumns` matches on the name the row actually
            // carries, so an aliased group value went unpresented before.
            const kind = this.readPresentationKind(table, g.field);
            if (kind) presentedOutput.set(outKey, kind);
          }
        }
      }
    }

    // [relation group join] Each relation the engine hands joins the related
    // rows the caller may read, and groups by their attributes:
    //
    //   LEFT JOIN (SELECT id AS __rgN_id, attr AS __rgN_aJ … FROM related
    //              WHERE <tenant wall> AND <composed read scope>) AS __rgN
    //          ON fk = __rgN.__rgN_id
    //   … GROUP BY __rgN.__rgN_aJ, CASE WHEN __rgN.__rgN_id IS NULL THEN 0 ELSE 1 END
    //
    // The derived table is compiled as a composed `ReadableIds` subquery is
    // (`readableIdsSubquery`): the related object's tenant wall from THIS
    // read's options (ADR-0139 D3 — the engine proved them the related read's
    // own) and its composed scope through this same where compiler, so it
    // binds only the scope's and the wall's own parameters, never one per
    // related record. Its columns are renamed so no column of the
    // aggregated table is ambiguous beside them; the join's left column is
    // the FK, unqualified, for the same reason. `__rgN_id` is unique in the
    // derived table (it is the key), so the join multiplies no row and every
    // measure aggregates the rows it would have without it. The resolved
    // column is `1` where a readable related record joined, `0` where none
    // did (an empty relation, or a record the caller cannot read) — the
    // attribute is NULL there, and the resolved column tells it from a real
    // NULL. A `null` parent is a related object nothing is readable of.
    (relationJoins ?? []).forEach((join, i) => {
      const at = `__rg${i}`;
      const idColumn = `${at}_id`;
      for (const a of join.attrs) projected.add(a.alias);
      projected.add(join.resolvedAlias);
      if (join.parent === null) {
        for (const a of join.attrs) builder.select(this.knex.raw(`NULL as ${this.aliasIdentifierSql(a.alias)}`));
        builder.select(this.knex.raw(`0 as ${this.aliasIdentifierSql(join.resolvedAlias)}`));
        presentedOutput.set(join.resolvedAlias, 'number');
        return;
      }
      const related = join.parent.object;
      const sub = this.getBuilder(related).select(
        this.knex.raw(`?? as ${this.aliasIdentifierSql(idColumn)}`, [this.remoteColumn(related, 'id', 'id')]),
      );
      join.attrs.forEach((a, j) => {
        sub.select(this.knex.raw(`?? as ${this.aliasIdentifierSql(`${at}_a${j}`)}`, [this.remoteColumn(related, a.attr, a.attr)]));
      });
      this.applyTenantScope(sub, related, options);
      if (join.parent.scope !== undefined) this.applyFilters(sub, join.parent.scope, options);
      const relatedTable = this.coercionKey(sub);
      builder.leftJoin(sub.as(at), columnOf(join.field), `${at}.${idColumn}`);
      join.attrs.forEach((a, j) => {
        const ref = `${at}.${at}_a${j}`;
        builder.groupBy(ref);
        builder.select(this.knex.raw(`?? as ${this.aliasIdentifierSql(a.alias)}`, [ref]));
        const kind = this.readPresentationKind(relatedTable, a.attr);
        if (kind) presentedOutput.set(a.alias, kind);
      });
      const resolved = 'CASE WHEN ?? IS NULL THEN 0 ELSE 1 END';
      builder.groupByRaw(resolved, [`${at}.${idColumn}`]);
      builder.select(this.knex.raw(`${resolved} as ${this.aliasIdentifierSql(join.resolvedAlias)}`, [`${at}.${idColumn}`]));
      presentedOutput.set(join.resolvedAlias, 'number');
    });

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
        // [#33698] A per-aggregation `filter` (#10576) compiles to a
        // conditional aggregate — `fn(CASE WHEN (pred) THEN arg END)` — which
        // is SQL's `fn(arg) FILTER (WHERE pred)` on every dialect this driver
        // targets: a row the predicate rejects contributes NULL, which every
        // aggregate skips. `count(*)` becomes `count(CASE WHEN (pred) THEN 1
        // END)` — ⛔ never `ELSE 0`, which `count` would count. A group the
        // filter empties answers what that aggregate answers over nothing
        // (`emptyGroupValueFor`, folded below like any other measure): `sum`
        // and both counts `0`, `avg`/`min`/`max` NULL — the in-memory path's
        // answer. Silently emitting the UNFILTERED aggregate is the #10413
        // defect; a predicate that cannot be lifted is refused instead (see
        // `compileMeasureFilter`). `{}` is the vacuous filter.
        const measureFilter = agg.filter && Object.keys(agg.filter).length > 0
          ? compileMeasureFilter(agg.filter, agg.alias ?? agg.field ?? '(unaliased)')
          : undefined;
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
        const dialect = this.dialectName;
        const argExpr = dialect === 'mssql'
          ? mssqlAggregandOperandSql(funcName, aggregandClass, '??')
          : aggregandOperandSql(funcName, aggregandClass, coreSqlDialectOf(dialect), '??');
        // The operand, conditional when a measure filter compiled: the
        // predicate's bindings precede the column's `??` in the text, so they
        // precede it in the bindings too.
        const operand = measureFilter ? `CASE WHEN (${measureFilter.sql}) THEN ${argExpr} END` : argExpr;
        const filterBindings: Knex.Value[] = measureFilter ? [...measureFilter.bindings] : [];
        const rawFunc = lowering.distinct
          ? `${lowering.sql}(distinct ${operand})`
          : `${lowering.sql}(${operand})`;
        const starFunc = measureFilter
          ? `${lowering.sql}(CASE WHEN (${measureFilter.sql}) THEN 1 END)`
          : `${lowering.sql}(*)`;
        if (agg.alias) {
          projected.add(agg.alias);
          if (fieldExpr === '*') {
            builder.select(this.knex.raw(`${starFunc} as ${this.aliasIdentifierSql(agg.alias)}`, filterBindings));
          } else {
            builder.select(this.knex.raw(`${rawFunc} as ${this.aliasIdentifierSql(agg.alias)}`, [...filterBindings, columnOf(fieldExpr)]));
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
            builder.select(this.knex.raw(starFunc, filterBindings));
          } else {
            builder.select(this.knex.raw(rawFunc, [...filterBindings, columnOf(fieldExpr)]));
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
    // [aggregate order and cut] The grouped statement becomes a derived table
    // the cut is taken from, so every dialect orders by the row's own columns
    // (PostgreSQL and SQL Server refuse an output alias inside an ORDER BY
    // expression) and counts the groups it formed BEFORE the cut — a window
    // over the derived table runs ahead of its ORDER BY and LIMIT: one
    // statement, one round trip. A NULL ranks last in either direction; a
    // column that folds to an identity over nothing (`sum`, the counts) ranks
    // as that identity, the value its row is served with.
    let statement: Knex.QueryBuilder = builder;
    if (orderCut !== undefined) {
      const unknown = orderCut.orderBy.find((k) => !projected.has(k.column));
      if (unknown !== undefined) {
        throw aggregateOrderCutFault(`it orders by '${unknown.column}', which the grouped statement does not project`);
      }
      if (projected.has(orderCut.groupCountColumn)) {
        throw aggregateOrderCutFault(`the group count column '${orderCut.groupCountColumn}' is also a projected column`);
      }
      const groups = this.aliasIdentifierSql('__os_groups');
      let outer = this.knex
        .select(this.knex.raw(`${groups}.*`))
        .select(this.knex.raw(`count(*) over () as ${this.aliasIdentifierSql(orderCut.groupCountColumn)}`))
        .from(builder.as('__os_groups'));
      if (options?.transaction) outer = outer.transacting(options.transaction as Knex.Transaction);
      for (const key of orderCut.orderBy) {
        const ref = `${groups}.${this.aliasIdentifierSql(key.column)}`;
        const identity = foldedOutput.get(key.column);
        if (key.rank !== undefined) {
          // A declared order: each listed value ranks by its position, any
          // other value (a NULL among them) after every listed one.
          const arms = key.rank.map((_, i) => `when ? then ${i}`).join(' ');
          outer.orderByRaw(`case ${ref} ${arms} else ${key.rank.length} end ${key.order}`, [...key.rank]);
        } else if (identity !== undefined && Number.isFinite(identity)) {
          outer.orderByRaw(`coalesce(${ref}, ${String(identity)}) ${key.order}`);
        } else {
          outer.orderByRaw(`case when ${ref} is null then 1 else 0 end, ${ref} ${key.order}`);
        }
      }
      if (orderCut.limit !== undefined) outer.limit(orderCut.limit);
      presentedOutput.set(orderCut.groupCountColumn, 'number');
      statement = outer;
    }
    let rows: unknown[];
    try {
      rows = await statement;
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

/**
 * [relation group join] The AST key the engine hands its relation joins on
 * (`objectql` `relation-group-join.ts`, the same `Symbol.for` key — this
 * package does not import the engine). A symbol, so no wire request and no
 * JSON query can carry one; set by the engine after every middleware ran.
 */
export const RELATION_GROUP_JOINS: unique symbol = Symbol.for('objectstack.driver.aggregate.relationGroupJoins');

/**
 * [aggregate order and cut] The AST key the engine hands its order, cut and
 * group-count request on (`objectql` `aggregate-order-cut.ts`, the same
 * `Symbol.for` key — this package does not import the engine). A symbol, so no
 * wire request and no JSON query can carry one; set by the engine after every
 * middleware ran.
 */
export const AGGREGATE_ORDER_CUT_DIRECTIVE: unique symbol = Symbol.for('objectstack.driver.aggregate.orderCut');

/** The order, cut and group-count column, as the engine hands them. */
export interface AggregateOrderCutDirective {
  /**
   * The full order, every key a column the grouped statement projects. A key
   * with a `rank` orders by each value's position in it, any value it does
   * not list after every listed one.
   */
  readonly orderBy: ReadonlyArray<{
    readonly column: string;
    readonly order: 'asc' | 'desc';
    readonly rank?: ReadonlyArray<string | number>;
  }>;
  /** The most groups to answer; absent = every group. */
  readonly limit?: number;
  /** The column every row answers the pre-cut group count under. */
  readonly groupCountColumn: string;
}

/** A directive the engine did not compose: refused, INTERNAL_ERROR / 500, before anything runs. */
function aggregateOrderCutFault(detail: string): Error {
  const err = new Error(
    `aggregate: an order-and-cut directive the engine did not compose was refused (${detail}); the query was NOT run.`,
  ) as Error & { code?: string; status?: number };
  err.code = 'INTERNAL_ERROR';
  err.status = 500;
  return err;
}

/** The directive on `query`, or `undefined` when it carries none; a malformed one is refused. */
export function aggregateOrderCutOf(query: DriverQuery): AggregateOrderCutDirective | undefined {
  const directive = (query as unknown as Record<symbol, unknown>)[AGGREGATE_ORDER_CUT_DIRECTIVE];
  if (directive === undefined) return undefined;
  const d = directive as Partial<AggregateOrderCutDirective> | null;
  const ok = d !== null && typeof d === 'object'
    && Array.isArray(d.orderBy)
    && d.orderBy.every((k) => typeof k?.column === 'string' && k.column !== '' && (k.order === 'asc' || k.order === 'desc')
      && (k.rank === undefined || (Array.isArray(k.rank) && k.rank.length >= 1
        && k.rank.every((v: unknown) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))))))
    && (d.limit === undefined || (typeof d.limit === 'number' && Number.isInteger(d.limit) && d.limit >= 1))
    && typeof d.groupCountColumn === 'string' && d.groupCountColumn !== '';
  if (!ok) throw aggregateOrderCutFault('malformed');
  return d as AggregateOrderCutDirective;
}

/** One relation join, as the engine hands it. */
export interface RelationGroupJoin {
  /** The single-valued relation (FK) column of the aggregated object. */
  readonly field: string;
  /** The related rows the caller may read, composed by the engine; `null` = none. */
  readonly parent: ComposedReadableIds | null;
  readonly attrs: ReadonlyArray<{ readonly attr: string; readonly alias: string }>;
  /** The output column: `1` where a readable related record joined, `0` where none did. */
  readonly resolvedAlias: string;
}

/**
 * [#33697] The non-UTC reference zone an `aggregate()` query's date buckets
 * are read in, or `undefined` when there is none to read: no `timezone`, the
 * `UTC` the engine never sends but a direct caller may, or a query with no
 * `dateGranularity` item (no bucket reads a zone).
 */
function zonedBucketOf(query: DriverAggregateQuery): string | undefined {
  const zone = query.timezone;
  if (zone === undefined || zone === 'UTC') return undefined;
  const bucketed = (query.groupBy ?? []).some((g) => typeof g === 'object' && g !== null && !!g.dateGranularity);
  return bucketed ? zone : undefined;
}

/**
 * [#33697] The runtime's resolved IANA name for `zone` when it is an
 * area/location name (contains `/`), else `undefined` — the test ADR-0053
 * Phase 2 D2 (as amended) states for what may be pushed down. A string the
 * runtime cannot resolve throws there, and an offset (`+08:00`) or an
 * abbreviation that resolves to itself (`EST5EDT`) has no `/`.
 */
function resolvedAreaZone(zone: string): string | undefined {
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
  return resolved.includes('/') ? resolved : undefined;
}

/**
 * The joins on `query`, or `undefined` when it carries none. A parent that is
 * not a leaf the engine composed is refused before anything compiles, as an
 * uncomposed `ReadableIds` leaf is: its scope is the only thing that bounds
 * the joined rows, and ⛔ a scope the engine did not compose is never read as
 * one.
 */
function relationGroupJoinsOf(query: DriverQuery): readonly RelationGroupJoin[] | undefined {
  const joins = (query as unknown as Record<symbol, unknown>)[RELATION_GROUP_JOINS];
  if (joins === undefined) return undefined;
  const ok = Array.isArray(joins) && joins.every((j: RelationGroupJoin) =>
    j !== null && typeof j === 'object'
    && typeof j.field === 'string'
    && (j.parent === null || isComposedReadableIds(j.parent))
    && Array.isArray(j.attrs) && j.attrs.every((a) => typeof a?.attr === 'string' && typeof a?.alias === 'string')
    && typeof j.resolvedAlias === 'string');
  if (!ok) {
    const err = new Error(
      'aggregate: a relation group join the engine did not compose was refused; the query was NOT run.',
    ) as Error & { code?: string; status?: number };
    err.code = 'INTERNAL_ERROR';
    err.status = 500;
    throw err;
  }
  return joins as readonly RelationGroupJoin[];
}

/**
 * The aggregate operand on SQL Server — the two `@objectstack/core` operand
 * policies (`aggregandOperandSql`), restated for the one dialect that policy
 * table does not name, because SQL Server needs BOTH of them for reasons of
 * its own:
 *
 * - **The boolean cast.** `bit` is SQL Server's boolean, and `SUM` / `AVG` /
 *   `MIN` / `MAX` over a `bit` operand are errors there ("Operand data type
 *   bit is invalid for sum operator"), the same position PostgreSQL's
 *   `boolean` is in. So the four functions read `CAST(x AS int)`, answering the
 *   ruled 1 / 0 arithmetic; `count` / `count_distinct` stay uncast.
 * - **Double accumulation.** `AVG` over an integer column is INTEGER division
 *   on SQL Server (`AVG` of 1 and 2 is 1), so the policy's `'double'` functions
 *   read `CAST(x AS float)`. A direct cast is the value the rows path adds:
 *   tedious hands a `decimal` / `numeric` / `money` value to JS as the same
 *   double, so there is no text detour to reproduce (PostgreSQL and MySQL take
 *   one because their clients hand those types over as decimal TEXT).
 *
 * Kept beside its one caller rather than added to the core policy table: the
 * table's dialect vocabulary is shared with the analytics compilers, which do
 * not emit for SQL Server.
 */
export function mssqlAggregandOperandSql(
  func: keyof typeof AGGREGATE_ACCUMULATION,
  columnClass: AggregandColumnClass | undefined,
  operand: string,
): string {
  const castsBoolean = columnClass === 'boolean' && func !== 'count' && func !== 'count_distinct';
  const cast = castsBoolean ? `cast(${operand} as int)` : operand;
  const accumulation = AGGREGATE_ACCUMULATION[func];
  const inDouble = accumulation === 'double'
    ? columnClass !== undefined
    : accumulation === 'double-over-fractional' && columnClass === 'fractional';
  return inDouble ? `cast(${cast} as float)` : cast;
}
