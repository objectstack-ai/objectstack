// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ReportPreview — runs the live Report draft through the SAME dataset-bound
 * renderer the runtime ReportView uses (ADR-0021 single-form).
 *
 * A 9.0 report binds a semantic-layer `dataset` and selects its measures
 * (`values`) grouped by dimensions (`rows`, plus `columns` across for a
 * matrix); a `joined` report instead stacks dataset-bound `blocks`. Both
 * render through plugin-report's `ReportRenderer` (→ DatasetReportRenderer),
 * keeping the studio preview pixel-equal with the runtime — including the
 * matrix cross-tab and the joined block stack — and the numbers consistent
 * with every other surface on the same dataset (`adapter.queryDataset`).
 * Drill-down stays inert here: the preview passes no `onDrill` sink.
 *
 * A draft with neither a dataset nor any dataset-bound block gets an
 * actionable empty state pointing at the right inspector control instead of
 * the retired pre-9.0 inline-query renderer.
 */

import * as React from 'react';
import { Database, Loader2 } from 'lucide-react';
import { useAdapter } from '../../../providers/AdapterProvider.js';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { PreviewShell, PreviewErrorBoundary, PreviewEmptyState } from './PreviewShell.js';
import { t as tr } from '../i18n.js';

const ReportRenderer = React.lazy(() =>
  import('@object-ui/plugin-report').then((m) => ({ default: m.ReportRenderer })),
);

export function ReportPreview({ draft, locale }: MetadataPreviewProps) {
  const adapter = useAdapter();
  const d = draft as any;

  // ADR-0021 single-form: a report binds a semantic-layer dataset; a `joined`
  // report instead carries its data on dataset-bound `blocks`. Both render
  // through plugin-report's ReportRenderer (→ DatasetReportRenderer, which
  // stacks each block). Previously only the single-dataset shape was
  // previewed, so a joined report fell through to the "bind a dataset" empty
  // state and the author designed blind.
  const hasDataset = typeof d.dataset === 'string' && !!d.dataset;
  const isJoinedWithBlocks =
    d.type === 'joined' &&
    Array.isArray(d.blocks) &&
    d.blocks.some((b: any) => typeof b?.dataset === 'string' && !!b.dataset);

  if (hasDataset || isJoinedWithBlocks) {
    const rows = Array.isArray(d.rows) ? (d.rows as string[]).filter(Boolean) : [];
    const hint = isJoinedWithBlocks
      ? `report · joined · ${d.blocks.length} block${d.blocks.length === 1 ? '' : 's'}`
      : `report · dataset "${d.dataset}"${rows.length ? ' · by ' + rows.join(', ') : ''}`;
    return (
      <PreviewShell hint={hint}>
        <PreviewErrorBoundary fallbackHint={tr('engine.reportPreview.renderFailed', locale)}>
          <React.Suspense
            fallback={
              <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {tr('engine.reportPreview.loading', locale)}
              </div>
            }
          >
            <div className="p-3 min-h-[200px] max-h-[70vh] overflow-auto">
              <ReportRenderer schema={draft as any} dataSource={adapter as any} />
            </div>
          </React.Suspense>
        </PreviewErrorBoundary>
      </PreviewShell>
    );
  }

  // Nothing renderable yet. A joined report needs at least one dataset-bound
  // block; every other type needs a top-level dataset. Point the author at the
  // right control instead of the retired pre-9.0 inline-query renderer.
  const joined = d.type === 'joined';
  return (
    <PreviewShell>
      <PreviewEmptyState
        icon={<Database className="h-8 w-8" />}
        title={tr(joined ? 'engine.reportPreview.joinedEmpty' : 'engine.reportPreview.empty', locale)}
        description={tr(joined ? 'engine.reportPreview.joinedEmptyHint' : 'engine.reportPreview.emptyHint', locale)}
      />
    </PreviewShell>
  );
}
