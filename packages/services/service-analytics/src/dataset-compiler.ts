// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Cube, Metric, Dimension as CubeDimension, CubeJoin } from '@objectstack/spec/data';
import {
  AGGREGATE_FIELD_TYPE_COMPATIBILITY,
  AggregationFunction,
  isAggregateCompatibleWithFieldType,
} from '@objectstack/spec/data';
import type { Dataset, DatasetMeasure, DatasetDimension } from '@objectstack/spec/ui';
import { resolveI18nLabel } from '@objectstack/spec/ui';
import type { FilterCondition } from '@objectstack/spec/data';
import { datasetInvalidError } from './dataset-refusal.js';
import { TEMPORAL_SOURCE_FIELD_TYPES } from './measure-result-type.js';

/**
 * Dataset → Cube compiler (ADR-0021 D-A=(c), WS2).
 *
 * Lowers a declarative `dataset` (base object + included relationships +
 * declared dimensions/measures + derived measures) into the existing Cube
 * analytics runtime model. The author never writes an `ON` clause: joins are
 * DERIVED from the `include` relationship names and the dotted `relationship.field`
 * references on dimensions/measures, matching the NativeSQLStrategy convention
 *   `<parentTable>.<relationship> = <relationship>.id`.
 *
 * Safety (D-C): every dotted field reference must point at a relationship that
 * the dataset explicitly declared in `include`; otherwise the compile fails.
 * The returned `allowedRelationships` set is the join allowlist the strategy
 * enforces at SQL-build time.
 */

/**
 * Aggregates v1 does NOT compile to the Cube SQL switch — surfaced as a clear error.
 *
 * **EMPTY since #6188, and deliberately kept.** It named `array_agg` and
 * `string_agg`: the two aggregates the spec declared and this runtime could not
 * lower. ADR-0049 resolved that the honest way round — both were retired from
 * `AggregationFunction` itself, so they are now refused one layer earlier, by
 * the parse, with a prescription that tells the author what to do instead.
 * `count_distinct` was the third unlowered function on the SQL drivers and was
 * NOT retired (maintainer ruling, 2026-08-07): this compiler lowers it already,
 * and the driver-side implementation follows on its own card.
 *
 * The set stays because it is one half of an arithmetic the lockstep tests
 * enforce (`SUPPORTED = spec vocabulary − this`), and that arithmetic is what
 * stops the next aggregate added to the spec from reaching the strategy's
 * `default` and returning a row count in place of the requested value. Empty is
 * the correct current reading — every declared aggregate is lowered — not a
 * leftover.
 */
export const UNSUPPORTED_AGGREGATES = new Set<string>();

/**
 * What v1 *can* lower — derived from the spec's vocabulary rather than restated.
 *
 * The list used to be hand-written prose inside the error message below, which
 * made it a third copy of one vocabulary (after `AggregationFunction` and the
 * `native-sql-strategy` switch) with nothing keeping the three in step. An
 * aggregate added to the spec would have passed this gate, been reported as
 * supported by that message, and then hit the strategy's `default` — returning
 * a row count in place of the requested number. objectui#2945.
 */
export const SUPPORTED_AGGREGATES: string[] = AggregationFunction.options
  .filter((a: string) => !UNSUPPORTED_AGGREGATES.has(a));

export interface DerivedMeasureSpec {
  name: string;
  op: 'ratio' | 'sum' | 'difference' | 'product';
  of: string[];
}

export interface CompiledDataset {
  /** The Cube the dataset compiles to (consumed by the strategy chain). */
  cube: Cube;
  /**
   * Every join alias the dataset may use — each declared `include` path AND its
   * intermediate prefixes (ADR-0071). The join allowlist (D-C): the
   * NativeSQLStrategy rejects any join alias not in this set.
   */
  allowedRelationships: Set<string>;
  /** Derived measures, computed post-aggregation by the executor (Q1). */
  derived: DerivedMeasureSpec[];
  /** Definition-level filter (the dataset's intrinsic scope). */
  filter?: FilterCondition;
  /** Per-measure scoped filters, keyed by measure name (applied by executor). */
  measureFilters: Record<string, FilterCondition>;
}

/**
 * The related object reached by traversing a relationship: its logical object
 * name (used to resolve the NEXT hop in a multi-hop chain — ADR-0071) and its
 * physical table name (the join target).
 */
export interface RelationshipTarget {
  object: string;
  table: string;
}

