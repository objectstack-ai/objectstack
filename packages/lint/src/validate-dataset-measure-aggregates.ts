// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16354 — the AUTHORING-TIME leg of the aggregate × field-type contract]
 * A dataset measure pairs an `aggregate` with a `field`. This rule refuses the
 * pairs `AGGREGATE_FIELD_TYPE_COMPATIBILITY` (`@objectstack/spec/data`, #16353)
 * does not accept, at the moment the author writes them. [#20890] It also
 * refuses a dataset DIMENSION over a JSON-stored field, which the analytics door
 * refuses to group by — see "The dimension leg" below.
 *
 * All judgement lives in the SHARED predicate —
 * `isAggregateCompatibleWithFieldType`, the same call the compile leg makes —
 * so this file is only the walk: where dataset measures live in a stack, how a
 * field name becomes a declared `FieldType`, and how a refused pair becomes a
 * finding with a location. ⛔ A second compatibility table here would BE the
 * two-accounts-of-one-pair drift the spec table exists to remove; if a verdict
 * seems wrong, the table is where to read and to argue.
 *
 * ## Why an authoring-time rule when the compile leg already refuses
 *
 * Both legs exist by the director ruling of decision batch #59 (2026-09-06,
 * 「both legs, table in spec」). The compile leg (`dataset-compiler`,
 * `service-analytics`) answers `400 DATASET_INVALID` when a query is built —
 * which is the last door before a backend, and the FIRST one a human sees only
 * if somebody happens to open the surface that binds this dataset. An
 * incoherent measure can sit in a config file, survive `os validate`, ship, and
 * surface as a 400 on someone else's dashboard weeks later, or — the dangerous
 * half the ruling was measured on — as a plausible number: SQLite coerces a
 * `datetime` column's canonical UTC text by its leading digits, so
 * `avg(submitted_at)` returns the average YEAR (`2025.5`) with no error and no
 * log, and the DEV datasource in this platform's default flow is SQLite.
 *
 * This rule puts the same verdict where the author is standing, before the
 * document is committed. The compile leg is unchanged: this is a second
 * consumer of one table, never a relaxation of the first.
 *
 * ## Where it reaches FURTHER than the compile leg, and why that is not a guess
 *
 * The compile leg returns early on a dotted `relationship.field` reference
 * (`if (field.includes('.')) return;`): its declared-type source is the host's
 * `AnalyticsServiceConfig.sourceFieldMeta`, which answers for the BASE object
 * only, so a column living on a joined object is *not judged rather than judged
 * wrongly*. At authoring time the whole object graph is in hand, so
 * {@link resolveFieldPath} resolves the hops and hands back the LEAF's declared
 * type — a read of the author's own declaration, not an inference. So a dotted
 * pair is judged here, and the spec module's instruction is honoured in the
 * direction that matters: a path whose type cannot be resolved is never handed
 * to the predicate as a guess (see the skips below).
 *
 * ## Its relation to the two neighbours that look like it
 *
 * - `measure-aggregate-incoherent` (`validate-widget-bindings.ts`) is the
 *   SEMANTIC opinion — "does this number mean anything" — and it is advisory
 *   and suppressible. It fires on `sum` / `count_distinct` over a `percent`
 *   field. The table refuses `sum` × `percent` too, on that predicate's own
 *   authority (`aggregate-field-type-compatibility.ts` says so), so that ONE
 *   pair is reported twice: an advisory about meaning, and this gating refusal
 *   about the contract. The overlap is deliberate rather than tidied away,
 *   because the two questions have different answers elsewhere —
 *   `count_distinct` × `percent` is advised and ACCEPTED by the table, and
 *   `avg` × `datetime` is refused here and not advised there.
 * - `rollup/non-numeric-aggregand` (`data-model-rules.ts`) judges a `summary`
 *   field's `summaryOperations`, and deliberately does NOT read this table:
 *   there the answer is STORED into a numeric column, so it refuses
 *   `min` / `max` over the temporal class, which this table accepts. Different
 *   question, different door, no shared verdict.
 *
 * ## Skips — never hand the predicate a guess
 *
 * `aggregate-field-type-compatibility.ts` states the consumer's tier:
 * *"a consumer that cannot resolve a field's type … must NOT call the predicate
 * with a guess — 'cannot answer, do not block' is the consumer's tier"*. So
 * this rule stays silent when:
 *
 *   1. the dataset names no base `object`, or one this stack does not define,
 *      or one that declares no readable field map (ADR-0015 `external` and
 *      datasource-introspected schemas) — `validate-object-references.ts` owns
 *      the first, and the rest are the object graph's `unknowable` verdicts;
 *   2. the measure writes no `aggregate` or no `field` — a plain `count` and a
 *      `derived` measure legitimately carry no field, and a non-string in
 *      either position is the schema's refusal to give, not this rule's;
 *   3. the path does not RESOLVE — a dangling reference is
 *      `dataset-field-unknown`'s finding (`validate-dataset-references.ts`),
 *      and one typo must not also yield a type verdict about a column that
 *      does not exist;
 *   4. the resolved leaf carries no declared `type` — an untyped field, and the
 *      driver-provisioned `id`, for which no definition table has an answer;
 *   5. the `aggregate` is outside the table's own vocabulary — `AggregationFunction`
 *      is a closed enum and a value outside it is a schema error, so refusing it
 *      here would report a vocabulary problem as a compatibility one.
 *
 * A registry-injected column is NOT a skip: since #16340 the graph carries the
 * registry's own definition, so `created_at` reads as the `datetime` it is and
 * `avg` over it is refused exactly as over an authored field — the pair reaches
 * the same backend either way.
 *
 * ## [#20890] The declaration half the per-type table cannot see
 *
 * The table is per TYPE, so it cannot see `multiple: true`: a `select` (or
 * `radio`, `lookup`, `user`, `file`, `image`) flagged `multiple` is a list
 * stored as JSON, the very storage the `count_distinct` row refuses `tags`
 * for. The compile leg and the engine's `count_distinct` door both ask
 * `isMultiValueField` (`@objectstack/spec/data`) beside the row, so this rule
 * asks it too, in the same place: {@link acceptsDeclaration} is the row AND
 * the declaration, and it decides the verdict and the accepted-aggregates hint
 * alike, so the two cannot disagree. Only `count_distinct` can be moved by the
 * flag — the `sum` / `avg` / `min` / `max` rows accept no multi-capable type,
 * and `count` reads no value. ⛔ No second account of the pair table: the row
 * is still the predicate's, the flag is still the spec's helper.
 *
 * ## [#20890] The dimension leg — `dimension-json-stored-field-refused`
 *
 * A dataset dimension is a GROUP KEY: it compiles to a cube dimension whose
 * `sql` is the dimension's `field` (`dataset-compiler.ts`), and a query that
 * selects it groups by that column. The analytics door
 * (`service-analytics`' `structured-json-dimension-door.ts`) refuses a grouped
 * member whose column is JSON-stored with `400 INVALID_FIELD`, before either
 * strategy builds a statement, because a JSON value is no group key the SQL
 * dialects share — one grouped each serialized value apart, another refused
 * the statement. Its two predicates, in its order, are the ones this rule
 * reads, called and never re-listed:
 *
 *   - `STRUCTURED_JSON_TYPES` — `json`, `composite`, `repeater`, `record`,
 *     `location`, `address`, `vector`;
 *   - `isMultiValueField` — an inherently multi option type (`multiselect`,
 *     `checkboxes`, `tags`), or a multi-capable type flagged `multiple: true`.
 *     The same type without the flag stores one value and is served.
 *
 * So a dimension over such a field is refused here, where the author is
 * standing, instead of on the first dashboard that selects it. There is no
 * selection of it the door serves as a group: a dataset's filters name FIELDS,
 * not dimensions, and the one ungrouped use of a dimension — a time-dimension
 * range with no `granularity` — bounds a date, which a JSON document is not.
 * The column is resolved on the object graph exactly as a measure's is (dotted
 * paths included, on the object the LEAF lives on) and stays silent under the
 * same skips 1, 3 and 4 above, plus a dimension that writes no `field`.
 *
 * ## [#21082] The cube leg — `analyticsCubes` members, under the same two ids
 *
 * An authored cube (`defineStack({ analyticsCubes })`) reaches the SAME doors
 * the dataset compiles to, whether the cube was authored or compiled from a
 * dataset: `structured-json-dimension-door.ts` judges every cube's grouped
 * members and `count_distinct` measures, and [#21419]
 * `cube-measure-field-type-door.ts` (#21044) judges every other measure whose
 * `type` is a row of the table. Until this leg no rule in this package walked
 * `analyticsCubes`, so a cube dimension over a `json` field, or a `sum` over a
 * `text` one, passed `os validate` and met its first refusal at query time.
 * The leg refuses what those doors refuse, with the verdicts this file already
 * holds — ⛔ no second account of either:
 *
 *   - a dimension whose column is structured-JSON or multi-value —
 *     {@link groupKeyClassOf}, under `dimension-json-stored-field-refused`;
 *   - [#21419] a measure whose `type` is a row of the table and whose column's
 *     declaration that row does not accept — {@link acceptsDeclaration}, the
 *     dataset measure's own verdict, under `measure-aggregate-field-type-refused`.
 *     That is every row, as on a dataset: `count_distinct` over a JSON-stored
 *     column (the `structured-json-dimension-door.ts` half), `sum` / `avg` /
 *     `min` / `max` over a type its row refuses (the
 *     `cube-measure-field-type-door.ts` half, which reads the TYPE alone — the
 *     `multiple` flag moves only `count_distinct`, see above), and never
 *     `count`, which reads no value and accepts every type. A `type` outside
 *     the table's vocabulary — since the custom-SQL metric types `number` /
 *     `string` / `boolean` were retired (#21000), one the schema itself
 *     refuses — is skip 5, as on a dataset, and neither door judges it.
 *
 * How a cube names its column is read the way the door reads it
 * (`analytics-service.ts`, `hop-object.ts`):
 *
 *   - the cube's object is its `sql`, trimmed, when that names an object this
 *     stack defines with a field map (skip 1, as for a dataset — a `sql` that
 *     is not a bare object name names none, and the door stands down on it
 *     too);
 *   - a member's column is its `sql`, a column reference since #20943: a bare
 *     column of the cube's object, or a relationship path whose leaf is read
 *     on the object the last hop reaches. A hop the cube declares a join for
 *     (`joins`, keyed by the path with its dots as `__`) reaches that join's
 *     `name` — the door's first tier, and the one place it can disagree with
 *     the field's declared `reference`; every other hop is walked on the
 *     object graph by {@link resolveFieldPath}, the door's second tier. A hop
 *     the graph cannot follow is the door's alias tier, and a skip here;
 *   - the row wildcard `'*'` names no column, so it resolves to nothing and is
 *     skipped, on a dimension and a measure alike (whether `'*'` belongs on
 *     either is a question of its own, not this leg's).
 *
 * The same skips 1, 3 and 4 hold, plus a member that writes no `sql`; and on
 * a measure, skip 5 and a measure that writes no `type`.
 *
 * Both legs ride the one registry entry: gating, on all three commands. At the
 * runtime write door that entry is dispatched for a `dataset` write, whose
 * per-write snapshot carries no `analyticsCubes`, so the cube leg reads nothing
 * there; an `analytics_cube` write is dispatched to no rule today.
 *
 * The function keeps its name: it is the registry's key (`authoring-rules.ts`),
 * and the dimension and cube legs ride on that one entry.
 */

import {
  AGGREGATE_FIELD_TYPE_COMPATIBILITY,
  STRUCTURED_JSON_TYPES,
  isAggregateCompatibleWithFieldType,
  isMultiValueField,
  type ValueShapeFieldDef,
} from '@objectstack/spec/data';

import { collectionEntries } from './collection-entries.js';
import {
  indexObjectGraph,
  isUnjudgeable,
  recordsOf,
  resolveFieldPath,
  type FieldPathVerdict,
  type ObjectGraph,
} from './object-graph.js';

/**
 * Stable diagnostic id. Named for the AXIS it judges — the field's declared
 * type — so it reads apart from its advisory neighbour
 * `measure-aggregate-incoherent`, which judges the same subject on the
 * semantic axis. `refused` is the ruling's own word for a pair outside the
 * table ("every other pair: refused").
 */
export const MEASURE_AGGREGATE_FIELD_TYPE_REFUSED = 'measure-aggregate-field-type-refused';

/**
 * [#20890] Stable diagnostic id for a dataset dimension whose field is
 * JSON-STORED — the spec's own name for the union the analytics door refuses
 * to group by (`aggregate-field-type-compatibility.ts`: the structured-JSON
 * class, the multi-option types, and a multi-capable type flagged
 * `multiple: true`). [#21082] A cube dimension whose `sql` names such a
 * column carries the same id: one verdict, one door, two places to write it.
 */
export const DIMENSION_JSON_STORED_FIELD_REFUSED = 'dimension-json-stored-field-refused';

export interface DatasetMeasureAggregateFinding {
  /**
   * Always `error`. The pair is decidable from the author's own declarations —
   * no runtime state, no call graph — and the alternative to refusing it is a
   * number whose value is a property of the SQL dialect. The compile leg
   * answers the same pair with `400 DATASET_INVALID`, so an advisory here
   * would only mean the author hears about it later, from someone else's
   * dashboard. A JSON-stored dimension is the same shape one door along: the
   * analytics door answers every query grouping by it with `400 INVALID_FIELD`.
   */
  severity: 'error';
  rule: typeof MEASURE_AGGREGATE_FIELD_TYPE_REFUSED | typeof DIMENSION_JSON_STORED_FIELD_REFUSED;
  /** Human-readable location, e.g. `dataset "sales" › measure "avg_closed"` or `cube "sales" › dimension "meta"`. */
  where: string;
  /**
   * Config path, e.g. `datasets[0].measures[2].aggregate`, `datasets[0].dimensions[1].field`,
   * `analyticsCubes[0].dimensions.meta.sql` or `analyticsCubes[0].measures.distinct_meta.type`.
   */
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

const strName = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

/**
 * The table as a Map, built once — for the MESSAGE only.
 *
 * A Map rather than property access on the frozen record because a
 * property-key lookup also answers for `Object.prototype` members, so an
 * author's `aggregate: 'toString'` would read as a declared row. The VERDICT
 * is never taken from here: it is
 * {@link isAggregateCompatibleWithFieldType}'s, which is fail-closed on both
 * vocabulary and shape. This Map only PRESENTS the same table — the accepted
 * set for the refused aggregate, and the aggregates that would accept this
 * field — so the message cannot name a set the verdict was not taken from.
 */
const ACCEPTED_TYPES_BY_AGGREGATE: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries(AGGREGATE_FIELD_TYPE_COMPATIBILITY).map(
    ([fn, types]) => [fn, types as readonly string[]] as const,
  ),
);

/**
 * May `aggregate` be applied to a field DECLARED as `shape`? The table's row
 * for the type ({@link isAggregateCompatibleWithFieldType}) AND, for
 * `count_distinct`, the declaration half the per-type row cannot see — a
 * multi-capable type flagged `multiple: true` is a list stored as JSON
 * ({@link isMultiValueField}). Asked the way the compile leg asks it, and the
 * one place this file asks it: the verdict and the hint both read it.
 */
function acceptsDeclaration(aggregate: string, shape: ValueShapeFieldDef): boolean {
  if (!isAggregateCompatibleWithFieldType(aggregate, shape.type)) return false;
  return !(aggregate === 'count_distinct' && isMultiValueField(shape));
}

/** Every aggregate that accepts a field declared as `shape` — always non-empty (`count` accepts any type). */
function aggregatesAccepting(shape: ValueShapeFieldDef): string[] {
  const accepting: string[] = [];
  for (const [fn] of ACCEPTED_TYPES_BY_AGGREGATE) {
    if (acceptsDeclaration(fn, shape)) accepting.push(fn);
  }
  return accepting;
}

/** The declaration as the words say it: the type, and the flag when the field carries it. */
function declaredAs(shape: ValueShapeFieldDef): string {
  return shape.multiple === true ? `\`${shape.type}\` with \`multiple: true\`` : `\`${shape.type}\``;
}

/** The declaration the graph holds for a resolved leaf — its type and its `multiple` flag. */
function shapeOf(verdict: Extract<FieldPathVerdict, { kind: 'ok' }>, fieldType: string): ValueShapeFieldDef {
  return { type: fieldType, multiple: verdict.meta?.multiple === true };
}

/** Which object the words say declares the leaf: the dataset's (or cube's) own, or the joined one. */
function declarerOf(
  verdict: Extract<FieldPathVerdict, { kind: 'ok' }>,
  baseObject: string,
  owner: 'dataset' | 'cube',
): string {
  return verdict.object === baseObject
    ? `object "${baseObject}"`
    : `object "${verdict.object}" (reached through this ${owner}'s join chain)`;
}

/**
 * [#20890] The class of a column a dimension GROUPS by, or `null` when it
 * stores one scalar value — the analytics door's two predicates, in its
 * order: {@link STRUCTURED_JSON_TYPES}, then {@link isMultiValueField} (the
 * declaration, `multiple` included). ⛔ Never the type alone: a type-only
 * reading would refuse `tags` and pass a `select` with `multiple: true`, which
 * is the same JSON column.
 */
function groupKeyClassOf(shape: ValueShapeFieldDef): 'structured-json' | 'multi-value' | null {
  if (STRUCTURED_JSON_TYPES.has(shape.type)) return 'structured-json';
  return isMultiValueField(shape) ? 'multi-value' : null;
}

/** One member a finding is about: where it stands, what it names, and who declares its column. */
interface MemberSite {
  /** The finding's `where`. */
  where: string;
  /** The finding's `path`. */
  path: string;
  /** The member's name, as the words say it. */
  name: string;
  /** The column reference the author wrote: a dataset member's `field`, a cube member's `sql`. */
  column: string;
  /** Who declares the resolved column, as the words say it ({@link declarerOf}). */
  declarer: string;
}

/**
 * The last sentence of a measure finding's hint: the door that refuses the
 * same pair later, and with what. A dataset's pair is refused when the
 * dataset compiles; an authored cube has no compile step, and its pair is
 * refused by the analytics door when a query names the measure.
 */
const DATASET_COMPILE_DOOR =
  'The compile leg refuses this same pair with `400 DATASET_INVALID` before any SQL is emitted, ' +
  'so this is the same fix made earlier.';
const CUBE_QUERY_DOOR =
  'The analytics door refuses this same pair on the cube with `400 INVALID_FIELD` before any SQL is ' +
  'built, so this is the same fix made earlier.';

/**
 * [#20890] The finding for a dimension that groups by a JSON-stored column,
 * in one set of words for a dataset dimension and a cube dimension alike.
 * `selector` names who selects the dimension: a dataset's reports and
 * dashboards, a cube's queries.
 */
function jsonStoredDimensionFinding(
  site: MemberSite,
  leaf: Extract<FieldPathVerdict, { kind: 'ok' }>,
  shape: ValueShapeFieldDef,
  cls: 'structured-json' | 'multi-value',
  selector: string,
): DatasetMeasureAggregateFinding {
  const head =
    `dimension "${site.name}" groups by field "${site.column}", which ` +
    `${site.declarer} declares as ${declaredAs(shape)} — `;
  const door =
    'The analytics door refuses every query that groups by this dimension with ' +
    `\`400 INVALID_FIELD\` before any SQL is built, so ${selector} that selects it gets ` +
    'that refusal instead of an answer.';
  return {
    severity: 'error',
    rule: DIMENSION_JSON_STORED_FIELD_REFUSED,
    where: site.where,
    path: site.path,
    message:
      cls === 'structured-json'
        ? head +
          'a structured-JSON value, which analytics does not group by. A JSON document is no ' +
          'group key the SQL dialects share: one groups each serialized document apart, ' +
          `another refuses the statement. ${door}`
        : head +
          'a multi-value field, which analytics does not group by. A list of values is no ' +
          'group key the SQL dialects share: one groups each serialized list apart, another ' +
          `refuses the statement. ${door}`,
    hint:
      cls === 'structured-json'
        ? 'Group by a field that stores one scalar value: store the part of the document you ' +
          'group on in a field of its own and point this dimension at that field, or remove ' +
          'the dimension.'
        : `Filter by one member instead of grouping: a record query on "${leaf.object}" ` +
          `with where { "${leaf.field}": { "$contains": VALUE } } counts or lists the records ` +
          'that hold VALUE, one query per member. Point this dimension at a field that stores ' +
          'one value, or remove it.',
  };
}

/**
 * The finding for a measure whose aggregate the column's declaration cannot
 * carry ({@link acceptsDeclaration} said no), in one set of words for a
 * dataset measure and a cube measure alike. `door` is the hint's last
 * sentence ({@link DATASET_COMPILE_DOOR} or {@link CUBE_QUERY_DOOR}).
 */
function refusedMeasureFinding(
  site: MemberSite,
  aggregate: string,
  accepted: readonly string[],
  fieldType: string,
  shape: ValueShapeFieldDef,
  door: string,
): DatasetMeasureAggregateFinding {
  // [#20890] The row accepts the TYPE and the declaration is what refuses:
  // a multi-capable field flagged `multiple: true` under `count_distinct`.
  const flaggedList = isAggregateCompatibleWithFieldType(aggregate, fieldType);
  return {
    severity: 'error',
    rule: MEASURE_AGGREGATE_FIELD_TYPE_REFUSED,
    where: site.where,
    path: site.path,
    message: flaggedList
      ? `measure "${site.name}" applies aggregate "${aggregate}" to field "${site.column}", which ` +
        `${site.declarer} declares as ${declaredAs(shape)} — a list of values ` +
        `stored as JSON. "${aggregate}" COMPARES the stored values for equality, and no two ` +
        `backends compare a JSON-stored value alike: one counts every row apart, one compares ` +
        `the serialized text, another has no equality for the type and fails at query time. ` +
        `"${aggregate}" accepts: ${accepted.join(', ')}, none of them with \`multiple: true\`.`
      : `measure "${site.name}" applies aggregate "${aggregate}" to field "${site.column}", which ` +
        `${site.declarer} declares as \`${fieldType}\`. That pair is refused by the aggregate × ` +
        `field-type compatibility table in @objectstack/spec, so the number a backend returns ` +
        `for it is a property of the SQL dialect rather than of the data — one coerces the ` +
        `stored form and answers something plausible, another has no such function and fails ` +
        `at query time. "${aggregate}" accepts: ${accepted.join(', ')}.`,
    hint:
      `Either point "${aggregate}" at a field of an accepted type, or aggregate ` +
      `"${site.column}" with one its ${declaredAs(shape)} ${shape.multiple === true ? 'declaration' : 'type'} accepts: ` +
      `${aggregatesAccepting(shape).join(', ')}. ` +
      `\`count\` accepts every type because it reads no value, and \`count_distinct\` every ` +
      `type but the JSON-stored ones — a field declared \`multiple: true\` among them — whose ` +
      `values no two backends compare alike; a ` +
      `quantity that must be added up or averaged has to be STORED as a ` +
      `numeric field (a computed column) and aggregated as one. ${door}`,
  };
}

/**
 * [#21082] The column a cube member's `sql` reads, resolved the way the
 * analytics door resolves it (`hop-object.ts`): a hop the cube declares a
 * join for reaches that join's `name` (keyed by the path up to the hop, its
 * dots as `__`), so the walk restarts on the LAST such join's object; every
 * other hop, and the leaf, are {@link resolveFieldPath}'s on the object graph.
 * ⛔ No hop is walked here: this only picks the object the shared walk starts
 * on. A bare column and the row wildcard `'*'` have no hop, and `'*'` resolves
 * to nothing.
 *
 * [#21439] Exported for `field-no-consumers` (`validate-field-consumers.ts`),
 * which credits every field a cube member's path reads by asking this
 * function about each prefix of the path — so a cube hop is resolved one way
 * in this package, and that is the door's way. Not re-exported from the
 * package barrel.
 */
export function resolveCubeColumn(
  graph: ObjectGraph,
  cube: AnyRec,
  baseObject: string,
  sql: string,
): FieldPathVerdict | undefined {
  const segments = sql.split('.');
  const joins = isRec(cube.joins) ? cube.joins : undefined;
  let root = baseObject;
  let from = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    const alias = segments.slice(0, i + 1).join('__');
    const join = joins && Object.prototype.hasOwnProperty.call(joins, alias) ? joins[alias] : undefined;
    const target = isRec(join) ? strName(join.name) : undefined;
    if (target) {
      root = target;
      from = i + 1;
    }
  }
  return resolveFieldPath(graph, root, segments.slice(from).join('.'));
}

/**
 * [#21082] The cube leg for one `analyticsCubes` entry — see "The cube leg" in
 * the module note. Its dimensions before its measures, each located at the
 * member's key (`analyticsCubes[0].dimensions.meta.sql`).
 */
function cubeMemberFindings(cube: AnyRec, cubePath: string, graph: ObjectGraph): DatasetMeasureAggregateFinding[] {
  const findings: DatasetMeasureAggregateFinding[] = [];

  // ── Skip 1: the cube's `sql` names no object this stack defines with a field map ──
  const object = typeof cube.sql === 'string' ? cube.sql.trim() : '';
  if (!object || !graph.has(object) || !graph.get(object)) return findings;

  const cubeName = strName(cube.name) ?? cubePath;

  /** The resolved, typed column a member's `sql` reads, or `undefined` for every skip. */
  const columnOf = (sql: string) => {
    // ── Skip 3: the reference does not resolve (the row wildcard among them) ──
    const verdict = resolveCubeColumn(graph, cube, object, sql);
    if (!verdict || isUnjudgeable(verdict) || verdict.kind !== 'ok') return undefined;
    // ── Skip 4: the column declares no type, so nothing can be asked about it ──
    const fieldType = verdict.meta?.type;
    if (!fieldType) return undefined;
    return { verdict, fieldType, shape: shapeOf(verdict, fieldType) };
  };

  for (const { rec: dimension, path } of collectionEntries(cube.dimensions, `${cubePath}.dimensions`)) {
    // A dimension that writes no `sql` has nothing to judge.
    const sql = strName(dimension.sql);
    if (!sql) continue;
    const column = columnOf(sql);
    if (!column) continue;
    const cls = groupKeyClassOf(column.shape);
    if (cls === null) continue;

    const name = strName(dimension.name) ?? path;
    findings.push(
      jsonStoredDimensionFinding(
        {
          where: `cube "${cubeName}" › dimension "${name}"`,
          path: `${path}.sql`,
          name,
          column: sql,
          declarer: declarerOf(column.verdict, object, 'cube'),
        },
        column.verdict,
        column.shape,
        cls,
        'a query',
      ),
    );
  }

  for (const { rec: measure, path } of collectionEntries(cube.measures, `${cubePath}.measures`)) {
    // [#21419] Every row of the table is this leg's, as on a dataset: the
    // `type` IS the aggregate, judged by the one verdict — see the module note.
    // A measure that writes no `type` has nothing to judge; a non-string there
    // is the schema's refusal to give, not this rule's.
    const aggregate = strName(measure.type);
    if (!aggregate) continue;
    // ── Skip 5: the `type` is outside the table's vocabulary (`number` / `string` / `boolean`) ──
    const accepted = ACCEPTED_TYPES_BY_AGGREGATE.get(aggregate);
    if (!accepted) continue;
    const sql = strName(measure.sql);
    if (!sql) continue;
    const column = columnOf(sql);
    if (!column) continue;
    if (acceptsDeclaration(aggregate, column.shape)) continue;

    const name = strName(measure.name) ?? path;
    findings.push(
      refusedMeasureFinding(
        {
          where: `cube "${cubeName}" › measure "${name}"`,
          path: `${path}.type`,
          name,
          column: sql,
          declarer: declarerOf(column.verdict, object, 'cube'),
        },
        aggregate,
        accepted,
        column.fieldType,
        column.shape,
        CUBE_QUERY_DOOR,
      ),
    );
  }

  return findings;
}

/**
 * Refuse every dataset measure whose `aggregate` the field's declaration
 * cannot carry, and every dataset dimension whose field is JSON-stored; then
 * [#21082] every cube dimension whose `sql` column is JSON-stored, and
 * [#21419] every cube measure whose `type` the column's declaration cannot
 * carry. Returns findings (empty =
 * clean): each dataset's dimensions before its measures, then each cube's.
 * Pure `(stack) => Finding[]` (ADR-0019): no I/O, and safe on both the
 * schema-parsed stack and the raw config the `os lint` path carries.
 */
export function validateDatasetMeasureAggregates(stack: unknown): DatasetMeasureAggregateFinding[] {
  const findings: DatasetMeasureAggregateFinding[] = [];
  if (!isRec(stack)) return findings;

  const datasets = recordsOf(stack.datasets);
  const cubes = collectionEntries(stack.analyticsCubes, 'analyticsCubes');
  if (datasets.length === 0 && cubes.length === 0) return findings;

  const graph: ObjectGraph = indexObjectGraph(stack);

  datasets.forEach((ds, di) => {
    // ── Skip 1: no base object, or one the graph cannot answer for ──
    const object = strName(ds.object);
    if (!object) return;
    if (!graph.has(object) || !graph.get(object)) return;

    const dsName = strName(ds.name) ?? `#${di}`;

    // ── [#20890] The dimension leg: a group key over a JSON-stored field ──
    recordsOf(ds.dimensions).forEach((dimension, k) => {
      // A dimension that writes no `field` has nothing to judge; a non-string
      // there is the schema's refusal to give, not this rule's.
      const field = strName(dimension.field);
      if (!field) return;

      // ── Skip 3: the path does not resolve — `dataset-field-unknown`'s finding ──
      const verdict = resolveFieldPath(graph, object, field);
      if (!verdict || isUnjudgeable(verdict) || verdict.kind !== 'ok') return;

      // ── Skip 4: the leaf declares no type, so nothing can be asked about it ──
      const fieldType = verdict.meta?.type;
      if (!fieldType) return;

      const shape = shapeOf(verdict, fieldType);
      const cls = groupKeyClassOf(shape);
      if (cls === null) return;

      const dimensionName = strName(dimension.name) ?? `#${k}`;
      findings.push(
        jsonStoredDimensionFinding(
          {
            where: `dataset "${dsName}" › dimension "${dimensionName}"`,
            path: `datasets[${di}].dimensions[${k}].field`,
            name: dimensionName,
            column: field,
            declarer: declarerOf(verdict, object, 'dataset'),
          },
          verdict,
          shape,
          cls,
          'a report or dashboard',
        ),
      );
    });

    recordsOf(ds.measures).forEach((measure, k) => {
      // ── Skip 2: nothing written in one of the two positions ──
      const aggregate = strName(measure.aggregate);
      const field = strName(measure.field);
      if (!aggregate || !field) return;

      // ── Skip 5: the aggregate is outside the table's vocabulary ──
      const accepted = ACCEPTED_TYPES_BY_AGGREGATE.get(aggregate);
      if (!accepted) return;

      // ── Skip 3: the path does not resolve — `dataset-field-unknown`'s finding ──
      const verdict = resolveFieldPath(graph, object, field);
      if (!verdict || isUnjudgeable(verdict) || verdict.kind !== 'ok') return;

      // ── Skip 4: the leaf declares no type, so nothing can be asked about it ──
      const fieldType = verdict.meta?.type;
      if (!fieldType) return;

      const shape = shapeOf(verdict, fieldType);
      if (acceptsDeclaration(aggregate, shape)) return;

      const measureName = strName(measure.name) ?? `#${k}`;
      findings.push(
        refusedMeasureFinding(
          {
            where: `dataset "${dsName}" › measure "${measureName}"`,
            path: `datasets[${di}].measures[${k}].aggregate`,
            name: measureName,
            column: field,
            declarer: declarerOf(verdict, object, 'dataset'),
          },
          aggregate,
          accepted,
          fieldType,
          shape,
          DATASET_COMPILE_DOOR,
        ),
      );
    });
  });

  // ── [#21082] The cube leg — see "The cube leg" in the module note ──
  for (const { rec: cube, path } of cubes) {
    findings.push(...cubeMemberFindings(cube, path, graph));
  }

  return findings;
}
