/**
 * The column summaries of `ObjectGrid` (`./ObjectGrid.tsx`), with the two
 * values they are answered against: the query the cross-page fan-out replays
 * and the resolved match total. Moved out of the component verbatim
 * (objectstack#25994, slice 6). Every input is passed in; the component reads
 * the returned values.
 */

import React from 'react';
import type { ObjectGridSchema, DataSource, ListColumn } from '@object-ui/types';
import { useScopedColumnSummary } from './useColumnSummary';
import { useWholeSetSummary } from './useWholeSetSummary';
import { normalizeColumns } from './objectGridColumns';
import type { ObjectGridExternalPaginationProps } from './objectGridProps';
import type { useObjectGridQueryInputs } from './objectGridQueryInputs';
import type { useObjectGridGroupingDecisions } from './objectGridGroupingDecisions';
import type { useObjectGridGrouping } from './objectGridGrouping';

type QueryInputs = ReturnType<typeof useObjectGridQueryInputs>;
type GroupingDecisions = ReturnType<typeof useObjectGridGroupingDecisions>;
type Grouping = ReturnType<typeof useObjectGridGrouping>;


export function useObjectGridSummaries({
  schema, dataSource, objectName, objectSchema, data, hasInlineData, externalManualPagination,
  hostFindParams, hostRowCount, lastFindParamsRef, totalMatching, refreshKey, serverPage,
  fetchWindow, serverGroupedFetch, isGrouped,
}: {
  schema: ObjectGridSchema;
  dataSource: DataSource | undefined;
  objectName: string | undefined;
  objectSchema: { fields?: Parameters<typeof useScopedColumnSummary>[2] } | null;
  data: Parameters<typeof useScopedColumnSummary>[1];
  hasInlineData: boolean;
  externalManualPagination: boolean;
  hostFindParams: ObjectGridExternalPaginationProps['findParams'];
  hostRowCount: ObjectGridExternalPaginationProps['rowCount'];
  lastFindParamsRef: React.RefObject<Record<string, unknown> | null>;
  totalMatching: number | undefined;
  refreshKey: number;
  serverPage: QueryInputs['serverPage'];
  fetchWindow: GroupingDecisions['fetchWindow'];
  serverGroupedFetch: GroupingDecisions['serverGroupedFetch'];
  isGrouped: Grouping['isGrouped'];
}) {
  // The query the cross-page fan-out would replay — from whichever side owns the
  // fetch (objectui#4501). ONE value, read by the fan-out AND by the affordance
  // gate below, so the offer and the thing it promises can never disagree —
  // and by the footer, whose whole-set figures are this same query's
  // (objectui#12081 item 3). Declared here, above the footer's hook, rather
  // than beside the fan-out: hooks run before the component's early returns.
  //
  // `hasInlineData` is exactly the data loader's own guard (`if (hasInlineData)
  // return`), which makes it the precise test for "this grid did not issue the
  // query behind the rows on screen". In that case `lastFindParamsRef` is not
  // merely empty, it is WRONG — either never written, or left over from an
  // earlier own-fetch — so the host's `findParams` is the only admissible
  // source, and there is deliberately no fallback to the ref and no `?? {}`
  // default: replaying `{}` is what asked the server for the whole object and
  // fed up to 5000 unmatched records to bulk delete.
  const bulkFanoutParams: Record<string, unknown> | null = hasInlineData
    ? (hostFindParams ?? null)
    : (lastFindParamsRef.current ?? null);

  // The real match total, from whichever side owns the fetch — ONE derived
  // value with ONE answer (objectui#4464). The pager has always read it this
  // way; the cross-page "Select all N matching" affordance read the raw
  // `totalMatching` STATE instead, whose only writer is this component's own
  // data loader. Under a host that fetches the rows itself (ListView passing
  // `manualPagination` + `rowCount`, i.e. the console) that loader never runs,
  // so the state stayed `undefined` and `BulkActionBar`'s gate was permanently
  // false while the pager, two lines away, showed the correct page count off
  // the very number the bar needed.
  //
  // Every consumer reads this const — the pager's `rowCount`, both
  // `BulkActionBar` sites, and the footer's whole-set read, which checks the
  // count it is answered against this one (objectui#12081 item 3). Do NOT
  // re-spell the conditional at a second consumption site: two copies of the
  // fallback is exactly how one of them gets missed again (this defect, and
  // #4138 before it).
  //
  // This answers HOW MANY match, and `canOfferSelectAllMatching` (objectui#4501)
  // independently answers WHETHER the escalation may be offered at all. The two
  // compose and neither substitutes for the other: the bar sites read this total
  // only *through* that floor, so a host with a real `rowCount` but no
  // `findParams` still gets no offer — a number to display is not a query to
  // replay. The floor also subsumes the `singleSelection` suppression that used
  // to be spelled at these sites (`!singleSelection` is its first conjunct).
  const resolvedTotalMatching = externalManualPagination ? hostRowCount : totalMatching;

  // --- Column summary support ---
  const summaryColumns = React.useMemo(() => {
    const cols = normalizeColumns(schema.columns);
    if (cols && cols.length > 0 && typeof cols[0] === 'object') {
      return cols as ListColumn[];
    }
    return undefined;
  }, [schema.columns]);
  // [objectui#12081 item 3] Whether the rows the footer reads ARE the set it
  // is drawn beside. Under server paging they are one page of it: a host
  // (`ListView`) hands this grid one window with the set's `rowCount`, or this
  // grid's own loader asked for one page of `fetchWindow` rows. Rows handed in
  // without a declared page are the set, and so is a first page that holds
  // every match. Only the flat table draws the footer, so a grouped grid asks
  // nothing.
  const footerRowsAreTheSet = externalManualPagination
    ? (hostRowCount as number) <= data.length
    : hasInlineData || (serverPage === 1 && (typeof totalMatching === 'number'
      ? totalMatching <= data.length
      : data.length < fetchWindow));
  const wholeSetSummary = useWholeSetSummary({
    enabled: !footerRowsAreTheSet && !isGrouped && !serverGroupedFetch && data.length > 0,
    dataSource,
    objectName,
    columns: summaryColumns,
    findParams: bulkFanoutParams,
    count: resolvedTotalMatching,
    reloadKey: String(refreshKey),
  });
  const { summaries, hasSummary } = useScopedColumnSummary(
    summaryColumns,
    data,
    objectSchema?.fields,
    footerRowsAreTheSet ? 'rows' : (wholeSetSummary.status === 'answered' ? 'whole' : 'page'),
    wholeSetSummary.row,
  );

  return {
    bulkFanoutParams, resolvedTotalMatching, summaries, hasSummary,
  };
}
