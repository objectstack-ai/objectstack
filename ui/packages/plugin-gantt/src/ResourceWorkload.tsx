/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Resource / Workload view.
 *
 * A per-resource load histogram aligned to the same time columns the Gantt grid
 * uses. Each resource gets a row; each column draws a bar whose height ∝ the
 * summed effort of that resource's tasks active in that span, painted red once
 * it exceeds capacity (over-allocation). The aggregation lives in `workload.ts`
 * (pure + unit-tested); this component is the renderer + timeline geometry.
 */
import * as React from 'react';
import { type GanttTask, type GanttViewMode, startOfUnit, addUnits } from './GanttView';
import { computeWorkload, type WorkloadColumn } from './workload';
import { useGanttTranslation } from './useGanttTranslation';
import { useDisplayLocale } from '@object-ui/i18n';

export interface ResourceWorkloadProps {
  tasks: GanttTask[];
  /** Resource accessor — null routes a task into the "unassigned" row. */
  assignee: (task: GanttTask) => { key: string | number; label: string } | null;
  /** Capacity units a task consumes while active (default 1). */
  effort?: (task: GanttTask) => number;
  /** Per-resource capacity ceiling; number or per-key function (default 1). */
  capacity?: number | ((key: string) => number);
  /** Time granularity — must match the chart it accompanies. */
  viewMode?: GanttViewMode;
  /** Label for the unassigned bucket. */
  unassignedLabel?: string;
  className?: string;
}

const DEFAULT_COL_WIDTH: Record<GanttViewMode, number> = {
  day: 26,
  week: 56,
  month: 76,
  quarter: 88,
  year: 104,
};

const ROW_HEIGHT = 48;
const HIST_HEIGHT = 34; // drawable height for the tallest bar
const LABEL_WIDTH = 180;

function columnLabel(date: Date, mode: GanttViewMode, locale: string): string {
  if (mode === 'day') return String(date.getDate());
  if (mode === 'week') return date.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' });
  if (mode === 'month') return date.toLocaleDateString(locale, { month: 'short' });
  if (mode === 'year') return String(date.getFullYear());
  return `Q${Math.floor(date.getMonth() / 3) + 1}`;
}

