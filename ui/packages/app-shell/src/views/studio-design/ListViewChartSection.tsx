// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27933 — the binding of a chart view, in the list-view panel:
 * the ADR-0021 dataset the chart reads, the measures it plots (`values`) and
 * the dimensions it groups them by, all in the list body's `chart` block
 * (`ListChartConfigSchema`), plus the chart type the spec's enum lists.
 *
 * The datasets offered are the ones whose base `object` is this object, and a
 * dataset's measures and dimensions are its own: read through the reading the
 * Create View dialog picks from (`useObjectDatasetBinding`), from the drafts
 * a Studio author sees when the pillar provides them. Each is picked by its
 * label; what is written is its name.
 *
 * - Another dataset keeps only the measures and dimensions it declares too. A
 *   name it does not declare binds nothing, so it is dropped, never kept. A
 *   dataset whose members the catalog does not list keeps none.
 * - A stored name the bound dataset does not declare is shown, marked, with
 *   its remove button, so the author sees why the chart plots nothing.
 * - No measure left: the `values` key is removed, not written empty. The spec
 *   requires it, so the pillar holds the edit as it holds every unset input
 *   (`listViewTypeHeldEdit`) rather than sending one the draft door refuses.
 * - The catalog, or the bound dataset, cannot be read: the stored names are
 *   shown as they are, with the reason, and nothing is offered to replace
 *   them. The panel itself never fails on it.
 * - No dataset is built on this object: the section says so, and offers no
 *   empty picker.
 */

import * as React from 'react';
import { Loader2, X } from 'lucide-react';
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@object-ui/components';
import { getListVariantSchema } from '../metadata-admin/view-schema.js';
import type { DatasetDimensionInfo, DatasetMeasureInfo } from '../metadata-admin/previews/useDatasetCatalog.js';
import { t, tFormat } from '../metadata-admin/i18n.js';
import { useStudioDatasetAuthoring } from './datasetCreate.js';
import { datasetOptionLabel, useObjectDatasetBinding } from './objectDatasets.js';
import { DraftChip } from './StudioDraftMark.js';

type Row = Record<string, unknown>;
type Member = DatasetMeasureInfo | DatasetDimensionInfo;

function isPlainObject(v: unknown): v is Row {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function namesOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string' && n !== '') : [];
}

const DATASET_ID = 'studio-list-view-chart-dataset';
const CHART_TYPE_ID = 'studio-list-view-chart-type';

/** The label each input of the `chart` block is drawn with, as the held notice names it. */
const CHART_INPUT_LABEL_KEYS: Readonly<Record<string, string>> = {
  dataset: 'engine.studio.inspector.listView.chart.dataset',
  values: 'engine.studio.inspector.listView.chart.measures',
  dimensions: 'engine.studio.inspector.listView.chart.dimensions',
  chartType: 'engine.inspector.report.chartType',
};

/** The chart section's label for an input of the `chart` block, or `null` for one it does not draw. */
export function chartInputLabel(key: string, locale: string): string | null {
  const labelKey = CHART_INPUT_LABEL_KEYS[key];
  return labelKey ? t(labelKey, locale) : null;
}

/** The spec's chart types (the `chartType` enum of the `chart` block) and its default. */
function chartTypeChoices(): { options: string[]; fallback: string } {
  const prop = getListVariantSchema()?.properties?.chart?.properties?.chartType;
  const options = Array.isArray(prop?.enum) ? prop.enum.filter((v: unknown): v is string => typeof v === 'string') : [];
  return { options, fallback: typeof prop?.default === 'string' ? prop.default : '' };
}

function chartTypeLabel(type: string, locale: string): string {
  const key = `engine.inspector.widget.type.${type}`;
  const text = t(key, locale);
  return text === key ? type : text;
}

/** `row` with `names` under `key`, or without the key when there are none. */
function withNames(row: Row, key: string, names: string[]): Row {
  const { [key]: _dropped, ...rest } = row;
  return names.length > 0 ? { ...rest, [key]: names } : rest;
}

/**
 * The measures or the dimensions of the chart: the stored names in order, each
 * by its label, and a picker that adds one the dataset declares.
 * `members` is `null` when the dataset's members are unknown: the stored names
 * are then shown as they are, unjudged, and nothing is offered.
 */
