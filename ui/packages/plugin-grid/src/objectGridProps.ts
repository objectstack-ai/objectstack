/**
 * The host-facing props types of `ObjectGrid` (`./ObjectGrid.tsx`) that
 * `ObjectGridComponentProps` builds on: the persisted column layout, one footer
 * summary, and the host-driven pagination props, moved out of that file
 * verbatim (objectstack#25994, slice 2). `ObjectGrid.tsx` re-exports every
 * name it exported before.
 */

import type { DataTableSchema } from '@object-ui/types';

/**
 * The column layout ObjectGrid persists and reports back — the merged result of
 * a resize and a reorder, not either event on its own. Named so the state hook
 * below and the `onColumnStateChange` prop cannot drift apart.
 */
export interface ObjectGridColumnState {
  order?: string[];
  widths?: Record<string, number>;
}

/**
 * One column summary as the grid's footer would draw it — `header: label`,
 * e.g. `Annual Revenue` and `Sum: 109,800,000.00` — handed to a host through
 * {@link ObjectGridComponentProps.onColumnSummaryChange} (objectui#12528).
 */
export interface ObjectGridFooterSummary {
  /** The column's accessor key. */
  key: string;
  /** The column's header text. */
  header: string;
  /** The formatted summary, scope included (`Sum: 109,800,000.00`). */
  label: string;
}

/**
 * One open group a grouped grid draws rows for, handed to a host through
 * {@link ObjectGridComponentProps.onRowGroupsChange} (objectstack#28461): the
 * group's key, its heading (the ancestors' headings before it on a nested
 * grouping, joined by ` › `) and the rows drawn under it, in display order.
 */
export interface ObjectGridRowGroup {
  /** The group's composite key, unique across levels. */
  key: string;
  /** The group's heading as its band reads it, its path on a nested grouping. */
  label: string;
  /** The rows drawn under the group, in order. */
  rows: ReadonlyArray<Record<string, any>>;
}

/**
 * The HOST-DRIVEN ("external") mode of ObjectGrid — framework#2212.
 *
 * The ordinary authoring surface hands ObjectGrid a `schema` and a `dataSource`
 * and lets it fetch, page, sort and search for itself. In this mode a host
 * (ListView, a designer preview, an app screen with its own toolbar) has
 * already fetched one window of a larger collection and drives the controls
 * itself: it passes the window as `data` plus the real match total and the
 * page/sort/search state, and ObjectGrid forwards them straight to its
 * DataTable instead of client-slicing the window it was handed.
 *
 * Kept as its own named interface rather than flattened into `ObjectGridComponentProps`
 * (#4277 裁决 B, 2026-08-11): the two are different classes of contract, and a
 * dozen more members merged into the authoring surface would erase that
 * boundary. Until this existed, every member below was read out of `...rest`
 * through an `as any` cast and was declared nowhere at all.
 *
 * DERIVATION (#4277 裁决 §3, the anti-drift pin): this vocabulary is already
 * declared once, on `DataTableSchema` — which is exactly where ObjectGrid
 * forwards it — so the members that have a counterpart there are TYPE-DERIVED
 * from that declaration rather than hand-copied into a second enumeration. Two
 * hand-written copies of one vocabulary is how the next drift happens. The
 * `Partial<...>` wrapper is deliberate and is the only shape change: the whole
 * mode is opt-in, and `DataTableSchema['data']` is required because a table
 * always has rows, while a grid that was given no `data` fetches its own.
 *
 * `search` is read outside this mode too (objectui#11021): a host that passes
 * it owns the search term even where the grid fetches for itself, and the
 * grid's own queries carry it. `ListView` hands its toolbar term to a grid
 * that groups on the server that way, with no rows.
 */
export interface ObjectGridExternalPaginationProps
  extends Partial<
    Pick<
      DataTableSchema,
      // The host's already-fetched window. Highest-priority data source: it
      // wins over `schema.data` / `schema.bind` when present.
      | 'data'
      // Turns off client slicing. With `rowCount` + `onPageChange` it is what
      // makes the mode active at all (see `externalManualPagination` below).
      | 'manualPagination'
      | 'rowCount'
      | 'page'
      | 'pageSize'
      | 'onPageChange'
      | 'onPageSizeChange'
      | 'sort'
      | 'onSortChange'
      | 'search'
      | 'onSearchChange'
    >
  > {
  /**
   * Grid-only: `DataTableSchema` has no counterpart to derive from.
   *
   * The table vocabulary reports column changes as separate per-event
   * callbacks — `onColumnResize(columnKey, width)` and
   * `onColumnReorder(newOrder)` — whereas this reports the MERGED, persisted
   * `{ order, widths }` layout after ObjectGrid has folded either event into
   * the state it also writes to `localStorage`, so a host can save one blob
   * (the console stores it on the signed-in user's own list state). Deriving
   * it from either table
   * callback would misstate both the payload and when it fires.
   */
  onColumnStateChange?: (state: ObjectGridColumnState) => void;

  /**
   * Grid-only: `DataTableSchema` has no counterpart to derive from — a table is
   * handed rows, it never issues a query.
   *
   * The params the host passed to `dataSource.find()` for the window it is
   * handing down in `data` — the SAME shape this grid's own loader stores in
   * `lastFindParamsRef` (`$filter` / `$orderby` / `$select` / `$search` /
   * `$searchFields` / `$expand` / `$top` / `$skip`), so both paths feed one
   * reader. `$top`/`$skip` may be present and are ignored: the fan-out windows
   * the replay itself.
   *
   * Why a prop rather than a fallback inside the grid (objectui#4501): the
   * cross-page "select all N matching" escalation re-issues the view's query to
   * collect the whole match set, and the query has to come from whichever side
   * owns the fetch. Under external pagination that is the host, and the grid's
   * own ref is either empty or stale — replaying it asked the server for the
   * WHOLE OBJECT (no `$filter`) and handed up to 5000 unmatched records to a
   * destructive executor. A grid-side `?? {}` default is what produced that,
   * which is why the missing case is not defaulted but REFUSED: with no params
   * for the current data path the escalation is not offered at all (see
   * `bulkFanoutParams` in the component body).
   *
   * A changed value is also the host's query-change signal: it resets the
   * escalation, mirroring the `setSelectAllMatching(false)` the internal loader
   * runs next to its own `lastFindParamsRef` write. Compared by CONTENT, so a
   * host re-render that rebuilds an equal object does not drop the user's
   * escalation.
   */
  findParams?: Record<string, unknown> | null;
}
