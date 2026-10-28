// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The report's period — `ReportSchema.dateRange` (ruling 6408567749 on
 * objectstack-ai/objectstack#25873, letter B; the spec half is #26548).
 *
 * A report that declares `dateRange` draws a date-range chip above its body
 * and runs every dataset query it makes inside the chosen window. The
 * renderer contract is the TSDoc on `ReportSchema.dateRange`:
 *
 * - The active window rides the dataset query as ONE
 *   `selection.timeDimensions` entry, `{ dimension, dateRange }`, with no
 *   `granularity`: a filter window, not a bucket, ANDed by the server with
 *   `runtimeFilter` and the dataset's own filter. Bucketing stays on the
 *   dimension's `dateGranularity` and the report's `rows` / `columns`.
 * - A preset goes on the wire BY NAME and the server resolves it (in the
 *   request's time zone, against one "now" for the whole query); a custom pick
 *   goes as `[start, end]`. Nothing here turns a preset into dates.
 * - `defaultRange` / `allowCustomRange` are the dashboard's declaration
 *   verbatim, so the chip offers the dashboard's preset list
 *   (`DATE_RANGE_PRESETS`) under the dashboard's labels
 *   (`dashboard.filters.range.*`). `custom` as the default is the spec's
 *   "open the picker, no window" sentinel.
 * - `dimension` names a dataset dimension declaring `type: 'date'`. Omitted,
 *   the dataset's ONE such dimension is used; the dataset definition is read
 *   to find it. Zero or several is an authoring error the
 *   `validate-report-date-range` lint rule refuses at build and publish; a
 *   stored document that still reaches here gets that error drawn in place of
 *   the report, never an unwindowed table under a period chip.
 *
 * A report WITHOUT `dateRange` is untouched: no chip, no dataset-definition
 * read, and the selection it posts is byte-identical to before.
 */

import * as React from 'react';
import { CalendarIcon } from 'lucide-react';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { DATE_RANGE_PRESETS } from '@object-ui/core';
import { useObjectTranslation, useSafeTranslate } from '@object-ui/i18n';
import { SchemaRendererContext } from '@object-ui/react';

/** `ReportSchema.dateRange`, as it arrives on a stored report. */
export interface ReportDateRangeDeclaration {
  dimension?: string;
  defaultRange?: string;
  allowCustomRange?: boolean;
}

/** One `DatasetSelection.timeDimensions` entry: the report's active window. */
export interface ReportTimeWindow {
  dimension: string;
  dateRange: string | [string, string];
}

/** What the viewer picked on the chip. */
export type ReportPeriod =
  | { kind: 'all' }
  | { kind: 'preset'; preset: string }
  | { kind: 'custom'; from?: string; to?: string };

/** The spec's default for an absent `defaultRange` (`ReportSchema.dateRange`). */
const SPEC_DEFAULT_RANGE = 'this_month';
/** Sentinels for the Select (Radix Select forbids empty values). */
const ALL_VALUE = '__all__';
const CUSTOM_VALUE = '__custom__';

/** The declaration, when the report carries one; anything else is no declaration. */
export function readDateRangeDeclaration(value: unknown): ReportDateRangeDeclaration | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as ReportDateRangeDeclaration;
}

/** The period the report opens on: `defaultRange`, or the spec's `this_month`. */
export function initialReportPeriod(decl: ReportDateRangeDeclaration): ReportPeriod {
  const range = typeof decl.defaultRange === 'string' ? decl.defaultRange : SPEC_DEFAULT_RANGE;
  if (range === 'custom') return { kind: 'custom' };
  return { kind: 'preset', preset: range };
}

/**
 * The window a period puts on the wire, or `undefined` for none: All time, and
 * a custom pick that does not yet name both ends (`custom` opens the picker
 * with no window).
 */
export function reportTimeWindow(dimension: string, period: ReportPeriod): ReportTimeWindow | undefined {
  if (period.kind === 'preset') return { dimension, dateRange: period.preset };
  if (period.kind === 'custom' && period.from && period.to) {
    return { dimension, dateRange: [period.from, period.to] };
  }
  return undefined;
}

export type ReportDateDimension =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ready'; dimension: string }
  | { status: 'error'; message: string };

/**
 * The dataset dimension the window applies to: `dateRange.dimension` as
 * declared, or — omitted — the dataset's one `type: 'date'` dimension, read
 * from the dataset definition through the host's authenticated `apiFetch`
 * (the read `ObjectChart`'s dataset path makes).
 */
