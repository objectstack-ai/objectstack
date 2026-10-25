/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Server-side grouping for a grid that owns its fetch (objectui#7189,
 * maintainer ruling A: 「7189 A  其他同意」).
 *
 * ## The contract this module consumes
 *
 * Grouping on a list view is server-side: the set of groups and every number
 * in a group header are properties of the QUERY, not of a fetched page, and
 * the rows inside a group are paged. `@objectstack/spec/ui` compiles a grouped
 * view into the two queries that say so, and this module sends exactly what
 * they compile — it never re-derives either:
 *
 *   - {@link compileListViewGroupQuery} — the GROUP HEADER query, one
 *     `EngineAggregateOptions` per nesting depth, answered through
 *     `DataSource.queryGroupHeaders` (`@object-ui/types`). One query per depth
 *     rather than one leaf query folded upward, because `avg` and
 *     `count_distinct` do not fold across levels (the spec module's own
 *     "Multi-level grouping" note); `count`, the number every header shows, is
 *     exact either way.
 *   - {@link compileListViewGroupRowsQuery} — ONE group's row page: the view's
 *     composed filter AND-ed with that group's key predicate, `limit` /
 *     `offset` per group, answered through the ordinary `DataSource.find`.
 *
 * Both take the view's composed filter as the same `FilterCondition`, so the
 * header numbers and the rows they head are one question asked twice rather
 * than two questions that might disagree.
 *
 * ## A search rides on BOTH queries (objectui#11021)
 *
 * `EngineAggregateOptions` declares ADR-0061 `search` / `searchFields` beside
 * `where` (`@objectstack/spec` 17.5.0, objectstack#20487), and the platform's
 * grouped branch expands them with the same expander its flat `find` uses. So
 * the grid's search term goes on the header query AND on every group's row
 * query, as ONE pair: {@link groupSearchOf} reads the header's pair off the
 * very row query each group's page is asked with. The header then counts the
 * searched rows, and the rows it heads are those rows. ⛔ Never on one of the
 * two alone: searched rows under unsearched counts (or the reverse) is two
 * questions that disagree. `compileListViewGroupQuery` compiles grouping and
 * `where` and takes no search, so the pair is set on the options it compiles,
 * under the spec's own key names.
 *
 * ## What a header row carries, and what the grid still has to do
 *
 * Every grouped field under its own name holding the RAW stored value — a
 * lookup key is the referenced record's id, never the record, and the empty
 * group's key is `null`. Resolving a key to a label is the consumer's, exactly
 * as for a cell, so a reference-typed grouping key is resolved here with one
 * `find` on the referenced object per grouped field (the same resolution
 * `ObjectChart` applies to a grouped series); a failed resolution keeps the id
 * rather than failing the grid. Ordering the groups is the consumer's too:
 * `useGroupedData` applies `GroupingField.order` over the header set.
 *
 * ## An answer is held against the question it answers (objectui#11574)
 *
 * Both hooks record what they hold WITH the question it answers — the object,
 * the grouping fields, and the query they compile with (the composed filter,
 * the search pair and, for the headers, the summary columns) — and read a
 * held answer only under that same question, at once, in the render the
 * question changes. A header row carries only the fields it was grouped by,
 * so the previous field's header set read under the next field's name is
 * every row keyed `null`: one `(empty)` group per old header, all on the same
 * composite key, which React cannot reconcile (the stale duplicates outlive
 * the real answer as phantom headers stuck on "Loading grid…"). A group row
 * page is held by composite key, and two fields can share a key (`0:high`
 * under `priority` and under `impact`), so the previous field's page — one
 * answered after the switch included — would render under the next field's
 * group. A refresh (`reloadKey`) re-asks the SAME question, so it keeps the
 * answer in hand on screen while it reloads; any other change starts with
 * none.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DataSource, QueryParams } from '@object-ui/types';
import type { FilterCondition } from '@objectstack/spec/data';
import {
  compileListViewGroupQuery,
  compileListViewGroupRowsQuery,
  type ListViewGroupHeaderRow,
  type ListViewGroupQuerySource,
} from '@objectstack/spec/ui';
import { isExpandableFieldType } from '@object-ui/core';
import { serverSummaryOf, type GroupAggregationConfig, type UsableGroupingField } from './useGroupedData';

