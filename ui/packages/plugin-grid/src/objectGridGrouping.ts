/**
 * The grouping of `ObjectGrid` (`./ObjectGrid.tsx`): the date-family group
 * faces and their headings, the group value formatter, the server group headers
 * and row pages, and the grouped data the table draws, moved out of the
 * component verbatim (objectstack#25994, slice 6). Every input is passed in;
 * the component reads the returned values.
 */

import React, { useEffect } from 'react';
import type { ObjectGridSchema, DataSource, ListColumn } from '@object-ui/types';
import { parseFilterAST, type FilterCondition } from '@objectstack/spec/data';
import type { useSafeFieldLabel } from '@object-ui/react';
import { buildCategoryOrder, buildCategoryRank } from '@object-ui/core';
import { useDisplayLocale } from '@object-ui/i18n';
import type { GridCellFieldLike } from './cellRendererResolution';
import { temporalCellFaceOf, type TemporalCellFace } from './temporalCellFace';
import {
  useGroupedDataInOptionOrder, usableGroupingFields,
  type GroupAggregationConfig, type GroupOptionRanks, type ServerGroupSource, type TemporalAggregateFaces,
} from './useGroupedData';
import { groupSearchOf, useServerGroupHeaders, useServerGroupRows, type ServerGroupLeaf } from './useServerGrouping';
import { normalizeColumns } from './objectGridColumns';
import { honestGroupAggregations } from './recordCurrencyAggregates';
import type { useGridTranslation } from './objectGridTranslations';
import type { useObjectGridQueryInputs } from './objectGridQueryInputs';
import type { useObjectGridGroupingDecisions } from './objectGridGroupingDecisions';
import type { useObjectGridRowLoad } from './objectGridRowLoad';

type QueryInputs = ReturnType<typeof useObjectGridQueryInputs>;
type GroupingDecisions = ReturnType<typeof useObjectGridGroupingDecisions>;
type RowLoad = ReturnType<typeof useObjectGridRowLoad>;
/** What the grouping reads off an object field: its cell face and its options. */
type GroupingFieldDef = GridCellFieldLike & {
  type?: string;
  options?: Parameters<ReturnType<typeof useSafeFieldLabel>['translateOptions']>[2];
};

/**
 * The date-family face the cell of `field` paints in this grid: the authored
 * column's `type` over the object field's, with the object field's `format`
 * and `widget`, through the cells' one shared resolve.
 */
function gridTemporalFaceOf(
  field: string,
  cols: ReadonlyArray<string | ListColumn>,
  objectFields: Readonly<Record<string, GroupingFieldDef | undefined>> | undefined,
): TemporalCellFace | undefined {
  const objectDefField = objectFields?.[field];
  const colOverride = cols.find(
    (c): c is ListColumn => typeof c === 'object' && c !== null && c.field === field,
  );
  return temporalCellFaceOf({
    type: colOverride?.type || objectDefField?.type,
    format: objectDefField?.format,
    widget: objectDefField?.widget,
  });
}

/** Each aggregated field whose cell paints a date-family face, with that face, once. */
function temporalFacesOfAggregations(
  aggregations: readonly GroupAggregationConfig[] | undefined,
  cols: ReadonlyArray<string | ListColumn>,
  objectFields: Readonly<Record<string, GroupingFieldDef | undefined>> | undefined,
): Array<[string, TemporalCellFace]> {
  const out: Array<[string, TemporalCellFace]> = [];
  for (const agg of aggregations ?? []) {
    const field = agg?.field;
    if (typeof field !== 'string' || field === '' || out.some(([seen]) => seen === field)) continue;
    const face = gridTemporalFaceOf(field, cols, objectFields);
    if (face) out.push([field, face]);
  }
  return out;
}