export function ResourceWorkload({
  tasks,
  assignee,
  effort,
  capacity = 1,
  viewMode = 'day',
  unassignedLabel = 'Unassigned',
  className,
}: ResourceWorkloadProps) {
  const { t } = useGanttTranslation();
  // The DISPLAY locale, never the UI language, and never `undefined`: the old
  // `language || undefined` handed an empty language to the MACHINE's locale
  // (objectui#10442).
  const locale = useDisplayLocale();
  const colWidth = DEFAULT_COL_WIDTH[viewMode];

  // Build columns over the task span (snapped to unit boundaries), mirroring
  // the Gantt grid so the histogram lines up column-for-column.
  const columns = React.useMemo<{ date: Date; col: WorkloadColumn; label: string }[]>(() => {
    if (!tasks.length) return [];
    const min = new Date(Math.min(...tasks.map((x) => x.start.getTime())));
    const max = new Date(Math.max(...tasks.map((x) => x.end.getTime())));
    let cur = startOfUnit(min, viewMode);
    const end = addUnits(startOfUnit(max, viewMode), 1, viewMode);
    const cols: { date: Date; col: WorkloadColumn; label: string }[] = [];
    // Guard against pathological spans (e.g. bad dates) blowing the loop up.
    let guard = 0;
    while (cur < end && guard++ < 4000) {
      const next = addUnits(cur, 1, viewMode);
      cols.push({ date: new Date(cur), col: { start: new Date(cur), end: new Date(next) }, label: columnLabel(cur, viewMode, locale) });
      cur = next;
    }
    return cols;
  }, [tasks, viewMode, locale]);

  const resources = React.useMemo(
    () => computeWorkload(tasks, columns.map((c) => c.col), { assignee, effort, capacity, unassignedLabel }),
    [tasks, columns, assignee, effort, capacity, unassignedLabel],
  );

  // Vertical scale: tallest bar across all resources, but at least one capacity
  // unit so an all-idle/under-capacity chart still shows the ceiling line.
  const maxScale = React.useMemo(() => {
    let m = 0;
    for (const r of resources) { m = Math.max(m, r.peak, r.capacity); }
    return m || 1;
  }, [resources]);

  const totalWidth = columns.length * colWidth;

  if (!tasks.length) {
    return (
      <div className={className} data-testid="resource-workload">
        <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
          {t('gantt.resource.empty')}
        </div>
      </div>
    );
  }

  return (
    <div
      className={className}
      data-testid="resource-workload"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}
    >
      <div style={{ display: 'flex', minWidth: LABEL_WIDTH + totalWidth }}>
        {/* Left: resource label column */}
        <div style={{ width: LABEL_WIDTH, flexShrink: 0 }}>
          <div
            style={{ height: 28, display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 12, fontWeight: 600, borderBottom: '1px solid hsl(var(--border))' }}
          >
            {t('gantt.resource.header')}
          </div>
          {resources.map((r) => (
            <div
              key={r.key}
              data-testid={`resource-row-${r.key}`}
              style={{ height: ROW_HEIGHT, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 12px', borderBottom: '1px solid hsl(var(--border) / 0.5)' }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
              <span
                data-testid={`resource-peak-${r.key}`}
                data-overloaded={r.overloadedCount > 0 ? 'true' : undefined}
                style={{ fontSize: 10, color: r.overloadedCount > 0 ? 'hsl(var(--destructive))' : 'hsl(var(--muted-foreground))' }}
              >
                {t('gantt.resource.peak')}: {Math.round(r.peak * 100) / 100} / {r.capacity}
                {r.overloadedCount > 0 ? ` · ${r.overloadedCount} ${t('gantt.resource.over')}` : ''}
              </span>
            </div>
          ))}
        </div>

        {/* Right: timeline header + histogram rows */}
        <div style={{ flex: 1 }}>
          {/* Column header */}
          <div style={{ display: 'flex', height: 28, borderBottom: '1px solid hsl(var(--border))' }}>
            {columns.map((c, i) => (
              <div
                key={i}
                style={{ width: colWidth, flexShrink: 0, textAlign: 'center', fontSize: 10, color: 'hsl(var(--muted-foreground))', borderLeft: '1px solid hsl(var(--border) / 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {c.label}
              </div>
            ))}
          </div>

          {/* One histogram strip per resource */}
          {resources.map((r) => {
            const capY = HIST_HEIGHT * (1 - Math.min(r.capacity / maxScale, 1));
            return (
              <div
                key={r.key}
                style={{ position: 'relative', display: 'flex', height: ROW_HEIGHT, borderBottom: '1px solid hsl(var(--border) / 0.5)' }}
              >
                {/* Capacity reference line */}
                <div
                  aria-hidden="true"
                  style={{ position: 'absolute', left: 0, right: 0, top: (ROW_HEIGHT - HIST_HEIGHT) / 2 + capY, borderTop: '1px dashed hsl(var(--muted-foreground) / 0.6)', pointerEvents: 'none', zIndex: 1 }}
                />
                {r.cells.map((cell, i) => {
                  const h = Math.max(cell.load > 0 ? 2 : 0, HIST_HEIGHT * Math.min(cell.load / maxScale, 1));
                  return (
                    <div
                      key={i}
                      data-testid={`resource-cell-${r.key}-${i}`}
                      data-load={cell.load}
                      data-overloaded={cell.overloaded ? 'true' : undefined}
                      title={`${columns[i]?.date.toLocaleDateString(locale)} — ${Math.round(cell.load * 100) / 100} / ${cell.capacity}`}
                      style={{ width: colWidth, flexShrink: 0, position: 'relative', borderLeft: '1px solid hsl(var(--border) / 0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: (ROW_HEIGHT - HIST_HEIGHT) / 2 }}
                    >
                      {cell.load > 0 && (
                        <div
                          style={{ width: colWidth - 6, height: h, borderRadius: 2, backgroundColor: cell.overloaded ? 'hsl(var(--destructive))' : 'hsl(var(--primary))', opacity: cell.overloaded ? 0.9 : 0.75 }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