function MemberList({
  id,
  label,
  names,
  members,
  readOnly,
  locale,
  addText,
  noneDeclaredText,
  onChange,
}: {
  id: string;
  label: string;
  names: string[];
  members: ReadonlyArray<Member> | null;
  readOnly: boolean;
  locale: string;
  addText: string;
  noneDeclaredText: string;
  onChange: (next: string[]) => void;
}): React.ReactElement {
  const remaining = members ? members.filter((m) => !names.includes(m.name)) : [];
  return (
    <div className="space-y-1.5" data-testid={`list-view-chart-${id}`}>
      <Label htmlFor={`studio-list-view-chart-${id}`} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {names.length > 0 && (
        <div className="space-y-1">
          {names.map((name) => {
            const member = members?.find((m) => m.name === name);
            const stale = members !== null && !member;
            return (
              <div
                key={name}
                className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1 text-xs"
                data-testid="list-view-chart-member"
                data-name={name}
                data-stale={stale ? 'true' : undefined}
              >
                <span className="flex-1 truncate">
                  <span>{member?.label || name}</span>
                  <code className="ml-2 text-muted-foreground">{name}</code>
                  {stale && (
                    <span className="ml-2 text-destructive">
                      {t('engine.studio.inspector.listView.chart.notInDataset', locale)}
                    </span>
                  )}
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={tFormat('engine.form.removeNamed', locale, { name })}
                    onClick={() => onChange(names.filter((n) => n !== name))}
                    className="px-1 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {members && members.length === 0 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{noneDeclaredText}</p>
      ) : (
        members &&
        !readOnly && (
          <Select value="" onValueChange={(name) => onChange([...names, name])} disabled={remaining.length === 0}>
            <SelectTrigger id={`studio-list-view-chart-${id}`} className="h-8 text-xs">
              <SelectValue
                placeholder={
                  remaining.length > 0 ? addText : t('engine.studio.inspector.listView.chart.allAdded', locale)
                }
              />
            </SelectTrigger>
            <SelectContent>
              {remaining.map((m) => (
                <SelectItem key={m.name} value={m.name}>
                  <span className="flex items-center gap-2">
                    <span>{m.label || m.name}</span>
                    <code className="text-xs text-muted-foreground">{m.name}</code>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      )}
    </div>
  );
}

export function ListViewChartSection({
  objectName,
  body,
  writeBody,
  readOnly,
  locale,
  marked,
}: {
  objectName: string;
  body: Row;
  writeBody: (next: Row) => void;
  readOnly: boolean;
  locale: string;
  /** objectui#12725 — the copilot drafted a setting of this block. */
  marked: boolean;
}): React.ReactElement {
  const chart = isPlainObject(body.chart) ? body.chart : null;
  const dataset = typeof chart?.dataset === 'string' ? chart.dataset : '';
  const values = namesOf(chart?.values);
  const dimensions = namesOf(chart?.dimensions);
  const authoring = useStudioDatasetAuthoring();
  const { catalog, datasets, bound, semantics } = useObjectDatasetBinding(objectName, dataset || undefined, {
    previewDrafts: authoring !== null,
  });
  const writeChart = (next: Row) => writeBody({ ...body, chart: next });

  const pickDataset = (name: string) => {
    if (name === dataset) return;
    const entry = datasets.find((d) => d.name === name);
    // A catalog entry that lists no member at all may be a name-only summary:
    // nothing is known to carry over, so nothing does.
    const known = !!entry && entry.measures.length + entry.dimensions.length > 0;
    const keep = (names: string[], members: ReadonlyArray<Member>) =>
      known ? names.filter((n) => members.some((m) => m.name === n)) : [];
    let next: Row = { ...(chart ?? {}), dataset: name };
    next = withNames(next, 'values', keep(values, entry?.measures ?? []));
    next = withNames(next, 'dimensions', keep(dimensions, entry?.dimensions ?? []));
    writeChart(next);
  };

  // The members to judge the stored names by, or `null` when they are unknown:
  // no dataset of this object bound, its read pending or failed.
  const judged = bound && !semantics.loading && !semantics.error;
  const measures = judged ? semantics.measures : null;
  const dims = judged ? semantics.dimensions : null;
  const { options: chartTypes, fallback: defaultChartType } = chartTypeChoices();
  const chartType = typeof chart?.chartType === 'string' ? chart.chartType : defaultChartType;
  const canPick = !catalog.loading && !catalog.error && datasets.length > 0;

  return (
    <div data-testid="list-view-chart" className="space-y-3 rounded-md border p-2">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-medium">
          {t('engine.studio.inspector.listView.chart', locale)}
          {marked && <DraftChip locale={locale} of="chart" />}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {t('engine.studio.inspector.listView.chart.intro', locale)}
        </p>
      </div>
      <div className="space-y-1.5" data-testid="list-view-chart-dataset">
        <Label htmlFor={DATASET_ID} className="text-xs text-muted-foreground">
          {t('engine.studio.inspector.listView.chart.dataset', locale)}
        </Label>
        {catalog.loading ? (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> {t('engine.studio.loading', locale)}
          </p>
        ) : catalog.error ? (
          <p className="rounded-md border border-dashed px-2 py-1.5 text-[11px] leading-snug text-muted-foreground" role="status" data-testid="list-view-chart-read-failed">
            {tFormat('engine.studio.inspector.listView.chart.readFailed', locale, { reason: catalog.error })}
          </p>
        ) : datasets.length === 0 ? (
          <p className="rounded-md border border-dashed px-2 py-1.5 text-[11px] leading-snug text-muted-foreground" data-testid="list-view-chart-no-datasets">
            {t('engine.studio.inspector.listView.chart.noDatasets', locale)}
          </p>
        ) : null}
        {canPick ? (
          <Select value={dataset || undefined} disabled={readOnly} onValueChange={pickDataset}>
            <SelectTrigger id={DATASET_ID} className="h-8 text-xs" data-testid="list-view-chart-dataset-trigger">
              <SelectValue placeholder={t('engine.studio.inspector.listView.chart.pickDataset', locale)} />
            </SelectTrigger>
            <SelectContent>
              {dataset && !bound && (
                <SelectItem value={dataset}>
                  <span className="font-mono">{dataset}</span>
                  <span className="ml-2 text-destructive">
                    {t('engine.studio.inspector.listView.chart.notObjectDataset', locale)}
                  </span>
                </SelectItem>
              )}
              {datasets.map((d) => (
                <SelectItem key={d.name} value={d.name}>
                  {datasetOptionLabel(d)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          dataset && (
            <p className="font-mono text-xs" data-testid="list-view-chart-stored-dataset">
              {dataset}
            </p>
          )
        )}
      </div>
      {bound && semantics.loading && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> {t('engine.studio.loading', locale)}
        </p>
      )}
      {bound && semantics.error && (
        <p className="rounded-md border border-dashed px-2 py-1.5 text-[11px] leading-snug text-muted-foreground" role="status" data-testid="list-view-chart-members-failed">
          {tFormat('engine.studio.inspector.listView.chart.membersFailed', locale, { reason: semantics.error })}
        </p>
      )}
      {(dataset || values.length > 0 || dimensions.length > 0) && (
        <>
          <MemberList
            id="values"
            label={t('engine.studio.inspector.listView.chart.measures', locale)}
            names={values}
            members={measures}
            readOnly={readOnly}
            locale={locale}
            addText={t('engine.studio.inspector.listView.chart.addMeasure', locale)}
            noneDeclaredText={t('engine.studio.inspector.listView.chart.noMeasures', locale)}
            onChange={(next) => writeChart(withNames(chart ?? {}, 'values', next))}
          />
          <MemberList
            id="dimensions"
            label={t('engine.studio.inspector.listView.chart.dimensions', locale)}
            names={dimensions}
            members={dims}
            readOnly={readOnly}
            locale={locale}
            addText={t('engine.studio.inspector.listView.chart.addDimension', locale)}
            noneDeclaredText={t('engine.studio.inspector.listView.chart.noDimensions', locale)}
            onChange={(next) => writeChart(withNames(chart ?? {}, 'dimensions', next))}
          />
        </>
      )}
      {chart && chartTypes.length > 0 && (
        <div className="space-y-1.5" data-testid="list-view-chart-type">
          <Label htmlFor={CHART_TYPE_ID} className="text-xs text-muted-foreground">
            {t('engine.inspector.report.chartType', locale)}
          </Label>
          <Select value={chartType || undefined} disabled={readOnly} onValueChange={(v) => writeChart({ ...chart, chartType: v })}>
            <SelectTrigger id={CHART_TYPE_ID} className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {chartType && !chartTypes.includes(chartType) && (
                <SelectItem value={chartType}>
                  <span className="font-mono">{chartType}</span>
                </SelectItem>
              )}
              {chartTypes.map((v) => (
                <SelectItem key={v} value={v}>
                  {chartTypeLabel(v, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
