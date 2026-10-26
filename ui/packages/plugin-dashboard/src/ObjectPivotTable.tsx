/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useDataScope, SchemaRendererContext, useFilterScope, useDataInvalidation } from '@object-ui/react';
import { useSafeFieldLabel } from '@object-ui/i18n';
import { extractRecords, computeDrillFilter, composeDrillFilter, FilterOperatorError, isDrillEnabled, resolveDrillTitle, type DrillEvent } from '@object-ui/core';
import { Skeleton, cn } from '@object-ui/components';
import { PivotTable } from './PivotTable';
import { DrillDownDrawer } from './DrillDownDrawer';
import { resolveFilterPlaceholders } from './utils';
import type { ObjectPivotDrillDownConfig, PivotTableSchema } from '@object-ui/types';

/**
 * Shared empty fallback for the resolved row list (objectui#4629).
 *
 * `Array.isArray(rawData) ? rawData : []` evaluates a FRESH array on every
 * render, and this component hands the result straight to `PivotTable` as
 * `finalSchema.data`, where it is the identity key of the cross-tabulation
 * memo (`PivotTable.tsx`, `[data, rowField, columnField, valueField,
 * aggregation]`). So while `rawData` is a non-array — a provider-config
 * `data`, or a `bind` path that resolves to an object — that memo rebuilds its
 * row/column sets, bucket map and totals on every render over nothing at all.
 * A module-scope empty makes "no rows yet" a stable value, and the
 * `Array.isArray` arm downstream passes it through unchanged, so the memo
 * holds.
 *
 * The same move `data-table.tsx` made for its own `EMPTY_ROWS` (objectui#4618,
 * PR #4623) and `ObjectDataTable.tsx` makes for the identical expression.
 *
 * Frozen so a consumer that mutates the array it was handed cannot corrupt the
 * shared instance for every other pivot on the page.
 */
const EMPTY_ROWS = Object.freeze([]) as unknown as any[];

/**
 * `PivotTableSchema` minus `drillDown`, which is a retirement tombstone on the
 * `pivot` node (objectui#10932). `object-pivot` declares its own `drillDown`
 * below, and intersecting it with the tombstone would collapse that member to
 * `never`: the one pivot that drills could not be authored with a drill.
 *
 * Key remapping, not `Omit`: written while `PivotTableSchema` inherited
 * `BaseSchema`'s `[key: string]: any`, which widened `keyof` to all of
 * `string`, so `Omit<PivotTableSchema, 'drillDown'>` would have kept the index
 * signature and dropped every declared member. objectui#8347 removed the
 * signature.
 */
type PivotTableSchemaWithoutDrillDown = {
  [K in keyof PivotTableSchema as K extends 'drillDown' ? never : K]: PivotTableSchema[K];
};