export function useObjectGridGrouping({
  schema, dataSource, objectName, objectFields, objectTypesPending, data, setData, setTotalMatching,
  t, translateOptions, groupedPage, setGroupedPage, groupedPageSize, refreshKey, serverPageSize,
  groupRowQuery, groupingKeyReadable, groupingRefusesNothing, unmaskedGroupingFields,
  serverGroupedFetch, invalidationNonce,
}: {
  schema: ObjectGridSchema;
  dataSource: DataSource | undefined;
  objectName: string | undefined;
  objectFields: Readonly<Record<string, GroupingFieldDef | undefined>> | undefined;
  objectTypesPending: boolean;
  data: unknown[];
  setData: React.Dispatch<React.SetStateAction<unknown[]>>;
  setTotalMatching: React.Dispatch<React.SetStateAction<number | undefined>>;
  t: ReturnType<typeof useGridTranslation>['t'];
  translateOptions: ReturnType<typeof useSafeFieldLabel>['translateOptions'];
  groupedPage: number;
  setGroupedPage: React.Dispatch<React.SetStateAction<number>>;
  groupedPageSize: number;
  refreshKey: number;
  serverPageSize: QueryInputs['serverPageSize'];
  groupRowQuery: GroupingDecisions['groupRowQuery'];
  groupingKeyReadable: GroupingDecisions['groupingKeyReadable'];
  groupingRefusesNothing: GroupingDecisions['groupingRefusesNothing'];
  unmaskedGroupingFields: GroupingDecisions['unmaskedGroupingFields'];
  serverGroupedFetch: GroupingDecisions['serverGroupedFetch'];
  invalidationNonce: RowLoad['invalidationNonce'];
}) {
  // --- Grouping support ---
  // Build a per-field value formatter so group headers display the human
  // readable label for select/boolean fields rather than the raw value
  // (e.g. "In Progress" instead of "in_progress", "Yes" instead of "true").
  // A select value's label is the OBJECT FIELD's option label (objectui#11544).
  const groupValueFormatter = React.useMemo(() => {
    // [objectui#7217] ONE normalized entry list, shared with the
    // `useGroupedDataInOptionOrder` call below. Reading `grouping.fields` raw here threw
    // `TypeError: Cannot read properties of null (reading 'field')` on a null
    // hole — the whole grid gone, during render, before any projection was
    // built. `usableGroupingFields` admits exactly the entries
    // `collectGroupingFieldRefs` harvests into the projection, so the grid can
    // never group by an entry the query never asked for.
    const groupingFields = usableGroupingFields(schema.grouping?.fields);
    if (!groupingFields.length) return undefined;

    // Per-field { value -> label } lookup, plus a per-field type so we can
    // handle booleans / dates / users without dedicated option lists.
    const lookup = new Map<string, { type?: string; options?: Map<string, string> }>();

    for (const gf of groupingFields) {
      const fieldName = gf.field;
      const objectDefField = objectFields?.[fieldName];
      // The authored column for this field may respell its TYPE — `type` is a
      // declared `ListColumn` member, and it is how a `"true"` / `"false"` text
      // value reads Yes / No. It never supplies the value LABELS
      // (objectui#11544): `options` is not a `ListColumn` member, and the
      // strict `ListColumnSchema` refuses it at publish, so the labels come
      // from the object field's `options` only. The lookup is typed as
      // `ListColumn` so a read of an undeclared column member does not compile.
      const cols: ReadonlyArray<string | ListColumn> = normalizeColumns(schema.columns) ?? [];
      const colOverride = cols.find(
        (c): c is ListColumn => typeof c === 'object' && c !== null && c.field === fieldName,
      );

      const type = colOverride?.type || objectDefField?.type;
      const rawOptions = objectDefField?.options;

      const optionsMap = new Map<string, string>();
      if (Array.isArray(rawOptions) && rawOptions.length > 0) {
        const translated = schema.objectName
          ? translateOptions(schema.objectName, fieldName, rawOptions)
          : rawOptions;
        for (const opt of translated) {
          if (opt && opt.value !== undefined && opt.value !== null) {
            const label = (opt as any).label;
            optionsMap.set(String(opt.value), label != null ? String(label) : String(opt.value));
          }
        }
      }

      lookup.set(fieldName, {
        type: type || undefined,
        options: optionsMap.size > 0 ? optionsMap : undefined,
      });
    }

    return (field: string, value: any): string | undefined => {
      const meta = lookup.get(field);
      if (!meta) return undefined;
      // Select / multi-select: resolve from options map first.
      if (meta.options) {
        const label = meta.options.get(String(value));
        if (label !== undefined) return label;
      }
      // Boolean fields: render as Yes/No. We use the toolbar i18n bundle so
      // grids without an objectName still produce a readable label — the same
      // `grid.yes`/`grid.no` keys the boolean cell renderer and the bulk-action
      // dialog use, passed as `defaultValue` (a bare string second argument is
      // read as an options object, so the fallback never applied).
      if (meta.type === 'boolean' || typeof value === 'boolean') {
        if (value === true || value === 'true') return t('grid.yes', { defaultValue: 'Yes' });
        if (value === false || value === 'false') return t('grid.no', { defaultValue: 'No' });
      }
      return undefined;
    };
  }, [schema.grouping, schema.columns, schema.objectName, objectFields, translateOptions, t]);

  // [objectui#13234] Per grouping field whose cell paints a date-family face,
  // that face; `temporalCellText` draws the field's group headings through
  // it. The type is the one `groupValueFormatter` reads (the authored column's
  // `type` over the object field's), taken through the cells' one shared
  // resolve, so a heading is drawn as a date exactly when the cell under it is.
  //
  // ⚠️ Drawn at the band (`groupBandsOf`), NOT returned from
  // `groupValueFormatter`: the grouping hook ORDERS groups by the label that
  // formatter returns, and a stored day sorts in calendar order only as the
  // stored string ("Aug 1" < "Oct 1" < "Sep 1" alphabetically). The group keeps
  // the stored key as its label, so its order and count are what they were;
  // only the text in its band changes.
  const temporalGroupFaces = React.useMemo(() => {
    const faces = new Map<string, TemporalCellFace>();
    const cols: ReadonlyArray<string | ListColumn> = normalizeColumns(schema.columns) ?? [];
    for (const gf of usableGroupingFields(schema.grouping?.fields)) {
      const face = gridTemporalFaceOf(gf.field, cols, objectFields);
      if (face) faces.set(gf.field, face);
    }
    return faces;
  }, [schema.grouping, schema.columns, objectFields]);

  const groupingForRender = groupingRefusesNothing || !schema.grouping
    ? schema.grouping
    : { ...schema.grouping, fields: unmaskedGroupingFields };
  // [objectui#7189] The entries the SERVER groups by: the render grouping less
  // any key this principal may not read (see `groupingKeyReadable`). Keyed on
  // the names, so a host rebuilding `grouping` every render re-asks nothing.
  // [objectstack#25786] A level's `orderBy` rides along — the header query
  // compiles its `min` / `max` column from it — under the same read gate: an
  // `orderBy` this principal may not read is dropped, and the level orders by
  // its own key, since the header row would carry that field's value and the
  // group order would disclose it.
  const serverGroupingKey = serverGroupedFetch
    ? JSON.stringify(
      usableGroupingFields(groupingForRender?.fields)
        .filter((gf) => groupingKeyReadable(gf.field))
        .map((gf) => [
          gf.field,
          gf.order ?? null,
          gf.collapsed ?? null,
          gf.orderBy && groupingKeyReadable(gf.orderBy) ? gf.orderBy : null,
        ]),
    )
    : '[]';
  const serverGroupingFields = React.useMemo(
    () => (JSON.parse(serverGroupingKey) as Array<[string, 'asc' | 'desc' | null, boolean | null, string | null]>)
      .map(([field, order, collapsed, orderBy]) => ({
        field,
        ...(order ? { order } : {}),
        ...(orderBy !== null ? { orderBy } : {}),
        ...(collapsed !== null ? { collapsed } : {}),
      })),
    [serverGroupingKey],
  );
  // The view's composed filter as ONE `FilterCondition` — what both compiled
  // queries take, so the header numbers and the rows they head answer the
  // same question. Lowered from the AST the flat fetch would have sent; a
  // filter that does not lower is refused, never dropped (dropping it would
  // group the unfiltered object).
  const groupRowQueryKey = JSON.stringify(groupRowQuery);
  const groupWhere = React.useMemo((): { where?: FilterCondition; error?: Error } => {
    const query = JSON.parse(groupRowQueryKey) as Record<string, unknown> | null;
    const ast = query?.$filter;
    if (ast === undefined || ast === null) return {};
    try {
      const where = parseFilterAST(ast);
      if (where === undefined) {
        return { error: new Error(`[ObjectGrid] The view filter could not be lowered for server-side grouping: ${JSON.stringify(ast)}`) };
      }
      return { where };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error(String(err)) };
    }
  }, [groupRowQueryKey]);
  const groupReloadKey = `${refreshKey}:${invalidationNonce}`;
  // [ADR-0144 D6] A money aggregate over a `record`-mode amount stands only in
  // groups bucketed by that amount's code field; elsewhere it would add
  // amounts in different currencies, so it is dropped before either the
  // server or the client bucketing computes it. Keyed on what it reads, so a
  // host that rebuilds `schema` every render does not re-key the header query.
  // [objectstack#32119] Per aggregated field whose cell paints a date-family
  // face, that face, resolved as the group headings' faces are: a `min` /
  // `max` over it is a time, drawn as the cell draws it, and a `sum` / `avg`
  // over it is no figure at all, so it is dropped here with the money
  // aggregates, before either path computes it or the server is asked.
  const groupAggregationKey = JSON.stringify({
    aggregations: schema.aggregations ?? null,
    grouping: usableGroupingFields(schema.grouping?.fields).map((gf) => gf.field),
    temporal: temporalFacesOfAggregations(schema.aggregations, normalizeColumns(schema.columns) ?? [], objectFields),
  });
  const groupAggregations = React.useMemo(() => {
    const { aggregations, grouping, temporal } = JSON.parse(groupAggregationKey) as {
      aggregations: ObjectGridSchema['aggregations'] | null;
      grouping: string[];
      temporal: Array<[string, TemporalCellFace]>;
    };
    const temporalFields = new Set(temporal.map(([field]) => field));
    const honest = honestGroupAggregations(aggregations ?? undefined, objectFields, grouping);
    if (!honest || temporalFields.size === 0) return honest;
    const kept = honest.filter(({ field, type }) => !(temporalFields.has(field) && (type === 'sum' || type === 'avg')));
    return kept.length === honest.length ? honest : kept;
  }, [groupAggregationKey, objectFields]);
  const displayLocale = useDisplayLocale();
  const temporalAggregates = React.useMemo((): TemporalAggregateFaces | undefined => {
    const { temporal } = JSON.parse(groupAggregationKey) as { temporal: Array<[string, TemporalCellFace]> };
    return temporal.length > 0 ? { faces: new Map(temporal), locale: displayLocale } : undefined;
  }, [groupAggregationKey, displayLocale]);
  const groupHeaders = useServerGroupHeaders({
    enabled: serverGroupedFetch && !objectTypesPending && groupRowQuery !== null && !groupWhere.error,
    dataSource,
    objectName,
    fields: serverGroupingFields,
    where: groupWhere.where,
    // [objectui#11021] The search term, off the same resolved query every
    // group's row page is asked with: one pair on both queries.
    ...groupSearchOf(groupRowQuery),
    aggregations: groupAggregations,
    objectFields,
    reloadKey: groupReloadKey,
  });
  // Keyed on the hook's STATE values (a stable identity React promises), so
  // the group tree is rebuilt when the server answers, not on every render.
  const groupHeaderRows = groupHeaders.headers;
  const groupKeyLabels = groupHeaders.keyLabels;
  const serverGroupSource: ServerGroupSource | undefined = React.useMemo(
    () => (serverGroupedFetch ? { headers: groupHeaderRows ?? [], keyLabels: groupKeyLabels } : undefined),
    [serverGroupedFetch, groupHeaderRows, groupKeyLabels],
  );

  // [objectui#11809] Each grouping field's DECLARED option order: the object
  // field's `options` read through core's `buildCategoryOrder` /
  // `buildCategoryRank`, the same reading the dashboard's category axis and
  // the funnel use. A select field's groups then follow the order the author
  // declared (Backlog → To Do → In Progress …), as the Kanban lanes do, rather
  // than the order of their labels; empty and undeclared values sit last. A
  // field with no options keeps label order. Keyed on the order itself (a
  // string), not on `schema.grouping`, which a host rebuilds every render.
  const groupOptionOrderKey = JSON.stringify(
    usableGroupingFields(schema.grouping?.fields).flatMap((gf) => {
      const order = buildCategoryOrder(objectFields?.[gf.field]?.options);
      return order ? [[gf.field, order]] : [];
    }),
  );
  const groupOptionRanks = React.useMemo((): GroupOptionRanks | undefined => {
    const ranks = new Map<string, ReadonlyMap<string, number>>();
    for (const [field, order] of JSON.parse(groupOptionOrderKey) as Array<[string, string[]]>) {
      const rank = buildCategoryRank(order);
      if (rank) ranks.set(field, rank);
    }
    return ranks.size > 0 ? ranks : undefined;
  }, [groupOptionOrderKey]);

  const { groups, isGrouped, toggleGroup } = useGroupedDataInOptionOrder(
    serverGroupedFetch
      ? (schema.grouping ? { ...schema.grouping, fields: serverGroupingFields } : undefined)
      : groupingForRender,
    data,
    groupAggregations,
    groupValueFormatter,
    serverGroupSource,
    groupOptionRanks,
    temporalAggregates,
  );

  // Reset grouped pagination to page 1 whenever the grouping config, page size
  // or the underlying data changes (e.g. switching grouping field, reload).
  const groupingKey = React.useMemo(
    () => JSON.stringify(schema.grouping ?? null),
    [schema.grouping],
  );
  React.useEffect(() => {
    setGroupedPage(1);
  }, [groupingKey, groupedPageSize, refreshKey]);

  // [objectui#7189] The open LEAF groups on the current page of groups — the
  // only ones whose rows are on screen, and so the only ones whose rows are
  // asked for. A collapsed group costs no row query at all.
  const serverGroupLeaves: ServerGroupLeaf[] = [];
  if (serverGroupedFetch) {
    const groupPages = Math.max(1, Math.ceil(groups.length / groupedPageSize));
    const onPage = Math.min(groupedPage, groupPages);
    const collectOpenLeaves = (group: typeof groups[number]) => {
      if (group.collapsed) return;
      if (group.subgroups.length === 0) serverGroupLeaves.push({ key: group.key, keyValues: group.keyValues });
      else group.subgroups.forEach(collectOpenLeaves);
    };
    groups.slice((onPage - 1) * groupedPageSize, onPage * groupedPageSize).forEach(collectOpenLeaves);
  }
  const groupRows = useServerGroupRows({
    enabled: serverGroupedFetch && !!groupHeaders.headers,
    dataSource,
    objectName,
    fields: serverGroupingFields,
    where: groupWhere.where,
    baseParams: groupRowQuery,
    pageSize: serverPageSize,
    leaves: serverGroupLeaves,
    reloadKey: groupReloadKey,
  });
  // The rows in hand are the open groups' pages: what everything else that
  // reads `data` (column inference, the client export, selection) sees.
  const serverLeafKeys = JSON.stringify(serverGroupLeaves.map((leaf) => leaf.key));
  useEffect(() => {
    if (!serverGroupedFetch) return;
    const keys = JSON.parse(serverLeafKeys) as string[];
    setData(keys.flatMap((key) => groupRows.pages[key]?.rows ?? []));
  }, [serverGroupedFetch, serverLeafKeys, groupRows.pages]);
  // …and the match total is the QUERY's: the top-level group counts summed.
  const serverGroupTotal = serverGroupedFetch && groupHeaders.headers
    ? (groupHeaders.headers[0] ?? []).reduce((sum, row) => sum + (Number(row.count) || 0), 0)
    : undefined;
  useEffect(() => {
    if (serverGroupTotal !== undefined) setTotalMatching(serverGroupTotal);
  }, [serverGroupTotal]);

  return {
    temporalGroupFaces, groupWhere, groupHeaders, groups, isGrouped, toggleGroup, groupRows,
  };
}
