/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { composeDrillFilter, isEmptyValue } from '@object-ui/core';
import type { DataSource } from '@object-ui/types';
import { laneKeyOf } from './kanbanReferenceLanes';

/**
 * objectstack#36520 — a lane's `sum`, `avg`, `min` or `max` statistic is a
 * property of the QUERY, not of the cards the lane has loaded.
 *
 * ## Why
 *
 * A lane the board pages for itself loads 50 records at a time
 * (`KANBAN_LANE_PAGE_SIZE`), and a board of one query loads up to its row cap,
 * so a statistic added up over the loaded cards is a figure over part of the
 * lane. A partial sum is no bound (a value may be negative), and an average, a
 * minimum or a maximum over part of a lane is not even that. AGENTS.md Prime
 * Directive 5 (SQL first): the figure is computed in the query, never fetched
 * and then added.
 *
 * ## The one read
 *
 * ONE grouped aggregate over the board's own query: the board's filter, its
 * host's search pair, grouped by the lane field, with the statistic as the one
 * aggregation (`avg` asks `COUNT(field)` beside it, to weigh the lanes it
 * folds). It rides the data door a grouped list view's headers and a paged
 * grid's footer already ride, `DataSource.queryGroupHeaders`
 * (`POST /data/:object/query`, routed to `engine.aggregate`). That door takes
 * the query verbatim and never degrades to a client-side reduction, and on the
 * platform it runs under the reader's permissions as `find` does: the row
 * filter of the reader's sharing and row rules, and a refusal of an aggregate
 * over a field the reader may not read (`403`). A refusal, a source without the
 * door, or a filter this read cannot lower draws no figure — ⛔ never one added
 * up over the loaded cards instead.
 *
 * ## The lane each group lands in
 *
 * The lanes key the way the board keys a card (`laneKeyOf`: a reference by its
 * foreign key, anything else as a string). A board whose lanes are fixed (the
 * declared lanes, else the lane field's options) puts a group whose key is no
 * lane, and the group of records with no value, in the trailing
 * "Uncategorized" lane, and folds them there: a sum adds, a minimum and a
 * maximum compare, an average weighs each group's average by its count of
 * filled values. A lane that pages itself matches its key exactly, as its own
 * lane query does; a board of one query matches it without case, as it buckets
 * its cards (`index.tsx`). A board whose lanes come from the data draws one
 * lane per key, so only the empty key is "Uncategorized".
 *
 * ## A partial answer
 *
 * The door cuts a grouped read to the deployment's default page size and says
 * so (`hasMore`). A cut answer draws no figure for any lane
 * ({@link readLaneStatistic}, objectstack#36870).
 *
 * ## A board its host hands its cards to
 *
 * Such a board asks the same read when its host also hands it the query those
 * cards came from ({@link KanbanLaneStatisticRequest}, objectstack#36871): the
 * node's `filter` is then the host's effective filter, and the request carries
 * the host's search pair and refresh signal. `ListView` does so for the board
 * whose lanes it does not know before the query (lanes over a lookup field),
 * to which it hands one page of rows: the figures cover every record of each
 * lane, not that page. A host that hands cards without its query (rows handed
 * in whole) gets a `sum` added up over them and no other figure.
 *
 * objectstack#37327 — the same read answers that board's other lane figures,
 * which a page cannot: each lane's record count ({@link LANE_COUNT_ALIAS}),
 * which its header and a foot `count` write, and the `SUM` of the view's
 * `summarizeField`, which its header total writes. Its group keys are the
 * lanes, so a lane whose records all sit past the page is drawn too. The read
 * is asked on that board whether or not the view draws a statistic; it is
 * still one grouped aggregate per board. A count the read cannot give (no
 * door, a refusal, a partial answer) is the page's, marked `+`.
 */

/**
 * The host's query, for the lane read of a board it hands its cards to
 * (objectstack#36871): the search pair its own fetch sent and the signal that
 * moves when it refetches. The filter is the node's own `filter`, which the
 * host sets to the effective filter of that fetch.
 *
 * A HOST channel, never an authoring key.
 */
