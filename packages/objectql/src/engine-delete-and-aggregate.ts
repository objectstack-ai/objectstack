// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Delete, count, aggregate and execute" section of
 * `ObjectQL`: the bodies of `assertNoInternalFieldEvaluated`, `aggregate` moved
 * out of `engine.ts` whole by `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link DeleteAndAggregateFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link DeleteAndAggregateHost}: exactly the
 * `ObjectQL` members they read, private ones included. Each stub hands its
 * body one literal of the members that body reads, plus a `.call`: methods go
 * as closures that call them on the engine at call time, so a subclass
 * override or an instance spy is still the one reached; fields and accessors
 * go as GETTERS, read when the body reads them, as they were on the class,
 * and a field a body assigns goes with a SETTER that assigns it on the engine.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { normalizeFilterComparandTypes } from '@objectstack/spec/data';
import type { EngineAggregateOptions, QueryAST } from '@objectstack/spec/data';
import type { InternalFieldEvaluationOptions, InternalFieldEvaluationQuery } from '@objectstack/spec/contracts';
import { assertFilterIsMaterializable, assertListComparandShapes, invalidFilterError } from './filter-comparand-shape.js';
import { assertHavingTemporalComparandsInterpretable, assertTemporalComparandsInterpretable } from './temporal-comparand-door.js';
import { assertTextOperatorTargetsAreStringCapable } from './text-operator-declared-type-door.js';
import { narrowHavingNumberComparands, narrowNumberComparands } from './number-comparand-declared-type-door.js';
import { rejectCredentialEvaluation } from './credential-evaluation-guard.js';
import { assertNoInternalFieldEvaluated, rejectInternalFieldEvaluation } from './internal-field-evaluation-guard.js';
import { assertGroupByNamesNoJsonStoredField } from './group-by-structured-json-door.js';
import { assertAggregationFieldTypesAccepted } from './aggregate-field-type-door.js';
import { assertRecordCurrencyAggregatesGrouped } from './record-currency-aggregate-door.js';
import { assertAggregatedColumnsAreDistinct, assertDateBucketTargetsAreTemporal } from './aggregate-query-shape-door.js';
import { applyInMemoryAggregation } from './in-memory-aggregation.js';
import { aggregatedRowColumnClasses, aggregatedRowColumnTypes, aggregatedRowColumns, applyHaving, assertAggregationFilterIsEvaluable, assertHavingIsEvaluable, assertHavingIsFilterCondition } from './having-filter.js';
import {
  ENGINE_AGGREGATE_OPTION_KEYS, ENGINE_WHERE_SLOTS, declaredDatetimeLowering, describeNonFilterWhere,
  foldEngineOptionAliases, isWhereFilterObject, lowerWhereFilterArray, mergeReadContext, rejectUnknownEngineOptions,
  resolveThenLowerWhere, whereResolvedTokenJudge,
} from './engine-top-level.js';
import type { EngineReadOptions, OperationContext } from './engine-top-level.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link DeleteAndAggregateFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface DeleteAndAggregateHost {
  readonly _registry: ObjectQL['_registry'];
  buildDriverOptions: ObjectQL['buildDriverOptions'];
  composeReadableIdsAtBoundary: ObjectQL['composeReadableIdsAtBoundary'];
  executeWithMiddleware: ObjectQL['executeWithMiddleware'];
  expandSearchOnOptions: ObjectQL['expandSearchOnOptions'];
  getDriver: ObjectQL['getDriver'];
  readonly logger: ObjectQL['logger'];
  rejectCredentialAggregation: ObjectQL['rejectCredentialAggregation'];
  readonly relatedSchemaOf: ObjectQL['relatedSchemaOf'];
  resolveObjectName: ObjectQL['resolveObjectName'];
  resolveWhereTokens: ObjectQL['resolveWhereTokens'];
}

/** The bodies of the "Delete, count, aggregate and execute" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class DeleteAndAggregateFacet {
  /** The body of `ObjectQL#assertNoInternalFieldEvaluated`; the method's docblock there is its contract. */
  static assertNoInternalFieldEvaluated(this: Pick<DeleteAndAggregateHost, 'relatedSchemaOf'>, object: string, query: InternalFieldEvaluationQuery, options?: InternalFieldEvaluationOptions): void {
    assertNoInternalFieldEvaluated(object, query, this.relatedSchemaOf, options);
  }

  /** The body of `ObjectQL#aggregate`; the method's docblock there is its contract. */
  static async aggregate(this: Pick<DeleteAndAggregateHost, '_registry' | 'buildDriverOptions' | 'composeReadableIdsAtBoundary' | 'executeWithMiddleware' | 'expandSearchOnOptions' | 'getDriver' | 'logger' | 'rejectCredentialAggregation' | 'relatedSchemaOf' | 'resolveObjectName' | 'resolveWhereTokens'>, object: string, query: EngineAggregateOptions, options?: EngineReadOptions): Promise<any[]> {
      object = this.resolveObjectName(object);
      // Fold the `filter` alias into `where` (#4346) — the AST below reads
      // `query.where` only, so an unfolded `{ filter }` aggregated every row.
      query = foldEngineOptionAliases(object, 'aggregate', query, ENGINE_WHERE_SLOTS);
      rejectUnknownEngineOptions(object, 'aggregate', query, ENGINE_AGGREGATE_OPTION_KEYS);
      query = lowerWhereFilterArray(object, 'aggregate', query, this._registry.getObject(object), this.relatedSchemaOf);
      // [ADR-0100] The filter half of the credential-column guard — `where`
      // and every `aggregations[i].filter` — before the search term joins
      // `where`; the aggregate half (`rejectCredentialAggregation`) follows.
      // [internal: true] The flagged-column refusal goes first, over every
      // position at once (`where`, `groupBy`, each aggregation's `field` and
      // `filter`), so a non-system caller meets the data door's words here
      // too rather than the aggregate guard's.
      rejectInternalFieldEvaluation(object, query, mergeReadContext(query?.context, options?.context), this.relatedSchemaOf);
      rejectCredentialEvaluation(object, 'aggregate', query, mergeReadContext(query?.context, options?.context), this.relatedSchemaOf);
      // ADR-0061 `search` → the rows are searched BEFORE they are grouped, by
      // the one expander `find` runs, at the same point in the sequence (after
      // the `where` doors above, before the AST is built and tokens resolve).
      query = await this.expandSearchOnOptions(object, query, options);
      this.rejectCredentialAggregation(object, query);
      // [#20783] …and a `groupBy` entry naming a structured-JSON field (`json`,
      // `composite`, `address`, …) is refused `INVALID_FIELD` / 400 here, before
      // any driver is asked: the drivers share no meaning for a JSON document as
      // a group key (memory merged every row into one group, SQLite grouped each
      // serialized document apart, PostgreSQL answered 500). After the
      // credential refusal, which reads the same entries, so a protected field
      // keeps that refusal's words. [#20808] The same door refuses a `groupBy`
      // entry naming a MULTI-VALUE field (`isMultiValueField`: a list stored in
      // a JSON column, split the same three ways), judged in one walk so the
      // first offending position is the one named.
      assertGroupByNamesNoJsonStoredField(object, this._registry.getObject(object), query.groupBy);
      // [#20808] …and every aggregation's (function, declared field type)
      // pair, asked of the spec table (`isAggregateCompatibleWithFieldType`)
      // beside `isMultiValueField`, before any driver is asked. [#20808] took
      // the `count_distinct` row (memory counted equal documents apart, SQLite
      // compared serialized text, PostgreSQL answered 500); [#20914] took the
      // other rows — `max` over a `json` field answered a document in memory, a
      // string on SQLite and a 500 on PostgreSQL; `sum` over one answered `0`,
      // `0` and a 500. Every row of the table is asked (see the door's header).
      assertAggregationFieldTypesAccepted(object, this._registry.getObject(object), query.aggregations);
      // [ADR-0144 D6] …and a `sum` / `avg` / `min` / `max` over a `record`-mode
      // amount that does not group by its code field: the rows hold amounts in
      // different currencies, which add into one number under one label.
      // After the type door, so a type it refuses keeps that door's words.
      assertRecordCurrencyAggregatesGrouped(object, this._registry.getObject(object), query.groupBy, query.aggregations);
      // [#25818] …and the two shapes that answered a plausible wrong table: a
      // `dateGranularity` over a field declared neither a date nor a datetime
      // (every row in one null bucket), and two columns of the aggregated row
      // under one name (the last value written won). After the two doors
      // above, so a JSON field under a date bucket keeps their words.
      assertDateBucketTargetsAreTemporal(object, this._registry.getObject(object), query.groupBy);
      assertAggregatedColumnsAreDistinct(object, query.groupBy, query.aggregations);
      // [#10576] The per-aggregation `filter` (`AggregationNodeSchema.filter`,
      // the contract half of #10413) is a second filter position on this verb,
      // so it walks through the same refusal doors `where` does at this seam:
      // the comparand-shape gate (#5869 — a scalar `$in` etc. is refused, not
      // silently matched against nothing) and the materializable-field gate
      // (#8296 — a typo'd column would otherwise select ZERO rows for that one
      // aggregation, silently, which is the same wrong-number shape #10413
      // measured). The path names which aggregation carries the offending key.
      {
          const aggregations = Array.isArray(query.aggregations) ? query.aggregations : [];
          let typedAggregations: typeof aggregations | undefined;
          for (const [i, agg] of aggregations.entries()) {
              const aggFilter = (agg as { filter?: unknown })?.filter;
              if (aggFilter == null) continue;
              // [#20122] The SHAPE gate `where` takes first on its own seam
              // (`lowerWhereFilterArray`, #20121) — first here too, with its
              // object test (`isWhereFilterObject`) and its words, minus the
              // array half (below). A filter that is not a filter object
              // (a string, a number, a boolean, `''`, a `Map`, a `Date`) was
              // stepped around by every door below, each of which walks a filter
              // node's keys, and then dropped: the fork below reads it as "no
              // filter", so the aggregation read every row of its group
              // (`driver-sql`'s native aggregate answered a non-empty string
              // with a 501 instead). The wire door already refuses these shapes
              // through `AggregationNodeSchema`; this closes the in-process one.
              //
              // An ARRAY is refused too, `[]` included — unlike `where`, which
              // lowers the condition-array sugar in its array branch. The slot
              // is declared `FilterConditionSchema` (an object, no array form),
              // the wire door refuses every array here (`VALIDATION_FAILED`),
              // and in-process a condition array counted no row (the walker
              // read its index positions as column names) while `[]` read as
              // no filter. Same ruling as `having`'s condition check (#20099).
              if (Array.isArray(aggFilter)) {
                  let shown: string;
                  try {
                      shown = JSON.stringify(aggFilter) ?? String(aggFilter);
                  } catch {
                      shown = String(aggFilter);
                  }
                  if (shown.length > 80) shown = `${shown.slice(0, 77)}...`;
                  throw invalidFilterError(
                      `aggregate('${object}'): 'aggregations[${i}].filter' must be a filter object, received ` +
                      `an array (${shown}). The condition-array form — [field, operator, value] tuples and ` +
                      `["and", …] groups — is input-only sugar lowered on 'where' alone; a per-aggregation ` +
                      `filter is declared as a filter condition object and does not take it, so an array here ` +
                      `was never applied as the filter it spells. Write the object form, ` +
                      `{ "FIELD": { "$gt": 100 } }, or omit 'filter' for no filter.`,
                  );
              }
              if (!isWhereFilterObject(aggFilter)) {
                  throw invalidFilterError(
                      `aggregate('${object}'): 'aggregations[${i}].filter' must be a filter object, ` +
                      `received ${describeNonFilterWhere(aggFilter)}. It was not applied, and an ` +
                      `unapplied filter would have aggregated every row of each group for that aggregation.`,
                  );
              }
              assertListComparandShapes(object, 'aggregate', aggFilter, `aggregations[${i}].filter`);
              assertFilterIsMaterializable(object, 'aggregate', this._registry.getObject(object), aggFilter);
              // [#15661] …and the declared-type door for the text operators: a
              // `$contains` over a numeric column in ONE aggregation's filter is
              // the same silent zero at a second filter position, and a door that
              // spoke on `where` alone would answer one mistake two ways within a
              // single verb. [#20334] Rooted at this position, as the shape door
              // above is: the refusal said `at where.amount.$contains`, a `where`
              // the author did not write.
              assertTextOperatorTargetsAreStringCapable(
                  object, 'aggregate', this._registry.getObject(object), aggFilter, `aggregations[${i}].filter`,
              );
              // [#20148] …and the TEMPORAL-comparand door, fourth here as it is
              // fourth on `where`'s seam (#8690) — the same function, against the
              // object's declared fields, since this filter reads the object's
              // raw rows. A comparand a declared date / datetime / time field
              // cannot interpret (`'not-a-date'`, the preset name
              // `'last_30_days'`) was compared as written: no row counted, a
              // `$between` with one such endpoint counted EVERY row, and the same
              // bound in a `where` was refused 400 — measured on the base on
              // driver-memory and driver-sql, through the engine and REST.
              // Before the token resolver below, as there, so a `{placeholder}`
              // is stepped around and resolved (or refused) a moment later.
              // [#20334] Rooted at this position too: the refusal said
              // `at where.placed_on.$gt`.
              assertTemporalComparandsInterpretable(
                  object, 'aggregate', this._registry.getObject(object), aggFilter, `aggregations[${i}].filter`,
              );
              // [#20351] …and the NUMBER-comparand door, fifth here as it is
              // fifth on `where`'s seam: a non-numeric string against a declared
              // numeric field counted no row (every row under `$ne`) where its
              // `where` twin was a 500 on PostgreSQL, and a numeric string is
              // narrowed to its number, copy-on-write, before the in-memory
              // evaluator compares it. Rooted at this position. [#20546] Its
              // walk's no-operator-object arm too: `{ amount: { a: 1 } }` here
              // counted no row, silently, on every driver. [#20745] So did
              // `{ owner: { region: 'NA' } }` beneath a lookup; a JSON object
              // here is refused alike, one answer per filter at every position.
              // [#21333] …and its boolean arm: `"true"` against a declared
              // boolean field counted no row (every row under `$ne`) on both
              // drivers; it is narrowed to `true` here, `"yes"` refused.
              const numeric = narrowNumberComparands(
                  object, 'aggregate', this._registry.getObject(object), aggFilter, `aggregations[${i}].filter`,
              );
              // [#20122] …and the two doors `having` took at its own entry
              // (#20099), so a refusal here is the FILTER's, never the data's:
              //  1. the comparand-TYPE door `where` takes in
              //     `lowerWhereFilterArray`, rooted at this position — a plain
              //     object, a `Map` or a function comparand was compared as it
              //     stood and counted no row (every row under `$ne`), and a
              //     `Symbol` under an ordering operator threw an uncoded
              //     `TypeError`, on a populated table only. An exact-range
              //     bigint is narrowed copy-on-write, as it is there;
              //  2. the walker's own refusals, judged once
              //     (`assertAggregationFilterIsEvaluable`). The fallback below
              //     walks the filter per SOURCE row, so `{ amount: { $median: 1 } }`
              //     was a 400 on a populated table and a `200 []` on an empty one,
              //     and a `$or` whose first branch held counted every row.
              //     [#20148] …then, against the object's DECLARED fields, the two
              //     cross-field rules `where` gets from `driver-sql`'s compiler:
              //     a `{ $field }` names a declared field, and an `addDays` pair
              //     follows `FieldReferenceSchema.addDays`' class rule. Both were
              //     answered by the fallback — no row counted — where `where` is
              //     refused. Refused in `where`'s words for that comparison, which
              //     withhold the fields, the operator and the reason; the
              //     withheld half goes to this log, as the driver writes its own.
              //     [#21007] …and, last, `where`'s JSON-column rule: a scalar
              //     comparison (`$in`, `$nin`, `$eq`, an ordering, implicit
              //     equality, …) on a field declared JSON-stored is refused in
              //     `where`'s words — counted by the fallback, `$nin` counted the
              //     very rows it was asked to exclude. Same withholding, same log.
              const typed = normalizeFilterComparandTypes(numeric, `aggregate('${object}')`, `aggregations[${i}].filter`);
              assertAggregationFilterIsEvaluable(typed, i, {
                  object,
                  fields: (this._registry.getObject(object) as { fields?: unknown } | undefined)?.fields,
                  reportWithheld: (diagnostic) => this.logger.warn(
                      `aggregate('${object}'): INVALID_FILTER — refusal detail withheld from the response, as it `
                      + `is for the same refusal in a where. Full diagnostic: ${diagnostic}`,
                  ),
              });
              if (typed !== aggFilter) {
                  typedAggregations ??= [...aggregations];
                  typedAggregations[i] = { ...(agg as object), filter: typed } as typeof agg;
              }
          }
          if (typedAggregations) query = { ...query, aggregations: typedAggregations };
      }
      // [#19974] `having` is this verb's THIRD filter position, and it walks
      // through the same comparand-shape face the other two take above —
      // called once, here, with the path seeded at `having`. The 2026-09-23
      // ruling on #19757 refuses an array in the equality slot at that face
      // "for every driver at once", and the face refuses it for `where` on
      // every driver. `having` never reaches a driver, though: the engine
      // evaluates it itself (`applyHaving`, having-filter.ts), and that walker
      // ANSWERED every shape the face refuses — `{ total: [5] }` by JS `==`
      // coercion (`5 == [5]` is true), `{ total: { $eq: [5] } }` by `!=`, a
      // scalar `$nin` or a malformed `$between` by keeping every group, a null
      // `$lt` bound by keeping none. Measured on the base through this method,
      // on driver-memory and driver-sqlite-wasm, on both doors below.
      //
      // ONE call covers BOTH `applyHaving` doors — the native
      // `driver.aggregate()` path and the in-memory fallback — because it runs
      // before either is chosen and before any driver is asked for a row. The
      // shape of a comparand is a property of the FILTER, so it is judged once
      // per query, never per aggregated row: an empty grouped set refuses the
      // same `having` a populated one does. ⛔ Not a second face and not a
      // walker-local check in having-filter.ts: the verdicts, the wording and
      // the `INVALID_FILTER` / 400 envelope are the face's own, so a `having`
      // refusal reads byte for byte as the `where` refusal of the same shape,
      // path aside — and whatever arm the face gains next, `having` gains too.
      //
      // [#20099] …and the rest of the doors `where` takes, at the same seam, so
      // the whole clause is judged once, before any row exists. In order:
      //  1. `having` is a filter condition at all — `QuerySchema.having` and
      //     `EngineAggregateOptions.having` declare `FilterConditionSchema`,
      //     which refuses an array or a scalar. The walker read an array's index
      //     keys as columns (`[['total','>',100]]` kept no group) and a scalar
      //     as no condition (every group). ⛔ Not lowered: the `FilterArray`
      //     sugar is declared on `where` alone, and every later door steps
      //     silently around a non-node, so this runs first.
      //  2. the comparand-shape face (above);
      //  3. the comparand-TYPE door — the same `normalizeFilterComparandTypes`
      //     `lowerWhereFilterArray` runs on `where`, path rooted at `having`, so
      //     `{ total: { $eq: { v: 1 } } }` is the `where` refusal of that shape
      //     rather than a silent `[]`, and an exact-range bigint is narrowed
      //     copy-on-write exactly as it is there;
      //  4. the walker's own refusals plus the `{ $field }` reference's
      //     position and name, judged against the aggregated row's column set
      //     read off THIS query (`assertHavingIsEvaluable`). The walker raised
      //     them per aggregated row, so an empty grouped set answered `200 []`
      //     for a `having` a populated one refused. [#20123] The same column
      //     set judges every KEY too: a key naming no column read "no value"
      //     in every group, so a typo for an alias kept no group (every group
      //     under a negation) with no error.
      // A reference that passes is then RESOLVED against each aggregated row
      // (having-filter.ts `compareWithReference`) on both doors below.
      assertHavingIsFilterCondition(query.having);
      assertListComparandShapes(object, 'aggregate', query.having, 'having');
      // [#20176] The object's declaration, read once: the per-aggregation
      // `filter` reads a temporal comparand by its column's storage rule
      // (`applyInMemoryAggregation` below), and `having` by its aggregated
      // column's — the rule the drivers apply to the same comparand in a
      // `where`. Before, both positions compared it as written, so an ISO
      // instant against a `date` field counted 1 row where the `where` twin
      // counted 3, over REST, on driver-memory and driver-sql alike.
      const declaredFields = (this._registry.getObject(object) as { fields?: Record<string, unknown> } | undefined)?.fields;
      // [#20127] …and each aggregated column's class, read off the query and the
      // object's declaration, so a `{ $field, addDays }` pair is judged by the
      // rule `FieldReferenceSchema.addDays` declares (two temporal columns of
      // one class) rather than answered by epoch-ms coercion. [#20176] Kept for
      // both `applyHaving` doors below, which read a temporal column's
      // comparands by its storage rule.
      const havingColumnClasses = aggregatedRowColumnClasses(query.groupBy, query.aggregations, declaredFields);
      {
          const having = normalizeFilterComparandTypes(query.having, `aggregate('${object}')`, 'having');
          assertHavingIsEvaluable(
              having,
              aggregatedRowColumns(query.groupBy, query.aggregations),
              havingColumnClasses,
              // [#21255] …and each column's TYPE, which a plain `{ $field }`
              // reference's class rule asks the spec's verdict of — the rule
              // `where` applies to every reference, not only an `addDays` pair.
              aggregatedRowColumnTypes(query.groupBy, query.aggregations, declaredFields),
          );
          // [#20263] …and last, the TEMPORAL-comparand door `where` (#8690) and
          // the per-aggregation `filter` (#20148) take: the same walk and the
          // same `@objectstack/core` predicate, with each column's kind read
          // from the class #20127 derived above (`min` / `max` of a temporal
          // field keeps its kind, a `day` bucket is a date, `count` / `sum` /
          // `avg` are not temporal). A comparand the column's storage rule
          // cannot read (`'not-a-date'`, a `date` year outside 0..9999) was
          // compared as written and kept no group or every group, on both
          // `applyHaving` doors, while its `where` twin answered 400. After
          // every other `having` door, so a clause one of them refuses keeps
          // that refusal's words; on the caller's own clause, before the
          // bigint narrowing, which is what `where`'s object form judges.
          assertHavingTemporalComparandsInterpretable(object, query.having, havingColumnClasses, query);
          // [#20351] …then the NUMBER-comparand door `where` and the
          // per-aggregation `filter` take, over the columns #20127 classes
          // `numeric`: a non-numeric string kept no group (every group under
          // `$ne`) on both `applyHaving` doors, and a numeric string is narrowed
          // to its number. On the bigint-narrowed clause, so the two
          // narrowings compose.
          // [#20546] The same walk's no-operator-object arm judges every column
          // whose TYPE holds scalar values (hence the types, beside the
          // classes): `{ total: { a: 1 } }` kept no group, silently, on every
          // driver, where its `where` twin answered two ways. [#20745] A
          // relation or JSON column's type is judged too (a lookup groupBy's
          // nested-relation `having` kept no group on every driver).
          // [#21333] …and, by the same types, the boolean arm: over a groupBy
          // of a boolean field `"true"` kept no group (`$ne "true"` every
          // group) on both drivers; it is narrowed to `true`, `"yes"` refused.
          const numeric = narrowHavingNumberComparands(
              object, having, havingColumnClasses,
              aggregatedRowColumnTypes(query.groupBy, query.aggregations, declaredFields),
          );
          if (numeric !== query.having) query = { ...query, having: numeric };
      }
      const driver = this.getDriver(object);
      this.logger.debug(`Aggregate on ${object} using ${driver.name}`, query);

      const opCtx: OperationContext = {
        object,
        operation: 'aggregate',
        // On the opCtx so middleware-injected read filters (RLS/sharing) land
        // in `ast.where` — same #2737 hole as count(): a locally-built AST
        // aggregated over rows the caller may not see.
        ast: {
            object,
            where: query.where,
            groupBy: query.groupBy,
            aggregations: query.aggregations,
            // ENFORCED since #4286 (step 3). On the ast so the FLS predicate
            // guard walks its references (predicate-guard.ts) and a future
            // native pushdown has it in hand; the engine's post-aggregation
            // applyHaving() below is authoritative either way.
            having: query.having,
        },
        options: query,
        context: mergeReadContext(query?.context, options?.context),
      };
      // [ADR-0053 D-D1, amended — #5930] Each of this verb's three filter
      // positions resolves, then lowers, through `resolveThenLowerWhere`: `where`
      // and `aggregations[i].filter` narrow the object's raw rows, so they read
      // its declared field types; `having` narrows the aggregated row, so it
      // reads each aggregated column's type (`min` / `max` of a `datetime`
      // field is a `datetime`; a `count` is a number).
      const rowLowering = declaredDatetimeLowering(this._registry.getObject(object));
      await this.resolveWhereTokens(opCtx.ast as QueryAST, opCtx.context, rowLowering, 'where', 'aggregate');
      // [#10576] Filter tokens (`{userId}`-style placeholders, #3810) resolve
      // in per-aggregation filters exactly as they do in `where` — a filter
      // position is a filter position, and an unresolved placeholder would be
      // compared as a literal string, silently selecting zero rows for that one
      // aggregation. Copy-on-write like `withResolvedWhere`: the entry objects
      // belong to the caller (view metadata / flow config get reused), so a
      // resolved filter lands on a copied entry, never written back through.
      {
          const astAggs = (opCtx.ast as QueryAST).aggregations;
          if (Array.isArray(astAggs) && astAggs.some((a) => (a as { filter?: unknown })?.filter != null)) {
              (opCtx.ast as QueryAST).aggregations = astAggs.map((a, i) => {
                  const f = (a as { filter?: unknown })?.filter;
                  if (f == null) return a;
                  const resolved = resolveThenLowerWhere(
                      f as any, opCtx.context, rowLowering,
                      whereResolvedTokenJudge(object, 'aggregate', this._registry.getObject(object), `aggregations[${i}].filter`),
                  );
                  return resolved === f ? a : { ...(a as object), filter: resolved } as typeof a;
              });
          }
      }
      // [#20334] …and in `having`, through the resolver `where` takes, so a
      // relative-date token compares as the day it names rather than as its own
      // text, and an unknown one is `FILTER_TOKEN_UNKNOWN` / 400 (it kept no
      // group with a 200). Both `applyHaving` doors below read `ast.having`, so
      // one call covers the native and the rows path, before any driver read.
      // After every `having` door above, as `where`'s resolution follows its
      // doors: the temporal door steps around a `{placeholder}` exactly as
      // `where`'s does (so, as there, the resolved value is judged only for
      // its year, by the resolution stage — #20844), and the other doors
      // judged a string that resolves to a string.
      {
          const havingColumnTypes = aggregatedRowColumnTypes(query.groupBy, query.aggregations, declaredFields);
          await this.resolveWhereTokens(
              opCtx.ast as QueryAST,
              opCtx.context,
              { isDatetimeColumn: (column) => havingColumnTypes.get(column) === 'datetime' },
              'having',
          );
      }

      await this.executeWithMiddleware(opCtx, async () => {
        // [ADR-0139 D2] The executor boundary, once for BOTH driver paths below
        // (they are exclusive, and the rows path keeps this `where` by
        // reference): the AST is final once the chain has run.
        const ast = await this.composeReadableIdsAtBoundary(object, 'aggregate', opCtx.ast as QueryAST, opCtx.context);

        // Prefer driver.aggregate() when available — driver.find() in many
        // drivers (e.g. driver-sql) does not honor `groupBy` / `aggregations`
        // and would silently return ungrouped raw rows. Fall back to find()
        // for drivers that handle aggregations through their query AST.
        const drv = driver as any;
        // Structured groupBy items ({field, dateGranularity}) require the
        // driver to advertise per-granularity native bucket support via
        // `supports.queryDateGranularity[g]`. If every structured item is
        // supported we can push the aggregate down to the driver; otherwise
        // we fall back to driver.find() + in-memory bucketing so the result
        // remains correct on a face that buckets fewer (e.g. the Turso remote
        // transport, which advertises none).
        const groupByItems = Array.isArray(query.groupBy) ? query.groupBy : [];
        const granularityCaps: Record<string, boolean> | undefined =
            drv?.supports?.queryDateGranularity;
        const structuredItems = groupByItems.filter((g) => typeof g !== 'string');
        const allStructuredSupported = structuredItems.every((g) => {
            if (!g?.dateGranularity) return true; // plain {field} object is fine
            return granularityCaps?.[g.dateGranularity] === true;
        });
        // ADR-0053 Phase 2 (D2): native driver date bucketing (driver-sql's
        // `to_char` / `date_format` / `strftime`) is UTC-only — SQLite has no
        // tz database and MySQL needs tz tables loaded,
        // so pushing tz-aware bucketing down splits boundaries per dialect. When
        // a non-UTC reference timezone is in play we therefore force the
        // in-memory path: the date-range `where` still goes to the driver (only
        // matching rows are fetched), but bucketing runs uniformly in JS so a
        // row near a tz day-boundary lands identically on every driver.
        const tz = query.timezone;
        const hasDateBucket = structuredItems.some((g) => !!g?.dateGranularity);
        const tzRequiresInMemory = !!tz && tz !== 'UTC' && hasDateBucket;
        // [#10576] Per-aggregation filters (`aggregations[].filter`, the
        // contract half of #10413) force the in-memory path: no driver compiles
        // a conditional aggregate (SQL `FILTER (WHERE …)` / `CASE WHEN`) from
        // this key today, and pushing it down would aggregate the UNFILTERED
        // rows — the silent drop #10413 measured. Same correct-first two-tier
        // shape as date bucketing and HAVING above: a driver that grows native
        // support must advertise a capability flag, at which point this fork
        // becomes its fallback tier. The driver faces also refuse the key
        // loudly (NOT_IMPLEMENTED/501) if reached directly, so neither seam can
        // drop it in silence. `{}` counts as no filter (the vacuous-filter
        // convention `where` / `having` already follow).
        const hasAggregationFilter = (Array.isArray(ast.aggregations) ? ast.aggregations : [])
            .some((a) => {
                const f = (a as { filter?: unknown })?.filter;
                return f != null && typeof f === 'object' && Object.keys(f).length > 0;
            });
        if (typeof drv.aggregate === 'function' && allStructuredSupported && !tzRequiresInMemory && !hasAggregationFilter) {
            // HAVING is engine-owned (#4286): applied AFTER aggregation, over
            // the aggregated row's own columns (aggregation aliases + groupBy
            // projections), identically on both paths. No driver implements it
            // natively today; one that grows native support must advertise a
            // capability flag, at which point this post-filter becomes the
            // fallback tier — the dateGranularity two-tier pattern.
            const aggregated = await drv.aggregate(object, ast, this.buildDriverOptions(object, opCtx.context, undefined, { recordedVerdict: opCtx.tenantLayer0Verdict }));
            return applyHaving(aggregated, ast.having, havingColumnClasses);
        }
        // In-memory fallback path: ask the driver for raw rows, then bucket +
        // aggregate here. This guarantees `groupBy` (incl. structured items
        // carrying `dateGranularity`) and `aggregations` always work even on
        // drivers that have no native aggregation support (driver-rest,
        // driver-memory, partial SQL drivers), and is the path that honours a
        // non-UTC reference timezone.
        //
        // [#16642] The `find` call asks for ROWS, so the aggregation keys this
        // path is about to evaluate ITSELF are stripped from the AST it sends
        // down. `find()`'s contract says nothing about `groupBy` /
        // `aggregations`, and the drivers disagree about them: `driver-sql`
        // and `driver-rest` ignore both and return rows (which is the only
        // reason this path has ever worked), while `driver-memory` honours
        // them — its `find()` funnels straight into the same
        // `performAggregation` its `aggregate(AST)` door uses, and
        // `driver-mongodb` / `driver-turso` carry the same refusal on their
        // own aggregation faces. Sending the keys to a driver of that kind
        // made this ONE seam answer two different wrong things:
        //
        //   * a per-aggregation `filter` (the key that ROUTED the call here)
        //     was refused NOT_IMPLEMENTED/501 by the driver's own #10413
        //     guard — a refusal aimed at direct callers, raised against the
        //     engine's own lowering, so `service-analytics` answered 501 for
        //     a measure `filter` on the memory driver while sqlite answered
        //     the number (#16642);
        //   * a date-bucketed `groupBy` came back ALREADY grouped, on the raw
        //     timestamp, and `applyInMemoryAggregation` then aggregated those
        //     GROUP rows a second time — a count of buckets reported under
        //     the author's own measure name, i.e. a plausible wrong number
        //     rather than a refusal.
        //
        // Both driver refusals document themselves as "unreachable through
        // `engine.aggregate`, which lowers in memory for every driver"
        // (`driver-memory`'s `refusePerAggregationFilter`, `driver-sql`'s
        // `unsupportedAggregationFilterError`); this is the line that makes
        // that true. `having` goes with them: `applyHaving` below is the
        // authority on it and no driver evaluates it in `find`.
        const rowsAst: QueryAST = { ...ast };
        delete rowsAst.groupBy;
        delete rowsAst.aggregations;
        delete rowsAst.having;
        const raw = await driver.find(object, rowsAst, this.buildDriverOptions(object, opCtx.context, undefined, { recordedVerdict: opCtx.tenantLayer0Verdict }));
        return applyHaving(applyInMemoryAggregation(raw, ast, tz, declaredFields), ast.having, havingColumnClasses);
      });

      return opCtx.result as any[];
  }
}
