/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * DraftReviewPanel — ADR-0033 Phase B, §5.
 *
 * A GENERIC, type-agnostic review/diff: it compares a pending DRAFT against the
 * last-published value and lists added / changed / removed top-level keys. It
 * works for ANY metadata type (view, dashboard, flow, …) — the object designer
 * keeps its richer per-field review (`ObjectFormCanvas`); this is the host-level
 * fallback so every type gets a real "what will publishing change" view.
 *
 * It deliberately reuses {@link computeDiffRows} from `LayeredDiff` — the same
 * structural diff engine the Layers tab uses — fed `(published, draft)` so
 * "added" = in the draft but not yet published, "removed" = published key the
 * draft drops, "modified" = value changed.
 */
import React from 'react';
import { computeDiffRows, type DiffStatus } from './LayeredDiff.js';
import { t, type SupportedLocale } from './i18n.js';

const STATUS_BADGE: Record<Exclude<DiffStatus, 'unchanged'>, string> = {
  modified:
    'bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800',
  added:
    'bg-emerald-100 text-emerald-900 border border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800',
  removed:
    'bg-rose-100 text-rose-900 border border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800',
};

const STATUS_ROW: Record<Exclude<DiffStatus, 'unchanged'>, string> = {
  modified: 'bg-amber-50/50 dark:bg-amber-950/20',
  added: 'bg-emerald-50/50 dark:bg-emerald-950/20',
  removed: 'bg-rose-50/50 dark:bg-rose-950/20',
};

function statusLabel(status: Exclude<DiffStatus, 'unchanged'>, locale?: SupportedLocale | string): string {
  if (status === 'added') return t('designer.canvas.diffAdded', locale);
  if (status === 'removed') return t('designer.canvas.diffRemoved', locale);
  return t('designer.canvas.diffChanged', locale);
}

function formatValue(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'string') return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return String(v);
  }
}

/** Number of top-level keys that differ between the draft and the published value. */
export function computeDraftChangeCount(published: unknown, draft: unknown): number {
  let n = 0;
  for (const row of computeDiffRows(published, draft)) {
    if (row.status !== 'unchanged') n += 1;
  }
  return n;
}

export interface DraftReviewPanelProps {
  /** The last-published (effective) value — the diff baseline. */
  published: unknown;
  /** The pending draft body being reviewed. */
  draft: unknown;
  locale?: SupportedLocale | string;
  className?: string;
}

export function DraftReviewPanel({ published, draft, locale, className }: DraftReviewPanelProps) {
  const rows = React.useMemo(
    () => computeDiffRows(published, draft).filter((r) => r.status !== 'unchanged'),
    [published, draft],
  );

  if (rows.length === 0) {
    return (
      <div className={`p-4 text-sm text-muted-foreground ${className ?? ''}`}>
        {t('designer.draftReview.empty', locale)}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`} data-testid="draft-review-panel">
      {rows.map((row) => {
        const status = row.status as Exclude<DiffStatus, 'unchanged'>;
        return (
          <div
            key={row.key}
            className={`flex flex-wrap items-baseline gap-2 rounded-md px-2.5 py-1.5 text-xs ${STATUS_ROW[status]}`}
          >
            <span
              className={`inline-flex shrink-0 items-center rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${STATUS_BADGE[status]}`}
            >
              {statusLabel(status, locale)}
            </span>
            <code className="font-mono font-medium text-foreground">{row.key}</code>
            {status === 'added' ? (
              <ins className="text-emerald-700 no-underline dark:text-emerald-400">
                {formatValue(row.effectiveValue)}
              </ins>
            ) : status === 'removed' ? (
              <del className="text-rose-700 dark:text-rose-400">{formatValue(row.codeValue)}</del>
            ) : (
              <span className="inline-flex items-baseline gap-1.5 text-muted-foreground">
                <del className="text-rose-700 dark:text-rose-400">{formatValue(row.codeValue)}</del>
                <span aria-hidden="true">→</span>
                <ins className="text-emerald-700 no-underline dark:text-emerald-400">
                  {formatValue(row.effectiveValue)}
                </ins>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
