/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * DrillDownDrawer — opens a side drawer (or dialog) that lists the
 * underlying records behind a clicked pivot cell / chart segment.
 *
 * Composition: <Sheet> + <ObjectDataTable>. The data table receives
 * the merged filter (widget filter ∧ drill filter) and the data source
 * inherited from the schema renderer context.
 */

import React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  cn,
} from '@object-ui/components';
import { SchemaRenderer, useDrillNavigation } from '@object-ui/react';
import { ObjectDataTable } from './ObjectDataTable';
import { OpenInListButton } from './OpenInListButton';

export interface DrillDownDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Drawer/dialog header. */
  title: string;
  /**
   * Where the drill lands: `'drawer'` (right-side Sheet), `'dialog'` (centered
   * Dialog), or `'navigate'` (skip the in-place view and open the object's full
   * list page via the host's drill navigation). `'navigate'` falls back to
   * `'drawer'` when no host navigation handler is available.
   */
  target?: 'drawer' | 'dialog' | 'navigate';
  /** Object name to query. */
  objectName: string;
  /** Filter applied to the drilled list. */
  filter?: Record<string, unknown>;
  /** Optional inline data source override (otherwise inherited via context). */
  dataSource?: any;
  /** Optional column whitelist. */
  columns?: string[];
  /** Optional max rows. */
  maxRows?: number;
  /** Optional className on the inner container. */
  className?: string;
  /**
   * M3: drill into an analytical report instead of the raw record list.
   * When the value is a dataset-bound report (ADR-0021: a `dataset`, or a
   * `joined` report whose blocks bind one; see {@link isDatasetBoundReport})
   * the drawer body renders a `report` node wrapping it
   * (`{ type: 'report', report }`) via `SchemaRenderer` (objectui#11440; the
   * retired `spec-report` alias carried the same wrapper). The widget's
   * `filter` is joined to the report's own `runtimeFilter` with `$and` and
   * written as the report's `runtimeFilter`, the one filter key the dataset
   * renderer applies (objectui#5137, objectui#11506), so the metric's scope
   * flows into the report. The report itself can drill further (into a list /
   * record) via its own row-click protocol. Any other value lists the records,
   * the two retired forms the authoring faces refuse by name among them: a
   * `{ name }` reference (objectui#11517) and the pre-9.0 `objectName` form
   * (objectui#11506).
   */
  report?: Record<string, unknown>;
}

/**
 * Is this drill `report` a dataset-bound report (ADR-0021) — the shape
 * `DrillDownConfig.report` declares (`@objectstack/spec`'s `ReportSchema`) and
 * the `report` node draws through its dataset renderer?
 *
 * The same reading as `isDatasetReport` in `@object-ui/plugin-report`, which
 * this package does not depend on: a non-empty `dataset`, or a `joined` report
 * with at least one block that binds one. So the drawer sends a report to the
 * `report` node exactly when that node renders it through the renderer that
 * reads `runtimeFilter`.
 *
 * objectui#11506 replaced the predicate this used to be, "a `columns` array or
 * an `objectName` key". Both limbs were markers of the pre-9.0 object-bound
 * report (`objectName` plus column objects), whose drill shape had no producer
 * and is retired: through the real drawer it drew an empty presentation and
 * issued no query, so it applied no filter under either key. A dataset-bound
 * matrix passed only because its `columns` (dimension names across) is also an
 * array, while a tabular, summary or joined dataset report, which carries no
 * `columns`, listed the records instead of drawing the report.
 */
function isDatasetBoundReport(report: unknown): report is Record<string, unknown> {
  if (!report || typeof report !== 'object') return false;
  const r = report as { dataset?: unknown; type?: unknown; blocks?: unknown };
  if (typeof r.dataset === 'string' && r.dataset.length > 0) return true;
  return r.type === 'joined'
    && Array.isArray(r.blocks)
    && r.blocks.some((b) => typeof (b as { dataset?: unknown } | null)?.dataset === 'string');
}

export const DrillDownDrawer: React.FC<DrillDownDrawerProps> = ({
  open,
  onClose,
  title,
  target = 'drawer',
  objectName,
  filter,
  dataSource,
  columns,
  maxRows,
  className,
  report,
}) => {
  const { openRecordList } = useDrillNavigation();
  const isReportDrill = isDatasetBoundReport(report);

  // `target: 'navigate'` skips the in-place view and opens the object's full
  // list page directly — but only when a host navigation handler exists and
  // this is a raw-record drill (a report drill has no single list page).
  // Otherwise it degrades gracefully to the drawer below.
  const navigateOnly = target === 'navigate' && !!openRecordList && !isReportDrill && !!objectName;
  React.useEffect(() => {
    if (open && navigateOnly) {
      openRecordList!(objectName, filter);
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, navigateOnly]);
  if (navigateOnly) return null;

  // Escape hatch — escalate the peek to the full list page (shown in the header
  // when the host wired navigation and this is a raw-record drill).
  const escapeHatch = !isReportDrill ? (
    <OpenInListButton objectName={objectName} filter={filter} onNavigate={onClose} />
  ) : null;

  const body = (
    <div className={cn('overflow-auto', className)} data-testid="drill-down-body">
      {isReportDrill
        ? (() => {
            // objectui#11506 — the drill's filter goes into `runtimeFilter`, the
            // key `ReportSchema` declares and the dataset renderer applies. It
            // used to be written as `filter`, which the spec refuses and the
            // renderer does not apply (objectui#5137), so the drilled report
            // rendered the whole dataset. Joined once with the report's own
            // `runtimeFilter`, as the `filter` write was joined: one rule. A
            // `filter` an unvalidated stored report still carries is neither
            // read nor removed: it reaches the renderer, which says in dev that
            // it was not applied.
            const ownFilter = report.runtimeFilter as Record<string, unknown> | undefined;
            const runtimeFilter = ownFilter
              ? (filter ? { $and: [ownFilter, filter] } : ownFilter)
              : filter;
            // The `report` node's declared wrapper (objectui#11440): the report,
            // with the drill's filter joined in, under `report`. `ReportRenderer`
            // unwraps it first and reads nothing else off the node, so the flat
            // copy of the report's keys and the top-level filter the retired
            // `spec-report` spelling also carried are not written.
            const reportSchema = {
              type: 'report',
              report: runtimeFilter ? { ...report, runtimeFilter } : report,
            };
            return <SchemaRenderer schema={reportSchema as any} />;
          })()
        : (
          <ObjectDataTable
            schema={{
              type: 'object-data-table',
              objectName,
              filter,
              columns: columns?.map((c) => ({ accessorKey: c, header: c })),
              pagination: true,
              searchable: false,
              pageSize: maxRows,
              // Complete the drill chain: a row in this filtered record list
              // opens that record. Dialog target so it stacks over this drawer.
              // Mirrors the chart / KPI drill tables — every drill-through list
              // (pivot, dataset, chart, metric) lands on a clickable record.
              drillDown: { enabled: true, mode: 'record', target: 'dialog' },
            }}
            dataSource={dataSource}
          />
        )}
    </div>
  );

  if (target === 'dialog') {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-5xl">
          <DialogHeader className="flex-row items-center justify-between gap-4 pr-8">
            <DialogTitle>{title}</DialogTitle>
            {escapeHatch}
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl md:max-w-3xl lg:max-w-4xl flex flex-col">
        <SheetHeader className="flex-row items-center justify-between gap-4 pr-8">
          <SheetTitle>{title}</SheetTitle>
          {escapeHatch}
        </SheetHeader>
        <div className="flex-1 overflow-hidden mt-2">{body}</div>
      </SheetContent>
    </Sheet>
  );
};