export interface KanbanLaneStatisticRequest {
  /** The host's search term (ADR-0061), sent as the read's `search`. */
  search?: string;
  /** The fields the term may match, sent beside it. */
  searchFields?: readonly string[];
  /** Moves when the host refetches its rows: the read is asked again. */
  reloadKey?: string | number;
}

/** The lane statistics answered by the server lane read. */
export type KanbanLaneAggregate = 'sum' | 'avg' | 'min' | 'max';

const LANE_AGGREGATES: ReadonlySet<string> = new Set<KanbanLaneAggregate>(['sum', 'avg', 'min', 'max']);

/** Is `type` a statistic the server lane read answers? */
export function isLaneAggregate(type: unknown): type is KanbanLaneAggregate {
  return typeof type === 'string' && LANE_AGGREGATES.has(type);
}

/** The compiled lane read: what `DataSource.queryGroupHeaders` takes. */
export type LaneStatisticQuery = Parameters<NonNullable<DataSource['queryGroupHeaders']>>[1];

/** A lane's figure: a number, a stored value (a date's `min`), or `null` when there is none. */
export type LaneFigure = number | string | null;

/** The column a lane read answers its statistic under. */
export function laneStatisticAlias(type: KanbanLaneAggregate, field: string): string {
  return `${type}_${field}`;
}

/** The column an `avg` lane read answers its count of filled values under. */
export function laneWeightAlias(field: string): string {
  return `count_${field}`;
}

export interface LaneStatisticQueryInput {
  laneField: string;
  type: KanbanLaneAggregate;
  field: string;
  /** The board's own filter, in the ObjectQL AST the lane queries send as `$filter`. */
  filter: unknown;
  /** The host's search term and fields, as the lane queries send them. */
  search?: string;
  searchFields?: readonly string[];
}

/**
 * The column a host-handed board's lane read answers each lane's record count
 * under: `COUNT(*)` (objectstack#37327).
 */
export const LANE_COUNT_ALIAS = 'count';

/**
 * The lane read of a board its host hands ONE PAGE of its query to
 * (objectstack#37327): the view's statistic when it draws one, beside each
 * lane's record count and, for the header total, the `SUM` of the view's
 * `summarizeField`. Still ONE grouped aggregate per board: the count and the
 * total ride the read the statistic already asks, never a query per lane.
 */
export interface LaneReadQueryInput {
  laneField: string;
  /** The view's lane statistic, when the board draws one. */
  statistic?: { type: KanbanLaneAggregate; field: string };
  /** Ask each lane's record count, under {@link LANE_COUNT_ALIAS}. */
  laneCount?: boolean;
  /** Ask each lane's `SUM` of this field, under `laneStatisticAlias('sum', totalField)`. */
  totalField?: string;
  /** The board's own filter, in the ObjectQL AST the lane queries send as `$filter`. */
  filter: unknown;
  /** The host's search term and fields, as the lane queries send them. */
  search?: string;
  searchFields?: readonly string[];
}

/**
 * The lane read for the board's query, or `null` when it cannot be asked as
 * the same question: a filter that does not lower to a condition (dropped, it
 * would total the unfiltered lanes), or an alias that would land on the lane
 * field's own column.
 */
export function compileLaneStatisticQuery(input: LaneStatisticQueryInput): LaneStatisticQuery | null {
  const { type, field, ...rest } = input;
  if (!field) return null;
  return compileLaneReadQuery({ ...rest, statistic: { type, field } });
}

/**
 * The general lane read ({@link LaneReadQueryInput}), or `null` when it asks
 * nothing or cannot be asked as the same question (see
 * {@link compileLaneStatisticQuery}). The statistic's aggregation comes first,
 * so a read that asks only the statistic is the one #36520 compiled.
 */
