// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * LayeredDiff — visualizes how the runtime resolves a two-tier metadata item.
 *
 * Tabs:
 *   • Diff (default) — field-level table comparing Code (artifact) vs
 *     Effective (merged). Highlights modified / added / removed top-level
 *     fields with color coding so admins can see at a glance what their
 *     overlay actually changes.
 *   • Code      — pretty-printed JSON of the artifact baseline.
 *   • Overlay   — pretty-printed JSON of just the deltas they've saved.
 *   • Effective — the merged value the runtime serves.
 *
 * Backed by `client.layered(type, name)`, i.e. `GET /meta/:type/:name/layers`.
 *
 * Diff scope: top-level keys only. Nested objects/arrays are compared by
 * JSON-stringify equality. Drilling into nested diffs is a future
 * enhancement; the overlay deltas we ship in practice are flat.
 */

import * as React from 'react';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@object-ui/components';
import { Badge, Switch } from '@object-ui/components';
import { cn } from '@object-ui/components';
import type { MetadataLayered } from '@object-ui/data-objectstack';
import { t, tFormat, translateConsoleValue, type SupportedLocale } from './i18n.js';

export interface LayeredDiffProps {
  layered: MetadataLayered<Record<string, unknown>> | null;
  loading?: boolean;
  locale?: SupportedLocale | string;
}

export type DiffStatus = 'unchanged' | 'modified' | 'added' | 'removed';

export interface DiffRow {
  key: string;
  status: DiffStatus;
  codeValue: unknown;
  effectiveValue: unknown;
}

const STATUS_STYLE: Record<DiffStatus, { badge: string; row: string }> = {
  unchanged: {
    badge: 'bg-muted text-muted-foreground border border-border',
    row: '',
  },
  modified: {
    badge: 'bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800',
    row: 'bg-amber-50/50 dark:bg-amber-950/20',
  },
  added: {
    badge: 'bg-emerald-100 text-emerald-900 border border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800',
    row: 'bg-emerald-50/50 dark:bg-emerald-950/20',
  },
  removed: {
    badge: 'bg-rose-100 text-rose-900 border border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800',
    row: 'bg-rose-50/50 dark:bg-rose-950/20',
  },
};

export function computeDiffRows(
  code: unknown,
  effective: unknown,
): DiffRow[] {
  const codeObj: Record<string, unknown> = isPlainObject(code) ? code : {};
  const effObj: Record<string, unknown> = isPlainObject(effective) ? effective : {};
  const allKeys = new Set<string>([
    ...Object.keys(codeObj),
    ...Object.keys(effObj),
  ]);
  const rows: DiffRow[] = [];
  for (const key of allKeys) {
    const inCode = key in codeObj;
    const inEff = key in effObj;
    const codeValue = codeObj[key];
    const effectiveValue = effObj[key];
    let status: DiffStatus;
    if (inCode && !inEff) {
      status = 'removed';
    } else if (!inCode && inEff) {
      status = 'added';
    } else if (stableStringify(codeValue) !== stableStringify(effectiveValue)) {
      status = 'modified';
    } else {
      status = 'unchanged';
    }
    rows.push({ key, status, codeValue, effectiveValue });
  }
  // Sort: changed first (modified, added, removed), then unchanged; alpha within each.
  const order: Record<DiffStatus, number> = {
    modified: 0,
    added: 1,
    removed: 2,
    unchanged: 3,
  };
  rows.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return a.key.localeCompare(b.key);
  });
  return rows;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stableStringify(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) => {
      if (isPlainObject(val)) {
        return Object.keys(val).sort().reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = val[k];
          return acc;
        }, {});
      }
      return val;
    });
  } catch {
    return String(v);
  }
}

