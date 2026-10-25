/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useMemo } from 'react';
import type { PivotTableSchema, PivotAggregation } from '@object-ui/types';
import { cn } from '@object-ui/components';
import type { DrillEvent } from '@object-ui/core';
import { useSafeTranslate } from '@object-ui/i18n';
import { WidgetEmptyState } from './WidgetEmptyState';

function useTotalLabel(): string {
  return useSafeTranslate()('dashboard.total', 'Total');
}

export interface PivotTableProps {
  schema: PivotTableSchema;
  className?: string;
  /**
   * Optional value→label map for the row field. Callers (e.g.
   * ObjectPivotTable) derive this from the referenced object's schema so the
   * pivot displays select-field labels (e.g. "Proposal") instead of raw
   * stored values (e.g. "proposal").
   */
  rowLabels?: Record<string, string>;
  /** Same as rowLabels but for the column field. */
  columnLabels?: Record<string, string>;
  /** Optional display label for the row field name (e.g. "Stage" for "stage"). */
  rowFieldLabel?: string;
  /**
   * What this pivot is bound to, named in the default empty state
   * (objectui#7063). `ObjectPivotTable` passes its `schema.objectName`; a pivot
   * over inline `schema.data` has no source to name and omits it. NOT read off
   * `schema`: `PivotTableSchema` declares no `objectName`, so reading one would
   * be reading a key the type says cannot be there — it survives
   * `ObjectPivotTable`'s spread only by accident.
   */
  sourceLabel?: string;
  /**
   * Drill-down click handler, and the ONLY drill switch. When provided, cells /
   * row & column headers / totals become interactive and each click hands its
   * context here; the host decides what a drill opens. `ObjectPivotTable`
   * passes it exactly when its `object-pivot` `drillDown` is enabled.
   *
   * Nothing is read off `schema` for this: `drillDown` on a `pivot` node is a
   * retirement tombstone (objectui#10932), since this component used to drill
   * only for a host that passed this handler and the `pivot` registration
   * passes none. Not a `drillDown` prop either: `SchemaRenderer` spreads a
   * node's keys as props, so a prop of that name would hand an authored
   * `drillDown` straight back to this component.
   */
  onDrillDown?: (event: DrillEvent) => void;
}

