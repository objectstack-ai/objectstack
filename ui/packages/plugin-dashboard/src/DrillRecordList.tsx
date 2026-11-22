/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The records behind a drilled number, drawn by the standard list
 * (objectstack-ai/objectstack#36256 item 5): the `list-view` block the object
 * list page draws its table with, mounted through the registry, so the drill
 * has the list's row height, sorting, filter chips, added columns, record
 * count and column calculations, and no table of its own.
 *
 * What the reader does here is this mount's state alone (item 8): the sort,
 * the edited chips, the added columns and the column calculations live in the
 * list and in this component, are written nowhere (no view, no preference),
 * and are gone when the drill closes. The list is read-only: no inline edit,
 * no create, no bulk action, no view switch, no saved view.
 *
 * The record's name opens its full page through the host
 * (`DrillNavigationContext.openRecord`, item 6), with the rows the list shows
 * as the page's ↑ ↓ set and the count it matched; no record panel is stacked
 * over the drill.
 */

import React from 'react';
import { ComponentRegistry, resolveFilterPlaceholders, resolveNameField } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererContext, useDrillNavigation, useFilterScope } from '@object-ui/react';
import { Loader2 } from 'lucide-react';
import { drillListConditions } from './drillConditions';

/** The registry key of the standard list (`@object-ui/plugin-list`). */
export const DRILL_LIST_COMPONENT = 'list-view';

/** Whether the standard list is registered in this renderer, loaded or lazily (the Console registers it lazily). */
export function drillListAvailable(): boolean {
  return ComponentRegistry.has(DRILL_LIST_COMPONENT) || ComponentRegistry.hasLazy(DRILL_LIST_COMPONENT);
}

export interface DrillRecordListProps {
  objectName: string;
  /** The drill's filter, as composed (placeholders still authored). */
  filter?: Record<string, unknown>;
  /** An authored column whitelist (`drillDown.columns`): shown as written. */
  columns?: string[];
  /** The columns the drill stands for (the grouped and measured fields), after the record's name. */
  defaultColumns?: string[];
  /** Rows per page (`drillDown.maxRows`). */
  maxRows?: number;
  dataSource?: any;
  /** Called after the host opened a record's page. */
  onNavigate?: () => void;
}

type Summary = string | Record<string, unknown>;

const rowId = (row: Record<string, unknown>): string | undefined => {
  const id = row?.id ?? row?._id;
  return id == null || id === '' ? undefined : String(id);
};

export const DrillRecordList: React.FC<DrillRecordListProps> = ({
  objectName,
  filter,
  columns,
  defaultColumns,
  maxRows,
  dataSource: ownDataSource,
  onNavigate,
}) => {
  const context = React.useContext(SchemaRendererContext);
  const dataSource = ownDataSource ?? context?.dataSource;
  const { openRecord } = useDrillNavigation();
  const scope = useFilterScope();
  // One resolution per mount: a chip shows the value the query compares.
  const conditions = React.useMemo(
    () => drillListConditions(resolveFilterPlaceholders(filter, scope) as Record<string, unknown> | undefined),
    // The drill's filter is fixed for the life of this mount (the dialog keys it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // The object's name field leads the default columns, as on the list page.
  const [nameField, setNameField] = React.useState<string | null | undefined>(
    columns?.length || typeof dataSource?.getObjectSchema !== 'function' ? null : undefined,
  );
  React.useEffect(() => {
    if (nameField !== undefined) return;
    let live = true;
    Promise.resolve(dataSource.getObjectSchema(objectName))
      .then((def: unknown) => { if (live) setNameField(resolveNameField(def) ?? null); })
      .catch(() => { if (live) setNameField(null); });
    return () => { live = false; };
  }, [dataSource, objectName, nameField]);

  const [added, setAdded] = React.useState<string[]>([]);
  const [summaries, setSummaries] = React.useState<Record<string, Summary>>({});
  const shown = React.useRef<{ ids: string[]; total?: number }>({ ids: [] });

  const baseColumns = React.useMemo(() => {
    if (columns?.length) return columns;
    const lead = nameField ? [nameField] : [];
    return Array.from(new Set([...lead, ...(defaultColumns ?? [])]));
  }, [columns, defaultColumns, nameField]);

  if (nameField === undefined) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  const listColumns = [...baseColumns, ...added.filter((f) => !baseColumns.includes(f))].map((field) =>
    summaries[field] ? { field, summary: summaries[field] } : field,
  );
  const schema = {
    type: DRILL_LIST_COMPONENT,
    // The page node's binding (`PageComponentSchema.dataSource`): the block
    // lands its `object` on the list's `objectName`. The default kind is the grid.
    dataSource: { object: objectName },
    ...(conditions.rest ? { filter: conditions.rest } : {}),
    // An empty list lets the list pick its own columns (no name field known).
    ...(listColumns.length > 0 ? { columns: listColumns } : {}),
    ...(maxRows ? { pagination: { pageSize: maxRows } } : {}),
    userActions: { editInline: false, addRecordForm: false, rowColor: false, group: false },
  };

  return (
    <SchemaRenderer
      schema={schema as any}
      dataSource={dataSource}
      initialFilters={conditions.chips}
      showViewSwitcher={false}
      addedFields={added}
      onAddedFieldsChange={setAdded}
      onColumnSummaryPick={(field: string, summary: Summary | null) => {
        setSummaries((prev) => {
          const next = { ...prev };
          if (summary) next[field] = summary;
          else delete next[field];
          return next;
        });
      }}
      onRowsChange={(rows: ReadonlyArray<Record<string, unknown>>) => {
        shown.current = { ...shown.current, ids: rows.map(rowId).filter((id): id is string => !!id) };
      }}
      onTotalChange={(total: number) => { shown.current = { ...shown.current, total }; }}
      rowOpensRecord={!!openRecord}
      onRowClick={openRecord ? (record: Record<string, unknown>) => {
        const id = rowId(record);
        if (!id) return;
        const { ids, total } = shown.current;
        openRecord(objectName, id, { siblings: ids.includes(id) ? ids : [id], ...(total != null ? { total } : {}) });
        onNavigate?.();
      } : undefined}
    />
  );
};
