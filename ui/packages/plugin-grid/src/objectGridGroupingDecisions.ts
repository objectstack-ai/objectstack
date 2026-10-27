/**
 * The grouping decisions of `ObjectGrid` (`./ObjectGrid.tsx`): the masked
 * grouping-key refusal, whether the grid groups on the server, the two
 * grouping refusals (no header query, rows not handed in whole), the load
 * effect's fetch window and the held group row query, moved out of the
 * component verbatim (objectstack#25994, slice 4). Every input is passed in;
 * the component reads the returned values.
 */

import React, { useEffect, useState } from 'react';
import type { ObjectGridSchema, DataSource, ListColumn, ViewData } from '@object-ui/types';
import type { usePermissions } from '@object-ui/permissions';
import { isMaskedGridColumn } from './maskedColumn';
import { usableGroupingFields } from './useGroupedData';
import { normalizeColumns } from './objectGridColumns';
import { DEFAULT_FETCH_BATCH_SIZE, NO_GROUPING_REFUSAL, resolvePageSize } from './objectGridDefaults';
import type { ObjectGridExternalPaginationProps } from './objectGridProps';

export function useObjectGridGroupingDecisions({
  schema,
  objectName,
  objectFields,
  objectTypesPending,
  perms,
  dataSource,
  hasInlineData,
  dataConfig,
  externalManualPagination,
  hostRowCount,
  serverPageSize,
}: {
  schema: ObjectGridSchema;
  objectName: string | undefined;
  objectFields: Readonly<Record<string, { type?: unknown } | undefined>> | undefined;
  objectTypesPending: boolean;
  perms: ReturnType<typeof usePermissions>;
  dataSource: DataSource | undefined;
  hasInlineData: boolean;
  dataConfig: ViewData | { provider: string; items: unknown[] } | null;
  externalManualPagination: boolean;
  hostRowCount: ObjectGridExternalPaginationProps['rowCount'];
  serverPageSize: number;
}) {
  // objectui#10583 — a MASKED field is REFUSED as a grouping key.
  // Grouping by it printed the raw value as each group's label. Masking the
  // label would not be enough: the buckets would still show which records
  // share a credential, ordered by its raw value. So the entry is dropped (the
  // other entries still group, as `usableGroupingFields` does for an unusable
  // one) and the drop is reported through the grid's warning channel. The rule
  // is the column flag's: `isMaskedGridColumn` over the view column's type and
  // the object-declared type.
  //
  // objectui#10657 (which folded objectui#10706) — the same rule's third
  // argument: while the object's field types are unknown (`objectTypesPending`,
  // the host-fetched window, or a failed read), an entry on a field whose view
  // column authors no type is WITHHELD and so refused too, since its group
  // label would print whatever the field holds. The group label follows the
  // cell: a withheld cell draws the mask, and a withheld key labels no group.
  // Once the types are known the entry groups again, unless its field is
  // masked. The refusal of a withheld entry is not warned: it is not a finding
  // about the authored grouping, and a failed read reports itself.
  const groupingFieldsRaw = schema.grouping?.fields;
  const maskedGroupingSignature = React.useMemo(() => {
    const cols: ReadonlyArray<string | ListColumn> = normalizeColumns(schema.columns) ?? [];
    const columnTypeOf = (field: string) =>
      cols.find((c): c is ListColumn => typeof c === 'object' && c !== null && c.field === field)?.type;
    const refused = usableGroupingFields(groupingFieldsRaw)
      .map((gf) => gf.field)
      .filter((field) => isMaskedGridColumn(columnTypeOf(field), objectFields?.[field]?.type, objectTypesPending));
    return JSON.stringify({
      refused,
      // The ones refused on a KNOWN masked type, which is what the warning names.
      warned: refused.filter((field) => isMaskedGridColumn(columnTypeOf(field), objectFields?.[field]?.type, false)),
    });
  }, [groupingFieldsRaw, schema.columns, objectFields, objectTypesPending]);
  // Keyed on the authored array and the signature STRING, never on a memo's
  // identity (AGENTS.md #10). Read only when something was refused: the
  // unmasked path below hands `useGroupedData` the authored config itself.
  const unmaskedGroupingFields = React.useMemo(() => {
    const { refused }: { refused: string[] } = JSON.parse(maskedGroupingSignature);
    return usableGroupingFields(groupingFieldsRaw).filter((gf) => !refused.includes(gf.field));
  }, [groupingFieldsRaw, maskedGroupingSignature]);
  const groupingRefusesNothing = maskedGroupingSignature === NO_GROUPING_REFUSAL;
  useEffect(() => {
    const { warned: masked }: { warned: string[] } = JSON.parse(maskedGroupingSignature);
    if (masked.length === 0) return;
    console.warn(
      `[ObjectUI] ObjectGrid grouping: ${schema.objectName ?? 'object-grid'} groups by the masked `
      + `field(s) ${masked.join(', ')}. A masked field cannot be a grouping key: its group labels would `
      + 'show the raw value, and its groups would show which records share it. The entry was ignored.',
    );
  }, [maskedGroupingSignature, schema.objectName]);

  // ── Server-side grouping (objectui#7189, maintainer ruling A) ─────────────
  //
  // Grouping on a list view is server-side: the set of groups and every number
  // in a group header are properties of the QUERY, not of a fetched page, and
  // the rows inside a group are paged. So a grouped grid that OWNS its fetch
  // asks the server for its group headers (`dataSource.queryGroupHeaders`,
  // the compiled `compileListViewGroupQuery`) and pages each open group's rows
  // (`compileListViewGroupRowsQuery`) instead of fetching one window and
  // bucketing it — which answered two headers (86, 14) or five page slices
  // (31/31/30/7/1) for the same five units of 86/61/31/7/1, depending on
  // nothing but row order, and left every row past the window unreachable.
  //
  // Presence of `queryGroupHeaders` is the capability. Rows handed in whole
  // (`hasInlineData`) are grouped where they are, which is exact because
  // nothing was withheld. A data source that cannot answer the header query
  // cannot group (objectui#10881, maintainer ruling F): the grid refuses,
  // naming the missing member, and asks for no rows — see
  // `groupingNeedsHeaderQuery`. It used to group the page it fetched, whose
  // every count was a page slice.
  //
  // Decided on the grouping AS CONFIGURED less the entries refused on a KNOWN
  // masked type — NOT less the entries merely withheld while the object's
  // types are still loading, or the first render would fetch one flat window
  // it is about to throw away.
  const groupingRefusedKnownMasked = React.useMemo(
    () => (JSON.parse(maskedGroupingSignature) as { warned: string[] }).warned,
    [maskedGroupingSignature],
  );
  // A grouping field this principal may not READ is not a key the server may
  // group by: a header row carries every key's raw value, so grouping by it
  // would print what the column itself withholds. Same gate, same deferral
  // (an unanswered policy filters nothing), as the projection's.
  const groupingKeyReadable = (field: string): boolean =>
    !perms?.isLoaded || !objectName || perms.checkField(objectName, field, 'read');
  const serverGroupedFetch =
    !hasInlineData
    && !!objectName
    && typeof dataSource?.queryGroupHeaders === 'function'
    && usableGroupingFields(groupingFieldsRaw).some(
      (gf) => !groupingRefusedKnownMasked.includes(gf.field) && groupingKeyReadable(gf.field),
    );
  // [objectui#10881] The refusal: this grid would fetch its own rows and group
  // them, and its data source cannot answer the group header query. There is
  // no honest grouping to draw — a fetched window grouped in the browser shows
  // page slices as group counts and drops every group whose rows fall past the
  // window — so the grid names the missing member instead, and the load effect
  // below asks for no rows (the object definition is still read: it is what
  // tells a KNOWN masked grouping key, which groups nothing, from one that
  // does). Rows handed in whole never reach it (`hasInlineData`). The same
  // grouping entries count as for `serverGroupedFetch`, less the readability
  // gate: over such a source a grouping by a key this principal may not read
  // is refused too, rather than falling through to a fetched page.
  const groupingNeedsHeaderQuery =
    !hasInlineData
    && !!objectName
    && !!dataSource
    && typeof dataSource.queryGroupHeaders !== 'function'
    && usableGroupingFields(groupingFieldsRaw).some((gf) => !groupingRefusedKnownMasked.includes(gf.field));
  // [objectui#10881] The second refusal: rows a host handed in that the SAME
  // host declares to be one page of more — the external-pagination props
  // (`externalManualPagination`) with a `rowCount` above the rows it handed.
  // Only rows handed in WHOLE group where they are; a declared window grouped
  // here shows page-slice counts and drops every group whose rows fall past
  // it (on 100 of 186 rows over five units, two groups: 86 and 14). The
  // header-query sentence is the wrong one here: the host owns this fetch,
  // and its data source may even declare `queryGroupHeaders`. So this names
  // its own remedy — hand the rows in whole, or let the grid fetch them.
  // Counted against the rows as HANDED (`dataConfig.items`), not the `data`
  // state that mirrors them one render later, so whole rows never flash it.
  // Same grouping entries as `groupingNeedsHeaderQuery`. A `rowCount` absent
  // or not above the handed rows is whole rows, and groups as before.
  const handedRows = hasInlineData ? (dataConfig as { items?: unknown } | undefined)?.items : undefined;
  const groupingNeedsWholeRows =
    externalManualPagination
    && Array.isArray(handedRows)
    && (hostRowCount as number) > handedRows.length
    && usableGroupingFields(groupingFieldsRaw).some((gf) => !groupingRefusedKnownMasked.includes(gf.field));
  // What the load effect's ONE flat fetch asks for (objectui#9853, ruling
  // 5824040487, structure B). Where the rows it holds ARE the page on screen,
  // that is the display page size. Where this grid buckets the rows it holds
  // into groups in the browser, nothing pages them, so it asks for the fetch
  // BATCH instead, which no display path reads. Since objectui#7189 a grouped
  // grid that fetches its own rows buckets a window only when the server
  // cannot group for it and the grid has not refused: not server-grouped
  // (`serverGroupedFetch` strips `$top` and pages each group), not refused
  // (`groupingNeedsHeaderQuery` asks for no rows), and at least one grouping
  // entry left once a KNOWN masked key is refused. The case that reaches it
  // today is a grouping key this principal may not read, over a data source
  // that answers the header query (see `groupingKeyReadable`).
  //
  // Counted the way the two predicates above count, less the keys refused on a
  // KNOWN masked type and NOT less the ones merely withheld while the object's
  // types load: otherwise the first fetch would go out at the page size and be
  // re-issued at the batch the moment the types land.
  const bucketsFetchedWindow =
    !serverGroupedFetch
    && !groupingNeedsHeaderQuery
    && usableGroupingFields(groupingFieldsRaw).some((gf) => !groupingRefusedKnownMasked.includes(gf.field));
  const fetchWindow = bucketsFetchedWindow
    ? resolvePageSize(schema, DEFAULT_FETCH_BATCH_SIZE)
    : serverPageSize;
  // The grid's own row query — projection, expansion, order and the view's
  // filter — resolved by the load effect below exactly as the flat fetch
  // resolves it, and handed to each group's row page. `null` until resolved.
  const [groupRowQuery, setGroupRowQuery] = useState<Record<string, unknown> | null>(null);
  // [objectui#11021] Leaving server grouping drops the held query. Only the
  // load effect below writes it, and only while grouping on the server, so a
  // grid that went flat and came back asked its first header query with the
  // query it held when it last grouped — a cleared search term, or an old
  // filter, sort or projection — and painted that answer before the fresh
  // one. `null` holds both group queries until the query as it stands now is
  // resolved.
  useEffect(() => {
    if (!serverGroupedFetch) setGroupRowQuery(null);
  }, [serverGroupedFetch]);

  return {
    unmaskedGroupingFields,
    groupingRefusesNothing,
    groupingKeyReadable,
    serverGroupedFetch,
    groupingNeedsHeaderQuery,
    groupingNeedsWholeRows,
    fetchWindow,
    groupRowQuery,
    setGroupRowQuery,
  };
}
