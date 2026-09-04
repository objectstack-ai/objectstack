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
 *
 * A summary alias that would land on a grouped field's own column
 * (`sum_amount` while grouping by a field named `sum_amount`) is refused, not
 * silently overwritten — the two would be one column with two meanings.
 *
 * ## The mapping table — `ColumnSummary` → `AggregationFunction` (fork i)
 *
 * | `ListColumn.summary` | aggregation node | note |
 * |---|---|---|
 * | `none` | (no node) | "no summary" is not a summary |
 * | `count` | `{ function: 'count' }` | fieldless — `COUNT(*)`, the group count itself |
 * | `count_unique` | `{ function: 'count_distinct', field }` | `COUNT(DISTINCT field)`, nulls excluded |
 * | `sum` / `avg` / `min` / `max` | the same name, `field` | |
 * | `count_empty` | **refused** | no counterpart — see below |
 * | `count_filled` | **refused** | no counterpart — see below |
 * | `percent_empty` | **refused** | no counterpart — see below |
 * | `percent_filled` | **refused** | no counterpart — see below |
 *
 * The four refused members are a STOP-AND-REPORT fork on #14556: the seat
 * decides whether they map (`count_filled` reads as `COUNT(field)`, which the
 * platform defines as the non-null count, while the footer's client-side
 * reading also treats `''` and `[]` as empty; `count_empty` is spellable only
 * with a per-aggregation `filter: { [field]: { $null: true } }`, which routes
 * the whole header query through the engine's in-memory tier today; the two
 * `percent_*` members are ratios of those counts, not aggregation functions).
 * Until that ruling lands the refusal below IS the contract: a grouped view
 * declaring one of them fails to compile LOUDLY, with `code`, `status` and
 * the `path` of the offending summary — nothing is dropped and no third
 * vocabulary is invented. {@link COLUMN_SUMMARY_AGGREGATION} is typed
 * `Record<ColumnSummary, …>`, so adding a member to `ColumnSummarySchema`
 * without deciding its row here fails to type-check.
 *
 * ## Multi-level grouping
 *
 * `groupBy` carries the grouping fields in nesting order, so the header query
 * answers one row per LEAF combination. An outer level's header is derived
 * from the leaf rows sharing its prefix: `count`, `sum`, `min` and `max` fold
 * exactly; `avg` does not (an average of averages weights the groups, not the
 * rows). When an outer level must carry an exact `avg`, compile that level's
 * own query with `depth` — the same query over the first `depth` grouping
 * fields — rather than folding. This is still one query shape.
 *
 * ## Deliberately NOT here
 *
 *   * **The REST door.** No `aggregate` route exists on the data endpoint
 *     today; which route carries the header query to the grid is the platform
 *     half of #14556 (item 2 of the card), not the spec half.
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
import type { ColumnSummary, GroupingConfig, ListColumn, ListView } from './view.zod';

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
 *   * `none` — the member means "no summary"; no node.
 *   * `unmapped` — no counterpart in `AggregationFunction`; the compiler
 *     refuses it loudly (fork i on #14556).
 */
export type ColumnSummaryAggregation =
  | { readonly kind: 'aggregate'; readonly function: AggregationFunction; readonly fieldless: boolean }
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
  count_empty: { kind: 'unmapped' },
  count_filled: { kind: 'unmapped' },
  percent_empty: { kind: 'unmapped' },
  percent_filled: { kind: 'unmapped' },
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
  | 'alias_collision'
  | 'grouping_empty'
  | 'grouping_field_blank'
  | 'depth_out_of_range'
  | 'group_key_not_a_prefix';

/**
 * A refusal to compile a grouped list view into its queries.
 *
 * Carries the ADR-0112 envelope (`code` + `status`) so a door that serves the
 * compile answers the same way the data path answers a malformed query, plus
 * the `path` of the offending declaration inside the list view (a zod-style
 * path: `['columns', 2, 'summary']`) and a closed `reason`. The two codes are
 * standard-catalog members (`api/errors.zod.ts`): `NOT_IMPLEMENTED` / 501 for
 * a summary the vocabulary has no counterpart for yet (the interim contract of
 * fork i), `INVALID_QUERY` / 400 for a declaration the contract cannot mean.
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

    const mapping = COLUMN_SUMMARY_AGGREGATION[member];
    if (mapping === undefined || mapping.kind === 'unmapped') {
      // The refusal is printed AT the author, so it carries the remedy and no
      // issue id (the tracking card is in the module note — fork i).
      throw new ListViewGroupQueryError(
        'summary_unmapped',
        path,
        `Column summary "${member}" on columns[${index}] (field "${field}") has no counterpart in the `
          + 'aggregation vocabulary (AggregationFunction: count / sum / avg / min / max / count_distinct), '
          + 'so a grouped list view cannot carry it in its group headers yet. Whether '
          + `${UNMAPPED_COLUMN_SUMMARIES.join(' / ')} map onto the vocabulary is an open contract question; `
          + 'until it is ruled, remove the summary from this column or group the view without it. '
          + 'Nothing is dropped silently.',
      );
    }
    if (mapping.kind === 'none') return;

    const aggregatedField = mapping.fieldless ? undefined : field;
    const alias = columnSummaryAlias(mapping.function, aggregatedField);
    if (alias === LIST_VIEW_GROUP_COUNT_ALIAS) return; // the group count column already carries it
    if (grouped.has(alias)) {
      throw new ListViewGroupQueryError(
        'alias_collision',
        path,
        `Column summary "${member}" on columns[${index}] would land under "${alias}", which is also a `
          + 'grouped field\'s own column on the header row — one column cannot carry both the group key '
          + 'and the summary. Rename the field or drop one of the two declarations.',
      );
    }
    if (!nodes.has(alias)) {
      nodes.set(alias, { function: mapping.function, field: aggregatedField, alias });
    }
  });

  return [...nodes.values()];
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
 * for the empty group, whose header key is `null` and which no `$eq` can
 * select (`null` is not a comparand; `$null` is the AST's spelling for
 * absence, `data/filter.zod.ts`).
 *
 * `groupKey` must carry a PREFIX of the nesting order — every level from the
 * outermost down to the group being opened, and no level past it — so the
 * rows of an outer group (a `depth`-scoped header) are spellable too.
 *
 * @throws {ListViewGroupQueryError} `group_key_not_a_prefix` (`INVALID_QUERY`)
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
  return names.slice(0, levels).map((name) => {
    const value = groupKey[name];
    return value === null || value === undefined
      ? { [name]: { $null: true } }
      : { [name]: { $eq: value } };
  });
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
