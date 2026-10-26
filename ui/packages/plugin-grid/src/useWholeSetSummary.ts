/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The whole matched set's footer figures, for a grid whose rows are one page
 * of it (objectui#12081 item 3).
 *
 * ## The question, and the door it rides
 *
 * The footer is drawn beside a count of the WHOLE matched set, so its figures
 * must be that set's figures. Under server paging the grid holds one page, so
 * those figures are a property of the QUERY, not of any fetched page — the
 * same reading objectui#7189 made of a group header's numbers. They are asked
 * the same way: ONE `EngineAggregateOptions` through
 * `DataSource.queryGroupHeaders`, with no `groupBy`, so the answer is the one
 * "header row" of the whole set. The platform's data door routes a body
 * carrying `aggregations` to `engine.aggregate` with or without a `groupBy`
 * (the `hasGroupBy || hasAggregations` branch of `findData`), and hands it the
 * query's `where`, `search` and `searchFields` — the same `where` its count
 * reads and the same search expander its flat `find` uses.
 *
 * Why this door and not `DataSource.aggregate()`: that member takes the
 * analytics-shaped `AggregateParams` (one field, one function), carries no
 * search on either of its branches, and may DEGRADE to a client-side reduction
 * over a `find()` — none of which can answer "these rows' figures". This one
 * sends the compiled query verbatim and never degrades: a source that cannot
 * answer throws, and the footer then says its figure is the page's.
 *
 * ## The query is compiled from the spec's own table
 *
 * `count` first (`COUNT(*)`, under `LIST_VIEW_GROUP_COUNT_ALIAS`), then one
 * node per declared column summary off `COLUMN_SUMMARY_AGGREGATION`, aliased
 * by `columnSummaryAlias`, deduplicated — the node set
 * `compileListViewGroupQuery` gives a grouped view, which that compiler will
 * not build without a grouping (`grouping_empty`). The answer is read back
 * through `deriveColumnSummary` (`useScopedColumnSummary`), so both directions
 * stay the spec's.
 *
 * ## ⛔ Never a figure over different rows than the count's
 *
 *   - The query is the one behind the rows on screen — the host's `findParams`
 *     or the grid's own — less its window: `$filter` (lowered through the
 *     spec's `parseFilterAST`, as the grouped header query lowers it),
 *     `$search` and `$searchFields`. A key outside the window keys and those
 *     three is a narrowing this read cannot repeat, so it is not asked.
 *   - The answer's `count` must equal the count the grid shows. When it does
 *     not — the platform's paged count under a search is a page-local
 *     estimate, not a count — the two describe different numbers of rows,
 *     and the footer stays on the page, labelled as the page's.
 *
 * ## Asked only for a footer, once per question
 *
 * A grid whose columns declare no summary that maps to an aggregate (none at
 * all, only `none`, only unknown members) asks nothing: `wholeSetSummaryNodes`
 * answers `null`, and the read is `off`. Every console list view is a paged
 * grid with object-form columns, so without this gate each of them would send
 * an aggregate query for a footer it never draws.
 *
 * The question is the object, the query and the summary columns; the window
 * (`$top`, `$skip`), the order and the projection are not in it, so a page
 * turn or a header sort asks nothing. A refresh or a write to the object
 * (the data-invalidation bus) re-asks the SAME question and keeps the answer
 * on screen until the new one lands (objectui#11574's reading).
 */

import { useEffect, useState } from 'react';
import type { DataSource, ListColumn } from '@object-ui/types';
import { parseFilterAST } from '@objectstack/spec/data';
import type { AggregationNode, EngineAggregateOptions, FilterCondition } from '@objectstack/spec/data';
import {
  COLUMN_SUMMARY_AGGREGATION,
  LIST_VIEW_GROUP_COUNT_ALIAS,
  columnSummaryAlias,
  type ColumnSummary,
  type ListViewGroupHeaderRow,
} from '@objectstack/spec/ui';
import { useDataInvalidation } from '@object-ui/react';

/** Find-param keys that shape the WINDOW or the row's SHAPE — never which rows match. */
const WINDOW_KEYS: ReadonlySet<string> = new Set(['$top', '$skip', '$orderby', '$select', '$expand', '$count']);

/**
 * The aggregation nodes the columns' summaries map to — `count` first
 * (`COUNT(*)`, which a `count` summary rides), then one node per declared
 * summary, deduplicated — or `null` when NO column declares a summary that
 * maps to an aggregate: none at all, only `none`, only members the table does
 * not know or cannot map, or a summary over no field. A grid with no footer
 * figure has nothing to ask, so `null` here is what keeps the read off
 * (objectui#12081 item 3, rework round 1): the `count` node alone is not a
 * question anybody asked.
 */
export function wholeSetSummaryNodes(columns: readonly ListColumn[] | undefined): AggregationNode[] | null {
  const nodes = new Map<string, AggregationNode>([[LIST_VIEW_GROUP_COUNT_ALIAS, { function: 'count', alias: LIST_VIEW_GROUP_COUNT_ALIAS }]]);
  let declared = false;
  for (const column of columns ?? []) {
    const summary = column?.summary;
    if (summary === undefined || summary === null) continue;
    const member = (typeof summary === 'string' ? summary : summary.type) as ColumnSummary;
    const mapping = Object.prototype.hasOwnProperty.call(COLUMN_SUMMARY_AGGREGATION, member)
      ? COLUMN_SUMMARY_AGGREGATION[member]
      : undefined;
    // `none`, an unknown member, and a member with no counterpart ask nothing:
    // the footer draws no figure for the first two and keeps the third on the
    // page (`deriveColumnSummary` finds no column for it).
    if (!mapping || mapping.kind === 'none' || mapping.kind === 'unmapped') continue;
    const field = typeof summary === 'string' ? column.field : (summary.field ?? column.field);
    if (typeof field !== 'string' || field === '') continue;
    declared = true;
    const fn = mapping.kind === 'derived' ? mapping.from : mapping.function;
    const aggregated = mapping.fieldless ? undefined : field;
    const alias = columnSummaryAlias(fn, aggregated);
    if (!nodes.has(alias)) nodes.set(alias, { function: fn, ...(aggregated !== undefined ? { field: aggregated } : {}), alias });
  }
  return declared ? [...nodes.values()] : null;
}

/**
 * The aggregate query for the whole matched set behind `findParams`, or
 * `null` when there is nothing to ask ({@link wholeSetSummaryNodes}) or it
 * cannot be asked as the same question (see the module note).
 */
export function compileWholeSetSummaryQuery(
  columns: readonly ListColumn[] | undefined,
  findParams: Readonly<Record<string, unknown>>,
): EngineAggregateOptions | null {
  const aggregations = wholeSetSummaryNodes(columns);
  if (aggregations === null) return null;

  for (const key of Object.keys(findParams)) {
    if (!WINDOW_KEYS.has(key) && key !== '$filter' && key !== '$search' && key !== '$searchFields') return null;
  }

  let where: FilterCondition | undefined;
  const filter = findParams.$filter;
  if (filter !== undefined && filter !== null) {
    let lowered: unknown;
    try {
      lowered = parseFilterAST(filter as Parameters<typeof parseFilterAST>[0]);
    } catch {
      return null;
    }
    // A filter that lowers to nothing, or to anything but a condition object,
    // is not one this read can repeat; dropping it would sum the unfiltered set.
    if (!lowered || typeof lowered !== 'object' || Array.isArray(lowered)) return null;
    where = lowered as FilterCondition;
  }

  const search = findParams.$search;
  const searchFields = findParams.$searchFields;
  if (search !== undefined && typeof search !== 'string') return null;
  if (searchFields !== undefined && !(Array.isArray(searchFields) && searchFields.every((f) => typeof f === 'string'))) return null;
  // The search pair as the find carried it: fields only beside a term, as
  // `groupSearchOf` reads the grouped grid's pair.
  const term = typeof search === 'string' ? search.trim() : '';

  return {
    ...(where ? { where } : {}),
    ...(term ? { search: term, ...(Array.isArray(searchFields) && searchFields.length > 0 ? { searchFields: searchFields as string[] } : {}) } : {}),
    aggregations,
  } as EngineAggregateOptions;
}

export interface WholeSetSummaryInput {
  /**
   * The rows on screen are one page of a larger matched set, so the footer
   * needs the set's own figures. `false` asks nothing.
   */
  enabled: boolean;
  dataSource?: DataSource;
  objectName?: string;
  /**
   * The grid's columns; only those carrying a `summary` that maps to an
   * aggregate contribute, and with none of them the read is `off`.
   */
  columns: ListColumn[] | undefined;
  /**
   * The find params behind the rows on screen — the host's `findParams`, or
   * the query this grid's own loader sent. `null` when none is known: the
   * figures cannot be asked, and the footer stays on the page.
   */
  findParams: Readonly<Record<string, unknown>> | null;
  /** The count the grid shows beside the footer, when it has one. */
  count: number | undefined;
  /** A change re-asks the same question (the grid's refresh). */
  reloadKey: string;
}

/**
 * - `off` — not asked: the rows are the whole set, or no column declares a
 *   summary that maps to an aggregate.
 * - `pending` — asked, no answer to THIS question in hand yet.
 * - `answered` — the whole set's header row, its `count` agreeing with the grid's.
 * - `unavailable` — no door, a refusal, an unaskable query, or an answer whose
 *   count is not the grid's.
 */
export type WholeSetSummary =
  | { status: 'off' | 'pending' | 'unavailable'; row?: undefined }
  | { status: 'answered'; row: ListViewGroupHeaderRow };

const OFF: WholeSetSummary = { status: 'off' };
const PENDING: WholeSetSummary = { status: 'pending' };
const UNAVAILABLE: WholeSetSummary = { status: 'unavailable' };

/** The hook's state, recorded against the question it answers. */
interface Held {
  question: string;
  answer: WholeSetSummary;
}

const NOTHING_HELD: Held = { question: '', answer: PENDING };

/** Ask the server for the whole matched set's footer figures. */
export function useWholeSetSummary(input: WholeSetSummaryInput): WholeSetSummary {
  const { enabled, dataSource, objectName, columns, findParams, count, reloadKey } = input;

  // The gate (rework round 1): a grid whose columns declare no summary that
  // maps to an aggregate draws no footer, so it asks nothing and listens to
  // nothing — the read is `off`, exactly as for rows that are the whole set.
  const active = enabled && wholeSetSummaryNodes(columns) !== null;
  const query = active && findParams ? compileWholeSetSummaryQuery(columns, findParams) : null;
  const canAsk = active
    && !!objectName
    && query !== null
    && typeof dataSource?.queryGroupHeaders === 'function';
  // Keyed on CONTENT, never on the identity of an object a host may rebuild
  // every render (AGENTS.md #10).
  const question = canAsk ? JSON.stringify([objectName, query]) : '';
  // A write to the object changes the set's figures; only a grid that asks
  // listens (a hook without a record id is a list/aggregate reader).
  const invalidationNonce = useDataInvalidation(canAsk ? objectName : undefined);
  const [held, setHeld] = useState<Held>(NOTHING_HELD);

  useEffect(() => {
    if (!canAsk || !dataSource || !objectName) return;
    let cancelled = false;
    // Nothing is set before the answer lands: re-asking the question in hand
    // keeps its answer on screen until the new one replaces it, and a
    // different question reads as pending by itself (the read below compares
    // the held question with this render's).
    const asked = (JSON.parse(question) as [string, EngineAggregateOptions])[1];
    // Through a resolved promise, so a source that throws synchronously is a
    // refusal like any other rather than a render error.
    Promise.resolve().then(() => dataSource.queryGroupHeaders!(objectName, asked)).then(
      (rows) => {
        if (cancelled) return;
        // No `groupBy`: the whole set is ONE row. Anything else is not an
        // answer to this question.
        const row = Array.isArray(rows) && rows.length === 1 && rows[0] && typeof rows[0] === 'object' ? rows[0] : undefined;
        setHeld({ question, answer: row ? { status: 'answered', row } : UNAVAILABLE });
      },
      () => {
        if (!cancelled) setHeld({ question, answer: UNAVAILABLE });
      },
    );
    return () => { cancelled = true; };
  }, [canAsk, dataSource, objectName, question, reloadKey, invalidationNonce]);

  if (!active) return OFF;
  if (!canAsk) return UNAVAILABLE;
  // Read in the render the question changes, never one render late.
  const answer = held.question === question ? held.answer : PENDING;
  // The answer's count is the count the grid shows, or its figures describe
  // other rows than the ones that count counts.
  if (answer.status === 'answered' && typeof count === 'number' && Number(answer.row.count) !== count) {
    return UNAVAILABLE;
  }
  return answer;
}
