/**
 * The query inputs of `ObjectGrid` (`./ObjectGrid.tsx`): the projection keys
 * the load effect depends on (grouping, predicates, row colour, concurrency
 * token) and the view's filter, sort, search and server-paging state, moved
 * out of the component verbatim (objectstack#25994, slice 4). Every input is
 * passed in; the component reads the returned values.
 */

import { useEffect, useState, useMemo } from 'react';
import type { ObjectGridSchema, TableSortItem } from '@object-ui/types';
import { useFilterScope } from '@object-ui/react';
import { collectPredicateFieldRefs, collectGroupingFieldRefs, listViewPredicates, toFilterNodeSafely } from '@object-ui/core';
import { useResolvedGridFilters } from './objectGridQuery';
import { DEFAULT_DISPLAY_PAGE_SIZE, resolvePageSize } from './objectGridDefaults';
import type { ObjectGridExternalPaginationProps } from './objectGridProps';

export function useObjectGridQueryInputs({
  schema,
  objectName,
  externalManualPagination,
  hostSearch,
}: {
  schema: ObjectGridSchema;
  objectName: string | undefined;
  externalManualPagination: boolean;
  hostSearch: ObjectGridExternalPaginationProps['search'];
}) {
  const schemaFields = schema.fields;
  const schemaColumns = schema.columns;
  // [objectui#12292] Whether this grid's rows must carry their concurrency
  // token: the AUTHORED key, not `inlineEditable`, so the principal's write
  // verdict landing does not cost a second fetch. A read-only principal is
  // sent one column it does not use.
  const carriesConcurrencyToken = schema.editable === true;
  // [objectui#12393] The row colour's field, which the projection asks for
  // (see `rowColorFields` in the load effect). A string, so the fetch effect
  // can name it: a host can replace the rule on a mounted grid (`ListView`
  // hands the grid its toolbar pick as `rowColor`), and a new field no
  // request carried would otherwise never be fetched. The `colors` map is a
  // render-time concern the projection cannot see, so changing it costs no
  // round trip.
  const rowColorField = schema.rowColor?.field || undefined;
  // [objectui#7179] The fetch effect's dep on the grouping block, as a CONTENT
  // key over the field NAMES alone.
  //
  // Not `schema.grouping` itself: hosts rebuild that object literal every
  // render (`plugin-list` spreads a fresh `{ grouping: groupingConfig }` into
  // the node it hands down), so naming it here would re-issue the query on
  // every render — the identity-churn refetch storm objectui#6697 recorded for
  // `expandFields`.
  //
  // Names ONLY, not the whole block: `order` and `collapsed` are render-time
  // concerns the projection cannot see, so a user collapsing a group must not
  // cost a round trip. What the query depends on is exactly this list.
  const groupingProjectionKey = useMemo(
    () => JSON.stringify(collectGroupingFieldRefs(schema.grouping)),
    [schema.grouping],
  );
  // [objectui#10689] The fetch effect's dep on the three view-level PREDICATE
  // carriers its projection harvests (objectui#3501), as a CONTENT key over the
  // operand NAMES alone, the shape `groupingProjectionKey` takes above.
  //
  // The load effect reads `conditionalFormatting`, `rowActionDefs` and
  // `bulkActionDefs` through `listViewPredicates` and puts each operand into
  // `$select`, but none of the three was a dependency. So a rule added to a
  // mounted grid never had its operand fetched: the rows kept arriving without
  // the field, and the rule, which reads it, never matched.
  //
  // Names ONLY: a rule's style, or an action's label, is a render-time concern
  // the projection cannot see, so changing it costs no round trip. The same
  // harvest over the same three inputs as the effect's; the object-level
  // `actions` / `userActions` it adds come from the definition the effect reads
  // for itself. The `rowActionDefs` cast is the objectui#5091 NON-AUTHOR
  // SURFACE exemption stated at the effect's own read of that key.
  // `__tests__/ObjectGrid.harvestInputsFetchKey-10689.test.tsx` pins each input.
  const conditionalFormattingRaw = schema.conditionalFormatting as readonly unknown[] | undefined;
  const rowActionDefsRaw = (schema as { rowActionDefs?: readonly unknown[] }).rowActionDefs;
  const bulkActionDefsRaw = (schema as { bulkActionDefs?: readonly unknown[] }).bulkActionDefs;
  const predicateProjectionKey = useMemo(
    () => JSON.stringify(collectPredicateFieldRefs(listViewPredicates({
      conditionalFormatting: conditionalFormattingRaw,
      rowActionDefs: rowActionDefsRaw,
      bulkActionDefs: bulkActionDefsRaw,
    }))),
    [conditionalFormattingRaw, rowActionDefsRaw, bulkActionDefsRaw],
  );
  // The view's declared filter, lowered ONCE through the repo's single filter
  // sink for both consumers below (the fetch and the server-side export).
  //
  // The lowering is what makes the authoring surface honest rather than merely
  // reachable (objectui#4041). Until this block published `filter`, the only
  // thing that could arrive here was an ObjectQL AST synthesized by
  // `ElementDataSourceGate`, and passing that through verbatim was right. An
  // AUTHOR writes the spec's view vocabulary instead — `ViewFilterRule[]`,
  // `[{ field, operator, value }]` — and that shape byte-copied onto `$filter`
  // is refused on the wire: `isFilterAST` is false for an array of objects and
  // the data API answers `400 INVALID_FILTER` (measured against a real backend
  // in objectui#3431). Declaring the key without this hop would have traded a
  // silent wrong answer for a guaranteed failure, which is not a fix.
  //
  // `toFilterNode` is that hop by design — the last stop before the wire, where
  // a value legitimately leaves the spec's view vocabulary and becomes an AST
  // (see its doc for why the fold cannot live at the producer). It passes AST
  // nodes through untouched, so the `ElementDataSourceGate` path is unchanged;
  // it also collects the MongoDB-style object shape, and returns `undefined`
  // for an absent or empty source so we skip `$filter` rather than sending an
  // empty array. `plugin-list`'s `buildEffectiveFilter` and `plugin-view`'s
  // `ObjectView` already reach the wire through this same sink; this read point
  // was the last consumer on the chain that did not.
  //
  // ⚠️ `toFilterNodeSafely`, not `toFilterNode` — objectui#9050. This read is a
  // RENDER-time `useMemo`: a `FilterOperatorError` from the lowering is a
  // render error, and there is no load `try` and no `classifyLoadError` above
  // it. The refusal is kept as a VALUE and rendered by the malformed-filter
  // branch below; collapsing it to `undefined` would mean "no filter" and run
  // the grid unconstrained, the silent widening objectui#9001 closed.
  //
  // objectui#10607: both authored entries are read RESOLVED and held (see
  // `useResolvedGridFilters`), so `{current_user_id}` goes out as the real id
  // and an equal filter keeps its reference across renders.
  const filterScope = useFilterScope();
  const authoredFilters = useResolvedGridFilters({ filter: schema.filter }, filterScope);
  const schemaFilterSource = authoredFilters.filter;
  const schemaFilterResult = useMemo(() => toFilterNodeSafely(schemaFilterSource), [schemaFilterSource]);
  const schemaFilterRefusal = schemaFilterResult.ok ? undefined : schemaFilterResult.refusal;
  const schemaFilter = schemaFilterResult.ok ? schemaFilterResult.node : undefined;
  const schemaSort = schema.sort;
  const schemaPagination = schema.pagination;
  const schemaPageSize = schema.pageSize;

  // Server-side ("manual") pagination for the flat list view. The fetch window
  // ($top/$skip) and the DataTable's display page size are the SAME number here
  // — the records we hold ARE one page, so paging means refetching the next
  // slice from the server instead of slicing an in-memory batch. This is what
  // makes records beyond the first batch reachable at all
  // (objectstack-ai/objectstack#2212).
  //
  // That makes this a DISPLAY page size, so undeclared it is the spec's display
  // default, ⛔ not the fetch batch (objectui#9853). A server-grouped leaf pages
  // its rows by this same size (`useServerGroupRows` below).
  const [serverPage, setServerPage] = useState(1);
  const [serverPageSize, setServerPageSize] = useState<number>(
    resolvePageSize(schema, DEFAULT_DISPLAY_PAGE_SIZE),
  );

  // Column-header sort, when this grid fetches its own rows (objectui#3106).
  // `null` means "nobody has clicked a header" and the view's declared
  // `schema.sort` is in force; once set it REPLACES that sort for the whole
  // collection, not for the window on screen.
  const [headerSort, setHeaderSort] = useState<TableSortItem[] | null>(null);
  // A view whose declared sort changes underneath us (view switch, saved-view
  // edit) invalidates a header sort taken against the previous one.
  useEffect(() => { setHeaderSort(null); }, [JSON.stringify(schema.sort ?? null)]);

  // Toolbar search term, when this grid fetches its own rows (objectui#3118).
  // It goes out as `$search` on the refetch — the server decides which fields
  // it matches from the object's metadata (ADR-0061), the same channel the
  // ListView toolbar uses. Filtering the rows we hold instead would search the
  // page on screen and call the answer "the results in this list".
  const [searchTerm, setSearchTerm] = useState('');
  // A term is asked of one collection. Pointing the grid at another object
  // makes it a question about rows it was never typed for.
  useEffect(() => { setSearchTerm(''); }, [objectName]);
  // [objectui#11021] Whose term is it? A host that passes `search` owns it —
  // under host-driven paging, and also when this grid fetches for itself:
  // `ListView` fetches for a flat grid, but hands a grid that groups on the
  // server no rows, only its toolbar term, which this grid's own queries then
  // carry (both group queries, or its own window). Absent that prop, the term
  // is the one typed into this grid's box.
  const hostOwnsSearch = externalManualPagination || hostSearch !== undefined;
  const querySearchTerm = hostOwnsSearch ? (hostSearch ?? '') : searchTerm;
  // [objectui#10689] The `$searchFields` the load effect sends, as a CONTENT
  // key for its dependency list: the view's `searchableFields`, and only while
  // a term goes out, since without one the query does not send them. A view
  // that narrows its search to other fields re-reads once; an equal array in a
  // new object does not.
  const searchFieldsKey =
    querySearchTerm.trim() && schema.searchableFields && schema.searchableFields.length > 0
      ? JSON.stringify(schema.searchableFields)
      : '';

  return {
    schemaFields,
    schemaColumns,
    carriesConcurrencyToken,
    rowColorField,
    groupingProjectionKey,
    predicateProjectionKey,
    filterScope,
    schemaFilterSource,
    schemaFilterRefusal,
    schemaFilter,
    schemaSort,
    schemaPagination,
    schemaPageSize,
    serverPage,
    setServerPage,
    serverPageSize,
    setServerPageSize,
    headerSort,
    setHeaderSort,
    setSearchTerm,
    hostOwnsSearch,
    querySearchTerm,
    searchFieldsKey,
  };
}