/**
 * `aggregations` as the summary columns the header query compiles from. An
 * entry naming no field or an unknown type contributes no node, so it renders
 * no number rather than a fabricated one.
 */
function summaryColumnsOf(aggregations: GroupAggregationConfig[] | undefined): NonNullable<ListViewGroupQuerySource['columns']> {
  const out: Array<{ field: string; summary: NonNullable<ReturnType<typeof serverSummaryOf>> }> = [];
  for (const agg of aggregations ?? []) {
    if (!agg || typeof agg.field !== 'string' || agg.field === '') continue;
    const summary = serverSummaryOf(agg.type);
    if (summary) out.push({ field: agg.field, summary });
  }
  return out as NonNullable<ListViewGroupQuerySource['columns']>;
}

/** The grouping block the two compilers read, keyed on field names alone. */
function groupingOf(fields: readonly UsableGroupingField[]): ListViewGroupQuerySource['grouping'] {
  return { fields: fields.map((f) => ({ field: f.field })) } as ListViewGroupQuerySource['grouping'];
}

export interface ServerGroupHeadersInput {
  /** Whether the grid groups server-side at all. */
  enabled: boolean;
  dataSource?: DataSource;
  objectName?: string;
  /** The grouping entries the grid may group by, in nesting order. */
  fields: readonly UsableGroupingField[];
  /** The view's composed filter, lowered to a `FilterCondition`. */
  where?: FilterCondition;
  /**
   * The search term (ADR-0061), and the fields it may match: the SAME pair
   * each group's row query carries as `$search` / `$searchFields`, read off it
   * by {@link groupSearchOf}. Absent when nothing is searched.
   */
  search?: string;
  searchFields?: readonly string[];
  /** `object-grid.aggregations` — the per-group numbers besides the count. */
  aggregations?: GroupAggregationConfig[];
  /** The object's field catalogue, for reference-typed grouping keys. */
  objectFields?: Record<string, { type?: unknown; reference?: unknown; displayField?: unknown } | undefined>;
  /** Any change re-asks the server (refresh, data invalidation). */
  reloadKey: string;
}

export interface ServerGroupHeaders {
  /**
   * Index `d` holds the answer of the depth-`d + 1` header query. `undefined`
   * until every depth has answered.
   */
  headers?: ListViewGroupHeaderRow[][];
  /**
   * Display labels for reference-typed grouping keys, per field, by the raw id
   * a header row carries — read off the referenced record. An id with no entry
   * keeps the id as its label.
   */
  keyLabels: Record<string, Record<string, string>>;
  loading: boolean;
  error: Error | null;
}

const IDLE: ServerGroupHeaders = { headers: undefined, keyLabels: {}, loading: false, error: null };

/** Asked, with no answer to THIS question in hand yet. */
const PENDING: ServerGroupHeaders = { headers: undefined, keyLabels: IDLE.keyLabels, loading: true, error: null };

/** The header state, recorded against the question it answers. */
interface HeldHeaders extends ServerGroupHeaders {
  /** The `question` this state answers; `''` when idle. */
  question: string;
}

const IDLE_HELD: HeldHeaders = { ...IDLE, question: '' };

/**
 * The search pair of a group row query, as the header query takes it.
 *
 * The grid resolves its row query once — `$search` only for a non-empty term,
 * `$searchFields` only beside it — and hands that query to
 * {@link useServerGroupRows}, whose every page carries both keys. Reading the
 * header's pair off the SAME object is what keeps the header counts and the
 * rows they head answering one search.
 */
export function groupSearchOf(
  rowQuery: Readonly<Record<string, unknown>> | null,
): Pick<ServerGroupHeadersInput, 'search' | 'searchFields'> {
  const search = rowQuery?.$search;
  if (typeof search !== 'string' || search === '') return {};
  const searchFields = rowQuery?.$searchFields;
  return Array.isArray(searchFields) && searchFields.length > 0
    ? { search, searchFields: searchFields as string[] }
    : { search };
}