export function compileLaneReadQuery(input: LaneReadQueryInput): LaneStatisticQuery | null {
  const { laneField, statistic, laneCount, totalField, filter, search, searchFields } = input;
  if (!laneField) return null;
  const aggregations: Array<{ function: 'count' | KanbanLaneAggregate; field?: string; alias: string }> = [];
  const asked = new Set<string>();
  const ask = (node: { function: 'count' | KanbanLaneAggregate; field?: string; alias: string }) => {
    if (asked.has(node.alias)) return;
    asked.add(node.alias);
    aggregations.push(node);
  };
  if (statistic) {
    if (!statistic.field) return null;
    ask({ function: statistic.type, field: statistic.field, alias: laneStatisticAlias(statistic.type, statistic.field) });
    if (statistic.type === 'avg') ask({ function: 'count', field: statistic.field, alias: laneWeightAlias(statistic.field) });
  }
  if (laneCount) ask({ function: 'count', alias: LANE_COUNT_ALIAS });
  if (totalField) ask({ function: 'sum', field: totalField, alias: laneStatisticAlias('sum', totalField) });
  if (aggregations.length === 0 || asked.has(laneField)) return null;

  let where: Record<string, unknown> | undefined;
  if (filter !== undefined && filter !== null) {
    let lowered: unknown;
    try {
      // The spec's one lowering sink between the AST the lane queries send
      // and the condition object an aggregate's `where` takes, with no second
      // filter to compose.
      lowered = composeDrillFilter(filter, undefined);
    } catch {
      return null;
    }
    if (lowered !== undefined) {
      if (!lowered || typeof lowered !== 'object' || Array.isArray(lowered)) return null;
      where = lowered as Record<string, unknown>;
    }
  }

  const term = typeof search === 'string' ? search.trim() : '';
  return {
    ...(where ? { where } : {}),
    ...(term
      ? { search: term, ...(searchFields && searchFields.length > 0 ? { searchFields: [...searchFields] } : {}) }
      : {}),
    groupBy: [laneField],
    aggregations,
  } as LaneStatisticQuery;
}

export interface LaneFigureReading {
  laneField: string;
  type: KanbanLaneAggregate;
  field: string;
  /** The board's fixed lanes, or `null` when its lanes come from the data. */
  laneIds: readonly string[] | null;
  /** Match a group key to a fixed lane without case (a board of one query). */
  foldCase: boolean;
  /** The trailing lane's id (`KANBAN_UNCOLUMNED_ID`). */
  uncolumnedId: string;
  /**
   * The column to read in place of `laneStatisticAlias(type, field)`: a lane's
   * record count reads {@link LANE_COUNT_ALIAS}, folded as a `sum`
   * (objectstack#37327).
   */
  alias?: string;
}

/** A number from an aggregate cell; a numeric string (a SQL `NUMERIC`) reads as its number. */
function numberOf(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

/** One group's contribution to its lane. */
interface Part {
  value: unknown;
  weight: number | null;
}

function foldParts(parts: readonly Part[], type: KanbanLaneAggregate): LaneFigure {
  if (type === 'sum') {
    let total = 0;
    for (const part of parts) {
      if (isEmptyValue(part.value)) continue;
      const value = numberOf(part.value);
      if (value === null) return null;
      total += value;
    }
    return total;
  }
  if (type === 'avg') {
    let weighted = 0;
    let filled = 0;
    for (const part of parts) {
      if (isEmptyValue(part.value)) continue;
      const value = numberOf(part.value);
      // A lane of one group needs no weight: its average is the server's.
      if (value === null) return null;
      if (parts.length === 1) return value;
      if (part.weight === null) return null;
      weighted += value * part.weight;
      filled += part.weight;
    }
    return filled === 0 ? null : weighted / filled;
  }
  // `min` / `max`: numbers compare as numbers, a stored value (a date)
  // compares as the string the server answered, ISO order.
  const present = parts.map((part) => part.value).filter((value) => !isEmptyValue(value));
  if (present.length === 0) return null;
  const numbers = present.map(numberOf);
  if (numbers.every((value): value is number => value !== null)) {
    return type === 'min' ? Math.min(...numbers) : Math.max(...numbers);
  }
  if (!present.every((value) => typeof value === 'string')) return null;
  const strings = [...(present as string[])].sort();
  return type === 'min' ? strings[0] : strings[strings.length - 1];
}

/**
 * Each lane's figure from the lane read's answer, by lane id. A lane no group
 * answered for is read by {@link laneFigureOf}.
 */
export function readLaneFigures(rows: unknown, reading: LaneFigureReading): Record<string, LaneFigure> {
  const { laneField, type, field, laneIds, foldCase, uncolumnedId } = reading;
  const alias = reading.alias ?? laneStatisticAlias(type, field);
  const weight = laneWeightAlias(field);
  const byKey = new Map<string, string>();
  for (const id of laneIds ?? []) byKey.set(foldCase ? id.toLowerCase() : id, id);
  const parts = new Map<string, Part[]>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const key = laneKeyOf(record[laneField]);
    const lane = laneIds
      ? byKey.get(foldCase ? key.toLowerCase() : key) ?? uncolumnedId
      : key === '' ? uncolumnedId : key;
    const list = parts.get(lane) ?? [];
    list.push({ value: record[alias], weight: type === 'avg' ? numberOf(record[weight]) : null });
    parts.set(lane, list);
  }
  const figures: Record<string, LaneFigure> = Object.create(null);
  for (const [lane, list] of parts) figures[lane] = foldParts(list, type);
  return figures;
}

