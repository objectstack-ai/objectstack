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
import { formatDate, formatDateTime, formatRelativeDate } from '@object-ui/fields';
import { buildCategoryOrder, buildCategoryRank, toDisplayDate } from '@object-ui/core';
import { resolveGridCellRendering, type GridCellFieldLike } from './cellRendererResolution';
import { useGroupedDataInOptionOrder, usableGroupingFields, type GroupOptionRanks, type ServerGroupSource } from './useGroupedData';
import { groupSearchOf, useServerGroupHeaders, useServerGroupRows, type ServerGroupLeaf } from './useServerGrouping';
import { normalizeColumns } from './objectGridColumns';
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
 * [objectui#13234] The face a date-family CELL paints, for one grouping field:
 * the renderer key from the cells' one shared resolve
 * (`resolveGridCellRendering`), and the object field's `format`, which is the
 * `format` the cell's field metadata carries.
 */
interface TemporalGroupFace {
  rendererType: 'date' | 'datetime';
  format?: string;
}

/**
 * [objectui#13234] A `date` / `datetime` group's key, drawn as the grid's cell
 * draws the same value. `undefined` for a key the cell has no face for (empty
 * or unparsable), so the band keeps the group's own label: "(empty)" for an
 * empty key, the stored text otherwise.
 *
 * The formatting CALLS are the cells' own, with the cells' arguments:
 * `DateCellRenderer` in a grid column (`inGridColumn`, objectstack#25884)
 * paints `formatDate(value, format || undefined, …)`, the absolute default
 * face when no `format` is declared;
 * `DateTimeCellRenderer` paints `formatRelativeDate` for `'relative'`, the
 * compact face for no format and for `'short'`, and `formatDateTime` with the
 * authored word otherwise (the compact face's string is the cell's two halves
 * joined by the one space the cell draws between them). No date is formatted
 * here. The face SELECTION is the one part those renderers do not export, and
 * it is restated here only: `groupDateHeading-13234.test.tsx` holds every
 * heading to the cell under it for every face, so a move on either side turns
 * it red.
 *
 * A heading names a DAY, not one row's deadline, so it reads the face's
 * neutral phrase: `dueLike`'s "Overdue" wording and red are a per-row verdict
 * (`settledWhen` is judged per row), and the rows of one group can judge it
 * differently.
 */
export function temporalGroupHeading(
  face: TemporalGroupFace,
  key: unknown,
  locale: string | undefined,
): string | undefined {
  if (typeof key !== 'string' && typeof key !== 'number') return undefined;
  // The cells' floor: every falsy scalar is empty, the numeric epoch included.
  if (!key) return undefined;
  // The cells' validity guard, the shared parse step.
  if (isNaN(toDisplayDate(key).getTime())) return undefined;
  if (face.rendererType === 'date') return formatDate(key, face.format || undefined, { locale });
  // A `datetime` cell renders an INSTANT, from the engine's parse.
  const instant = new Date(key);
  const style = !face.format || face.format === 'short' ? 'compact' : face.format;
  return style === 'relative'
    ? formatRelativeDate(instant, { locale })
    : formatDateTime(instant, { style, locale });
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
  // that face; `temporalGroupHeading` draws the field's group headings through
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
    const faces = new Map<string, TemporalGroupFace>();
    const cols: ReadonlyArray<string | ListColumn> = normalizeColumns(schema.columns) ?? [];
    for (const gf of usableGroupingFields(schema.grouping?.fields)) {
      const objectDefField = objectFields?.[gf.field];
      const colOverride = cols.find(
        (c): c is ListColumn => typeof c === 'object' && c !== null && c.field === gf.field,
      );
      const { rendererType } = resolveGridCellRendering({
        type: colOverride?.type || objectDefField?.type,
        format: objectDefField?.format,
        widget: objectDefField?.widget,
      });
      if (rendererType === 'date' || rendererType === 'datetime') {
        faces.set(gf.field, { rendererType, format: objectDefField?.format || undefined });
      }
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
  const groupHeaders = useServerGroupHeaders({
    enabled: serverGroupedFetch && !objectTypesPending && groupRowQuery !== null && !groupWhere.error,
    dataSource,
    objectName,
    fields: serverGroupingFields,
    where: groupWhere.where,
    // [objectui#11021] The search term, off the same resolved query every
    // group's row page is asked with: one pair on both queries.
    ...groupSearchOf(groupRowQuery),
    aggregations: schema.aggregations,
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
    schema.aggregations,
    groupValueFormatter,
    serverGroupSource,
    groupOptionRanks,
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
