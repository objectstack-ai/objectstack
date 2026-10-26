/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useMemo, useCallback } from 'react';
import type { GroupingConfig } from '@object-ui/types';
import { deriveColumnSummary, type ListViewGroupHeaderRow } from '@objectstack/spec/ui';

/** Supported aggregation function types. */
export type AggregationType = 'sum' | 'count' | 'avg' | 'min' | 'max' | 'count_distinct';

/**
 * Describes a single aggregation to compute per group — one entry of
 * `ObjectGridSchema.aggregations`, drawn in that group's header.
 *
 * Not named `AggregationConfig`: `@object-ui/types` publishes that name for
 * the query-AST aggregation `DriverQueryConfig.aggregations` carries
 * (`function`, `alias`, `distinct`, `separator`), which `@object-ui/core`'s
 * `QueryASTBuilder` compiles. The two share only `field`, so this one carries
 * the narrower name (objectui#6349, batch 7).
 */
export interface GroupAggregationConfig {
  /** The field to aggregate. */
  field: string;
  /** The aggregation function. */
  type: AggregationType;
}

/** Result of a computed aggregation for a group. */
export interface AggregationResult {
  /** The field that was aggregated. */
  field: string;
  /** The aggregation function used. */
  type: AggregationType;
  /**
   * The computed value. `null` only on a server-grouped grid, where it is what
   * the aggregate itself answered (`avg` / `min` / `max` over no values) —
   * shown as a dash rather than invented as `0`.
   */
  value: number | null;
}

export interface GroupEntry {
  /** Composite key identifying this group (unique across all levels) */
  key: string;
  /** Display label for the group header (current level only) */
  label: string;
  /** Field name this group is bucketed by */
  field: string;
  /** Nesting depth (0 = top-level) */
  depth: number;
  /**
   * Rows belonging to this group (flattened across subgroups). Empty on a
   * server-grouped grid: the rows there are PAGED per group by the grid,
   * which holds each open group's current page — `count` is the group's size.
   */
  rows: any[];
  /**
   * The group's size. On a server-grouped grid this is the header query's
   * `count` — the group's TOTAL row count, a property of the query rather than
   * of any page (objectui#7189). Grouping rows the grid holds whole, it is
   * `rows.length`.
   */
  count: number;
  /**
   * The raw key of every level from the outermost down to this group, by
   * field name — what the group's own row query is compiled from. `null` is
   * the empty group's key.
   */
  keyValues: Record<string, unknown>;
  /** Whether the group section is collapsed */
  collapsed: boolean;
  /** Computed aggregations for this group (empty when no aggregations configured). */
  aggregations: AggregationResult[];
  /**
   * Nested subgroups for the next grouping field.
   *
   * Empty array (not undefined) when this is the deepest level so consumers
   * can switch on `subgroups.length` to decide whether to render a child
   * `GroupRow` or the data table.
   */
  subgroups: GroupEntry[];
}

export interface UseGroupedDataResult {
  /** Grouped entries (empty when grouping is not configured) */
  groups: GroupEntry[];
  /** Whether grouping is active */
  isGrouped: boolean;
  /** Toggle the collapsed state of a group by its key */
  toggleGroup: (key: string) => void;
}

/**
 * Extract a stable identity key from a value. For lookup / master_detail
 * fields the cell contains an expanded object (e.g. `{ id, name, ... }`); we
 * key off `id` so different referenced records produce distinct groups even
 * when they happen to share the same display name. Plain primitives are
 * stringified directly.
 */