export function useReportDateDimension(
  dataset: string,
  decl: ReportDateRangeDeclaration | undefined,
): ReportDateDimension {
  const { t } = useObjectTranslation();
  const apiFetch = React.useContext(SchemaRendererContext)?.apiFetch;
  const declared = typeof decl?.dimension === 'string' && decl.dimension ? decl.dimension : undefined;
  const needsRead = !!decl && !declared && !!dataset;
  const [read, setRead] = React.useState<
    { dataset: string; dateDimensions: string[] } | { dataset: string; failed: string } | null
  >(null);

  React.useEffect(() => {
    if (!needsRead) return;
    let cancelled = false;
    (async () => {
      try {
        const doFetch = apiFetch ?? fetch;
        const res = await doFetch(`/api/v1/meta/dataset/${encodeURIComponent(dataset)}`, {
          headers: { accept: 'application/json' },
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = await res.json();
        const def = doc?.item ?? doc?.data ?? doc;
        const dims: unknown[] = Array.isArray(def?.dimensions) ? def.dimensions : [];
        const dateDimensions = dims
          .filter((d): d is { name: string; type?: unknown } =>
            !!d && typeof (d as { name?: unknown }).name === 'string')
          .filter((d) => d.type === 'date')
          .map((d) => d.name);
        if (!cancelled) setRead({ dataset, dateDimensions });
      } catch (e) {
        if (!cancelled) setRead({ dataset, failed: String((e as Error)?.message ?? e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsRead, dataset, apiFetch]);

  if (!decl) return { status: 'off' };
  if (declared) return { status: 'ready', dimension: declared };
  if (!read || read.dataset !== dataset) return { status: 'loading' };
  if ('failed' in read) {
    return {
      status: 'error',
      message: t('report.dateRange.datasetUnreadable', {
        defaultValue: 'This report’s date range names no dimension, and the “{{dataset}}” dataset could not be read to find its date dimension ({{reason}}).',
        dataset,
        reason: read.failed,
      }),
    };
  }
  if (read.dateDimensions.length === 1) return { status: 'ready', dimension: read.dateDimensions[0] };
  return {
    status: 'error',
    message: t('report.dateRange.noSingleDateDimension', {
      defaultValue: 'This report’s date range names no dimension, and the “{{dataset}}” dataset declares {{total}} date dimensions ({{found}}) where it needs exactly one. Name the date dimension in the report’s dateRange.dimension.',
      dataset,
      total: read.dateDimensions.length,
      found: read.dateDimensions.join(', ') || '—',
    }),
  };
}

/** The chip: All time, the dashboard's presets, and Custom… when allowed. */
export function ReportDateRangeControl({
  decl,
  value,
  onChange,
}: {
  decl: ReportDateRangeDeclaration;
  value: ReportPeriod;
  onChange: (next: ReportPeriod) => void;
}) {
  const tt = useSafeTranslate();
  const allowCustom = decl.allowCustomRange !== false;
  const presetLabel = (p: string) => tt(`dashboard.filters.range.${p}`, p.replace(/_/g, ' '));
  const selectValue = value.kind === 'all' ? ALL_VALUE : value.kind === 'custom' ? CUSTOM_VALUE : value.preset;
  const triggerText =
    value.kind === 'preset'
      ? presetLabel(value.preset)
      : value.kind === 'custom'
        ? value.from || value.to
          ? `${value.from ?? '…'} – ${value.to ?? '…'}`
          : tt('dashboard.filters.custom', 'Custom…')
        : tt('dashboard.filters.allTime', 'All time');
  const rangeLabel = tt('dashboard.filters.dateRange', 'Date range');

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="report-date-range">
      <Select
        value={selectValue}
        onValueChange={(v) => {
          if (v === ALL_VALUE) onChange({ kind: 'all' });
          else if (v === CUSTOM_VALUE) onChange({ kind: 'custom' });
          else onChange({ kind: 'preset', preset: v });
        }}
      >
        <SelectTrigger className="h-8 w-auto min-w-36 gap-1" aria-label={rangeLabel}>
          <CalendarIcon className="size-3.5 opacity-60" />
          <SelectValue placeholder={rangeLabel}>{triggerText}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{tt('dashboard.filters.allTime', 'All time')}</SelectItem>
          {DATE_RANGE_PRESETS.map((p) => (
            <SelectItem key={p} value={p}>{presetLabel(p)}</SelectItem>
          ))}
          {allowCustom && <SelectItem value={CUSTOM_VALUE}>{tt('dashboard.filters.custom', 'Custom…')}</SelectItem>}
        </SelectContent>
      </Select>
      {allowCustom && value.kind === 'custom' && (
        <>
          <Input
            type="date"
            className="h-8 w-auto"
            aria-label={tt('report.dateRange.from', 'From')}
            value={value.from ?? ''}
            onChange={(e) => onChange({ ...value, from: e.target.value || undefined })}
          />
          <Input
            type="date"
            className="h-8 w-auto"
            aria-label={tt('report.dateRange.to', 'To')}
            value={value.to ?? ''}
            onChange={(e) => onChange({ ...value, to: e.target.value || undefined })}
          />
        </>
      )}
    </div>
  );
}