/**
 * Resolves a relationship name on a base object to the related object/table,
 * using the runtime's object graph. Optional: when omitted the compiler trusts
 * the declared `include` names (the NativeSQLStrategy convention assumes the
 * relationship name equals the related table name).
 *
 * May return a bare table-name `string` (legacy single-hop: object name is
 * assumed equal to the table) or a {@link RelationshipTarget} (required to
 * traverse further along a multi-hop path, where object differs from table for
 * namespaced objects).
 */
export type RelationshipResolver = (
  baseObject: string,
  relationshipName: string,
) => string | RelationshipTarget | undefined;

/**
 * Optional probes the compiler consults to reject metadata that is decidable
 * BEFORE any query runs. Every probe is optional and every one of them is
 * tiered "cannot answer, do not block" (the same stand-down as
 * `isRegisteredObject` / `getObjectFieldNames` on `AnalyticsServiceConfig`):
 * a host without a data engine compiles exactly as it did before.
 */
export interface DatasetCompileOptions {
  /**
   * [#5115] The datasource `objectName` is BOUND to, or `undefined` when nothing
   * authoritative can answer (no data engine, unknown object) — or when nothing
   * binds the object at all and it rides the deployment's default datasource.
   *
   * With it the compiler can settle at COMPILE time what #5033 could only
   * report at QUERY time: a dataset whose join crosses datasources declares a
   * statement no driver can execute, because the analytics engine lowers the
   * whole dataset into ONE SQL statement on the base object's datasource.
   *
   * [#5288] What the host supplies here changed shape, the rule below did not.
   * It used to be the object's DECLARED `datasource` — step 1 of the five
   * `ObjectQL.getDriver` routes by — so an object placed by a
   * `datasourceMapping` rule, by the ADR-0057 §3.6 lifecycle split, or by its
   * package's `defaultDatasource` answered `'default'` and was read here as
   * unanswered. The built-in host (`plugin.ts`) now asks the engine's own
   * resolver instead, so those three placements ARE visible from here and a join
   * between two objects bound to two different datasources is decidable
   * whichever mechanism bound them.
   *
   * Still deliberately UNANSWERED: `'default'`, and the object that no rule
   * places anywhere. The deployment's default driver keeps its natural name
   * (#3826), so "rides the default" is reported as `undefined` rather than as a
   * name — which means a join from a bound object to a default-riding one stays
   * undecidable here and remains the query-time diagnostic's business (#5288
   * records this boundary; widening it is #5115's follow-up, not this rule's).
   * See {@link compileDataset}.
   */
  getObjectDatasource?: (objectName: string) => string | undefined;
  /**
   * ADR-0062 D6 — is `objectName` federated (bound to an external datasource)?
   *
   * A federated participant is EXEMPT from the cross-datasource rejection:
   * `NativeSQLStrategy.canHandle` already declines a cube whose base or joined
   * object is external, so such a dataset is served by the ObjectQL FK-expand
   * path (two reads, joined in memory) — which crosses datasources by
   * construction. Rejecting it here would break a path that works today.
   */
  isExternalObject?: (objectName: string) => boolean;
  /**
   * [#16737 / #16099] The DECLARED `FieldType` of `field` on `objectName`, or
   * `undefined` when nothing authoritative can answer. Supplied by the host
   * from the same `AnalyticsServiceConfig.sourceFieldMeta` the result-column
   * enrichment reads.
   *
   * It is what makes {@link assertAggregateFieldTypeCompatible} decidable at
   * COMPILE time — the compile leg of the director ruling (decision batch #59,
   * 2026-09-06: "both legs, table in spec"), whose table is
   * `AGGREGATE_FIELD_TYPE_COMPATIBILITY` in `@objectstack/spec`. Absent hook,
   * unknown object, unknown field → the pair is not judged, matching every
   * other probe on this interface.
   */
  declaredFieldType?: (objectName: string, field: string) => string | undefined;
}