/** Apply a simple format string to a number. Supports prefix/suffix like "$,.2f". */
function formatValue(value: number, format?: string): string {
  if (!format) return String(value);

  let prefix = '';
  let useGrouping = false;
  let decimals: number | undefined;

  let fmt = format;

  // Extract leading non-format characters as prefix (e.g. "$")
  const prefixMatch = fmt.match(/^([^0-9.,#]*)/);
  if (prefixMatch && prefixMatch[1]) {
    // comma inside the prefix-ish area means grouping, not a literal prefix
    const raw = prefixMatch[1];
    prefix = raw.replace(',', '');
    if (raw.includes(',')) useGrouping = true;
    fmt = fmt.slice(prefixMatch[1].length);
  }

  // Grouping indicator anywhere remaining
  if (fmt.includes(',')) {
    useGrouping = true;
    fmt = fmt.replace(/,/g, '');
  }

  // Decimal specifier e.g. ".2f"
  const decMatch = fmt.match(/\.(\d+)f?/);
  if (decMatch) {
    decimals = Number(decMatch[1]);
    fmt = fmt.slice(decMatch[0].length);
  }

  // Remaining characters become suffix
  const suffix = fmt.replace(/[0-9#.f]/g, '');

  const formatted = decimals !== undefined ? value.toFixed(decimals) : String(value);

  if (useGrouping) {
    const [intPart, decPart] = formatted.split('.');
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return prefix + (decPart !== undefined ? `${grouped}.${decPart}` : grouped) + suffix;
  }

  return prefix + formatted + suffix;
}

/** Friendly display label for an empty/null column or row key. */
const EMPTY_KEY_LABEL = '—';

function displayKey(key: string, labels?: Record<string, string>): string {
  if (key === '') return EMPTY_KEY_LABEL;
  return labels?.[key] ?? key;
}

/**
 * "No rows" as ONE stable value, never a per-render `[]` literal
 * (objectui#5562).
 *
 * `PivotTable` spelled the empty array TWICE — as the destructuring default
 * for `schema.data` and as the `Array.isArray` fallback — so a schema that
 * declares no `data` key, or whose `data` is a provider-config object rather
 * than rows, produced a FRESH array identity on every render. That value is
 * the first entry of the cross-tabulation memo's dependency list
 * (`[data, rowField, columnField, valueField, aggregation]`), so the memo
 * rebuilt its two ordered key sets, its `bucket[row][col]` map, the aggregated
 * matrix and the row/column/grand totals on every render, over nothing.
 *
 * Both spellings now resolve to this one module-scope value, so "no rows" is
 * stable across renders and the memo holds. Same fix, same reason as
 * `data-table.tsx`'s EMPTY_COLUMNS/EMPTY_ROWS (objectui#4618) and
 * `ObjectPivotTable`'s (objectui#4629); this is the direct-use path those two
 * did not cover.
 *
 * Frozen so a consumer that mutates the array it was handed cannot corrupt the
 * shared instance for every other pivot on the page.
 */
const EMPTY_ROWS = Object.freeze([]) as unknown as PivotTableSchema['data'];

/**
 * The aggregations this pivot computes — the renderer half of the spec's
 * `ChartAggregateFunctionSchema` (`ui/chart.zod.ts`), the UI-side subset the
 * spec deliberately carved out of the engine's 8-name `AggregationFunction`.
 * Engine-level names (`count_distinct`, `array_agg`, `string_agg`) used to
 * fall into a `default:` branch that returned a SUM — a plausible wrong total
 * with no signal (#2941). They now short-circuit to a visible notice before
 * any cell is computed. Exported for the spec-parity test.
 */
export const PIVOT_AGGREGATIONS: ReadonlySet<string> = new Set(['sum', 'count', 'avg', 'min', 'max']);

/** Aggregate an array of numbers with the given function. */
function aggregate(values: number[], fn: PivotAggregation): number {
  if (values.length === 0) return 0;
  switch (fn) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'count':
      return values.length;
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    default:
      // Unreachable: the component refuses to render out-of-vocabulary
      // aggregations. NaN (never a silent sum) is the tripwire if a new call
      // site skips that gate.
      return Number.NaN;
  }
}

/**
 * PivotTable – Cross-tabulation / Pivot Table component.
 *
 * Renders a matrix where rows correspond to `rowField`, columns to
 * `columnField`, and cells show the aggregated `valueField`.
 */
export const PivotTable: React.FC<PivotTableProps> = ({ schema, className, rowLabels, columnLabels, rowFieldLabel, sourceLabel, onDrillDown }) => {
  const {
    title,
    rowField,
    columnField,
    valueField,
    aggregation = 'sum',
    // Module-scope empty, never a `[]` literal — see EMPTY_ROWS.
    data: rawData = EMPTY_ROWS,
    showRowTotals = false,
    showColumnTotals = false,
    format,
    columnColors,
  } = schema;
  const totalLabel = useTotalLabel();

  // The host's handler is the switch (see `onDrillDown`); nothing on the node is.
  const drillEnabled = typeof onDrillDown === 'function';
  const fireDrill = (ev: DrillEvent) => {
    if (!drillEnabled) return;
    onDrillDown!({
      ...ev,
      rowLabel: ev.rowKey !== undefined ? (rowLabels?.[ev.rowKey] ?? ev.rowKey) : ev.rowLabel,
      colLabel: ev.colKey !== undefined ? (columnLabels?.[ev.colKey] ?? ev.colKey) : ev.colLabel,
    });
  };
  const drillKey = (handler: () => void): React.KeyboardEventHandler => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
  const cellInteractive = drillEnabled
    ? 'cursor-pointer hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]'
    : '';

  // Ensure data is always an array – provider config objects must not reach
  // iteration. The fallback is the shared empty, not a literal, so a
  // provider-config schema does not re-key the cross-tabulation memo below
  // on every render (objectui#5562).
  const data = Array.isArray(rawData) ? rawData : EMPTY_ROWS;

  const { rowKeys, colKeys, matrix, rowTotals, colTotals, grandTotal } = useMemo(() => {
    // Collect unique row/column values preserving insertion order
    const rowSet = new Map<string, true>();
    const colSet = new Map<string, true>();
    // Bucket raw values: bucket[row][col] = number[]
    const bucket: Record<string, Record<string, number[]>> = {};

    for (const item of data) {
      const r = String(item[rowField] ?? '');
      const c = String(item[columnField] ?? '');
      const v = Number(item[valueField]) || 0;

      rowSet.set(r, true);
      colSet.set(c, true);

      if (!bucket[r]) bucket[r] = {};
      if (!bucket[r][c]) bucket[r][c] = [];
      bucket[r][c].push(v);
    }

    const rKeys = Array.from(rowSet.keys());
    const cKeys = Array.from(colSet.keys());

    // Build aggregated matrix
    const mat: Record<string, Record<string, number>> = {};
    const rTotals: Record<string, number> = {};
    const cTotals: Record<string, number> = {};

    for (const r of rKeys) {
      mat[r] = {};
      const rowValues: number[] = [];
      for (const c of cKeys) {
        const cellValues = bucket[r]?.[c] ?? [];
        const cellAgg = aggregate(cellValues, aggregation);
        mat[r][c] = cellAgg;
        rowValues.push(...cellValues);

        // Accumulate column bucket values for column totals
        if (!cTotals[c] && cTotals[c] !== 0) {
          // Will compute after
        }
      }
      rTotals[r] = aggregate(rowValues, aggregation);
    }

    // Column totals
    for (const c of cKeys) {
      const colValues: number[] = [];
      for (const r of rKeys) {
        const cellValues = bucket[r]?.[c] ?? [];
        colValues.push(...cellValues);
      }
      cTotals[c] = aggregate(colValues, aggregation);
    }

    // Grand total
    const allValues: number[] = [];
    for (const item of data) {
      allValues.push(Number(item[valueField]) || 0);
    }
    const gt = aggregate(allValues, aggregation);

    return { rowKeys: rKeys, colKeys: cKeys, matrix: mat, rowTotals: rTotals, colTotals: cTotals, grandTotal: gt };
  }, [data, rowField, columnField, valueField, aggregation]);

  const fmt = (v: number) => formatValue(v, format);

  // Out-of-vocabulary aggregation (e.g. the engine-level `count_distinct`
  // arriving through untyped SDUI JSON): refuse loudly instead of quietly
  // summing every cell (#2941). Placed after the hooks so their order stays
  // stable across renders.
  if (!PIVOT_AGGREGATIONS.has(aggregation)) {
    return (
      <div className={cn('overflow-auto', className)} data-testid="pivot-unsupported-aggregation">
        {title && (
          <h3 className="text-sm font-semibold mb-2">{title}</h3>
        )}
        <div role="alert" className="flex flex-col items-center justify-center py-8 text-destructive">
          <p className="text-xs">
            Unsupported aggregation &ldquo;{String(aggregation)}&rdquo; — this pivot table renders{' '}
            {[...PIVOT_AGGREGATIONS].join(', ')}.
          </p>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={cn('overflow-auto', className)}>
        {title && (
          <h3 className="text-sm font-semibold mb-2">{title}</h3>
        )}
        {/* objectui#7063 — the shared dashboard default. The title used to be
            suppressed outright (`title=""` plus `[&>h3]:hidden`), leaving a
            grid glyph over a bare `dashboard.noDataAvailable` line: exactly
            the "reads as a load failure" shape the ruling is about. */}
        <WidgetEmptyState testId="pivot-empty-state" source={sourceLabel} className="py-8" />
      </div>
    );
  }

  return (
    <div className={cn('overflow-auto', className)}>
      {title && (
        <h3 className="text-sm font-semibold mb-2">{title}</h3>
      )}
      <table className="w-full text-sm border-collapse table-auto" role="table">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">{rowFieldLabel || rowField}</th>
            {colKeys.map((col) => {
              const onClick = () => fireDrill({ scope: 'column', colKey: col });
              return (
                <th
                  key={col}
                  className={cn(
                    'text-right p-2 font-medium whitespace-nowrap',
                    col === '' && 'italic text-muted-foreground/70',
                    columnColors?.[col] ?? 'text-muted-foreground',
                    cellInteractive,
                  )}
                  title={col === '' ? `${columnField}: (empty)` : `${columnField}: ${col}`}
                  role={drillEnabled ? 'button' : undefined}
                  tabIndex={drillEnabled ? 0 : undefined}
                  onClick={drillEnabled ? onClick : undefined}
                  onKeyDown={drillEnabled ? drillKey(onClick) : undefined}
                  aria-label={drillEnabled ? `Drill into ${columnField}: ${col || '(empty)'}` : undefined}
                >
                  {displayKey(col, columnLabels)}
                </th>
              );
            })}
            {showRowTotals && (
              <th className="text-right p-2 font-semibold text-muted-foreground bg-muted/20 whitespace-nowrap">{totalLabel}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rowKeys.map((row) => (
            <tr key={row} className="border-b border-border/50 hover:bg-muted/30">
              <td
                className={cn(
                  'p-2 font-medium whitespace-nowrap',
                  row === '' && 'italic text-muted-foreground/70',
                  cellInteractive,
                )}
                role={drillEnabled ? 'button' : undefined}
                tabIndex={drillEnabled ? 0 : undefined}
                onClick={drillEnabled ? () => fireDrill({ scope: 'row', rowKey: row }) : undefined}
                onKeyDown={drillEnabled ? drillKey(() => fireDrill({ scope: 'row', rowKey: row })) : undefined}
                aria-label={drillEnabled ? `Drill into ${rowField}: ${row || '(empty)'}` : undefined}
              >
                {displayKey(row, rowLabels)}
              </td>
              {colKeys.map((col) => {
                const value = matrix[row]?.[col] ?? 0;
                const onClick = () => fireDrill({ scope: 'cell', rowKey: row, colKey: col, value });
                return (
                  <td
                    key={col}
                    className={cn(
                      'text-right p-2 tabular-nums',
                      columnColors?.[col],
                      cellInteractive,
                    )}
                    role={drillEnabled ? 'button' : undefined}
                    tabIndex={drillEnabled ? 0 : undefined}
                    onClick={drillEnabled ? onClick : undefined}
                    onKeyDown={drillEnabled ? drillKey(onClick) : undefined}
                    aria-label={drillEnabled ? `Drill into ${rowField}=${row || '(empty)'}, ${columnField}=${col || '(empty)'}` : undefined}
                  >
                    {fmt(value)}
                  </td>
                );
              })}
              {showRowTotals && (
                <td
                  className={cn('text-right p-2 font-semibold tabular-nums bg-muted/20', cellInteractive)}
                  role={drillEnabled ? 'button' : undefined}
                  tabIndex={drillEnabled ? 0 : undefined}
                  onClick={drillEnabled ? () => fireDrill({ scope: 'row', rowKey: row, value: rowTotals[row] ?? 0 }) : undefined}
                  onKeyDown={drillEnabled ? drillKey(() => fireDrill({ scope: 'row', rowKey: row, value: rowTotals[row] ?? 0 })) : undefined}
                >
                  {fmt(rowTotals[row] ?? 0)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {showColumnTotals && (
          <tfoot>
            <tr className="border-t-2 border-border font-semibold bg-muted/40">
              <td className="p-2">{totalLabel}</td>
              {colKeys.map((col) => (
                <td
                  key={col}
                  className={cn('text-right p-2 tabular-nums', cellInteractive)}
                  role={drillEnabled ? 'button' : undefined}
                  tabIndex={drillEnabled ? 0 : undefined}
                  onClick={drillEnabled ? () => fireDrill({ scope: 'column', colKey: col, value: colTotals[col] ?? 0 }) : undefined}
                  onKeyDown={drillEnabled ? drillKey(() => fireDrill({ scope: 'column', colKey: col, value: colTotals[col] ?? 0 })) : undefined}
                >
                  {fmt(colTotals[col] ?? 0)}
                </td>
              ))}
              {showRowTotals && (
                <td
                  className={cn('text-right p-2 tabular-nums font-bold', cellInteractive)}
                  role={drillEnabled ? 'button' : undefined}
                  tabIndex={drillEnabled ? 0 : undefined}
                  onClick={drillEnabled ? () => fireDrill({ scope: 'total', value: grandTotal }) : undefined}
                  onKeyDown={drillEnabled ? drillKey(() => fireDrill({ scope: 'total', value: grandTotal })) : undefined}
                >
                  {fmt(grandTotal)}
                </td>
              )}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};
