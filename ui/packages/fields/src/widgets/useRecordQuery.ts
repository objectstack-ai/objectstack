/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DataSource, QueryParams } from '@object-ui/types';

/**
 * useRecordQuery — the shared record-query kernel behind record pickers.
 *
 * Encapsulates the query/pagination/search/sort loop that was previously
 * duplicated (and independently tuned) inside `RecordPickerDialog.fetchRecords`
 * and `LookupField.fetchLookupData`:
 *
 * - builds the `QueryParams` (`$top`/`$skip`/`$search`/`$searchFields`/
 *   `$orderby`/`$filter`/`$expand`),
 * - issues `dataSource.find(objectName, params)` and normalises the result
 *   (`{ data, total }`, tolerating a bare array),
 * - owns `records`/`loading`/`error`/`total` plus the `page`/`search`/`sort`
 *   controls, with a debounced search path,
 * - clears itself when it can no longer query — `enabled` false (e.g. a dialog
 *   closing), or no data source or object name — superseding any read still in
 *   flight, so that read's answer commits nothing (objectui#10712).
 *
 * The caller keeps ownership of *selection* state and of record→option mapping;
 * this hook only answers "what records match the current query". It is the
 * reusable core the search-first PeoplePicker (and a future org-tree tier)
 * compose on top of.
 *
 * Effect shape intentionally mirrors the original components to preserve
 * behaviour: the fetch effect keys on page/sort/filter/expand (NOT `search`,
 * which drives its own debounced fetch), and state resets live in a separate
 * `enabled`-keyed effect so they never cascade into a fetch (React #185).
 */
export interface UseRecordQueryOptions {
  /** Backing data source. When absent/invalid the hook stays idle. */
  dataSource?: DataSource | null;
  /** Object/resource name to query (e.g. `sys_user`). */
  objectName?: string | null;
  /**
   * Gate fetching. When false no request is issued and query state is cleared.
   * Typically wired to a dialog's `open`, plus any "dependencies satisfied"
   * guard. Default `true`.
   */
  enabled?: boolean;
  /** `$top` — page size. Default 50. */
  pageSize?: number;
  /**
   * When true, use page-based pagination (`$skip = (page - 1) * pageSize`).
   * When false (default) a single page of `pageSize` records is fetched.
   */
  paginate?: boolean;
  /**
   * `$filter` — already merged by the caller (base `lookupFilters`, dependent
   * lookup chain, candidate hygiene like `banned != true`, …). Compared by
   * value, so a referentially-new-but-equal object each render will not loop.
   *
   * Either the `QueryParams.$filter` record form or a lowered ObjectQL AST node
   * (an array), since the picker's merge now produces both (#3831). Typed
   * `unknown` rather than `Record< string, any >` so an array cannot slip
   * through a type that silently accepts it; emptiness is decided by
   * {@link hasFilter}, not by `Object.keys`.
   */
  filter?: unknown;
  /** `$expand` — related entities to include (e.g. `['primary_business_unit_id']`). */
  expand?: string[];
  /** `$searchFields` — narrow the server searchable set (ADR-0061). */
  searchFields?: string[];
  /** Debounce applied to {@link UseRecordQueryResult.setSearch}, in ms. Default 300. */
  debounceMs?: number;
}

export interface RecordQuerySort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface UseRecordQueryResult {
  /** Records returned by the current query. */
  records: any[];
  loading: boolean;
  error: string | null;
  /** Total matching records (server-reported, else the current page length). */
  total: number;
  /** `ceil(total / pageSize)`, at least 1. */
  totalPages: number;
  page: number;
  search: string;
  /**
   * The search term `records` answer: the term of the query that committed
   * them, `''` before the first answer and after a reset. It is set in the same
   * commit as `records`, so the two never disagree.
   *
   * `search` moves on every keystroke, and the query for it runs after the
   * debounce, so for that window `records` still answer an earlier term. A
   * consumer that acts on "the rows for what the user typed" compares this
   * with `search` (objectui#13162): equal means the rows on screen answer the
   * term in the box. A late answer to a superseded query commits nothing
   * (objectui#10712), so it cannot set this either.
   */
  answeredSearch: string;
  sort: RecordQuerySort | null;
  /** Jump to a page (1-indexed). No-op unless `paginate` is set. */
  setPage: (page: number) => void;
  /** Set the search term; debounced, and resets to page 1. */
  setSearch: (query: string) => void;
  /** Toggle sort on a field (new field → asc, same field → flip); resets to page 1. */
  toggleSort: (field: string) => void;
  /** Set the sort directly (or clear with `null`); resets to page 1. */
  setSort: (sort: RecordQuerySort | null) => void;
  /** Clear query state (search/page/sort/records/error). */
  reset: () => void;
  /** Imperatively refetch with the current params. */
  refetch: () => void;
}

