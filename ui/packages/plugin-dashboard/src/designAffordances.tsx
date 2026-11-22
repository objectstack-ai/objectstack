/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Two pieces `DashboardRenderer` draws on a widget (objectstack#36372):
 *
 *  - {@link WidgetFilterMark}: the always-visible mark naming the dashboard
 *    filters that do not reach a widget. It is handed the list
 *    `dashboardFiltersNotApplied` answers, which asks the binding the
 *    widget's query is built from, so the mark and the data agree.
 *  - {@link WidgetResizeHandle}: the design-mode corner handle that resizes a
 *    widget by whole grid tracks.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import type { DashboardFilterDef } from '@object-ui/core';
import { useDashboardFilterLabeler } from './DashboardFilterBar';

/** `items` as one list in `language` ("Region and Owner"), else comma-joined. */
function listOf(items: string[], language: string | undefined): string {
  // `Intl.ListFormat` is ES2021: typed here, since the package's `lib` is ES2020.
  const ListFormat = (Intl as unknown as {
    ListFormat?: new (locale?: string, options?: { style: string; type: string }) => { format(list: string[]): string };
  }).ListFormat;
  if (!ListFormat) return items.join(', ');
  try {
    return new ListFormat(language || undefined, { style: 'long', type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

/**
 * The filters that do not reach a widget, named in one short line. Draws
 * nothing for an empty list: a widget every filter reaches carries no mark.
 */
export function WidgetFilterMark({
  defs,
  widgetId,
  className,
}: {
  defs: readonly DashboardFilterDef[];
  widgetId?: string;
  className?: string;
}) {
  const { t, language } = useObjectTranslation();
  const labelOf = useDashboardFilterLabeler();
  if (defs.length === 0) return null;
  const names = listOf(defs.map((def) => labelOf(def) || def.name), language);
  const text = t('dashboard.filters.notApplied', { filters: names, defaultValue: 'Not filtered by {{filters}}' });
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center truncate rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal leading-4 text-muted-foreground',
        className,
      )}
      data-testid={widgetId ? `dashboard-widget-filter-mark-${widgetId}` : 'dashboard-widget-filter-mark'}
      data-filters={defs.map((def) => def.name).join(',')}
      title={text}
    >
      {text}
    </span>
  );
}

/** A widget's span in grid tracks. */
export interface WidgetSpan {
  w: number;
  h: number;
}

/**
 * The span a pointer drag of `(dx, dy)` pixels from `start` asks for, in
 * whole tracks: each axis moves by the drag over one track's pitch (the span's
 * own size plus the grid gap, divided by its track count), rounded, so the
 * widget snaps to the grid as the pointer crosses half a track. Width stays
 * within `1..maxColumns`, height at least `1`.
 */
export function resizedSpan(
  start: WidgetSpan,
  box: { width: number; height: number },
  gapPx: number,
  drag: { dx: number; dy: number },
  maxColumns: number,
): WidgetSpan {
  const pitchW = (box.width + gapPx) / Math.max(1, start.w);
  const pitchH = (box.height + gapPx) / Math.max(1, start.h);
  const w = start.w + (pitchW > 0 ? Math.round(drag.dx / pitchW) : 0);
  const h = start.h + (pitchH > 0 ? Math.round(drag.dy / pitchH) : 0);
  return {
    w: Math.min(Math.max(1, w), Math.max(1, maxColumns)),
    h: Math.max(1, h),
  };
}

/**
 * The bottom-right corner handle of a widget in design mode. A drag reports
 * each new whole-track span through `onResize` as the pointer crosses a track;
 * the host writes it into the widget's `layout`. The pointer is captured so
 * the drag survives leaving the handle, and the pointer-down stops there: the
 * widget's reorder drag and its click-to-select do not start under it.
 */
export function WidgetResizeHandle({
  span,
  maxColumns,
  gapPx,
  label,
  onResize,
}: {
  span: WidgetSpan;
  maxColumns: number;
  gapPx: number;
  label: string;
  onResize: (next: WidgetSpan) => void;
}) {
  const drag = React.useRef<{
    x: number;
    y: number;
    start: WidgetSpan;
    box: { width: number; height: number };
    last: WidgetSpan;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const card = e.currentTarget.parentElement;
    const rect = card?.getBoundingClientRect();
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      start: span,
      box: { width: rect?.width ?? 0, height: rect?.height ?? 0 },
      last: span,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const next = resizedSpan(d.start, d.box, gapPx, { dx: e.clientX - d.x, dy: e.clientY - d.y }, maxColumns);
    if (next.w === d.last.w && next.h === d.last.h) return;
    d.last = next;
    onResize(next);
  };
  const end = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  // The keyboard path: arrows grow or shrink the span by one track.
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step: Record<string, Partial<WidgetSpan>> = {
      ArrowRight: { w: span.w + 1 },
      ArrowLeft: { w: span.w - 1 },
      ArrowDown: { h: span.h + 1 },
      ArrowUp: { h: span.h - 1 },
    };
    const patch = step[e.key];
    if (!patch) return;
    e.preventDefault();
    e.stopPropagation();
    const next = {
      w: Math.min(Math.max(1, patch.w ?? span.w), Math.max(1, maxColumns)),
      h: Math.max(1, patch.h ?? span.h),
    };
    if (next.w !== span.w || next.h !== span.h) onResize(next);
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid="dashboard-widget-resize-handle"
      className="absolute bottom-0.5 right-0.5 z-20 h-4 w-4 cursor-se-resize touch-none rounded-sm border-b-2 border-r-2 border-primary bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    />
  );
}