export interface ObjectPivotTableProps {
  schema: PivotTableSchemaWithoutDrillDown & {
    objectName?: string;
    /**
     * RETIRED (objectui#7353, ADR-0049 remove arm, ruling 5809008870) — write
     * `objectName`, the key this widget fetches through.
     *
     * This member carried the dashboard widget's provider config
     * (`{ provider, object }`), copied onto the pivot node beside `objectName`
     * by `DashboardGridLayout` and read by nothing. The producer no longer
     * writes it and no reader was added.
     *
     * A `?: never` tombstone, not a plain deletion: `PivotTableSchema` extends
     * `BaseSchema`, whose `[key: string]: any` absorbed a deleted member
     * silently at any value until objectui#8347 (a widened value still would). Licensed by prong 1 of the discriminator
     * (objectui#5941, #7526, in its amended form, `5f8190c8c`): it names the live
     * replacement, `objectName`. A JSON-authored value is refused by name at
     * parse time too, since objectui#11440: the `object-pivot` arm of
     * `@object-ui/types/zod` declares the same retirement in its props bag.
     *
     * @deprecated Not read by `ObjectPivotTable` — write `objectName`.
     */
    dataProvider?: never;
    // The data-scope binding key is NOT re-declared here. It used to be, as a
    // local member grown because no schema shape declared it — the
    // second-declaration class objectui#6357 measured. `PivotTableSchema
    // extends BaseSchema`, which now declares it once, same spelling.

    // ⚠️ `filter` STAYS a local member, and that is a decision rather than an
    // oversight (objectui#9024). It is read twice below — the fetch leg's
    // `$filter` and the drill seam — and `object-pivot`'s registry `inputs`
    // advertise it, so the key is live. What it is NOT is a member of the
    // schema type above: `PivotTableSchema` is `type: 'pivot'`, the plain
    // cross-tab, and `PivotTable` reads no `filter` at all — declaring it there
    // would put an `object-pivot`-only key on the one node type that never
    // reads it, and STILL leave `object-pivot` (which does) undeclared, since
    // an `object-pivot` node is not assignable to that `type` literal. It is
    // the same reason `objectName` is passed to `PivotTable` as a PROP instead
    // of read off `finalSchema` (see the comment at the render below).
    //
    // The sibling widgets each declare `filter` on their OWN `Object*Schema`:
    // measured on this tree, NINE of the eleven `Object*Schema` interfaces in
    // `@object-ui/types` declare it — six array-only (`ObjectGridSchema`,
    // `ObjectViewSchema`, `ObjectMapSchema`, `ObjectGanttSchema`,
    // `ObjectCalendarSchema`, `ObjectKanbanSchema`), plus `ObjectChartSchema`'s
    // two-armed union, `ObjectGallerySchema`'s `unknown` and
    // `ObjectDataTableSchema`'s `any`. `object-pivot` has no such interface at
    // all, so the consistent fix is to give it one carrying the two live
    // members grown here — `objectName`, `filter` — and the `dataProvider`
    // tombstone beside them. That widens a
    // published authorable surface and wants its own card and ruling, rather
    // than a one-member edit smuggled into a composition fix.
    //
    // ⭐ The composition below does NOT depend on this: `composeDrillFilter`
    // takes `unknown` and routes every shape through the repo's single filter
    // sink, so the drill is correct for both arms whatever this key is typed.
    filter?: any;
    /**
     * This block's drill-down shape, `ObjectPivotDrillDownConfig`: `mode` is
     * refused by name (objectui#10685, applying objectui#9002's ruling B).
     * Every click point on a pivot is an aggregated bucket, so it always drills
     * through; there is no row for `mode` to open as a record. `PivotTableSchema`
     * carries no drill at all: on a plain `pivot` node the key is a retirement
     * tombstone (objectui#10932), and this block is where a pivot drill lives.
     */
    drillDown?: ObjectPivotDrillDownConfig;
  };
  dataSource?: any;
  className?: string;
}

/**
 * ObjectPivotTable — Async-aware wrapper around PivotTable.
 *
 * When `objectName` is provided and a `dataSource` is available via context
 * or props, fetches records automatically and passes them to PivotTable.
 *
 * Lifecycle states:
 * - **Loading** → skeleton placeholder
 * - **Error** → error message
 * - **Empty** → friendly "No data available" (delegated to PivotTable)
 * - **Data** → PivotTable with fetched rows
 */