/** Map a dataset measure's aggregate to the Cube metric `type`. */
function aggregateToMetricType(m: DatasetMeasure): Metric['type'] {
  // Only reached for non-derived measures, where the spec refinement guarantees
  // an aggregate; guard defensively so the type narrows from `optional`.
  if (!m.aggregate) {
    throw new Error(`[dataset-compiler] non-derived measure "${m.name}" has no aggregate`);
  }
  if (UNSUPPORTED_AGGREGATES.has(m.aggregate)) {
    // [#5367] `DATASET_INVALID` / 400 — the aggregate is the dataset author's
    // choice, and the message already names the ones that would work.
    //
    // Unreachable while `UNSUPPORTED_AGGREGATES` is empty (#6188 retired its two
    // members from the spec, which now refuses them at parse). Kept as the
    // landing site for the next aggregate the spec declares before this runtime
    // can lower it: without it that aggregate reaches the strategy's `default`
    // and comes back as a row count. The lockstep suite is what decides which
    // of the two states we are in, so this branch cannot rot unnoticed.
    throw datasetInvalidError(
      `[dataset-compiler] measure "${m.name}" uses aggregate "${m.aggregate}" which is ` +
      `not supported by the v1 dataset runtime (supported: ${SUPPORTED_AGGREGATES.join(', ')}).`,
    );
  }
  return m.aggregate as Metric['type'];
}

/**
 * The aggregates that DERIVE a new number from the aggregated values, as
 * opposed to SELECTING one of them. `sum` and `avg` always answer a number
 * whatever the column holds, so a non-numeric storage form is read as
 * arithmetic by whichever dialect is underneath — the divergence
 * {@link assertAggregateFieldTypeCompatible} refuses. `min` / `max` answer a
 * value of the field's own type and are the other half of the same split
 * `measureResultType` makes; they are not judged here (see that function's
 * scope note). `count` / `count_distinct` read no value at all.
 *
 * ⛔ This is a SCOPE, never a verdict: which pairs are accepted is read off
 * `AGGREGATE_FIELD_TYPE_COMPATIBILITY` in `@objectstack/spec` and is not
 * restated anywhere in this package.
 */
const DERIVING_AGGREGATES: ReadonlySet<string> = new Set(['sum', 'avg']);

/**
 * The one sentence of PRESCRIPTION a refusal adds after naming the accepted
 * set — chosen by the source field's class, because the author's way forward
 * is not the same one for every refused pair. ⛔ It prescribes; it never
 * re-states which pairs are accepted (that is the table's line above it).
 *
 * The temporal sentence is the one #16737 measured and shipped, kept verbatim
 * for the class it was written about. The string/other sentence is the
 * generalisation this card adds: counting is the aggregate that reads no
 * arithmetic off a value, so it is what an author who wanted "how much text is
 * there" actually wants.
 */
const REMEDY_BY_SOURCE_CLASS = (fieldType: string): string =>
  TEMPORAL_SOURCE_FIELD_TYPES.has(fieldType)
    ? 'For a temporal field, `min`/`max` return a real instant; a DURATION has to be '
      + 'stored as a number (a computed "days open" field) and aggregated as one.'
    : 'For a non-numeric field, `count`/`count_distinct` accept every type because they '
      + 'read no arithmetic off the value; a quantity that should be added up has to be '
      + 'stored as a numeric field and aggregated as one.';