function formatCell(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Count of top-level fields where the overlay actually changes the
 * effective value vs the artifact baseline. Used by the editor's
 * Layers tab trigger to show e.g. "3 overlaid" next to the label.
 *
 * Returns 0 when there is no baseline (pure-runtime item) or the two
 * payloads are identical.
 */
export function countOverlaidFields(
  code: unknown,
  effective: unknown,
): number {
  if (code == null) return 0;
  let n = 0;
  for (const row of computeDiffRows(code, effective)) {
    if (row.status !== 'unchanged') n += 1;
  }
  return n;
}

export function LayeredDiff({ layered, loading, locale }: LayeredDiffProps) {
  if (loading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {t('engine.edit.loading', locale)}
      </div>
    );
  }
  if (!layered) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {t('engine.layers.diff.noBaseline', locale)}
      </div>
    );
  }

  const hasOverlay = layered.overlay != null;

  return (
    <Tabs defaultValue="diff" className="w-full">
      <TabsList className="grid grid-cols-4 w-fit">
        <TabsTrigger value="diff">
          {t('engine.layers.diff', locale)}
        </TabsTrigger>
        <TabsTrigger value="code">
          {t('engine.layers.code', locale)}
          <Badge variant="outline" className="ml-1.5 text-[10px]">
            {translateConsoleValue('layer', 'artifact', locale)}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="overlay">
          {t('engine.layers.overlay', locale)}
          {hasOverlay ? (
            <Badge className="ml-1.5 text-[10px] bg-emerald-600 text-emerald-50">
              {/*
                objectui#4982 — the scope goes through `translateConsoleValue`
                like the other three layer labels in this list. It used to be
                rendered raw, so this one badge's language depended on whether
                the item HAD an overlay: with one, a zh-CN admin read `org` /
                `env`; without one, the `set` fallback below rendered 「已设」.
              */}
              {translateConsoleValue(
                'layer',
                layered.overlayScope ?? 'set',
                locale,
              )}
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-1.5 text-[10px] text-muted-foreground">
              {translateConsoleValue('layer', 'none', locale)}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="effective">
          {t('engine.layers.effective', locale)}
          <Badge variant="outline" className="ml-1.5 text-[10px]">
            {translateConsoleValue('layer', 'merged', locale)}
          </Badge>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="diff" className="mt-3">
        <DiffTable
          code={layered.code}
          effective={layered.effective}
          locale={locale}
        />
      </TabsContent>

      <TabsContent value="code" className="mt-3">
        <LayerPanel
          payload={layered.code}
          emptyHint={t('engine.layers.diff.noBaseline', locale)}
        />
      </TabsContent>

      <TabsContent value="overlay" className="mt-3">
        <LayerPanel
          payload={layered.overlay}
          emptyHint={t('engine.layers.diff.noChanges', locale)}
        />
      </TabsContent>

      <TabsContent value="effective" className="mt-3">
        <LayerPanel
          payload={layered.effective}
          emptyHint="No effective value resolved."
        />
      </TabsContent>
    </Tabs>
  );
}

function DiffTable({
  code,
  effective,
  locale,
}: {
  code: unknown;
  effective: unknown;
  locale?: SupportedLocale | string;
}) {
  const [showUnchanged, setShowUnchanged] = React.useState(false);

  const rows = React.useMemo(
    () => (code == null ? [] : computeDiffRows(code, effective)),
    [code, effective],
  );

  const counts = React.useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc[r.status] += 1;
        return acc;
      },
      { unchanged: 0, modified: 0, added: 0, removed: 0 } as Record<DiffStatus, number>,
    );
  }, [rows]);

  // No baseline = pure runtime overlay; the diff table has nothing to compare.
  // Checked after the hooks above so hook order stays stable across renders.
  if (code == null) {
    return (
      <div className="rounded border bg-muted/30 p-4 text-xs text-muted-foreground">
        {t('engine.layers.diff.noBaseline', locale)}
      </div>
    );
  }

  const visibleRows = showUnchanged
    ? rows
    : rows.filter((r) => r.status !== 'unchanged');

  const hasAnyChange =
    counts.modified > 0 || counts.added > 0 || counts.removed > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted-foreground">
          {tFormat('engine.layers.diff.summary', locale, {
            modified: counts.modified,
            added: counts.added,
            removed: counts.removed,
          })}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <Switch
            checked={showUnchanged}
            onCheckedChange={setShowUnchanged}
            aria-label={t('engine.layers.diff.showUnchanged', locale)}
          />
          {t('engine.layers.diff.showUnchanged', locale)}
          <Badge variant="outline" className="ml-1 text-[10px]">
            {counts.unchanged}
          </Badge>
        </label>
      </div>

      {!hasAnyChange && !showUnchanged ? (
        <div className="rounded border bg-muted/30 p-4 text-xs text-muted-foreground">
          {t('engine.layers.diff.noChanges', locale)}
        </div>
      ) : (
        <div className="rounded border overflow-hidden">
          <div className="grid grid-cols-[minmax(140px,1fr)_minmax(160px,1.4fr)_minmax(160px,1.4fr)_auto] bg-muted/50 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <div className="px-3 py-2">{t('engine.layers.diff.field', locale)}</div>
            <div className="px-3 py-2">{t('engine.layers.diff.code', locale)}</div>
            <div className="px-3 py-2">{t('engine.layers.diff.effective', locale)}</div>
            <div className="px-3 py-2">{t('engine.layers.diff.status', locale)}</div>
          </div>
          <div className="divide-y">
            {visibleRows.map((row) => {
              const style = STATUS_STYLE[row.status];
              return (
                <div
                  key={row.key}
                  className={cn(
                    'grid grid-cols-[minmax(140px,1fr)_minmax(160px,1.4fr)_minmax(160px,1.4fr)_auto] text-xs',
                    style.row,
                  )}
                >
                  <div className="px-3 py-2 font-mono text-foreground truncate" title={row.key}>
                    {row.key}
                  </div>
                  <DiffValueCell
                    value={row.codeValue}
                    muted={row.status === 'added'}
                  />
                  <DiffValueCell
                    value={row.effectiveValue}
                    muted={row.status === 'removed'}
                  />
                  <div className="px-3 py-2">
                    <span
                      className={cn(
                        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                        style.badge,
                      )}
                    >
                      {t(`engine.layers.diff.${row.status}`, locale)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DiffValueCell({ value, muted }: { value: unknown; muted?: boolean }) {
  const text = formatCell(value);
  const isMissing = value === undefined;
  return (
    <div
      className={cn(
        'px-3 py-2 font-mono break-all',
        muted || isMissing ? 'text-muted-foreground italic' : 'text-foreground',
      )}
      title={text.length > 200 ? text : undefined}
    >
      {text.length > 200 ? `${text.slice(0, 200)}…` : text}
    </div>
  );
}

function LayerPanel({
  payload,
  emptyHint,
}: {
  payload: unknown;
  emptyHint: string;
}) {
  if (payload == null) {
    return (
      <div className="rounded border bg-muted/30 p-4 text-xs text-muted-foreground">
        {emptyHint}
      </div>
    );
  }
  let pretty: string;
  try {
    pretty = JSON.stringify(payload, null, 2);
  } catch {
    pretty = String(payload);
  }
  return (
    <pre className="rounded border bg-muted/30 p-3 text-xs font-mono overflow-auto max-h-[420px]">
      {pretty}
    </pre>
  );
}