/**
 * Is this filter source worth sending as `$filter` at all?
 *
 * Array-aware on purpose. The picker's merge yields either the
 * `QueryParams.$filter` record form or a lowered ObjectQL AST node (#3831), and
 * `Object.keys` on an array returns its INDICES — so the record-only test read
 * `['0','1','2']` for an AST node and was right only by accident. An empty array
 * is "no filter" for the same reason an empty object is.
 *
 * Narrows to the `$filter` slot's own type rather than a restatement of it
 * (#3909), so the caller assigns with no cast and this predicate cannot drift
 * from the declaration it is guarding.
 */
function hasFilter(filter: unknown): filter is NonNullable<QueryParams['$filter']> {
  if (filter === null || filter === undefined) return false;
  if (Array.isArray(filter)) return filter.length > 0;
  if (typeof filter !== 'object') return false;
  return Object.keys(filter as object).length > 0;
}

export function useRecordQuery(options: UseRecordQueryOptions): UseRecordQueryResult {
  const {
    dataSource,
    objectName,
    enabled = true,
    pageSize = 50,
    paginate = false,
    filter,
    expand,
    searchFields,
    debounceMs = 300,
  } = options;

  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPageState] = useState(1);
  const [search, setSearchState] = useState('');
  const [answeredSearch, setAnsweredSearch] = useState('');
  const [sort, setSortState] = useState<RecordQuerySort | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // objectui#10712 (objectui#10713) — the number of the latest `runQuery` call
  // that issued a read. Held in a ref: nothing renders from it. The reset
  // below moves it too, so a read in flight at the reset is superseded.
  const runSeqRef = useRef(0);

  const clearDebounce = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  // Stable signatures for object/array inputs so the fetch effect keys on their
  // *value*, not a fresh reference every render.
  const filterSignature = useMemo(
    () => (hasFilter(filter) ? JSON.stringify(filter) : ''),
    [filter],
  );
  const expandSignature = useMemo(() => (expand?.length ? expand.join(',') : ''), [expand]);
  const searchFieldsSignature = useMemo(
    () => (searchFields?.length ? searchFields.join(',') : ''),
    [searchFields],
  );

  const canQuery =
    !!enabled && !!dataSource && typeof dataSource.find === 'function' && !!objectName;

  // Core fetch. Takes the controlled inputs as arguments so the debounced
  // search path and the effect path share one implementation.
  //
  // objectui#10712 (objectui#10713) — the page / sort / filter effect, the
  // debounced search and `refetch` all call this, and a later call can be
  // issued while an earlier one is in flight. Only the LATEST call commits its
  // records, total or error, and only it ends `loading`: a superseded answer
  // that lands last would otherwise show the results of an earlier query, and
  // one that lands first would end the loading state the current query is
  // still in. A call that returns before reading is not a run: it issues no
  // read and sets no `loading`, so it supersedes nothing.
  const runQuery = useCallback(
    async (searchTerm: string, pageArg: number, sortArg: RecordQuerySort | null) => {
      if (!canQuery || !dataSource || !objectName) return;

      const seq = ++runSeqRef.current;
      const isCurrent = () => runSeqRef.current === seq;
      setLoading(true);
      setError(null);

      try {
        const params: QueryParams = { $top: pageSize };
        if (paginate) params.$skip = (pageArg - 1) * pageSize;
        if (searchTerm && searchTerm.trim()) params.$search = searchTerm.trim();
        if (searchFields && searchFields.length > 0) params.$searchFields = searchFields;
        if (sortArg) params.$orderby = { [sortArg.field]: sortArg.direction };
        // No cast: `QueryParams.$filter` now declares both shapes it accepts
        // (#3909), so the AST-array form the picker's merge yields is describable
        // here. The local cast this replaces was deliberate debt — taken at this
        // ONE assignment rather than widening the shared type that several other
        // producers (plugin-list's `buildEffectiveFilter`, plugin-view's
        // ObjectView) already feed arrays through. The shared type is honest now,
        // so the debt is paid rather than moved.
        if (hasFilter(filter)) params.$filter = filter;
        if (expand && expand.length > 0) params.$expand = expand;

        const result = await dataSource.find(objectName, params);
        if (!isCurrent()) return;
        const data: any[] = result?.data ?? (result as any) ?? [];

        setRecords(data);
        setTotal(result?.total ?? data.length);
        setAnsweredSearch(searchTerm);
      } catch (err) {
        if (!isCurrent()) return;
        setError(err instanceof Error ? err.message : String(err));
        setRecords([]);
        setAnsweredSearch(searchTerm);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    // filter/expand/searchFields are referenced via their signatures below so
    // this callback stays stable across referentially-new-but-equal props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canQuery, dataSource, objectName, pageSize, paginate, filterSignature, expandSignature, searchFieldsSignature],
  );

  // Fetch on enable and whenever page/sort/filter/expand change. `search` is
  // intentionally excluded — it has its own debounced path in `setSearch`.
  useEffect(() => {
    if (canQuery) {
      runQuery(search, page, sort);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuery, page, sort, runQuery]);

  // Clear the query state, superseding any read in flight (objectui#10712).
  // The run number moves, so that read's answer commits nothing: it was the
  // latest run, and before this card it committed over the cleared state.
  // `loading` is ended here, since that run no longer may end it, and a pending
  // debounced search is dropped, since it would query what the hook is
  // clearing. This is both the consumer's `reset()` and the reset the effect
  // below applies when the hook can no longer query.
  const reset = useCallback(() => {
    runSeqRef.current += 1;
    clearDebounce();
    setLoading(false);
    setRecords([]);
    setError(null);
    setSearchState('');
    setAnsweredSearch('');
    setPageState(1);
    setSortState(null);
  }, [clearDebounce]);

  // Reset query state when the hook can no longer query — separate from the
  // fetch effect so resets don't re-trigger a fetch (React #185). Keyed on
  // `canQuery`, not `enabled` alone (objectui#10712): `objectName` or
  // `dataSource` going null had no reset, so the previous object's records
  // stayed and a read in flight committed.
  useEffect(() => {
    if (!canQuery) reset();
  }, [canQuery, reset]);

  // Drop a pending debounced search whenever the fetch effect above is about to
  // run a query, and on unmount (objectui#10712). Keyed on what that effect is
  // keyed on: `runQuery` (a filter, object, data-source, page-size or `enabled`
  // change moves it) AND `page` and `sort`, which move without moving
  // `runQuery`. Any of these inside the debounce window re-runs the query
  // through the fetch effect with the current `search`; the armed timer would
  // then run as a call numbered latest, either the OLDER closure (the previous
  // filter, object or data source) or the current closure with the OLDER page
  // or sort (`setSearch` arms it with page 1 and the sort in scope), and its
  // answer would replace the one the fetch effect asked for. React runs this
  // cleanup before that effect's body in the same commit, so the timer is gone
  // before the new query is numbered.
  useEffect(() => () => clearDebounce(), [runQuery, page, sort, clearDebounce]);

  const setSearch = useCallback(
    (query: string) => {
      setSearchState(query);
      setPageState(1);
      clearDebounce();
      debounceTimer.current = setTimeout(() => {
        runQuery(query, 1, sort);
      }, debounceMs);
    },
    [runQuery, sort, debounceMs, clearDebounce],
  );

  const setPage = useCallback((next: number) => {
    setPageState(next);
  }, []);

  const toggleSort = useCallback((field: string) => {
    setSortState(prev =>
      prev && prev.field === field
        ? { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { field, direction: 'asc' },
    );
    setPageState(1);
  }, []);

  const setSort = useCallback((next: RecordQuerySort | null) => {
    setSortState(next);
    setPageState(1);
  }, []);

  const refetch = useCallback(() => {
    runQuery(search, page, sort);
  }, [runQuery, search, page, sort]);

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  return {
    records,
    loading,
    error,
    total,
    totalPages,
    page,
    search,
    answeredSearch,
    sort,
    setPage,
    setSearch,
    toggleSort,
    setSort,
    reset,
    refetch,
  };
}