/**
 * [#16737 / #16099] Refuse a measure whose AGGREGATE cannot meaningfully consume
 * its field's declared TYPE — the compile leg of the director ruling (decision
 * batch #59, 2026-09-06: "both legs, table in spec"; the table is
 * `AGGREGATE_FIELD_TYPE_COMPATIBILITY` in `@objectstack/spec`, #16353).
 *
 * ## The shape this closes
 *
 * `{ aggregate: 'avg', field: 'submitted_at' }` over a `Field.datetime`
 * compiled to `AVG(submitted_at)` and reached the backend, where the ANSWER is
 * a property of the dialect rather than of the data. Both halves were measured
 * on this card:
 *
 * ```
 * -- SQLite (better-sqlite3), the canonical storage form (#3912)
 * select typeof(submitted_at), submitted_at from clm_contract limit 1;
 *   text|2026-05-19T00:00:00.000Z
 * select avg(submitted_at) from clm_contract;
 *   2025.5                      -- text->numeric coercion: the average YEAR
 *
 * -- PostgreSQL 16.13
 * select avg(submitted_at) from clm_contract;
 *   ERROR:  function avg(timestamp with time zone) does not exist   -- 42883
 * ```
 *
 * ⭐ The SQLite half is the dangerous one, and the reason this refusal is a
 * refusal rather than a definition: `2025.5` is not a number a reader can tell
 * is wrong. Fed to `derived: { op: 'difference', of: [avg_a, avg_b] }` it
 * became `-0.85` on a tile labelled "average cycle time delta" — exactly what a
 * correct answer looks like. Postgres at least fails loudly; the DEV datasource
 * in this platform's default flow is SQLite, so the plausible number is what
 * ships (Prime Directive #12).
 *
 * ## Why compile time, and why that also covers `derived`
 *
 * `derived` measures reference other measures BY NAME, and the executor expands
 * a selected derived measure into its `of` dependencies before querying. Both
 * are downstream of THIS loop: a dataset carrying an incompatible base measure
 * never finishes compiling, so no `derived` op can be handed its output. That
 * is the whole of `derived` coverage — there is no second gate to keep in step,
 * which is why the refusal is placed on the measure and not on the consumer.
 *
 * ## ⚠️ Scope: the DERIVING aggregates, and why `min` / `max` still wait
 *
 * The verdict is the spec predicate's — ⛔ no row is restated here. What is
 * scoped is which PAIRS this gate judges at all: those whose aggregate DERIVES
 * a new number from the values (`sum` / `avg`, {@link DERIVING_AGGREGATES}),
 * and no other. `min` / `max` SELECT one of the stored values and are not
 * judged here at all.
 *
 * ⛔ That is a deliberate stop, not an oversight, and the line is the one this
 * package already draws: `measureResultType` branches on exactly this pair of
 * aggregates, because `min` / `max` return a value of the source field's OWN
 * type while `sum` / `avg` always return a number (#15768). The defect this
 * gate exists for is a DERIVED number whose value is decided by the dialect
 * rather than by the data, so the deriving aggregates are precisely its
 * population.
 *
 * ⛔ Executing the table's `min` / `max` rows from here today would break uses
 * this platform answers on purpose, measured rather than assumed — #16099
 * drove it before this scope was written:
 *
 * - `min` / `max` over the STRING classes (`text`, `select`, `lookup`,
 *   `autonumber`, …) are refused by the table and are the subject of a ruling
 *   going the OTHER way: the table is to be AMENDED to accept them
 *   (**#17513**). `measureResultType` (#15768) types exactly those results as
 *   `'string'`, and `__tests__/measure-result-type.test.ts` pins them end to
 *   end through `queryDataset`. Enforcing them here would pre-empt that
 *   amendment.
 * - `min` over `json` and over `formula` are refused by the table, are in NO
 *   ruling's scope, and are nonetheless driven end to end by the same shared
 *   fixture as the rows above (`min_payload`, `min_margin`). Because that
 *   fixture compiles every measure in ONE dataset, a single refused pair reds
 *   the whole section: subtracting only the string classes and enforcing the
 *   rest was measured on this card and still failed **15** cases, all of them
 *   on `min` × `json`. So the `min` / `max` population is ONE question, and it
 *   is #17513's rather than a set this gate can partly execute.
 *
 * The deriving rows carry no such counter-evidence. Their temporal members were
 * measured on both dialects under #16737 (above); for the rest, no shipped
 * dataset in this repository pairs `sum` or `avg` with a non-numeric field —
 * every one of the eleven shipped dataset measures resolves to `number`,
 * `currency`, `summary` or `progress` — and `sum` × `percent`, which
 * `analytics-service.ts` has called "incoherent" in a comment since before this
 * table existed, is refused here on the table's authority at last.
 *
 * `boolean` / `toggle` are not a collision in either population: #16750 added
 * both members to the `sum` / `avg` / `min` / `max` rows on the authority of
 * maintainer ruling #11152 (booleans aggregate as NUMBERS on every backend,
 * pinned by `AGGREGATION_CASES`), so the table ACCEPTS them and there is
 * nothing here to refuse.
 *
 * ## Tiering — "cannot answer, do not block", the same as every sibling probe
 *
 * - No `declaredFieldType` hook (no data engine wired) → not judged.
 * - A field the hook cannot resolve → not judged.
 * - A `min` / `max` measure → not judged HERE (see the scope note).
 * - A RELATIONSHIP-PATH field (`account.closed_at`) → not judged. The hook
 *   resolves a column on the BASE object, so it would answer about a different
 *   column of the same name, or about nothing; the spec module says exactly
 *   this ("a consumer that cannot resolve a field's type must NOT call the
 *   predicate with a guess").
 * - `count` with no field → nothing to judge.
 *
 * ⛔ The accepted set is NEVER restated here. It is read off the exported table
 * so the message cannot drift from the contract it enforces, and so a row
 * changed in the spec changes this refusal in the same commit.
 */
