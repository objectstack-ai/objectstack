/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createContext, useContext } from 'react';
import { extractRecords, mergeFilterNodes } from '@object-ui/core';

/**
 * A board that pages each LANE itself (objectui#12619).
 *
 * ## Why
 *
 * A board under a list view used to draw the rows the list fetched for its
 * grid: one page of the view (Rows per page 25), bucketed into lanes on the
 * client. Measured on HotCRM's 45 opportunities: 25 cards, the closed columns
 * at 0, and every lane count a count of that page. A lane is a query of its
 * own — the view's filter AND the lane value, in the view's order — so the
 * board asks it as one: the first {@link KANBAN_LANE_PAGE_SIZE} records of
 * each lane, the lane's count from the same answer (`QueryResult.total`), and a
 * "Load more" at the foot of a lane that holds more.
 *
 * ## Who asks for it
 *
 * The HOST, through `ObjectKanban`'s `lanePaging` prop, never the document: the
 * `object-kanban` node's `limit` is the row cap of the board's ONE query
 * ("Maximum number of records loaded onto the board"), and a board authored
 * with it keeps that query. `ListView` hands the request to the board it
 * mounts, with the toolbar search and its reload signal.
 *
 * ## The lanes are known before the query
 *
 * A lane query needs the lane values up front, so a board pages its lanes only
 * when it has them: its declared lanes, or the lane field's options. A board
 * whose lanes come from the data, or that draws swimlanes, keeps the one query.
 *
 * ## Records in no lane
 *
 * One more query asks for the records whose lane value is none of the lanes, or
 * empty (`KANBAN_UNCOLUMNED_ID`), so the trailing "Uncategorized" lane still
 * holds every record the lanes do not (#2792), paged the same way.
 */

/** How many records a lane asks for at a time. */
export const KANBAN_LANE_PAGE_SIZE = 50;

/**
 * What a host hands a board that should page its lanes. Every member is a
 * query input the host owns and the board's own document does not carry.
 */
export interface KanbanLanePagingRequest {
  /** The host's search term (ADR-0061), sent as `$search` on every lane query. */
  search?: string;
  /** The fields the term may match, sent as `$searchFields` beside it. */
  searchFields?: readonly string[];
  /** Moves when the host refreshes: every lane is asked again, at the depth it was loaded to. */
  reloadKey?: string | number;
}

/** One lane's paging state, as the board holds it. */
export interface KanbanLanePage {
  /** The server's count of the lane's records, `null` when the source answered none. */
  total: number | null;
  /** How many of the lane's records the server has handed the board. */
  loaded: number;
  /** Does the lane hold records the board has not loaded? */
  hasMore: boolean;
  /** Is a page of this lane on its way? */
  loading: boolean;
}

/** The channel from `ObjectKanban` to the lane headers and feet `KanbanImpl` draws. */
export interface KanbanLanePaging {
  /** Each paged lane's state, by lane id (`KANBAN_UNCOLUMNED_ID` included). */
  pages: Readonly<Record<string, KanbanLanePage>>;
  /** Ask for the next page of one lane. */
  loadMore: (laneId: string) => void;
}

/**
 * Package-private, like `KanbanColumnSummaryContext`, for the same reason: the
 * producer and the consumer sit either side of the board's `Suspense`/`lazy`
 * boundary, and nothing outside this package sets it. `null` (no provider) is
 * every board that does not page its lanes, whose headers stay as they were.
 */
export const KanbanLanePagingContext = createContext<KanbanLanePaging | null>(null);

/** Read the lane-paging channel above. */
export function useKanbanLanePaging(): KanbanLanePaging | null {
  return useContext(KanbanLanePagingContext);
}

/** The view's filter AND one lane's value: the records of that lane. */
export function laneQueryFilter(base: unknown, laneField: string, laneId: unknown): unknown {
  return mergeFilterNodes(base, [laneField, '=', laneId]);
}

/**
 * The view's filter AND "in no lane": a lane value that is none of `laneIds`,
 * or none at all. `nin` alone would leave the empty ones out, since a stored
 * `null` is not "not in" a list on a SQL backend.
 */
export function uncolumnedQueryFilter(base: unknown, laneField: string, laneIds: readonly unknown[]): unknown {
  return mergeFilterNodes(base, ['or', [laneField, 'nin', [...laneIds]], [laneField, 'is_null']]);
}

/**
 * One lane query's answer as a page: its records, and the lane's count when the
 * source answered one. `loadedBefore` is what the lane already held, for a
 * "Load more" page. Without a count, a full page is the only sign of more.
 */
export function readLanePage(
  result: unknown,
  loadedBefore: number,
  asked: number,
): { rows: any[]; page: KanbanLanePage } {
  const rows = extractRecords(result);
  const rawTotal = result && typeof result === 'object' ? (result as { total?: unknown }).total : undefined;
  const total = typeof rawTotal === 'number' && Number.isFinite(rawTotal) ? rawTotal : null;
  const loaded = loadedBefore + rows.length;
  return {
    rows,
    page: {
      total,
      loaded,
      hasMore: total !== null ? loaded < total : rows.length >= asked,
      loading: false,
    },
  };
}

/**
 * The number a paged lane's header shows, and whether it is a lower bound.
 *
 * `cards` is what the lane draws NOW. It moves from what the server handed the
 * lane (`loaded`) when a card is dragged in or out or deleted before the next
 * read, and the count moves with it, so the header agrees with the lane in
 * between. Without a server count the lane can say only what it holds, with a
 * `+` while it holds more.
 */
export function laneCount(page: KanbanLanePage, cards: number): { count: number; atLeast: boolean } {
  if (page.total === null) return { count: cards, atLeast: page.hasMore };
  return { count: Math.max(cards, page.total + (cards - page.loaded)), atLeast: false };
}