/**
 * Every lane's figure from the lane read's ANSWER, or `null` — no figure for
 * any lane — when the answer is partial (objectstack#36870).
 *
 * The grouped read can be cut: under a deployment's default page size the
 * door slices the group rows and answers `hasMore`, which
 * `DataSource.queryGroupHeaders` hands on as the answer's `hasMore`. A cut
 * answer is not every lane's groups: a lane that folds several groups (the
 * trailing "Uncategorized" lane) would total only the groups answered, and a
 * lane whose group was dropped would read as empty — `0` for a sum. Neither is
 * a figure the board can draw, and the answer does not say which lanes it cut,
 * so no lane draws one.
 */
export function readLaneStatistic(
  answer: unknown,
  reading: LaneFigureReading,
): Record<string, LaneFigure> | null {
  if (Array.isArray(answer) && (answer as { hasMore?: unknown }).hasMore === true) return null;
  return readLaneFigures(answer, reading);
}

/**
 * One lane's figure: what the read answered for it, else the figure of a lane
 * that holds no record — `0` for a sum, none for an average, a minimum or a
 * maximum.
 *
 * A lane the board knows holds records (`holdsRecords`: its count is above
 * zero) that no group answered for draws NO figure: the board's count and the
 * whole answer disagree (a write landed between the two reads), and a `0`
 * there would be a wrong figure in place of a missing one. A PARTIAL answer
 * never reaches here — {@link readLaneStatistic} answers no figures for it.
 */
export function laneFigureOf(
  figures: Readonly<Record<string, LaneFigure>>,
  laneId: string,
  type: KanbanLaneAggregate,
  holdsRecords: boolean,
): LaneFigure {
  if (Object.prototype.hasOwnProperty.call(figures, laneId)) return figures[laneId];
  if (holdsRecords) return null;
  return type === 'sum' ? 0 : null;
}

/** The reading of a lane read's answer, less the statistic it reads. */
export type LaneReading = Omit<LaneFigureReading, 'type' | 'field' | 'alias'>;

/**
 * Every lane's record count from a lane read that asked it
 * ({@link LANE_COUNT_ALIAS}, objectstack#37327), or `null` when the answer is
 * partial or a count is not a number: no lane then has a whole count.
 */
export function readLaneCounts(answer: unknown, reading: LaneReading): Record<string, number> | null {
  const figures = readLaneStatistic(answer, { ...reading, type: 'sum', field: '', alias: LANE_COUNT_ALIAS });
  if (!figures) return null;
  const counts: Record<string, number> = Object.create(null);
  for (const lane of Object.keys(figures)) {
    const value = figures[lane];
    if (typeof value !== 'number') return null;
    counts[lane] = value;
  }
  return counts;
}

/**
 * The lanes a lane read's answer names, in its order, for a board whose lanes
 * come from the data (objectstack#37327): one per non-empty key, as
 * `lanesFromRecords` keys a loaded record. `null` for a partial answer, which
 * does not name every lane.
 */
export function readLaneKeys(answer: unknown, laneField: string): string[] | null {
  if (!Array.isArray(answer) || (answer as { hasMore?: unknown }).hasMore === true) return null;
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of answer) {
    if (!row || typeof row !== 'object') continue;
    const key = laneKeyOf((row as Record<string, unknown>)[laneField]);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}