export const ObjectPivotTable: React.FC<ObjectPivotTableProps> = ({ schema, dataSource: propDataSource, className }) => {
  const context = useContext(SchemaRendererContext);
  const dataSource = propDataSource || context?.dataSource;
  const boundData = useDataScope(schema.bind);

  const [fetchedData, setFetchedData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-field value→label maps and field-name→display-label mapping derived
  // from the referenced object's schema. Lets the pivot table render
  // select-field display labels (e.g. "Web") instead of raw stored values
  // (e.g. "web"), and use the field's display label (e.g. "Stage") in the
  // top-left header cell.
  const [fieldLabelMaps, setFieldLabelMaps] = useState<Record<string, Record<string, string>>>({});
  const [fieldNameLabels, setFieldNameLabels] = useState<Record<string, string>>({});
  // Drill-down click event — declared with the other hooks (above any
  // conditional early return) to keep React's hook order stable.
  const [drillEvent, setDrillEvent] = useState<DrillEvent | null>(null);

  // i18n: translate field display labels and select option labels via the
  // standard object/field translation conventions.
  const { fieldLabel, fieldOptionLabel } = useSafeFieldLabel();

  useEffect(() => {
    if (!dataSource || !schema.objectName) return;
    const getSchema = (dataSource as any).getObjectSchema;
    if (typeof getSchema !== 'function') return;
    let alive = true;
    Promise.resolve(getSchema.call(dataSource, schema.objectName))
      .then((s: any) => {
        if (!alive || !s?.fields) return;
        const objectName = schema.objectName!;
        const maps: Record<string, Record<string, string>> = {};
        const nameLabels: Record<string, string> = {};
        for (const [fieldName, fieldDef] of Object.entries<any>(s.fields)) {
          const rawLabel = fieldDef?.label ? String(fieldDef.label) : fieldName;
          nameLabels[fieldName] = fieldLabel(objectName, fieldName, rawLabel);
          const opts = fieldDef?.options;
          if (Array.isArray(opts) && opts.length > 0) {
            const m: Record<string, string> = {};
            for (const opt of opts) {
              if (opt && opt.value !== undefined && opt.label !== undefined) {
                const value = String(opt.value);
                const fallback = String(opt.label);
                m[value] = fieldOptionLabel(objectName, fieldName, value, fallback);
              }
            }
            if (Object.keys(m).length > 0) maps[fieldName] = m;
          }
        }
        setFieldLabelMaps(maps);
        setFieldNameLabels(nameLabels);
      })
      .catch(() => { /* silently fall back to raw values */ });
    return () => { alive = false; };
    // `fieldLabel` / `fieldOptionLabel` are REAL dependencies: the derivation
    // above calls both, so a run with a stale resolver stores stale labels in
    // `fieldLabelMaps` / `fieldNameLabels` and the pivot's headers and cells
    // render in the wrong language until some unrelated dependency happens to
    // move. They used to be hidden behind refs because `useSafeFieldLabel()`
    // returned a fresh object on every render outside an i18next provider,
    // which would have made this effect re-run on every render — and, because
    // it ends in two `setState` calls with freshly built objects, each run
    // scheduled the next one: an unbounded derive loop. `useObjectLabel`'s memo
    // now holds on both paths (objectui#5564), so these identities change only
    // when the resolver genuinely changes — a provider mounting, or a language
    // switch — and the effect settles after one run per such change.
    // Pinned by `ObjectPivotTable.i18nResolverDeps.test.tsx` (objectui#5625).
  }, [dataSource, schema.objectName, fieldLabel, fieldOptionLabel]);

  // Session scope for `{current_user_id}` / `{current_org_id}` in the schema
  // filter. Read at component level — the fetch below is async.
  const filterScope = useFilterScope();

  // objectui#10778 — the data-invalidation bus (`notifyDataChanged` from
  // `@object-ui/react`), read the objectui#10623 way: the nonce moves when a
  // write to the object this pivot QUERIES is declared, and the fetch effect
  // below names it, so the cross-tab is re-read in place (the skeleton is drawn
  // only while there are no rows yet). Without it a page action over raw HTTP
  // left the pivot stale unless the page was remounted.
  //
  // `schema.objectName` is the object for both spellings of the binding: the
  // flat key, and the element `dataSource: { object }` that `ObjectPivotBlock`
  // binds onto it. Subscribed only when this effect queries: bound rows and
  // authored `data` rows are not its query.
  const fetchesForItself =
    !!dataSource && !!schema.objectName && !boundData && (!schema.data || schema.data.length === 0);
  const invalidationNonce = useDataInvalidation(fetchesForItself ? schema.objectName : undefined);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      if (!dataSource || !schema.objectName) return;
      if (isMounted) {
        setLoading(true);
        setError(null);
      }
      try {
        let data: any[];

        if (typeof dataSource.find === 'function') {
          const results = await dataSource.find(schema.objectName, {
            $filter: resolveFilterPlaceholders(schema.filter, filterScope),
          });
          data = extractRecords(results);
        } else {
          return;
        }

        if (isMounted) {
          setFetchedData(data);
        }
      } catch (e) {
        console.error('[ObjectPivotTable] Fetch error:', e);
        if (isMounted) {
          setError(e instanceof Error ? e.message : 'Failed to load data');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    if (schema.objectName && !boundData && (!schema.data || schema.data.length === 0)) {
      fetchData();
    }

    return () => { isMounted = false; };
  }, [schema.objectName, dataSource, boundData, schema.data, schema.filter, filterScope, invalidationNonce]);

  // --- Drill-down composition --------------------------------------------
  // The filter the drilled list is scoped by: this pivot's own filter narrowed
  // by the clicked cell (see `renderDrillDrawer` below for why it is composed
  // and never spread). Computed HERE, above the early returns, so the refusal
  // below can be reported from an effect rather than from render.
  //
  // ⚠️ The composition lowers both filters through the throwing converter
  // form — objectui#10789. It ran inside `renderDrillDrawer`, i.e. during
  // RENDER after a click, so a pivot filter this layer refuses (one that drew
  // the pivot from inline or bound rows, which nothing lowers here) threw into
  // the error boundary and took the pivot with it. The refusal is kept as a
  // VALUE: no drawer opens and nothing is navigated to (never with "no
  // filter", which would list every record the pivot is scoped to exclude),
  // and it is logged, naming the operator — the channel a failed drill already
  // reports on (`ReportView`'s drill handler). Only a `FilterOperatorError` is
  // caught, the rule `toFilterNodeSafely` states.
  const drillComposition = useMemo(():
    | { ok: true; filter: Record<string, unknown> | undefined }
    | { ok: false; refusal: FilterOperatorError }
    | undefined => {
    if (!drillEvent) return undefined;
    try {
      const clicked = computeDrillFilter(schema.drillDown, drillEvent, {
        rowField: schema.rowField,
        columnField: schema.columnField,
      });
      return { ok: true, filter: composeDrillFilter(schema.filter, clicked) };
    } catch (error) {
      if (!(error instanceof FilterOperatorError)) throw error;
      return { ok: false, refusal: error };
    }
  }, [drillEvent, schema.drillDown, schema.rowField, schema.columnField, schema.filter]);
  // Keyed on the MESSAGE, a primitive: one warning per refused declaration.
  const drillRefusalMessage = drillComposition?.ok === false ? drillComposition.refusal.message : undefined;
  useEffect(() => {
    if (drillRefusalMessage) {
      console.warn(`[ObjectPivotTable] drill-down refused — the drilled list cannot be scoped: ${drillRefusalMessage}`);
    }
  }, [drillRefusalMessage]);

  // Resolve data: bound data > static schema data > fetched data
  const rawData = boundData || schema.data || fetchedData;
  const finalData = Array.isArray(rawData) ? rawData : EMPTY_ROWS;

  // Loading skeleton
  if (loading && finalData.length === 0) {
    return (
      <div className={cn('overflow-auto', className)} data-testid="pivot-loading">
        {schema.title && (
          <h3 className="text-sm font-semibold mb-2">{schema.title}</h3>
        )}
        <div className="space-y-2 p-2">
          <div className="flex gap-2">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-20" />
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={cn('overflow-auto', className)} data-testid="pivot-error">
        {schema.title && (
          <h3 className="text-sm font-semibold mb-2">{schema.title}</h3>
        )}
        <div className="flex flex-col items-center justify-center py-8 text-destructive" data-testid="pivot-error-message">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mb-2 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-xs">{error}</p>
        </div>
      </div>
    );
  }

  // No data source available but objectName configured
  if (!dataSource && schema.objectName && finalData.length === 0) {
    return (
      <div className={cn('overflow-auto', className)}>
        {schema.title && (
          <h3 className="text-sm font-semibold mb-2">{schema.title}</h3>
        )}
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <p className="text-xs">No data source available for &ldquo;{schema.objectName}&rdquo;</p>
        </div>
      </div>
    );
  }

  // Delegate to PivotTable with resolved data. `drillDown` is this block's and
  // stays behind: `PivotTable` drills through `onDrillDown` below, and on the
  // `pivot` node it renders the key is a retirement tombstone (objectui#10932).
  const { drillDown: _objectPivotDrillDown, ...pivotSchema } = schema;
  const finalSchema: PivotTableSchema = {
    ...pivotSchema,
    data: finalData,
  };

  const rowLabels = schema.rowField ? fieldLabelMaps[schema.rowField] : undefined;
  const colLabels = schema.columnField ? fieldLabelMaps[schema.columnField] : undefined;
  const rowFieldLabel = schema.rowField ? fieldNameLabels[schema.rowField] : undefined;

  // --- Drill-down wiring ---------------------------------------------------
  const drillDown = schema.drillDown;

  const handleDrillDown = isDrillEnabled(drillDown)
    ? (event: DrillEvent) => setDrillEvent(event)
    : undefined;

  const renderDrillDrawer = () => {
    // A refused composition opens nothing (objectui#10789, above).
    if (!drillEvent || !schema.objectName || !drillComposition?.ok) return null;
    // ⛔ Composed through `composeDrillFilter`, NOT by spreading this pivot's
    // own filter into an object literal. `schema.filter` reaches this component
    // in BOTH dialects and a spread is only correct for the second:
    //
    //   - the ObjectQL `$filter` OBJECT (`{ region: 'emea' }`), and
    //   - a spec `FilterArray` / ObjectQL AST node (`[['region','=','emea']]`).
    //
    // The array arm is not hypothetical here, and it is not only what a hand
    // author may write: `object-pivot`'s registry `inputs` advertise
    // `{ name: 'filter', type: 'array' }` (see `index.tsx`), and
    // `ElementDataSourceGate` WRITES the array arm mechanically — binding a
    // pivot the spec way (`dataSource: { object, view }`) sets this key to
    // `mergeFilterNodes(schema.filter, view.filter)`, an AST node, for every
    // saved view that carries a filter. Spreading THAT yields index keys
    // (`{ '0': ['region','=','emea'] }`), so the pivot's own conditions were
    // replaced by a key the query layer ignores and the drilled list showed
    // rows this pivot is scoped to exclude (objectui#9024).
    //
    // ⚠️ Direction: the widget filter is what NARROWS, so losing it widened the
    // drill to a SUPERSET — silently, since nothing errors. The seam's docblock
    // names the composition rule (`widget.filter ∧ drill.filter`, via the
    // repo's single filter sink `mergeFilterNodes`); it is not decided here.
    // `ObjectChart` was routed through the same seam by objectui#8944.
    const merged = drillComposition.filter;
    const title = resolveDrillTitle(drillDown, drillEvent, schema.title || 'Details');
    return (
      <DrillDownDrawer
        open
        onClose={() => setDrillEvent(null)}
        title={title}
        target={drillDown?.target ?? 'drawer'}
        objectName={schema.objectName}
        filter={merged}
        dataSource={dataSource}
        columns={drillDown?.columns}
        maxRows={drillDown?.maxRows}
        report={drillDown?.report}
      />
    );
  };

  return (
    <>
      {/* objectui#7063 — `sourceLabel` is the object this pivot is bound to,
          named by the shared default empty state. Passed as a PROP because
          `finalSchema` is a `PivotTableSchema`, which declares no
          `objectName`; it survives the spread above only by accident and
          reading it there would be reading a key the type denies. */}
      <PivotTable
        schema={finalSchema}
        className={className}
        rowLabels={rowLabels}
        columnLabels={colLabels}
        rowFieldLabel={rowFieldLabel}
        sourceLabel={schema.objectName}
        onDrillDown={handleDrillDown}
      />
      {renderDrillDrawer()}
    </>
  );
};