function assertAggregateFieldTypeCompatible(
  datasetName: string,
  objectName: string,
  measure: DatasetMeasure,
  declaredFieldType?: (objectName: string, field: string) => string | undefined,
): void {
  if (!declaredFieldType) return;
  const aggregate = measure.aggregate;
  const field = measure.field;
  if (!aggregate || !field) return;
  // A dotted reference resolves on a JOINED object; this hook answers for the
  // base one. Not judged rather than judged wrongly.
  if (field.includes('.')) return;
  const fieldType = declaredFieldType(objectName, field);
  if (!fieldType) return;
  // Scoped to the DERIVING aggregates — see the scope note above. The VERDICT
  // still comes from the spec table, never from this condition.
  if (!DERIVING_AGGREGATES.has(aggregate)) return;
  if (isAggregateCompatibleWithFieldType(aggregate, fieldType)) return;

  const accepted = AGGREGATE_FIELD_TYPE_COMPATIBILITY[aggregate];
  // [#5716] `DATASET_INVALID` / 400 — a verdict about the dataset DOCUMENT,
  // decided from metadata alone before any query runs, and fixable only by the
  // author who wrote the pair.
  throw datasetInvalidError(
    `[dataset-compiler] dataset "${datasetName}" measure "${measure.name}" applies aggregate ` +
    `"${aggregate}" to field "${field}", which object "${objectName}" declares as ` +
    `\`${fieldType}\`. That pair is not accepted: "${aggregate}" derives a NUMBER from the ` +
    `stored values, so over a \`${fieldType}\` column the answer is decided by the SQL ` +
    `dialect rather than by the data — one coerces the stored form to a number and returns ` +
    `something plausible, another has no such function and fails at query time — and one ` +
    `dataset would mean two things on two deployments. ` +
    `"${aggregate}" accepts: ${accepted.join(', ')}. ` +
    `${REMEDY_BY_SOURCE_CLASS(fieldType)}`,
  );
}

/** Map a dataset dimension type to the Cube dimension `type`. */
function dimensionType(d: DatasetDimension): CubeDimension['type'] {
  switch (d.type) {
    case 'date': return 'time';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'lookup': return 'string';
    case 'string': return 'string';
    default: return 'string';
  }
}

/** The relationship PATH a dotted field traverses — all segments but the final
 *  column — or null for a base-object field. E.g. `account.owner.region` →
 *  `account.owner`; `account.region` → `account`; `region` → null. */
function fieldRelationshipPath(field: string): string | null {
  const idx = field.lastIndexOf('.');
  return idx > 0 ? field.slice(0, idx) : null;
}

/** Max relationship hops in one `include` path — base → 3 hops = 4 objects
 *  (ADR-0071; Salesforce-report-type parity). To-one chains never fan out, so
 *  this is a performance/complexity guard, not a correctness limit. */
const MAX_JOIN_HOPS = 3;

/** SQL-safe join alias for a relationship PATH. The dotted path is the author-
 *  facing form; the alias replaces dots with `__` (Cube.js convention) so each
 *  prefix is one valid identifier — quoted dotted identifiers are rejected by
 *  the read-scope SQL guard (fail-closed). Single-segment paths are unchanged,
 *  so single-hop joins stay byte-for-byte identical. */
const joinAlias = (path: string): string => path.replace(/\./g, '__');

/**
 * [#6761] The locale this compiler resolves an inline-locale-map label at:
 * **none**, i.e. the platform source language `en` per `resolveI18nLabel`'s
 * documented nullish-tolerance.
 *
 * This is a decision, not an omission, and it is spelled as a named constant so
 * it stays visible and greppable rather than reading as a forgotten argument
 * (the resolver takes `locale` positionally for exactly that reason).
 *
 * **A compiled Cube is a REGISTRY artifact, not a response.** `registerDataset`
 * writes it into `CubeRegistry` under the dataset's name, `queryDataset`
 * re-registers on every call, and `getMeta()` — the `/analytics/meta` face —
 * reads it back with **no execution context at all** (`IAnalyticsService.getMeta`
 * takes `cubeName?` and nothing else, and the route calls it without one). So
 * the request locale must NOT be baked in here: one `zh-CN` query would leave a
 * Chinese-labelled cube in a registry every later reader shares, and
 * `/analytics/meta` would answer whoever queried last. Request-scoped
 * resolution belongs where a request is in hand — `queryDataset`'s two field
 * enrichment sites, which read `context.locale`.
 *
 * **The fallback stays `d.name`, and that is safe against the `f.label == null`
 * guard** (#5199 route A / #6761). `Metric.label` and `Dimension.label` are
 * REQUIRED strings in `analytics.zod.ts`, so an unresolvable label must still
 * produce one, and the machine name is what this compiler already wrote. It
 * cannot pre-empt the document-sourced label downstream because a cube label
 * never reaches `AnalyticsResult.fields[]`: both strategies' `buildFieldMeta`,
 * the draft preview evaluator, and `DatasetExecutor`'s #5537 descriptor
 * adoption all emit `{ name, type }` only. The enrichment sites therefore still
 * see `f.label == null` and write the locale-resolved label over nothing.
 */