function extractValueKey(value: any): string {
  if (value === undefined || value === null || value === '') return '';
  if (Array.isArray(value)) {
    return value.map((v) => extractValueKey(v)).join('|');
  }
  if (typeof value === 'object') {
    const id = (value as any).id ?? (value as any)._id ?? (value as any).pk ?? (value as any).value;
    if (id !== undefined && id !== null && id !== '') return String(id);
    const label = (value as any).name ?? (value as any).label ?? (value as any).title;
    if (label !== undefined && label !== null && label !== '') return String(label);
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

/**
 * Build a value-only key segment for a single grouping field. Used to compose
 * stable composite keys across nesting levels.
 */
function buildSegmentKey(row: Record<string, any>, field: string): string {
  return extractValueKey(row[field]);
}

/**
 * Optional per-field value formatter. Returning `undefined` falls back to the
 * default stringification, so resolvers can opt out for individual values
 * (e.g. unknown select values).
 */
export type GroupValueFormatter = (field: string, value: any) => string | undefined;

/**
 * Build a human-readable label for a single grouping field value.
 *
 * When a `formatValue` resolver is supplied, it is consulted first so callers
 * can map raw values (e.g. select option codes, booleans) to display labels.
 */
function buildSegmentLabel(
  value: any,
  field: string,
  formatValue?: GroupValueFormatter,
): string {
  if (value === undefined || value === null || value === '') return '(empty)';
  if (formatValue) {
    const formatted = formatValue(field, value);
    if (formatted !== undefined && formatted !== '') return formatted;
  }
  if (Array.isArray(value)) {
    const joined = value
      .map((v) => {
        if (formatValue) {
          const f2 = formatValue(field, v);
          if (f2 !== undefined && f2 !== '') return f2;
        }
        return buildSegmentLabel(v, field);
      })
      .join(', ');
    return joined || '(empty)';
  }
  // Lookup / master_detail fields: the cell is an expanded object such as
  // `{ id, name, ... }`. Stringifying directly produces "[object Object]",
  // so prefer common display fields, falling back to the id.
  if (typeof value === 'object') {
    const label =
      (value as any).name ??
      (value as any).label ??
      (value as any).title ??
      (value as any).display_name ??
      (value as any).displayName ??
      (value as any).fullName ??
      (value as any).full_name;
    if (label !== undefined && label !== null && label !== '') return String(label);
    const id = (value as any).id ?? (value as any)._id ?? (value as any).pk;
    if (id !== undefined && id !== null && id !== '') return String(id);
    return '(empty)';
  }
  return String(value);
}

/**
 * Compute aggregation results for a set of rows.
 */
function computeAggregations(
  rows: any[],
  configs: GroupAggregationConfig[],
): AggregationResult[] {
  return configs.map(({ field, type }) => {
    if (type === 'count_distinct') {
      const set = new Set<unknown>();
      for (const r of rows) {
        const v = r[field];
        if (v != null && v !== '') set.add(v);
      }
      return { field, type, value: set.size };
    }
    if (type === 'count') {
      // count includes nulls (row count for the bucket).
      return { field, type, value: rows.length };
    }
    const nums = rows
      .map((r) => Number(r[field]))
      .filter((n) => Number.isFinite(n));

    let value: number;
    switch (type) {
      case 'sum':
        value = nums.reduce((a, b) => a + b, 0);
        break;
      case 'avg':
        value = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        break;
      case 'min':
        value = nums.length > 0 ? Math.min(...nums) : 0;
        break;
      case 'max':
        value = nums.length > 0 ? Math.max(...nums) : 0;
        break;
      default:
        value = 0;
    }

    return { field, type, value };
  });
}

/**
 * Compare function that respects per-field sort order.
 */
function compareGroups(a: string, b: string, order: 'asc' | 'desc'): number {
  const cmp = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return order === 'desc' ? -cmp : cmp;
}

/**
 * Per grouping field, the field's DECLARED option order (objectui#11809):
 * `field → { key → position }`, each rank map as `@object-ui/core`'s
 * `buildCategoryRank(buildCategoryOrder(options))` builds it from the object
 * field's `options` — the ONE reading of a picklist's order the funnel already
 * uses. A field absent here has no option order and keeps label order.
 *
 * A package-internal hand-off: `ObjectGrid` holds the object definition and
 * builds it; the published {@link useGroupedData} carries none.
 */
export type GroupOptionRanks = ReadonlyMap<string, ReadonlyMap<string, number>>;

/** What one group is ordered by. */
interface SortableGroup {
  /** The group's value key — `''` is the empty group. */
  segment: string;
  /** The group's raw stored value (an array for a multi-value field). */
  raw: unknown;
  /** The header label, for the label-order arms. */
  label: string;
}

/**
 * A group's place in its field's declared option order: one position per
 * stored value (a multi-value key ranks as the tuple of its members), or
 * `null` when any member is not a declared option.
 */
function optionRankOf(raw: unknown, ranks: ReadonlyMap<string, number>): number[] | null {
  const members = Array.isArray(raw) ? raw : [raw];
  if (members.length === 0) return null;
  const out: number[] = [];
  for (const member of members) {
    const rank = ranks.get(extractValueKey(member));
    if (rank === undefined) return null;
    out.push(rank);
  }
  return out;
}

/**
 * The group order for a field (objectui#11809). With a declared option order:
 * the options in that order (reversed for `desc`), then any value the options
 * do not declare, by label, then the empty group — empty and unknown values
 * sit last in both directions. Without one: label order, exactly as before.
 */
function compareGroupEntries(
  a: SortableGroup,
  b: SortableGroup,
  order: 'asc' | 'desc',
  ranks: ReadonlyMap<string, number> | undefined,
): number {
  if (!ranks) return compareGroups(a.label, b.label, order);
  const aEmpty = a.segment === '';
  const bEmpty = b.segment === '';
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  const aRank = optionRankOf(a.raw, ranks);
  const bRank = optionRankOf(b.raw, ranks);
  if (aRank && bRank) {
    const shared = Math.min(aRank.length, bRank.length);
    let cmp = 0;
    for (let i = 0; i < shared && cmp === 0; i++) cmp = aRank[i] - bRank[i];
    if (cmp === 0) cmp = aRank.length - bRank.length;
    return order === 'desc' ? -cmp : cmp;
  }
  if (aRank || bRank) return aRank ? -1 : 1;
  return compareGroups(a.label, b.label, order);
}

/**
 * One entry of the spec's `grouping.fields[]` as AUTHORED — `field` plus the
 * optional `order` / `collapsed`.
 *
 * ⚠️ NOT the same type as `@object-ui/components`' `GroupingFieldEntry`, which
 * is the grouping EDITOR's fully-populated value shape and requires `order`
 * and `collapsed`. This one is `z.input` of the spec schema, where both carry
 * defaults and are therefore optional, so the two are structurally different
 * and each keeps its own name (objectui#6273 — one authority per exported
 * name; a shared spelling for two shapes is the collision that gate exists to
 * catch).
 */
export type UsableGroupingField = NonNullable<GroupingConfig['fields']>[number];

/**
 * The `grouping.fields[]` entries a grid can actually group by (objectui#7217).
 *
 * ## Why this exists
 *
 * `grouping` is authored JSON and reaches the renderer unparsed — `ObjectGrid`
 * reads `schema.grouping` straight off its props and `@object-ui/core`'s
 * `validateSchema` is structural and never looks at the key. A `null` hole in
 * the array (a trailing comma, a sparse generator, an agent-written block) was
 * therefore dereferenced twice with no guard: once by `ObjectGrid`'s
 * `groupValueFormatter` memo and once by this hook's `buildLevel`. Both threw
 * `TypeError: Cannot read properties of null (reading 'field')` and took the
 * whole grid down during render.
 *
 * ## The admission rule is the harvester's, deliberately
 *
 * An entry is usable when it is an object carrying a non-empty string `field`
 * — exactly the entries `collectGroupingFieldRefs` (`@object-ui/core`) harvests
 * into the projection. Keeping the two sets equal is the point: an entry the
 * grid grouped by but the projection ignored would be fetched as `undefined`
 * on every row and bucket every record into one `(empty)` group, which is the
 * silent wrong answer objectui#7179 closed. This is a defensive normalizer,
 * NOT a lenient alias — no off-spec spelling is taught to mean anything here;
 * unusable entries are dropped, never coerced.
 *
 * ## Dropping the entry, not the grouping
 *
 * One bad entry must not flatten a working grouped view: the usable entries
 * still group, at the levels they still occupy.
 *
 * @param fields - `grouping.fields` in any authored state.
 * @returns The usable entries, in order, with their `order` / `collapsed`
 *   intact — the harvester answers with field NAMES, which is why this cannot
 *   simply route through it.
 */
export function usableGroupingFields(fields: unknown): UsableGroupingField[] {
  if (!Array.isArray(fields)) return [];
  return fields.filter((entry): entry is UsableGroupingField => {
    if (entry === null || typeof entry !== 'object') return false;
    const name = (entry as { field?: unknown }).field;
    return typeof name === 'string' && name.trim() !== '';
  });
}

/**
 * The server's answer for a grouped grid that owns its fetch (objectui#7189):
 * the group set and every header number, as the group header query answered
 * them. The rows inside each group are paged by the grid itself, per group,
 * so they are not part of this tree.
 */
export interface ServerGroupSource {
  /**
   * Index `d` holds the header rows of the depth-`d + 1` query — one row per
   * group at that level, every grouped field under its own name holding the
   * RAW stored value (`null` for the empty group), and `count`.
   */
  headers: ReadonlyArray<ReadonlyArray<ListViewGroupHeaderRow>>;
  /**
   * Display labels for keys that are not their own label (a lookup key is the
   * referenced record's id), per field, by the raw key.
   */
  keyLabels?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * The grid's own `aggregations` vocabulary → the spec's `ColumnSummary`
 * members, so a per-group number rides the header query the spec compiles
 * (`compileListViewGroupQuery`) and is read back through the spec's
 * `deriveColumnSummary` — one mapping, both directions. `count` maps to the
 * summary that RIDES the group count (`COUNT(*)`), which is what this key has
 * always meant (a group's row count, whatever `field` names);
 * `count_distinct` is the spec's `count_unique`.
 */
const SERVER_SUMMARY: Readonly<Record<AggregationType, 'sum' | 'count' | 'avg' | 'min' | 'max' | 'count_unique'>> = {
  sum: 'sum',
  count: 'count',
  avg: 'avg',
  min: 'min',
  max: 'max',
  count_distinct: 'count_unique',
};

/** The spec summary member one grid aggregation type reads back through. */
export function serverSummaryOf(type: AggregationType): (typeof SERVER_SUMMARY)[AggregationType] | undefined {
  return Object.prototype.hasOwnProperty.call(SERVER_SUMMARY, type) ? SERVER_SUMMARY[type] : undefined;
}

/**
 * Read the grid's per-group aggregations off ONE header row. A configured
 * aggregation the header query carried no column for is left out rather than
 * reported as a number nobody computed.
 */
function readServerAggregations(
  row: ListViewGroupHeaderRow,
  configs: GroupAggregationConfig[] | undefined,
): AggregationResult[] {
  if (!configs || configs.length === 0) return [];
  const out: AggregationResult[] = [];
  for (const { field, type } of configs) {
    const summary = serverSummaryOf(type);
    if (!summary || typeof field !== 'string' || field === '') continue;
    const value = deriveColumnSummary(row, summary, field);
    if (value === undefined) continue;
    out.push({ field, type, value: value === null ? null : Number(value) });
  }
  return out;
}

/** Two raw group keys name the same group (a stored value, or both empty). */
function sameGroupKey(a: unknown, b: unknown): boolean {
  const aEmpty = a === null || a === undefined;
  const bEmpty = b === null || b === undefined;
  if (aEmpty || bEmpty) return aEmpty && bEmpty;
  return a === b || String(a) === String(b);
}

/**
 * Hook that groups a grid's rows by the fields specified in GroupingConfig.
 *
 * Supports multi-level grouping, per-field sort order, and per-field default
 * collapsed state.  Collapse state is managed internally so the consumer only
 * needs to wire `toggleGroup` to the UI.
 *
 * Two sources, one tree (objectui#7189, maintainer ruling A):
 *
 *   - `server` given — the grid owns its fetch, and the group set, every
 *     count and every aggregation come from the server's header query. `data`
 *     is not read: grouping a fetched page is exactly the answer the ruling
 *     retired, since a group whose rows all fall past the page would not
 *     appear at all and every count would be a page slice.
 *   - `server` absent — the rows in `data` are grouped here. That is exact
 *     when they are every row, which is what the grid takes rows a host hands
 *     it to be (inline rows, a host's whole result set). A grid that fetches
 *     its own rows never groups them here: over a data source with no header
 *     query it refuses grouping instead (objectui#10881, ruling F). A host
 *     that DECLARES the rows one page of more (`manualPagination`,
 *     `onPageChange` and a larger `rowCount`) is refused too; one that hands in a window without
 *     saying so gets that window grouped. `ListView` hands a grouped grid no
 *     window over a source that answers the header query, a toolbar search
 *     included: it hands the term instead (objectui#11021).
 *
 * @param config        - GroupingConfig from the grid schema (optional)
 * @param data          - flat data rows (grouped only when `server` is absent)
 * @param aggregations  - optional aggregation definitions to compute per group
 * @param formatValue   - optional per-field formatter that maps raw values to
 *                        display labels (e.g. resolves select option codes
 *                        to their human-readable labels)
 * @param server        - the server's header rows and per-group row pages
 */
export function useGroupedData(
  config: GroupingConfig | undefined,
  data: any[],
  aggregations?: GroupAggregationConfig[],
  formatValue?: GroupValueFormatter,
  server?: ServerGroupSource,
): UseGroupedDataResult {
  return useGroupedDataInOptionOrder(config, data, aggregations, formatValue, server, undefined);
}

/**
 * {@link useGroupedData}, with each select grouping field's groups in the
 * field's declared option order (objectui#11809) — what `ObjectGrid`, which
 * holds the object definition, calls. A field `optionRanks` does not name keeps
 * label order.
 *
 * @param optionRanks - per grouping field, its declared option order
 */
export function useGroupedDataInOptionOrder(
  config: GroupingConfig | undefined,
  data: any[],
  aggregations: GroupAggregationConfig[] | undefined,
  formatValue: GroupValueFormatter | undefined,
  server: ServerGroupSource | undefined,
  optionRanks: GroupOptionRanks | undefined,
): UseGroupedDataResult {
  // [objectui#7217] The SAME normalized list `ObjectGrid`'s formatter memo
  // reads. Memoized on the raw array rather than on `config`: hosts rebuild
  // the `{ grouping }` object literal every render, so keying on `config`
  // would hand `groups` a fresh array identity on every render.
  const rawFields = config?.fields;
  const fields = useMemo(() => usableGroupingFields(rawFields), [rawFields]);
  const isGrouped = fields.length > 0;

  // Track which group keys have been explicitly toggled by the user.
  const [toggledKeys, setToggledKeys] = useState<Record<string, boolean>>({});

  const groups: GroupEntry[] = useMemo(() => {
    if (!isGrouped) return [];

    if (server) {
      /**
       * One level of the server tree: the depth-`depth` header rows whose
       * outer keys are `prefix`, each becoming one group whose `count` and
       * aggregations are the row's own — never recomputed from rows.
       */
      const buildServerLevel = (
        depth: number,
        parentKey: string,
        prefix: Record<string, unknown>,
      ): GroupEntry[] => {
        if (depth >= fields.length) return [];
        const f = fields[depth];
        const outer = fields.slice(0, depth);
        const rowsAtDepth = (server.headers[depth] ?? []).filter((row) =>
          outer.every((pf) => sameGroupKey(row[pf.field], prefix[pf.field])),
        );
        const entries = rowsAtDepth.map((row) => {
          const raw = row[f.field] ?? null;
          const resolved = raw === null ? undefined : server.keyLabels?.[f.field]?.[String(raw)];
          return {
            row,
            raw,
            segment: extractValueKey(raw),
            label: resolved ?? buildSegmentLabel(raw, f.field, formatValue),
          };
        });
        const order = f.order ?? 'asc';
        const ranks = optionRanks?.get(f.field);
        entries.sort((a, b) => compareGroupEntries(a, b, order, ranks));

        return entries.map(({ row, raw, segment, label }) => {
          const compositeKey = parentKey ? `${parentKey}__${depth}:${segment}` : `${depth}:${segment}`;
          const collapsedDefault = !!f.collapsed;
          const collapsed =
            compositeKey in toggledKeys ? toggledKeys[compositeKey] : collapsedDefault;
          const keyValues = { ...prefix, [f.field]: raw };
          const isLeaf = depth + 1 >= fields.length;
          const count = Number(row.count);
          return {
            key: compositeKey,
            label,
            field: f.field,
            depth,
            rows: [],
            count: Number.isFinite(count) ? count : 0,
            keyValues,
            collapsed,
            aggregations: readServerAggregations(row, aggregations),
            subgroups: isLeaf ? [] : buildServerLevel(depth + 1, compositeKey, keyValues),
          };
        });
      };
      return buildServerLevel(0, '', {});
    }

    /**
     * Recursively build a tree of groups for the slice of rows at the current
     * nesting depth. Each level partitions rows by `fields[depth]` and then
     * recurses into the next field.  When all fields are consumed we stop and
     * the rows attached to the leaf entry become the data table input.
     */
    const buildLevel = (
      rowsAtLevel: any[],
      depth: number,
      parentKey: string,
      prefix: Record<string, unknown>,
    ): GroupEntry[] => {
      if (depth >= fields.length) return [];
      const f = fields[depth];

      const map = new Map<string, { label: string; rows: any[] }>();
      const keyOrder: string[] = [];

      for (const row of rowsAtLevel) {
        const segment = buildSegmentKey(row, f.field);
        if (!map.has(segment)) {
          map.set(segment, {
            label: buildSegmentLabel(row[f.field], f.field, formatValue),
            rows: [],
          });
          keyOrder.push(segment);
        }
        map.get(segment)!.rows.push(row);
      }

      const order = f.order ?? 'asc';
      const ranks = optionRanks?.get(f.field);
      const sortableOf = (segment: string): SortableGroup => {
        const entry = map.get(segment);
        return { segment, raw: entry?.rows[0]?.[f.field], label: entry?.label ?? segment };
      };
      keyOrder.sort((a, b) => compareGroupEntries(sortableOf(a), sortableOf(b), order, ranks));

      return keyOrder.map((segment) => {
        const entry = map.get(segment)!;
        const compositeKey = parentKey ? `${parentKey}__${depth}:${segment}` : `${depth}:${segment}`;
        const collapsedDefault = !!f.collapsed;
        const collapsed =
          compositeKey in toggledKeys ? toggledKeys[compositeKey] : collapsedDefault;
        const agg = aggregations && aggregations.length > 0
          ? computeAggregations(entry.rows, aggregations)
          : [];
        const keyValues = { ...prefix, [f.field]: entry.rows[0]?.[f.field] ?? null };
        const subgroups = depth + 1 < fields.length
          ? buildLevel(entry.rows, depth + 1, compositeKey, keyValues)
          : [];
        return {
          key: compositeKey,
          label: entry.label,
          field: f.field,
          depth,
          rows: entry.rows,
          count: entry.rows.length,
          keyValues,
          collapsed,
          aggregations: agg,
          subgroups,
        };
      });
    };

    return buildLevel(data, 0, '', {});
  }, [data, fields, isGrouped, toggledKeys, aggregations, formatValue, server, optionRanks]);

  const toggleGroup = useCallback((key: string) => {
    setToggledKeys((prev) => {
      // Determine the per-level default: the leading "<depth>:..." segment of
      // the composite key tells us which grouping field (and its `collapsed`
      // flag) to honor when the user has not explicitly toggled this group.
      const lastSegment = key.split('__').pop() || '';
      const depthMatch = /^(\d+):/.exec(lastSegment);
      const depth = depthMatch ? Number(depthMatch[1]) : 0;
      const fieldDefault = !!fields[depth]?.collapsed;
      return {
        ...prev,
        [key]: prev[key] !== undefined ? !prev[key] : !fieldDefault,
      };
    });
  }, [fields]);

  return { groups, isGrouped, toggleGroup };
}