/**
 * Ask the server for the group set and every header number — one compiled
 * header query per nesting depth.
 */
export function useServerGroupHeaders(input: ServerGroupHeadersInput): ServerGroupHeaders {
  const { enabled, dataSource, objectName, fields, where, search, searchFields, aggregations, objectFields, reloadKey } = input;
  const [state, setState] = useState<HeldHeaders>(IDLE_HELD);

  // Keyed on CONTENT, never on the identity of an object a host may rebuild
  // every render (AGENTS.md #10).
  const fieldsKey = JSON.stringify(fields.map((f) => f.field));
  const whereKey = JSON.stringify(where ?? null);
  const searchKey = JSON.stringify(
    search
      ? { search, ...(searchFields && searchFields.length > 0 ? { searchFields: [...searchFields] } : {}) }
      : null,
  );
  const aggregationsKey = JSON.stringify(summaryColumnsOf(aggregations));
  const referenceKey = JSON.stringify(
    fields.map((f) => {
      const def = objectFields?.[f.field];
      return isExpandableFieldType(def) && typeof def?.reference === 'string' && def.reference
        ? [def.reference, typeof def.displayField === 'string' ? def.displayField : null]
        : null;
    }),
  );
  const canAsk = enabled && !!objectName && typeof dataSource?.queryGroupHeaders === 'function' && fields.length > 0;
  // What the header set answers: the grouping fields and the header query
  // they compile with. `reloadKey` is not in it — a refresh asks the same
  // question again — and neither is `referenceKey`, which labels the keys of
  // the same answer.
  const question = JSON.stringify([objectName ?? null, fieldsKey, whereKey, searchKey, aggregationsKey]);

  useEffect(() => {
    if (!canAsk || !dataSource || !objectName) {
      // Leaving server grouping drops the last answer rather than keeping a
      // group set that no longer describes the view.
      setState((prev) => (prev === IDLE_HELD ? prev : IDLE_HELD));
      return;
    }
    let cancelled = false;
    // Re-asking the question in hand keeps its answer on screen while it
    // reloads; a different question starts with none (objectui#11574).
    setState((prev) => (prev.question === question
      ? { ...prev, loading: true, error: null }
      : { ...PENDING, question }));
    const fieldNames: string[] = JSON.parse(fieldsKey);
    const references: Array<[string, string | null] | null> = JSON.parse(referenceKey);
    const grouping = groupingOf(fieldNames.map((field) => ({ field })));
    const columns = JSON.parse(aggregationsKey) as NonNullable<ListViewGroupQuerySource['columns']>;
    const composedWhere = JSON.parse(whereKey) as FilterCondition | null;
    const searched = JSON.parse(searchKey) as { search: string; searchFields?: string[] } | null;

    (async () => {
      try {
        const headers = await Promise.all(
          fieldNames.map((_, depthIndex) => {
            const query = compileListViewGroupQuery(
              { grouping, columns },
              { ...(composedWhere ? { where: composedWhere } : {}), depth: depthIndex + 1 },
            );
            // Every depth counts the same searched rows (objectui#11021).
            return dataSource.queryGroupHeaders!(objectName, searched ? { ...query, ...searched } : query);
          }),
        );

        // Reference-typed keys are ids; read the records their labels come
        // from. Keyed off the deepest answer, which carries every key.
        const keyLabels: ServerGroupHeaders['keyLabels'] = {};
        const deepest = headers[headers.length - 1] ?? [];
        await Promise.all(
          fieldNames.map(async (field, i) => {
            const target = references[i];
            if (!target) return;
            const [reference, displayField] = target;
            const ids = [...new Set(deepest.map((row) => row[field]).filter((v) => v !== null && v !== undefined && v !== ''))];
            if (ids.length === 0) return;
            try {
              const result = await dataSource.find(reference, {
                $filter: { id: { $in: ids } },
                $top: ids.length,
              });
              const byId: Record<string, string> = {};
              for (const rec of (result?.data ?? []) as Array<Record<string, unknown>>) {
                const id = rec?.id;
                if (id === undefined || id === null) continue;
                const label = (displayField ? rec[displayField] : undefined)
                  ?? rec.name ?? rec.label ?? rec.title;
                if (label !== undefined && label !== null && label !== '') byId[String(id)] = String(label);
              }
              keyLabels[field] = byId;
            } catch (err) {
              // The ids still group correctly; only their labels are missing.
              console.warn(`[ObjectGrid] Failed to resolve group labels for '${field}' (${reference}):`, err);
            }
          }),
        );

        if (!cancelled) setState({ question, headers, keyLabels, loading: false, error: null });
      } catch (err) {
        if (!cancelled) {
          setState({ question, headers: undefined, keyLabels: {}, loading: false, error: err instanceof Error ? err : new Error(String(err)) });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [canAsk, dataSource, objectName, question, fieldsKey, whereKey, searchKey, aggregationsKey, referenceKey, reloadKey]);

  // Read in the render the question changes, not one render late: the
  // state still holds the previous question's answer until the effect
  // above has run, and that answer is never this question's.
  if (!canAsk) return IDLE;
  return state.question === question ? state : PENDING;
}

/** One leaf group whose rows the grid wants on screen. */
export interface ServerGroupLeaf {
  /** The composite key `useGroupedData` gave the group. */
  key: string;
  /** The raw key of every level from the outermost down to this group. */
  keyValues: Readonly<Record<string, unknown>>;
}

export interface ServerGroupRowsInput {
  enabled: boolean;
  dataSource?: DataSource;
  objectName?: string;
  fields: readonly UsableGroupingField[];
  where?: FilterCondition;
  /**
   * The grid's own row query — projection, expansion, order and search — as
   * the grid resolved it. Its `$filter` and window are each group's own: the
   * view's filter reaches a group through `where`. `null` until the grid has
   * resolved it.
   */
  baseParams: Record<string, unknown> | null;
  pageSize: number;
  /** The leaf groups that are expanded and on screen. */
  leaves: readonly ServerGroupLeaf[];
  reloadKey: string;
}

export interface ServerGroupRowsPage {
  rows: Record<string, unknown>[];
  page: number;
  loading: boolean;
  error: Error | null;
}

export interface ServerGroupRows {
  /** The page of rows held for each leaf group, by its composite key. */
  pages: Readonly<Record<string, ServerGroupRowsPage>>;
  /** Turn one group's page. */
  setPage: (key: string, page: number) => void;
}

interface HeldPage extends ServerGroupRowsPage {
  /** The request this page answers — a different one means re-ask. */
  signature: string;
}

/** The pages held, recorded against the question they answer. */
interface HeldPages {
  question: string;
  pages: Record<string, HeldPage>;
}

const NO_PAGES: Readonly<Record<string, HeldPage>> = {};

/**
 * Page the rows INSIDE each visible, expanded leaf group — one compiled row
 * query per group, `limit` / `offset` per group.
 */
export function useServerGroupRows(input: ServerGroupRowsInput): ServerGroupRows {
  const { enabled, dataSource, objectName, fields, where, baseParams, pageSize, leaves, reloadKey } = input;

  const fieldsKey = JSON.stringify(fields.map((f) => f.field));
  const whereKey = JSON.stringify(where ?? null);
  const paramsKey = JSON.stringify(baseParams ?? null);
  const leavesKey = JSON.stringify(leaves.map((l) => [l.key, l.keyValues]));
  const queryKey = JSON.stringify([fieldsKey, whereKey, paramsKey, pageSize, reloadKey]);
  // The question the group set answers, as far as a group's rows share it:
  // the grouping fields, the composed filter and the search pair. A group's
  // composite key means a different group under a different question (two
  // fields can share one), so a page held under one is never read under
  // another (objectui#11574). Order, projection, page size and a refresh are
  // the same groups asked again: the page in hand stays on screen meanwhile.
  const question = JSON.stringify([objectName ?? null, fieldsKey, whereKey, groupSearchOf(baseParams)]);
  const [held, setHeld] = useState<HeldPages>({ question, pages: {} });
  const heldPages = held.question === question ? held.pages : NO_PAGES;

  // The page each group is on, recorded AGAINST the question it was turned
  // under: a different question (filter, sort, page size, a refresh) makes
  // every recorded page stale, so each group starts over at its first page —
  // read that way at once, rather than reset one render late.
  const [turned, setTurned] = useState<{ queryKey: string; pages: Record<string, number> }>({ queryKey, pages: {} });
  const pageByKey = turned.queryKey === queryKey ? turned.pages : {};

  const canAsk = enabled && !!objectName && !!dataSource && baseParams !== null && fields.length > 0;
  const pagesKey = JSON.stringify(pageByKey);

  useEffect(() => {
    if (!canAsk || !dataSource || !objectName || !baseParams) return;
    const fieldNames: string[] = JSON.parse(fieldsKey);
    const grouping = groupingOf(fieldNames.map((field) => ({ field })));
    const composedWhere = JSON.parse(whereKey) as FilterCondition | null;
    const wanted: Array<[string, Record<string, unknown>]> = JSON.parse(leavesKey);

    for (const [key, keyValues] of wanted) {
      const page = (JSON.parse(pagesKey) as Record<string, number>)[key] ?? 1;
      const signature = JSON.stringify([queryKey, key, page]);
      // Already asked (answered or in flight) for exactly the page on screen.
      // A response to any OTHER request for this group is dropped on arrival
      // by the same signature, so paging back and forth never shows a stale
      // page under the pager's number — and one asked under another question
      // by the question too, so it never lands in this question's pages.
      if (heldPages[key]?.signature === signature) continue;
      setHeld((prev) => {
        const pages = prev.question === question ? prev.pages : {};
        return {
          question,
          pages: { ...pages, [key]: { rows: pages[key]?.rows ?? [], page, loading: true, error: null, signature } },
        };
      });

      const compiled = compileListViewGroupRowsQuery({ grouping }, keyValues, {
        ...(composedWhere ? { where: composedWhere } : {}),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      // The grid's projection / expansion / order / search, the group's filter
      // and window. `$filter` is replaced, not dropped: the view's composed
      // filter is already inside `compiled.where`, AND-ed with this group's
      // key. `$search` / `$searchFields` stay: the header query carries the
      // same pair (`groupSearchOf`), so these rows are the rows it counted.
      const { $filter: _filter, ...rest } = baseParams as Record<string, unknown>;
      const params = {
        ...rest,
        $filter: compiled.where,
        $top: compiled.limit,
        $skip: compiled.offset,
      };

      const answers = (prev: HeldPages) => prev.question === question && prev.pages[key]?.signature === signature;
      dataSource
        .find(objectName, params as QueryParams)
        .then((result) => {
          setHeld((prev) => (answers(prev)
            ? { question, pages: { ...prev.pages, [key]: { rows: result?.data ?? [], page, loading: false, error: null, signature } } }
            : prev));
        })
        .catch((err) => {
          setHeld((prev) => (answers(prev)
            ? { question, pages: { ...prev.pages, [key]: { rows: [], page, loading: false, error: err instanceof Error ? err : new Error(String(err)), signature } } }
            : prev));
        });
    }
    // `heldPages` is read to skip a request already answered; naming it would
    // re-run this effect on every answer, which asks nothing new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAsk, dataSource, objectName, question, fieldsKey, whereKey, leavesKey, pagesKey, queryKey, pageSize]);

  const setPage = useCallback((key: string, page: number) => {
    setTurned((prev) => {
      const pages = prev.queryKey === queryKey ? prev.pages : {};
      return pages[key] === page && prev.queryKey === queryKey
        ? prev
        : { queryKey, pages: { ...pages, [key]: page } };
    });
  }, [queryKey]);

  // The held STATE itself (or the one empty constant), not a projection
  // memoised over it: a consumer keys an effect on it, and a state value's
  // identity is a promise React keeps where a memo's is not (AGENTS.md #10).
  return { pages: heldPages, setPage };
}