const REGISTRY_LOCALE: string | undefined = undefined;

export function compileDataset(
  dataset: Dataset,
  resolver?: RelationshipResolver,
  options?: DatasetCompileOptions,
): CompiledDataset {
  const include = dataset.include ?? [];

  // ── #5115 — cross-datasource joins are rejected HERE, at compile time ──────
  //
  // A dataset lowers to ONE SQL statement executed on the base object's
  // datasource (`plugin.ts` routes raw SQL by object since #5033). So a join
  // whose target lives on a DIFFERENT datasource is not a query that sometimes
  // fails — it is metadata that can never execute, and the question "which
  // datasource is each participant bound to" is fully answerable the moment the
  // dataset is compiled. #5033 made that failure loud at QUERY time (in front of
  // whoever opened the dashboard); this gate moves the same verdict to
  // registration, where the AUTHOR is still holding the metadata.
  //
  // Tiering — "cannot answer, do not block": no probe, no answer for the base
  // object, or no answer for a target ⇒ compile as before and let #5033's
  // query-time defence report it. A false ALLOW costs a loud runtime error that
  // already exists; a false REJECT would blank a working dashboard on upgrade,
  // so this gate fires ONLY on a conflict the metadata itself proves.
  //
  // What counts as an ANSWER: a non-`'default'` datasource NAME for the object.
  // Two objects bound to two different names are provably in two databases.
  //
  // `'default'` is not one. It is what `ObjectSchema.datasource` defaults to and
  // what `ObjectQL.getDriver` reads as "no explicit binding, keep looking", so
  // treating it as "the primary DB" would reject a dataset whose two objects a
  // mapping rule in fact lands on the SAME datasource, and would make the
  // verdict depend on whether the object happened to be Zod-parsed (which
  // materializes the default). It is read as UNANSWERED, as is `undefined`.
  //
  // [#5288] The probe used to report only step 1 of that resolution — the
  // DECLARED value — which left every object placed by a `datasourceMapping`
  // rule, by the ADR-0057 §3.6 lifecycle split (audit/telemetry/event → the
  // `telemetry` datasource), or by its package's `defaultDatasource` answering
  // `'default'` and therefore unanswerable here. The built-in host now asks
  // `ObjectQL.resolveEffectiveDatasource`, so this rule — unchanged — sees those
  // placements too. What it still cannot see is the object nothing binds at all:
  // that one rides the deployment's default driver and is reported as
  // `undefined`, so a join from a bound object to a default-riding one is not
  // decidable here and stays with #5033's query-time diagnostic.
  const declaredDatasource = (objectName: string): string | undefined => {
    const declared = options?.getObjectDatasource?.(objectName);
    return declared && declared.toLowerCase() !== 'default' ? declared : undefined;
  };
  const isExternal = (objectName: string): boolean =>
    options?.isExternalObject?.(objectName) ?? false;
  const baseDatasource = declaredDatasource(dataset.object);
  // Datasource ids are compared case-insensitively: an id differing only in case
  // is not evidence of two different databases, and an uncertain answer must
  // not reject.
  const sameDatasource = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const baseIsFederated = isExternal(dataset.object);
  const assertSameDatasource = (targetObject: string, path: string): void => {
    // Judgeable only when the BASE side is placed and non-federated; it is the
    // side every comparison is made against, so an unplaceable base means no
    // join can be judged (never reject every join for want of the base).
    if (!baseDatasource || baseIsFederated) return;
    if (isExternal(targetObject)) return; // served by the FK-expand path, not by one statement
    const targetDatasource = declaredDatasource(targetObject);
    if (!targetDatasource) return; // cannot answer for this target
    if (sameDatasource(targetDatasource, baseDatasource)) return;
    // [#5716] `DATASET_INVALID` / 400 — the AUTHOR's verdict, decided entirely
    // from metadata before any query runs: the dataset's `include` path and the
    // two objects' `datasource` bindings. Both are things the author (or an
    // admin) can change, and the message already names both fixes. Nothing here
    // is a runtime fault, so a 500 told the author "the platform is broken"
    // about a document they wrote.
    throw datasetInvalidError(
      `[dataset-compiler] dataset "${dataset.name}" declares a JOIN that crosses datasources: ` +
      `its base object "${dataset.object}" is on datasource "${baseDatasource}", but the joined ` +
      `object "${targetObject}" — reached via the \`include\` path "${path}" — is on datasource ` +
      `"${targetDatasource}". A dataset JOIN cannot cross datasources: the whole dataset is ` +
      `executed as ONE statement on the base object's datasource, so "${targetObject}" is simply ` +
      `not there. Fix it by binding both objects to the same datasource, or by dropping "${path}" ` +
      `from the dataset's \`include\` (and every dimension/measure that references it).`,
    );
  };

  // Resolve each declared relationship PATH into its ordered join chain, emitting
  // one Cube join per PATH PREFIX (ADR-0071 multi-hop, to-one only). The join
  // ALIAS is the full dotted path (`account.owner`), which self-describes the
  // chain: the parent alias is the path minus its last segment, the FK column is
  // that last segment. So declaring `account.owner` auto-adds the intermediate
  // `account` join, and the strategy can rebuild every `ON` from the alias alone.
  // Without a resolver, each segment's relationship name is assumed to equal both
  // the related object and its table (legacy convention / unit tests).
  const resolveHop = (fromObject: string, rel: string): RelationshipTarget => {
    if (!resolver) return { object: rel, table: rel };
    const resolved = resolver(fromObject, rel);
    if (!resolved) {
      // [#5716] `DATASET_INVALID` / 400 — the dataset's own `include` names a
      // relationship the object graph does not have: a typo or a stale dataset,
      // fixable only by the author. Sibling of the already-enveloped "…is not
      // declared in the dataset's `include`" (#5367), one step earlier in the
      // same resolution.
      //
      // ⚠️ The WORDING is left exactly as it was, and that is not an oversight:
      // it contains both "relation"(ship) and "does not exist", so
      // `analytics-service.ts`'s `isMissingSourceError` matches it — the mine
      // #5717 filed. Enveloping it does not disarm that sniffer (it reads the
      // message, not the envelope) and does not arm it either (this throw is
      // still OUTSIDE `queryDataset`'s try, which is the only reason the mine
      // has never gone off). What it DOES do is make #5717's option B — "never
      // degrade an error that declares a 4xx envelope to an empty result" —
      // able to cover this site, which before today it could not.
      throw datasetInvalidError(
        `[dataset-compiler] dataset "${dataset.name}" includes relationship "${rel}" ` +
        `which does not exist on object "${fromObject}".`,
      );
    }
    return typeof resolved === 'string' ? { object: resolved, table: resolved } : resolved;
  };
  const joins: Record<string, CubeJoin> = {};
  for (const path of include) {
    const segments = path.split('.');
    if (segments.length > MAX_JOIN_HOPS) {
      // [#5716] `DATASET_INVALID` / 400 — a limit of the v1 runtime, reported
      // against a path the author wrote. Same family as the aggregate refusal a
      // few lines up ("not supported by the v1 dataset runtime", #5367): what
      // the runtime cannot do is stated as a property of the dataset, because
      // that is what the author has to change.
      throw datasetInvalidError(
        `[dataset-compiler] dataset "${dataset.name}" include path "${path}" exceeds the ` +
        `${MAX_JOIN_HOPS}-hop limit (${segments.length} hops). Deeper traversal is not supported.`,
      );
    }
    let fromObject = dataset.object;
    let parentAlias = dataset.object;
    let prefix = '';
    for (const seg of segments) {
      prefix = prefix ? `${prefix}.${seg}` : seg;
      const target = resolveHop(fromObject, seg);
      // #5115 — every hop is a join target in the single statement, so each one
      // (not just the last segment of a path) must sit on the base datasource.
      assertSameDatasource(target.object, prefix);
      const alias = joinAlias(prefix);
      if (!joins[alias]) {
        // KEY is the SQL-safe alias; `name` carries the join TABLE; the strategy
        // rebuilds the ON clause from the alias convention (`<parent>.<seg> = <alias>.id`).
        joins[alias] = {
          name: target.table,
          relationship: 'many_to_one',
          sql: `${parentAlias}.${seg} = ${prefix}.id`,
        };
      }
      fromObject = target.object;
      parentAlias = prefix;
    }
  }

  // The join allowlist (D-C) is every registered alias — each declared path AND
  // its intermediate prefixes — so a multi-hop field's intermediate joins pass.
  const allowedRelationships = new Set(Object.keys(joins));

  // Assert any dotted field only traverses a DECLARED relationship PATH (D-C).
  const assertDeclared = (field: string, ownerKind: string, ownerName: string) => {
    const relPath = fieldRelationshipPath(field);
    if (relPath && !joins[joinAlias(relPath)]) {
      // [#5367] `DATASET_INVALID` / 400 — a dimension/measure traversing a
      // relationship the same document never declared in `include` is the
      // dataset author's mistake, and the fix is in the document they hold.
      throw datasetInvalidError(
        `[dataset-compiler] ${ownerKind} "${ownerName}" references relationship path "${relPath}" ` +
        `via "${field}", but "${relPath}" is not declared in the dataset's \`include\`. ` +
        `Only fields along a declared relationship path are joinable.`,
      );
    }
  };

  // Compile dimensions.
  const dimensions: Record<string, CubeDimension> = {};
  for (const d of dataset.dimensions) {
    assertDeclared(d.field, 'dimension', d.name);
    const dim: CubeDimension = {
      name: d.name,
      // [#6761] An inline locale map is a label, not a missing one. Before this,
      // the `typeof === 'string'` test dropped the map and substituted the
      // machine name, which `/analytics/meta` then published as a display title
      // (`title: 'owner'` for a dimension labelled `{ en: 'Owner', … }`).
      label: resolveI18nLabel(d.label, REGISTRY_LOCALE) ?? d.name,
      type: dimensionType(d),
      sql: d.field,
    };
    if (dim.type === 'time') {
      dim.granularities = d.dateGranularity
        ? [d.dateGranularity]
        : ['day', 'week', 'month', 'quarter', 'year'];
    }
    dimensions[d.name] = dim;
  }

  // Compile measures (non-derived → Cube metrics; derived → sidecar).
  const measures: Record<string, Metric> = {};
  const derived: DerivedMeasureSpec[] = [];
  const measureFilters: Record<string, FilterCondition> = {};

  for (const m of dataset.measures) {
    if (m.derived) {
      derived.push({ name: m.name, op: m.derived.op, of: m.derived.of });
      continue;
    }
    if (m.field) assertDeclared(m.field, 'measure', m.name);
    // [#16737 / #16099] …and the aggregate ITSELF must be one the field's
    // declared type can carry. Placed after the join-declaration check so a
    // dotted field is refused for the reason it is actually wrong (an
    // undeclared relationship) before this gate stands down on it.
    assertAggregateFieldTypeCompatible(dataset.name, dataset.object, m, options?.declaredFieldType);
    const metric: Metric = {
      name: m.name,
      // [#6761] Same as the dimension label above — see {@link REGISTRY_LOCALE}.
      label: resolveI18nLabel(m.label, REGISTRY_LOCALE) ?? m.name,
      type: aggregateToMetricType(m),
      // `count` with no field aggregates over rows (*).
      sql: m.field ?? '*',
    };
    if (typeof m.format === 'string') metric.format = m.format;
    measures[m.name] = metric;
    if (m.filter) measureFilters[m.name] = m.filter;
  }

  const cube: Cube = {
    name: dataset.name,
    // [#6761] The cube's own display title, same rule. `Cube.title` is optional
    // in the schema, but an absent dataset label already produced the machine
    // name here and that is not what this card changes — only the map case moves.
    title: resolveI18nLabel(dataset.label, REGISTRY_LOCALE) ?? dataset.name,
    sql: dataset.object,
    measures,
    dimensions,
    public: false,
  };
  if (Object.keys(joins).length > 0) cube.joins = joins;

  return {
    cube,
    allowedRelationships,
    derived,
    filter: dataset.filter,
    measureFilters,
  };
}
