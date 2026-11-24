// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata list's own state in the address (objectstack#36896, epic
 * objectstack#36890 decision 10): the search text, the source, "only
 * customizations", the activation status and the sort ride the list's URL, so
 * a refresh keeps them, × / Back from a detail returns to them, and the detail
 * address carries them for ‹ ›.
 *
 * Three parts, all pure:
 *
 *  - the codec — {@link decodeListState} / {@link writeListState} — between
 *    the address and {@link MetadataListState};
 *  - {@link applyListState} — the list's filter and sort over its rows, the
 *    ONE implementation the list page draws and the detail's ‹ › order reads,
 *    so the two cannot disagree;
 *  - {@link orderedListNames} — the names in that order, the shape
 *    `StudioDetailHeader`'s `sequence.names` takes.
 *
 * Page-scoped params (`urlParams.ts` keeps the console's reserved ones): none
 * of them names a reserved param, nor one the item page reads (`package`,
 * `scope`, `member`, `tab`, `review`, `open`, `sel`) — the list-state test
 * holds that. Every write REPLACES the history entry: Back never pages through
 * keystrokes or filter flips, it leaves the list.
 *
 * The package scope (`package`, `scope`) is not part of this state: it keeps
 * its own params and meaning (`ResourceListPage`, `catalog-scope.ts`).
 */

/** The search text. */
export const LIST_QUERY_PARAM = 'q';
/** The source filter: `artifact` or `runtime`; absent = every source. */
export const LIST_SOURCE_PARAM = 'source';
/** "Only customizations": `1`; absent = off. */
export const LIST_CUSTOMIZED_PARAM = 'customized';
/** The activation status filter: `active` or `inactive`; absent = every status. */
export const LIST_STATUS_PARAM = 'status';
/** The sort: a key, `-` before it for descending; absent = {@link DEFAULT_LIST_SORT}. */
export const LIST_SORT_PARAM = 'sort';

/** Every param the list state writes. */
export const LIST_STATE_PARAMS: readonly string[] = [
  LIST_QUERY_PARAM,
  LIST_SOURCE_PARAM,
  LIST_CUSTOMIZED_PARAM,
  LIST_STATUS_PARAM,
  LIST_SORT_PARAM,
];

export type ListSourceFilter = 'all' | 'artifact' | 'runtime';
export type ListStatusFilter = 'all' | 'active' | 'inactive';

/**
 * The keys the list sorts by: the item's API name (its primary key) and its
 * label. The seam for a third key — the modified time, once the list serves
 * its modified-time sibling field — is one entry here and one member on
 * {@link ListRowReader}; nothing else reads the set.
 */
export const LIST_SORT_KEYS = ['name', 'label'] as const;
export type ListSortKey = (typeof LIST_SORT_KEYS)[number];

export interface ListSort {
  key: ListSortKey;
  dir: 'asc' | 'desc';
}

/**
 * The default order: by API name, A to Z. It is also the order ‹ › use when
 * the detail was opened with no list context (a refresh, a shared link, ⌘K) —
 * decision 10 — so an untouched list and a context-free detail agree.
 */
export const DEFAULT_LIST_SORT: ListSort = { key: 'name', dir: 'asc' };

export interface MetadataListState {
  query: string;
  source: ListSourceFilter;
  customizedOnly: boolean;
  status: ListStatusFilter;
  sort: ListSort;
}

export const DEFAULT_LIST_STATE: MetadataListState = {
  query: '',
  source: 'all',
  customizedOnly: false,
  status: 'all',
  sort: DEFAULT_LIST_SORT,
};

function isSortKey(value: string): value is ListSortKey {
  return (LIST_SORT_KEYS as readonly string[]).includes(value);
}

/** The `sort` value for a sort: `label`, `-label`; `''` for the default. */
export function encodeListSort(sort: ListSort): string {
  if (sort.key === DEFAULT_LIST_SORT.key && sort.dir === DEFAULT_LIST_SORT.dir) return '';
  return `${sort.dir === 'desc' ? '-' : ''}${sort.key}`;
}

/** A `sort` value read back; a value naming no key is the default. */
export function decodeListSort(raw: string | null | undefined): ListSort {
  if (!raw) return DEFAULT_LIST_SORT;
  const desc = raw.startsWith('-');
  const key = desc ? raw.slice(1) : raw;
  return isSortKey(key) ? { key, dir: desc ? 'desc' : 'asc' } : DEFAULT_LIST_SORT;
}

/**
 * The list state an address names. A param that is absent, or holds a value
 * the list does not offer (a hand-edited link), reads as that filter's
 * default; an address never throws.
 */
export function decodeListState(params: URLSearchParams): MetadataListState {
  const source = params.get(LIST_SOURCE_PARAM);
  const status = params.get(LIST_STATUS_PARAM);
  return {
    query: params.get(LIST_QUERY_PARAM) ?? '',
    source: source === 'artifact' || source === 'runtime' ? source : 'all',
    customizedOnly: params.get(LIST_CUSTOMIZED_PARAM) === '1',
    status: status === 'active' || status === 'inactive' ? status : 'all',
    sort: decodeListSort(params.get(LIST_SORT_PARAM)),
  };
}

/**
 * `params` with the list state written over it: a value at its default is
 * removed, so an untouched list has a clean address. Every other param
 * (`package`, `scope`, …) is kept as it is. Returns a new object.
 */
export function writeListState(params: URLSearchParams, state: MetadataListState): URLSearchParams {
  const next = new URLSearchParams(params);
  const put = (key: string, value: string) => (value ? next.set(key, value) : next.delete(key));
  put(LIST_QUERY_PARAM, state.query);
  put(LIST_SOURCE_PARAM, state.source === 'all' ? '' : state.source);
  put(LIST_CUSTOMIZED_PARAM, state.customizedOnly ? '1' : '');
  put(LIST_STATUS_PARAM, state.status === 'all' ? '' : state.status);
  put(LIST_SORT_PARAM, encodeListSort(state.sort));
  return next;
}

/**
 * The list context a row link carries to its detail (decision 10): the
 * non-default list-state params as `a=b&c=d`, `''` for an untouched list.
 */
export function listContextQuery(state: MetadataListState): string {
  return writeListState(new URLSearchParams(), state).toString();
}

/** Whether an address carries any list context. */
export function hasListContext(params: URLSearchParams): boolean {
  return LIST_STATE_PARAMS.some((key) => params.has(key));
}

/**
 * What the list knows of one row, for {@link applyListState}. The two
 * optional members are the filters the list offers only sometimes: absent,
 * that filter is not offered and its state is ignored, exactly as the page
 * draws no control for it.
 */
export interface ListRowReader<R> {
  /** The row's API name (the type's primary key). */
  name(row: R): string;
  /** The row's label; a row without one sorts by its name. */
  label(row: R): string | undefined;
  /** The search: does the row match the text (never called with `''`)? */
  matches(row: R, query: string): boolean;
  /** Where the row comes from. */
  source(row: R): 'artifact' | 'runtime';
  /** "Only customizations" is offered: is the row a customization? */
  customized?: (row: R) => boolean;
  /**
   * The status filter is offered: is the row active? `null` while the answer
   * is unknown (unread or unreadable), and an unknown row matches neither
   * status.
   */
  active?: (row: R) => boolean | null;
}

const COLLATORS = new Map<string, Intl.Collator>();

/** The comparison the sort uses, in the reader's display locale (numbers in number order, case ignored). */
function collatorFor(locale: string): Intl.Collator {
  let collator = COLLATORS.get(locale);
  if (!collator) {
    collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    COLLATORS.set(locale, collator);
  }
  return collator;
}

function sortValue<R>(row: R, key: ListSortKey, read: ListRowReader<R>): string {
  if (key === 'label') {
    const label = read.label(row);
    return label ? label : read.name(row);
  }
  return read.name(row);
}

/**
 * The rows the list shows for `state`, in the order it shows them: filtered
 * by every offered filter, then sorted by `state.sort`, compared in `locale`
 * (the reader's display locale — the list and the detail pass the same one).
 * Ties break on the name, then on the rows' own order, so the order is total
 * and stable.
 */
export function applyListState<R>(
  rows: readonly R[],
  state: MetadataListState,
  read: ListRowReader<R>,
  locale: string,
): R[] {
  const collator = collatorFor(locale);
  const kept = rows.filter((row) => {
    if (state.query && !read.matches(row, state.query)) return false;
    if (state.source !== 'all' && read.source(row) !== state.source) return false;
    if (state.customizedOnly && read.customized && !read.customized(row)) return false;
    if (state.status !== 'all' && read.active) {
      const active = read.active(row);
      if (active === null || active !== (state.status === 'active')) return false;
    }
    return true;
  });
  const sign = state.sort.dir === 'desc' ? -1 : 1;
  return kept
    .map((row, at) => ({ row, at }))
    .sort((a, b) => {
      const primary = collator.compare(sortValue(a.row, state.sort.key, read), sortValue(b.row, state.sort.key, read));
      if (primary !== 0) return sign * primary;
      const byName = collator.compare(read.name(a.row), read.name(b.row));
      if (byName !== 0) return sign * byName;
      return a.at - b.at;
    })
    .map(({ row }) => row);
}

/** The package scope a list is read in (`ResourceListPage` resolves it). */
export interface ListScope {
  /** The type's own hide hook (`listFilter` on its resource config). */
  listFilter?: (item: Record<string, unknown>) => boolean;
  /** Every package's rows: the environment scope, or the area's cross-package leg. */
  unscoped: boolean;
  /** The package the list is scoped to; `null` shows nothing (fail closed). */
  activePackage: string | null;
  /** The active package's `.custom` pair, whose rows the area's list also holds (ADR-0146 D3). */
  pairId: string | null;
}

/**
 * The rows a scope holds, before any user filter: rows tagged with the active
 * package (or its pair). Untagged rows and the `sys_metadata` sentinel have no
 * package of their own and match no package (ADR-0070 D5).
 */
export function scopeListRows<R extends { item: Record<string, unknown> }>(rows: readonly R[], scope: ListScope): R[] {
  return rows.filter((row) => {
    if (scope.listFilter && !scope.listFilter(row.item)) return false;
    if (scope.unscoped) return true;
    if (!scope.activePackage) return false;
    const pkg = row.item._packageId;
    return pkg === scope.activePackage || (scope.pairId !== null && pkg === scope.pairId);
  });
}

/**
 * The names ‹ › step through: {@link applyListState}'s rows, by name. Rows
 * that share a name (two members of a bundle, two holders of a permission
 * set) are one entry, at the first row's place — ‹ › open an item by its name.
 * With {@link DEFAULT_LIST_STATE} — no list context — this is every row by
 * name, A to Z.
 */
export function orderedListNames<R>(
  rows: readonly R[],
  state: MetadataListState,
  read: ListRowReader<R>,
  locale: string,
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of applyListState(rows, state, read, locale)) {
    const name = read.name(row);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}
