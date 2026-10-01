// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21044] The cube door's measure × field-type judgment: a `measures` entry
 * whose aggregate `AGGREGATE_FIELD_TYPE_COMPATIBILITY` (`@objectstack/spec/
 * data`) refuses for its column's declared type is refused `INVALID_FIELD` /
 * 400, ahead of strategy selection — the table the dataset door executes at
 * compile, asked at the door every cube query passes.
 *
 * ## The shape this closes
 *
 * Measured through `POST /api/v1/analytics/query` on the real dispatcher route,
 * at `2821e9f15b`, a configured cube over two rows (`note` `x` / `y`):
 *
 * | measure | face | SQLite | PostgreSQL 16.13 |
 * |:--|:--|:--|:--|
 * | `max` / `min` over `text`, `max` over `select` | `NativeSQLStrategy` | 200, the text (`"y"`), `fields[]` `number` | the same |
 * | the same | `ObjectQLStrategy` | 400 `INVALID_FIELD`, the engine's door | the same |
 * | `sum` over `text` | both | 200, `0`, `fields[]` `number` | 500 `DATABASE_ERROR` |
 * | `avg` over `text` | `NativeSQLStrategy` | 200, `0` | 500 `DATABASE_ERROR` |
 * | `avg` over `text` | `ObjectQLStrategy` | 400 `INVALID_FIELD`, the engine's door | the same |
 *
 * The dataset door refuses every one of these pairs at compile
 * (`DATASET_INVALID` / 400, `dataset-compiler.ts`); the engine's aggregate door
 * refuses some of them on the ObjectQL face, after the strategy has begun (it
 * holds its `sum` row); the native face asked nothing. So one cube answered the
 * same query by which strategy the driver selected and which dialect it spoke —
 * a text value under a column described `number`, a plausible `0`, a 400 or a
 * 500.
 *
 * ## Where it stands
 *
 * In `AnalyticsService.ensureCube`, on every path out of it, right after the
 * #20807 / #20912 door (`structured-json-dimension-door.ts`): ahead of
 * `callCtx` and strategy selection, for `query()` (the `/analytics/query`
 * door, and every query a dataset selection runs through `DatasetExecutor`)
 * and for `generateSql()` (the `/analytics/sql` dry run) alike. One door ahead
 * of both strategies gives one answer on every driver, and nothing is read
 * before it answers.
 *
 * ## What it judges
 *
 * - Every `measures` entry that resolves to a cube measure whose `type` is an
 *   `AggregationFunction` row of the table — every row, as the dataset door
 *   judges every row (decision batch #127), with no scope condition on top of
 *   the table (`count_distinct` through its own door, below) — and an authored measure, a suffix-inferred one (`note_max`)
 *   and a compiled dataset's are one population. The member is resolved by the
 *   CALLER's resolver (the same one `withDeclaredMeasureFormats` reads), never
 *   a second one here.
 * - The measure's column is its `sql` when that is a column reference, read on
 *   the object that DECLARES it (`sourceFieldMeta`): a bare identifier is a
 *   column of the cube's own object; [#21129] a relationship path
 *   (`account.name`) is its last segment, on the object the path's last hop
 *   reaches. The caller locates it through the one hop resolver
 *   (`hop-object.ts`, `columnObjectOf`) — the object both strategies join and
 *   read for that path — and ⛔ this module walks no path of its own.
 * - The verdict is `isAggregateCompatibleWithFieldType`'s. ⛔ No row is
 *   restated here: the accepted set the words name is read off the exported
 *   table, so a row changed in the spec changes this refusal in the same
 *   commit.
 *
 * `count_distinct` is judged by its own door (#20912, the module named above),
 * which asks the same row AND the declaration half the per-type row cannot see
 * (`isMultiValueField`): one verdict per pair, never two doors with two
 * wordings. The `sum` / `avg` / `min` / `max` rows accept no multi-capable
 * type, so the declaration half adds nothing to them, and `count` accepts every
 * type.
 *
 * ## Not judged — "cannot answer, do not block", the dataset door's tiers
 *
 * - A host that wires no `sourceFieldMeta`, or a cube whose `sql` is not a
 *   bare object name (the caller stands down for both).
 * - A member that resolves to no declared measure (the source-field gate's).
 * - A measure type outside the table's vocabulary: the expression metric types
 *   (`number` / `string` / `boolean`).
 * - A `sql` that is not a column reference (`'*'`, an expression).
 * - A column the declaration hook cannot resolve — for a relationship path,
 *   one whose hop reaches an object the host does not know (the resolver's
 *   alias tier with nothing registered under the alias) — or a type outside
 *   `FieldType` (a driver-internal alias): the table is fail-closed on
 *   vocabulary, and refusing on it would refuse a pair nobody declared. The
 *   spec module says the same ("a consumer that cannot resolve a field's type
 *   must NOT call the predicate with a guess").
 *
 * ## [#21129] A relationship-path column
 *
 * Measured through `POST /api/v1/analytics/query` on the real dispatcher route
 * at `c6b6889193`, a configured cube over `deal` with a declared join
 * `account` to a related object holding `name` (`text`), `revenue`
 * (`number`), `opened_at` (`datetime`) and `tier` (`select`):
 *
 * | measure `sql` | face | SQLite | PostgreSQL 16.14 |
 * |:--|:--|:--|:--|
 * | `max` / `min` over `account.name`, `max` over `account.tier` | `NativeSQLStrategy` | 200, the text, `fields[]` `number` | the same |
 * | `sum` over `account.name` | `NativeSQLStrategy` | 200, `0` | 500 `DATABASE_ERROR` |
 * | every one of them | `ObjectQLStrategy` | 400 `INVALID_FIELD`, its cross-object refusal | the same |
 *
 * A base-object column of the same type was already refused here, so one
 * question about one declared type was answered by whether the column sat a
 * hop away. Read where the column is declared, a relationship-path pair the
 * table refuses is refused as a base-object one is, ahead of both strategies:
 * one envelope and one wording on both faces.
 *
 * ## The envelope, and why it is not the dataset door's code
 *
 * `INVALID_FIELD` / 400 through `invalidMemberError` (ADR-0112), with the
 * column and its object attached, as the #20912 door attaches them: `field` is
 * the column as the measure's `sql` spells it (`note`, or `account.name`), and
 * `object` is the object that declares it. The
 * dataset door answers the same pair `DATASET_INVALID`, which is a verdict
 * about a dataset DOCUMENT (`dataset-refusal.ts`'s header): this door's caller
 * sent no dataset, and a verdict about ONE MEMBER the request named is the
 * `INVALID_FIELD` family — the code the cube door's three source-field gates,
 * its #20912 `count_distinct` door and the engine's aggregate door already
 * answer, the last one for this very pair on the ObjectQL face. The dataset
 * door never reaches this one for a pair it refuses: it refuses at compile.
 * Its compile check reads the base object's declaration and leaves a
 * relationship-path field unjudged, so such a pair reaches this door through
 * `DatasetExecutor` and is refused here.
 */

import {
  AGGREGATE_FIELD_TYPE_COMPATIBILITY,
  FieldType,
  isAggregateCompatibleWithFieldType,
} from '@objectstack/spec/data';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import { invalidMemberError } from './dataset-refusal.js';

/** The declared `FieldType` vocabulary — the only types the table can answer for. */
const DECLARED_FIELD_TYPES: ReadonlySet<string> = new Set(FieldType.options);

/** The aggregates this door judges: every row of the table but `count_distinct`, whose own door judges it. */
const isJudgedAggregate = (type: unknown): type is keyof typeof AGGREGATE_FIELD_TYPE_COMPATIBILITY =>
  typeof type === 'string'
  && type !== 'count_distinct'
  && Object.prototype.hasOwnProperty.call(AGGREGATE_FIELD_TYPE_COMPATIBILITY, type);

/**
 * WHY the pair has no backend-independent answer, chosen by what the aggregate
 * does with the values — an explanation, never a verdict, and the LAST sentence
 * of the words, so a door that bounds a 4xx message cuts it first.
 */
const reasonFor = (aggregate: string): string =>
  aggregate === 'min' || aggregate === 'max'
    ? 'String order is collation-dependent and some stored forms have no order at all, so each SQL '
      + 'dialect would pick its own value.'
    : 'Each SQL dialect would coerce the stored form to a number or fail, so the answer would depend on '
      + 'the backend.';

/**
 * A measure's column, located on the object that declares it — the shape the
 * #20912 door's `DimensionColumn` carries for a dimension.
 */
export interface MeasureColumn {
  /** The object that declares the column: the cube's own, or the one a relationship path's last hop reaches. */
  readonly object: string;
  /** The column's name on that object. */
  readonly column: string;
  /** The measure's `sql` as written: the column, or the relationship path to it. */
  readonly path: string;
}

/** Who declares the column, as the words say it: the cube's own object, or the related one. */
function declarerOf(target: MeasureColumn): string {
  return target.path === target.column
    ? `which object '${target.object}' declares`
    : `whose column '${target.column}' the related object '${target.object}' declares`;
}

/**
 * Refuse the first `measures` entry of `query` whose aggregate the table
 * refuses for its column's declared type — `INVALID_FIELD` / 400. See the
 * module header.
 *
 * @param measureOf - The cube measure a `measures` entry resolves to, by the
 *   caller's resolver: its `type`, and the {@link MeasureColumn} it aggregates,
 *   located on the object that declares it (`null` when its `sql` is not a
 *   column reference) — or `undefined` when the entry resolves to no declared
 *   measure.
 * @param declaredTypeOf - The declared `FieldType` of a column on an object, or
 *   `undefined` when nothing authoritative answers.
 *
 * The words put the verdict first, then that the query did not run, then the
 * accepted set read off the table, then the reason: a door that bounds a 4xx
 * message keeps the front of it.
 */
export function assertCubeMeasureFieldTypesAccepted(
  query: AnalyticsQuery,
  cubeName: string,
  measureOf: (member: string) => { type: unknown; column: MeasureColumn | null } | undefined,
  declaredTypeOf: (object: string, field: string) => string | undefined,
): void {
  for (const member of query.measures ?? []) {
    const measure = measureOf(member);
    if (!measure?.column) continue;
    const aggregate = measure.type;
    if (!isJudgedAggregate(aggregate)) continue;
    const target = measure.column;
    const declared = declaredTypeOf(target.object, target.column);
    if (typeof declared !== 'string' || !DECLARED_FIELD_TYPES.has(declared)) continue;
    if (isAggregateCompatibleWithFieldType(aggregate, declared)) continue;

    const err = invalidMemberError(
      `Measure '${member}' on cube '${cubeName}' takes the ${aggregate} of field '${target.path}', `
      + `${declarerOf(target)} as ${declared}: ${aggregate} does not accept that type, so the query was NOT `
      + `run. ${aggregate} accepts ${AGGREGATE_FIELD_TYPE_COMPATIBILITY[aggregate].join(', ')}; aggregate a `
      + `field of one of those types, or count the rows with count. ${reasonFor(aggregate)}`,
      { member, param: 'measures', cube: cubeName },
    ) as Error & { field?: string; object?: string };
    err.field = target.path;
    err.object = target.object;
    throw err;
  }
}
