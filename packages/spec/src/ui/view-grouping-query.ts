// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * List-view grouping is SERVER-SIDE — the two queries a grouped list view is
 * answered with, compiled from the view's own declaration (#14556).
 *
 * ## The ruling this module implements
 *
 * Maintainer ruling A on objectui#7189 (2026-09-02, verbatim 「7189 A  其他同意」),
 * carried into the spec lane by #14556: *"The set of groups and every number in
 * a group header (the count and any per-group aggregation) are properties of
 * the query, not of the fetched page. Rows inside a group are paged."* The
 * client-side grouping of a fetched page is the interim state, not the
 * contract — on 186 rows in five units with `$top: 100` it rendered two
 * headers (86, 14) when the rows were contiguous and five (31/31/30/7/1) when
 * they were interleaved; neither is the data (86/61/31/7/1), and the rows past
 * the first window were not on page 2, they were unreachable.
 *
 * The seat ruling on #14556 (third tier): **reuse, no new query shape.**
 *
 * 1. **The group set and every header number are ONE aggregate query**, in
 *    the vocabulary `data/query.zod.ts` already declares: `groupBy` is
 *    `grouping.fields[].field` in nesting order (multi-level grouping is a
 *    multi-column `groupBy`), `aggregations` is a `count` node plus the view's
 *    declared per-column summaries mapped onto `AggregationFunction` (the one
 *    vocabulary datasets use — objectui#4576: one vocabulary, not two), and
 *    `where` is the view's composed filter. {@link compileListViewGroupQuery}.
 * 2. **Rows inside a group are the EXISTING paged `find`** with the group's
 *    key predicate AND-ed into the same view filter, `limit` / `offset` per
 *    group. {@link compileListViewGroupRowsQuery}.
 * 3. **Execution is the existing contract** —
 *    `IDataEngine.aggregate(objectName, EngineAggregateOptions, options)` for
 *    (1) and `IDataEngine.find(objectName, EngineQueryOptions, options)` for
 *    (2) (`contracts/data-engine.ts`). No new engine verb, no new envelope.
 *    `engine.aggregate` pushes (1) down to a driver that implements
 *    `aggregate()` (driver-sql groups by every `groupBy` item and lowers
 *    `count` / `sum` / `avg` / `min` / `max` / `count_distinct`) and otherwise
 *    buckets `driver.find()` output in memory (`applyInMemoryAggregation`),
 *    so the same header query answers on every driver.
 *
 * ## What a header row carries (result-column naming)
 *
 * One row per distinct combination of the grouped fields, and on each row:
 *
 *   * every grouped field under **its own name**, holding the RAW STORED value
 *     (a lookup group key is the referenced id, never the expanded record;
 *     the empty group's key is `null` — the in-memory face folds an absent
 *     field into `null`, the SQL face groups `NULL` as one bucket). Resolving
 *     a key to a display label is the consumer's, exactly as for a cell.
 *   * `count` ({@link LIST_VIEW_GROUP_COUNT_ALIAS}) — the group's TOTAL row
 *     count, a fieldless `count` node (`COUNT(*)`: every row of the group,
 *     null cells included — the ruled semantics in `aggregation-conformance`).
 *   * one column per declared column summary, under
 *     {@link columnSummaryAlias} — `<function>_<field>` (`sum_amount`,
 *     `count_distinct_owner`). Two columns declaring the same summary over
 *     the same field are one number and one column. A column summary
 *     `count` IS the group count (it counts every row of the group, filled or
 *     not — the footer's own reading), so it rides the `count` column rather
 *     than minting a second one.
 *   * for `count_filled` / `count_empty` / `percent_filled` / `percent_empty`
 *     ONE column per summarised field, `count_<field>` — `COUNT(field)`, the
 *     non-null count — from which all four are DERIVED on the header row by
 *     {@link deriveColumnSummary} (see the mapping table).
 *
 * A summary alias that would land on a grouped field's own column
 * (`sum_amount` while grouping by a field named `sum_amount`) is refused, not
 * silently overwritten — the two would be one column with two meanings. So
 * is a grouping field named `count`: it would share its column with the
 * group count.
 *
 * ## The mapping table — `ColumnSummary` → the aggregation vocabulary (fork i, ruled)
 *
 * | `ListColumn.summary` | aggregation node | on the header row |
 * |---|---|---|
 * | `none` | (no node) | — "no summary" is not a summary |
 * | `count` | `{ function: 'count' }` | `count` — fieldless, `COUNT(*)`, the group count itself |
 * | `count_unique` | `{ function: 'count_distinct', field }` | `count_distinct_<field>` — `COUNT(DISTINCT field)`, nulls excluded |
 * | `sum` / `avg` / `min` / `max` | the same name, `field` | `<function>_<field>` |
 * | `count_filled` | `{ function: 'count', field }` | `count_<field>` — `COUNT(field)`, the non-null count |
 * | `count_empty` | the same node | derived: `count − count_<field>` |
 * | `percent_filled` | the same node | derived: `count_<field> / count` (0 when `count` is 0) |
 * | `percent_empty` | the same node | derived: `1 − percent_filled` |
 *
 * The seat ruling on fork (i) (contract review on the card, 2026-09-04): the
 * four `*_filled` / `*_empty` members map by DERIVATION from two exact
 * counts the vocabulary already has — `COUNT(*)` and `COUNT(field)` — never
 * by a per-aggregation `filter` (which would route the whole header query
 * through the engine's in-memory tier) and never by a new
 * `AggregationFunction` member (six lowering faces and the conformance
 * ledger stay untouched). Several of the four over the same field are ONE
 * `count_<field>` node. "Empty" is the SERVER's meaning on every face: the
 * stored value is `null` (`aggregation-conformance.ts`, the `count(col)`
 * rows); the footer's client-side reading, which also treats `''` and `[]`
 * as empty, is objectui's to converge under "one vocabulary". The
 * `summary_unmapped` refusal (`NOT_IMPLEMENTED` / 501) stays for any FUTURE
 * member with no counterpart — {@link UNMAPPED_COLUMN_SUMMARIES} is empty
 * today — and {@link COLUMN_SUMMARY_AGGREGATION} is typed
 * `Record<ColumnSummary, …>`, so adding a member to `ColumnSummarySchema`
 * without deciding its row here fails to type-check. A value that is not a
 * member at all (a typo reaching the helper unparsed) is `INVALID_QUERY` /
 * 400 (`summary_unknown`): a typo is not a capability gap.
 *
 * ## Multi-level grouping
 *
 * `groupBy` carries the grouping fields in nesting order, so the header query
 * answers one row per LEAF combination. An outer level's header is derived
 * from the leaf rows sharing its prefix: `count`, `sum`, `min`, `max` and
 * the `count_<field>` column (hence `count_filled` / `count_empty`, and the
 * two percents recomputed from the folded counts) fold exactly; `avg` and
 * `count_distinct` do NOT — an average of averages weights the groups, not
 * the rows, and the same value can be distinct in several leaves at once, so
 * per-leaf distinct counts over-count the union. When an outer level must
 * carry an exact `avg` or `count_unique`, compile that level's own query
 * with `depth` — the same query over the first `depth` grouping fields —
 * rather than folding. This is still one query shape.
 *
 * ## The door — existing, not new
 *
 * Both compiled queries ride the data endpoint's EXISTING query door:
 * `POST /data/:object/query` (`packages/rest/src/rest-server.ts`, the
 * `${dataPath}/:object/query` route) validates the body as a
 * `FindDataRequest` and hands it to `protocol.findData`, which routes a body
 * carrying `groupBy` / `aggregations` to `engine.aggregate`
 * (`packages/metadata-protocol/src/protocol.ts`, the `hasGroupBy ||
 * hasAggregations` branch) and answers `{ object, records, total, hasMore }`
 * with the header rows as `records`; `client.data.query()`
 * (`packages/client/src/index.ts`) posts there, and the RPC face declares
 * `method: 'aggregate'` with an `EngineAggregateOptions` body
 * (`data/data-engine.zod.ts`, `DataEngineAggregateRequestSchema`). The row
 * page is the same door with the compiled `EngineQueryOptions`. No new
 * route, no new wire shape; the platform half of the card PINS that door on
 * the compiled queries (the 186-row fixture through the route, on driver-sql
 * and on the in-memory tier).
 *
 * ## Deliberately NOT here
 *
 *   * **Lowering the view's `filter` rules to a `FilterCondition`.** Both
 *     inputs here take the view's COMPOSED filter — the same `where` the
 *     view's row query already carries. The rule dialect → AST lowering is
 *     `parseFilterAST` (`data/filter.zod.ts`) on the platform and
 *     objectui's `filter-converter` on the client.
 *   * **Ordering the groups.** `EngineAggregateOptions` carries no `orderBy`;
 *     `GroupingField.order` is applied by the consumer over the header rows,
 *     a set the size of the group count.
 *
 * ## No business logic here (Prime Directive #2)
 *
 * Pure contract derivations — a declaration in, the queries the contract
 * says it means out — in the same seat as `chart-aggregate.ts` (result-column
 * naming) and `i18n-label-resolver.ts` (one shared rule instead of a private
 * twin per producer). The header query is what the platform half executes
 * and what objectui's `plugin-grid` will ask for once it lands; keeping the
 * derivation here is what stops the two ends from re-deriving it apart.
 */

import type { FilterCondition } from '../data/filter.zod';
import type { AggregationFunction, AggregationNode } from '../data/query.zod';
import type { EngineAggregateOptions, EngineQueryOptions } from '../data/data-engine.zod';
import type { ColumnSummary, ColumnSummaryConfig, GroupingConfig, ListColumn, ListView } from './view.zod';

/**
 * The alias of the per-group TOTAL row count on every header row — a
 * fieldless `count` node, `COUNT(*)`. The same literal the fieldless-count
 * alias already is on the object-bound chart path (`chart-aggregate.ts`).
 */
export const LIST_VIEW_GROUP_COUNT_ALIAS = 'count';

/**
 * How one `ColumnSummary` member reaches the group header query.
 *
 *   * `aggregate` — a node with this `function`; `fieldless` says whether the
 *     node names the summarised field (`COUNT(*)` does not).
 *   * `derived` — a `count` node over the summarised field (`COUNT(field)`,
 *     the non-null count, column `count_<field>`), from which the member is
 *     computed on the header row by {@link deriveColumnSummary}.
 *   * `none` — the member means "no summary"; no node.
 *   * `unmapped` — no counterpart in the vocabulary; the compiler refuses it
 *     loudly (`NOT_IMPLEMENTED` / 501). No member is in this state today.
 */
export type ColumnSummaryAggregation =
  | { readonly kind: 'aggregate'; readonly function: AggregationFunction; readonly fieldless: boolean }
  | { readonly kind: 'derived'; readonly from: 'count'; readonly fieldless: false }
  | { readonly kind: 'none' }
  | { readonly kind: 'unmapped' };

/**
 * The mapping table, exhaustive over `ColumnSummarySchema` by construction —
 * a new summary member without a row here is a type error, which is how the
 * fork stays visible instead of silently dropping.
 */
export const COLUMN_SUMMARY_AGGREGATION: Readonly<Record<ColumnSummary, ColumnSummaryAggregation>> = Object.freeze({
  none: { kind: 'none' },
  count: { kind: 'aggregate', function: 'count', fieldless: true },
  count_unique: { kind: 'aggregate', function: 'count_distinct', fieldless: false },
  sum: { kind: 'aggregate', function: 'sum', fieldless: false },
  avg: { kind: 'aggregate', function: 'avg', fieldless: false },
  min: { kind: 'aggregate', function: 'min', fieldless: false },
  max: { kind: 'aggregate', function: 'max', fieldless: false },
  count_filled: { kind: 'derived', from: 'count', fieldless: false },
  count_empty: { kind: 'derived', from: 'count', fieldless: false },
  percent_filled: { kind: 'derived', from: 'count', fieldless: false },
  percent_empty: { kind: 'derived', from: 'count', fieldless: false },
} as const);

/**
 * The `ColumnSummary` members with no `AggregationFunction` counterpart — the
 * exact list the compiler refuses (fork i on #14556), derived from the table
 * rather than restated.
 */
export const UNMAPPED_COLUMN_SUMMARIES: readonly ColumnSummary[] = Object.freeze(
  (Object.keys(COLUMN_SUMMARY_AGGREGATION) as ColumnSummary[])
    .filter((member) => COLUMN_SUMMARY_AGGREGATION[member].kind === 'unmapped'),
);

/**
 * The result column a column summary lands under on a header row:
 * `<function>_<field>`. A fieldless `count` is {@link LIST_VIEW_GROUP_COUNT_ALIAS}.
 */
export function columnSummaryAlias(fn: AggregationFunction, field: string | undefined): string {
  if (fn === 'count' && !field) return LIST_VIEW_GROUP_COUNT_ALIAS;
  return `${fn}_${field}`;
}

/** The slice of a list view the group queries read. */
export interface ListViewGroupQuerySource {
  /** `ListView.grouping` — the fields to group by, in nesting order. */
  grouping: GroupingConfig;
  /**
   * `ListView.columns` — only `ListColumn` entries carrying a `summary`
   * contribute; bare field-name columns declare no summary.
   */
  columns?: ListView['columns'];
}

export interface CompileListViewGroupQueryOptions {
  /**
   * The view's COMPOSED filter — the same `where` its row query carries.
   * Omitted or `{}` means the whole object.
   */
  where?: FilterCondition;
  /**
   * How many grouping levels the query groups by, from the outermost:
   * `1..grouping.fields.length`, default every level (one row per leaf
   * combination). See "Multi-level grouping" in the module note.
   */
  depth?: number;
}

export interface CompileListViewGroupRowsQueryOptions {
  /** The view's COMPOSED filter — the same `where` the header query carried. */
  where?: FilterCondition;
  /** Page size within the group (`limit`; `$top` on the wire). */
  limit?: number;
  /** Rows to skip within the group (`offset`; `$skip` on the wire). */
  offset?: number;
  /** Row order within the group — passed through to the find. */
  orderBy?: EngineQueryOptions['orderBy'];
  /** Projection — passed through to the find. */
  fields?: EngineQueryOptions['fields'];
}

/**
 * One header row as the platform answers it: the grouped fields under their
 * own names, `count`, and one column per declared summary
 * ({@link columnSummaryAlias}).
 */
export interface ListViewGroupHeaderRow {
  [column: string]: unknown;
  count: number;
}

/**
 * Why {@link compileListViewGroupQuery} / {@link compileListViewGroupRowsQuery}
 * refused — the machine-readable discriminator beside the ADR-0112 envelope.
 */
export type ListViewGroupQueryRefusal =
  | 'summary_unmapped'
  | 'summary_unknown'
  | 'alias_collision'
  | 'grouping_empty'
  | 'grouping_field_blank'
  | 'depth_out_of_range'
  | 'group_key_not_a_prefix'
  | 'group_key_not_scalar';

/**
 * A refusal to compile a grouped list view into its queries.
 *
 * Carries the ADR-0112 envelope (`code` + `status`) so a door that serves the
 * compile answers the same way the data path answers a malformed query, plus
 * the `path` of the offending declaration inside the list view (a zod-style
 * path: `['columns', 2, 'summary']`) and a closed `reason`. The two codes are
 * standard-catalog members (`api/errors.zod.ts`): `NOT_IMPLEMENTED` / 501 for
 * a DECLARED summary member the vocabulary has no counterpart for
 * (`summary_unmapped` — none today), `INVALID_QUERY` / 400 for a declaration
 * the contract cannot mean, a value that is no member at all
 * (`summary_unknown` — a typo is not a capability gap) included.
 * Spelled as literals here rather than imported from `../api/errors.zod` —
 * `api/` already imports `ui/`, and a value edge back would be a cycle for
 * two strings; `view-grouping-query.test.ts` pins them to
 * `StandardErrorCode.enum` so the two cannot drift.
 */
export class ListViewGroupQueryError extends Error {
  readonly code: 'NOT_IMPLEMENTED' | 'INVALID_QUERY';
  readonly status: 501 | 400;
  readonly path: ReadonlyArray<string | number>;
  readonly reason: ListViewGroupQueryRefusal;

  constructor(
    reason: ListViewGroupQueryRefusal,
    path: ReadonlyArray<string | number>,
    message: string,
  ) {
    super(message);
    this.name = 'ListViewGroupQueryError';
    this.reason = reason;
    this.path = path;
    if (reason === 'summary_unmapped') {
      this.code = 'NOT_IMPLEMENTED';
      this.status = 501;
    } else {
      this.code = 'INVALID_QUERY';
      this.status = 400;
    }
  }
}

/** The grouping fields, validated and in nesting order. */
function groupingFieldNames(grouping: GroupingConfig | undefined): string[] {
  const fields = grouping?.fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new ListViewGroupQueryError(
      'grouping_empty',
      ['grouping', 'fields'],
      'A grouped list view names at least one grouping field: `grouping.fields` is empty, so there is '
        + 'no `groupBy` to compile and no group to page. Declare the field(s) to group by, in nesting order.',
    );
  }
  return fields.map((entry, index) => {
    const name = entry && typeof entry === 'object' ? (entry as { field?: unknown }).field : undefined;
    if (typeof name !== 'string' || name.trim() === '') {
      throw new ListViewGroupQueryError(
        'grouping_field_blank',
        ['grouping', 'fields', index, 'field'],
        `grouping.fields[${index}].field is not a field name, so it cannot be a \`groupBy\` column. `
          + 'Name the field to group by at this level, or remove the level.',
      );
    }
    return name;
  });
}

/**
 * The per-column summaries a view declares, as aggregation nodes — the header
 * query's `aggregations` after the `count` node. Refuses an unmapped member
 * (fork i) and an alias landing on a grouped field's column.
 */
function summaryAggregationNodes(
  columns: ListView['columns'] | undefined,
  groupByNames: readonly string[],
): AggregationNode[] {
  const grouped = new Set<string>(groupByNames);
  const nodes = new Map<string, AggregationNode>();
  const entries: ReadonlyArray<string | ListColumn> = Array.isArray(columns) ? columns : [];

  entries.forEach((column, index) => {
    if (!column || typeof column !== 'object') return; // a bare field name declares no summary
    const summary = column.summary;
    if (summary === undefined) return;
    const path = ['columns', index, 'summary'];
    const member: ColumnSummary = typeof summary === 'string' ? summary : summary.type;
    const field = typeof summary === 'string' ? column.field : (summary.field ?? column.field);

    const mapping = columnSummaryMapping(member, path, `columns[${index}] (field "${field}")`);
    if (mapping.kind === 'none') return;

    const fn: AggregationFunction = mapping.kind === 'derived' ? mapping.from : mapping.function;
    const aggregatedField = mapping.fieldless ? undefined : field;
    const alias = columnSummaryAlias(fn, aggregatedField);
    // The collision check comes FIRST: a grouped field named `count` would
    // share its column with the group count, whether or not a summary is
    // declared, and `compileListViewGroupQuery` refuses that up front — this
    // ordering keeps the two answers identical for a `count` summary too.
    if (grouped.has(alias)) {
      throw new ListViewGroupQueryError(
        'alias_collision',
        path,
        `Column summary "${member}" on columns[${index}] would land under "${alias}", which is also a `
          + 'grouped field\'s own column on the header row — one column cannot carry both the group key '
          + 'and the summary. Rename the field or drop one of the two declarations.',
      );
    }
    if (alias === LIST_VIEW_GROUP_COUNT_ALIAS) return; // the group count column already carries it
    if (!nodes.has(alias)) {
      nodes.set(alias, { function: fn, field: aggregatedField, alias });
    }
  });

  return [...nodes.values()];
}

/**
 * The table row for one summary value, or the refusal the contract gives it:
 * `summary_unknown` (`INVALID_QUERY` / 400) for a value that is no
 * `ColumnSummary` member at all, `summary_unmapped` (`NOT_IMPLEMENTED` /
 * 501) for a member whose row says the vocabulary has no counterpart.
 */
function columnSummaryMapping(
  member: ColumnSummary,
  path: ReadonlyArray<string | number>,
  where: string,
): Exclude<ColumnSummaryAggregation, { kind: 'unmapped' }> {
  const mapping = (COLUMN_SUMMARY_AGGREGATION as Readonly<Record<string, ColumnSummaryAggregation | undefined>>)[member];
  if (mapping === undefined) {
    throw new ListViewGroupQueryError(
      'summary_unknown',
      path,
      `Column summary "${String(member)}" on ${where} is not a column summary function. `
        + `The members are ${Object.keys(COLUMN_SUMMARY_AGGREGATION).join(' / ')}; `
        + 'a value outside that list is refused as malformed, not treated as a capability gap.',
    );
  }
  if (mapping.kind === 'unmapped') {
    // The refusal is printed AT the author, so it carries the remedy and no
    // issue id (the tracking card is in the module note — fork i).
    throw new ListViewGroupQueryError(
      'summary_unmapped',
      path,
      `Column summary "${member}" on ${where} has no counterpart in the `
        + 'aggregation vocabulary (AggregationFunction: count / sum / avg / min / max / count_distinct), '
        + 'so a grouped list view cannot carry it in its group headers yet. Whether '
        + `${UNMAPPED_COLUMN_SUMMARIES.join(' / ')} map onto the vocabulary is an open contract question; `
        + 'until it is ruled, remove the summary from this column or group the view without it. '
        + 'Nothing is dropped silently.',
    );
  }
  return mapping;
}

/**
 * Read ONE column summary's value off a header row — the aggregate members
 * from their `<function>_<field>` column (`count` from `count`), and the four
 * DERIVED members from the row's two exact counts:
 *
 *   * `count_filled`   = `count_<field>` (`COUNT(field)`, the non-null count)
 *   * `count_empty`    = `count − count_<field>`
 *   * `percent_filled` = `count_<field> / count` — a ratio in `0..1`, and `0`
 *     when `count` is `0` (no division)
 *   * `percent_empty`  = `1 − percent_filled` — so an empty group reads `1`
 *
 * `undefined` when the row carries no column for the summary (the header
 * query was compiled without it) and for `none`; `null` is what the
 * aggregate itself answered (`avg` / `min` / `max` over no values). Refuses
 * an unknown member (`summary_unknown`) exactly as the compiler does.
 *
 * `summary` is the member, or the `{ type, field }` object form; `field` is
 * the column's own field, which the object form's `field` overrides — the
 * same resolution {@link compileListViewGroupQuery} applies.
 */
export function deriveColumnSummary(
  row: ListViewGroupHeaderRow,
  summary: ColumnSummary | ColumnSummaryConfig,
  field: string,
): number | null | undefined {
  const member: ColumnSummary = typeof summary === 'string' ? summary : summary.type;
  const aggregatedField = typeof summary === 'string' ? field : (summary.field ?? field);
  const mapping = columnSummaryMapping(member, [], `field "${aggregatedField}"`);
  if (mapping.kind === 'none') return undefined;
  if (mapping.kind === 'aggregate') {
    const value = row[columnSummaryAlias(mapping.function, mapping.fieldless ? undefined : aggregatedField)];
    return value === undefined ? undefined : (value as number | null);
  }
  const raw = row[columnSummaryAlias(mapping.from, aggregatedField)];
  if (raw === undefined || raw === null) return undefined;
  const filled = Number(raw);
  const total = Number(row[LIST_VIEW_GROUP_COUNT_ALIAS]);
  const percentFilled = total === 0 ? 0 : filled / total;
  switch (member) {
    case 'count_filled': return filled;
    case 'count_empty': return total - filled;
    case 'percent_filled': return percentFilled;
    case 'percent_empty': return 1 - percentFilled;
    default: return undefined;
  }
}

/**
 * The GROUP HEADER query: the set of groups and every number in every group
 * header, as ONE `EngineAggregateOptions` for `IDataEngine.aggregate`.
 *
 *   * `where` — `options.where`, the view's composed filter, verbatim
 *     (omitted when not given).
 *   * `groupBy` — `grouping.fields[].field` in nesting order (the first
 *     `options.depth` of them; default all).
 *   * `aggregations` — the `count` node first
 *     ({@link LIST_VIEW_GROUP_COUNT_ALIAS}), then one node per declared
 *     column summary ({@link COLUMN_SUMMARY_AGGREGATION},
 *     {@link columnSummaryAlias}), in column order, deduplicated.
 *
 * @throws {ListViewGroupQueryError} on an unmapped summary (fork i —
 *   `NOT_IMPLEMENTED` / 501), an alias colliding with a grouped field, an
 *   empty grouping, a blank grouping field, or a `depth` outside
 *   `1..fields.length` (all `INVALID_QUERY` / 400).
 */
export function compileListViewGroupQuery(
  view: ListViewGroupQuerySource,
  options: CompileListViewGroupQueryOptions = {},
): EngineAggregateOptions {
  const names = groupingFieldNames(view.grouping);
  const depth = options.depth ?? names.length;
  if (!Number.isInteger(depth) || depth < 1 || depth > names.length) {
    throw new ListViewGroupQueryError(
      'depth_out_of_range',
      ['grouping', 'fields'],
      `depth ${String(depth)} is outside 1..${names.length}: a header query groups by the first \`depth\` `
        + `of the ${names.length} declared grouping level(s). Omit \`depth\` for every level.`,
    );
  }
  const groupBy = names.slice(0, depth);
  const countLevel = groupBy.indexOf(LIST_VIEW_GROUP_COUNT_ALIAS);
  if (countLevel >= 0) {
    throw new ListViewGroupQueryError(
      'alias_collision',
      ['grouping', 'fields', countLevel, 'field'],
      `grouping.fields[${countLevel}].field is "${LIST_VIEW_GROUP_COUNT_ALIAS}", the column every header row `
        + 'carries its group count under — one column cannot carry both the group key and the count. '
        + 'Rename the field.',
    );
  }
  const aggregations: AggregationNode[] = [
    { function: 'count', alias: LIST_VIEW_GROUP_COUNT_ALIAS },
    ...summaryAggregationNodes(view.columns, groupBy),
  ];
  const query: EngineAggregateOptions = { groupBy, aggregations };
  if (options.where !== undefined) query.where = options.where;
  return query;
}

/**
 * The predicate that selects ONE group's rows: for each grouped field, in
 * nesting order, `{ field: { $eq: key } }` — or `{ field: { $null: true } }`
 * for the empty group, whose header key is `null`: the `$null` predicate is
 * the AST's own spelling for absence (`data/filter.zod.ts`, lowered to
 * `IS NULL` on the SQL family) and the one the view filter dialect's
 * `is_empty` / `is_null` lower to (`parseFilterAST`), so a group predicate
 * and a view filter agree on what "empty" means.
 *
 * `groupKey` must carry a PREFIX of the nesting order — every level from the
 * outermost down to the group being opened, and no level past it — so the
 * rows of an outer group (a `depth`-scoped header) are spellable too.
 *
 * Group keys are SCALAR-valued: what a header row carries under a grouped
 * field is one stored value (string, number, boolean, bigint, a date instant,
 * or `null`). An array or object where a key should be is refused
 * (`group_key_not_scalar`) rather than compiled into a predicate that would
 * compare a list or a record and select the wrong rows.
 *
 * @throws {ListViewGroupQueryError} `group_key_not_a_prefix` /
 *   `group_key_not_scalar` (`INVALID_QUERY`)
 */
export function listViewGroupKeyPredicate(
  grouping: GroupingConfig,
  groupKey: Readonly<Record<string, unknown>>,
): FilterCondition[] {
  const names = groupingFieldNames(grouping);
  const keyed = new Set(Object.keys(groupKey));
  const levels = names.filter((name) => keyed.has(name)).length;
  const isPrefix = levels > 0
    && keyed.size === levels
    && names.slice(0, levels).every((name) => keyed.has(name));
  if (!isPrefix) {
    throw new ListViewGroupQueryError(
      'group_key_not_a_prefix',
      ['grouping', 'fields'],
      `A group key names the grouping fields from the outermost level down to the group being opened `
        + `(a prefix of [${names.join(', ')}]); received [${[...keyed].join(', ')}]. `
        + 'Carry every outer level\'s key, and no field that is not a grouping field.',
    );
  }
  return names.slice(0, levels).map((name, level) => {
    const value = groupKey[name];
    if (!isScalarGroupKey(value)) {
      throw new ListViewGroupQueryError(
        'group_key_not_scalar',
        ['grouping', 'fields', level, 'field'],
        `The group key for "${name}" is ${Array.isArray(value) ? 'an array' : 'an object'}; a group key is `
          + 'one stored scalar value (or null for the empty group), exactly what the header row carries '
          + 'under the grouped field. Pass that value.',
      );
    }
    return value === null || value === undefined
      ? { [name]: { $null: true } }
      : { [name]: { $eq: value } };
  });
}

/** A value a header row can carry under a grouped field — one stored scalar, or absence. */
function isScalarGroupKey(value: unknown): boolean {
  if (value === null || value === undefined || value instanceof Date) return true;
  const type = typeof value;
  return type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint';
}

/**
 * The PER-GROUP ROW PAGE: the EXISTING paged `find`, as `EngineQueryOptions`
 * for `IDataEngine.find`, with the group's key predicate AND-ed into the
 * view's composed filter:
 *
 * ```ts
 * { where: { $and: [viewWhere, { business_unit: { $eq: 'northgate_ops' } }] }, limit: 50, offset: 0 }
 * ```
 *
 * `$and` is the filter AST's own composition; a missing or empty
 * `options.where` contributes no member (`{ $and: [] }` is TRUE by the ruled
 * reduction, so the group predicates alone would already be the whole
 * condition — the empty member is simply not spelled). `limit` / `offset` /
 * `orderBy` / `fields` pass through when given.
 *
 * @throws {ListViewGroupQueryError} see {@link listViewGroupKeyPredicate}
 */
export function compileListViewGroupRowsQuery(
  view: Pick<ListViewGroupQuerySource, 'grouping'>,
  groupKey: Readonly<Record<string, unknown>>,
  options: CompileListViewGroupRowsQueryOptions = {},
): EngineQueryOptions {
  const members: FilterCondition[] = [];
  const viewWhere = options.where;
  if (viewWhere && typeof viewWhere === 'object' && Object.keys(viewWhere).length > 0) {
    members.push(viewWhere);
  }
  members.push(...listViewGroupKeyPredicate(view.grouping, groupKey));

  const query: EngineQueryOptions = { where: { $and: members } };
  if (options.limit !== undefined) query.limit = options.limit;
  if (options.offset !== undefined) query.offset = options.offset;
  if (options.orderBy !== undefined) query.orderBy = options.orderBy;
  if (options.fields !== undefined) query.fields = options.fields;
  return query;
}
