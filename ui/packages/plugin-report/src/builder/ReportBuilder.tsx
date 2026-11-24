// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ReportBuilder — the one page a report is built on, new or existing
 * (objectstack#36374, board 49 figure 3).
 *
 * Left: the report drawn live. Right: five settings, top to bottom — report
 * type, data source (with 「+ Filter」 under it, objectstack#36645), measure,
 * grouping, chart. There is no "Generate" button:
 * every pick rewrites the report document (`reportBuilderModel.ts`) and the
 * preview draws it again. Picking a data source draws a number at once (the
 * dataset's count measure, no grouping). While a required piece is missing the
 * preview says what it is, where the chart would be, and that section's picker
 * opens by itself.
 *
 * The builder holds no state of its own beyond which picker is open: the host
 * owns the report document, reads the dataset catalog and the bound dataset's
 * members, and owns Save / Discard / Close. That is what lets two hosts share
 * it — the report page's 「Edit」 and the new-report page — and keeps the
 * network out of this package (the catalog hooks live with the metadata
 * client in the console).
 *
 * The name and description boxes are host-controlled too: what a box shows
 * and what an edit stores depend on the served translation of the report's
 * text, which only the host can read (objectstack#35008, #36373).
 *
 * @module
 */

import * as React from 'react';
import { BarChart3, Hash, LineChart, PieChart, Plus, Table2, X, Loader2 } from 'lucide-react';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@object-ui/components';
import { useSafeTranslate } from '@object-ui/i18n';
import { DatasetReportRenderer, type DatasetDrillArgs } from '../DatasetReportRenderer';
import {
  REPORT_BUILDER_CHART_TYPES,
  boundDataset,
  chartSplits,
  chartTakesTargetLine,
  fillDefaults,
  missingPiece,
  pickChartType,
  pickDataset,
  pickGrouping,
  pickMeasure,
  selectedChartType,
  selectedGrouping,
  selectedMeasure,
  setShowValues,
  setTargetLine,
  targetLine,
  type ReportBuilderDataset,
  type ReportBuilderMembers,
  type ReportBuilderSection,
  type ReportDraft,
} from './reportBuilderModel';

/** One host-controlled text box in the builder's header. */
export interface ReportBuilderTextBox {
  value: string;
  onChange: (next: string) => void;
  /** A line under the box (the host's served-translation note). */
  note?: React.ReactNode;
}

export interface ReportBuilderProps {
  /** The report document being built — the host's buffer. */
  report: ReportDraft;
  /** Every edit: the next report document. */
  onChange: (next: ReportDraft) => void;
  /** The report's name box. */
  name: ReportBuilderTextBox;
  /** The report's description box. */
  description: ReportBuilderTextBox;
  /** The datasets the data source offers. */
  datasets: ReportBuilderDataset[];
  datasetsLoading?: boolean;
  /** The bound dataset's members; `undefined` while not read (or nothing is bound). */
  members?: ReportBuilderMembers;
  membersLoading?: boolean;
  /** A line the host could not read the catalog or the members with. */
  catalogError?: string;
  /**
   * The report filter under the data source (「+ Filter」, objectstack#36645):
   * the report's `runtimeFilter` on the bound dataset. Host-controlled like
   * the name box — the filterable fields are the dataset object's, and the
   * filter's conversion to and from the spec's `FilterCondition` is the
   * console's one shared bridge, so neither is read in this package. Drawn
   * only while a data source is bound; absent, the builder offers no filter.
   */
  filter?: React.ReactNode;
  /** Save: resolves once the host has written (or refused) the report. */
  onSave: () => void | Promise<unknown>;
  /** Discard: put the report back as it was when the builder opened. */
  onDiscard: () => void;
  /** Close the builder. */
  onClose: () => void;
  /** Whether the report differs from where it started (Discard is off when not). */
  dirty?: boolean;
  saving?: boolean;
  /** A host notice above the preview (a pending draft, a refusal). */
  banner?: React.ReactNode;
  dataSource?: unknown;
  /** The preview's drill sink (「View details」). */
  onDrill?: (args: DatasetDrillArgs) => void;
  className?: string;
}

const CHART_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  bar: BarChart3,
  line: LineChart,
  donut: PieChart,
  metric: Hash,
  table: Table2,
};

/** Radix Select refuses an empty item value, so "no grouping" is a sentinel. */
const NONE = '__none__';

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function ReportBuilder({
  report,
  onChange,
  name,
  description,
  datasets,
  datasetsLoading,
  members,
  membersLoading,
  catalogError,
  filter,
  onSave,
  onDiscard,
  onClose,
  dirty,
  saving,
  banner,
  dataSource,
  onDrill,
  className,
}: ReportBuilderProps) {
  const tt = useSafeTranslate();
  const dataset = boundDataset(report);
  const measure = selectedMeasure(report);
  const grouping = selectedGrouping(report);
  const chartType = selectedChartType(report);
  const readyMembers = membersLoading ? undefined : members;
  // Judged on the report as it stands once the dataset's default measure
  // lands (the effect below), so a just-picked dataset never opens the
  // measure picker for the one render before its count measure is filled.
  const missing = missingPiece(readyMembers ? fillDefaults(report, readyMembers) : report, readyMembers);

  // The one open picker. A missing piece opens its section's picker by
  // itself, once per missing piece: closing it leaves it closed until the
  // next piece goes missing.
  const [openPicker, setOpenPicker] = React.useState<ReportBuilderSection | 'grouping2' | null>(null);
  const missingKey = missing ? `${missing.section}:${missing.reason}` : '';
  React.useEffect(() => {
    if (!missing) return;
    if (missing.reason === 'noMeasures') return;
    setOpenPicker(missing.section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey]);
  const pickerProps = (section: ReportBuilderSection | 'grouping2') => ({
    open: openPicker === section,
    onOpenChange: (open: boolean) => setOpenPicker(open ? section : null),
  });

  // A dataset is picked before its members are read, so its default measure
  // lands once they arrive (the host hands in the BOUND dataset's members).
  React.useEffect(() => {
    if (membersLoading || !members) return;
    const next = fillDefaults(report, members);
    if (next !== report) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, membersLoading, dataset]);

  // The second-layer picker shows while the report has a second layer, or
  // once 「Add another layer」 was pressed and before one is picked.
  const [secondLayerAsked, setShowSecondLayer] = React.useState(false);
  const showSecondLayer = secondLayerAsked || !!grouping.second;

  const measures = members?.measures ?? [];
  const dimensions = members?.dimensions ?? [];
  const textOf = (item: { name: string; label?: string }) => item.label || item.name;
  const target = targetLine(report);
  const showValues = !!(report.chart && (report.chart as Record<string, unknown>).showDataLabels);

  const chartLabel = (type: string) =>
    tt(`report.builder.chart.${type}`, type);

  return (
    <div
      className={`flex h-full min-h-0 flex-col bg-background ${className ?? ''}`}
      data-testid="report-builder"
      data-report-name={typeof report.name === 'string' ? report.name : undefined}
    >
      {/* Header: close, the name and its description, then Discard / Save. */}
      <header className="flex items-start gap-3 border-b px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mt-0.5 h-8 w-8 shrink-0"
          onClick={onClose}
          aria-label={tt('report.builder.close', 'Close')}
          data-testid="report-builder-close"
        >
          <X className="h-4 w-4" />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Input
            value={name.value}
            onChange={(e) => name.onChange(e.target.value)}
            placeholder={tt('report.builder.namePlaceholder', 'Untitled report')}
            aria-label={tt('report.builder.name', 'Report name')}
            className="h-8 border-transparent px-1 text-base font-semibold shadow-none hover:border-input focus-visible:border-input"
            data-testid="report-builder-name"
          />
          {name.note}
          <Input
            value={description.value}
            onChange={(e) => description.onChange(e.target.value)}
            placeholder={tt('report.builder.descriptionPlaceholder', 'Add a description')}
            aria-label={tt('report.builder.description', 'Description')}
            className="h-7 border-transparent px-1 text-sm text-muted-foreground shadow-none hover:border-input focus-visible:border-input"
            data-testid="report-builder-description"
          />
          {description.note}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDiscard}
            disabled={!dirty || saving}
            data-testid="report-builder-discard"
          >
            {tt('report.builder.discard', 'Discard')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => { void onSave(); }}
            disabled={saving || !!missing}
            data-testid="report-builder-save"
          >
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {tt('report.builder.save', 'Save')}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* The live picture. */}
        <main className="min-h-0 min-w-0 flex-1 overflow-auto bg-muted/5 p-4 sm:p-6" data-testid="report-builder-preview">
          {banner}
          <div className="rounded-lg border bg-background p-4 shadow-sm sm:p-6">
            {dataset && membersLoading && !measure ? (
              <div className="flex min-h-64 items-center justify-center" data-testid="report-builder-loading">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : missing ? (
              <div
                role="status"
                className="flex min-h-64 flex-col items-center justify-center gap-2 text-center"
                data-testid="report-builder-missing"
                data-missing={missing.reason}
              >
                <BarChart3 className="h-8 w-8 text-muted-foreground/60" />
                <p className="text-sm font-medium text-muted-foreground">
                  {tt(`report.builder.missing.${missing.reason}`, missing.reason)}
                </p>
              </div>
            ) : (
              <DatasetReportRenderer
                report={report as never}
                dataSource={dataSource}
                onDrill={onDrill}
                foldTableUnderChart
              />
            )}
          </div>
        </main>

        {/* The five settings. */}
        <aside
          className="flex w-full shrink-0 flex-col gap-5 overflow-auto border-t p-4 md:w-80 md:border-l md:border-t-0"
          aria-label={tt('report.builder.settings', 'Report settings')}
          data-testid="report-builder-settings"
        >
          <Section title={tt('report.builder.type.label', 'Report type')} testId="report-builder-type">
            <Select value="snapshot" {...pickerProps('type')}>
              <SelectTrigger className="h-9" data-testid="report-builder-type-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="snapshot">{tt('report.builder.type.snapshot', 'Current state')}</SelectItem>
              </SelectContent>
            </Select>
          </Section>

          <Section title={tt('report.builder.source.label', 'Data source')} testId="report-builder-source">
            <Select
              value={dataset || undefined}
              onValueChange={(next) => onChange(pickDataset(report, next, undefined))}
              {...pickerProps('source')}
            >
              <SelectTrigger className="h-9" data-testid="report-builder-source-trigger">
                <SelectValue placeholder={tt('report.builder.source.placeholder', 'Choose a data source')} />
              </SelectTrigger>
              <SelectContent>
                {datasetsLoading ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    {tt('report.builder.source.loading', 'Loading data sources…')}
                  </div>
                ) : datasets.length === 0 && !dataset ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    {tt('report.builder.source.none', 'No data sources yet')}
                  </div>
                ) : null}
                {datasets.map((d) => (
                  <SelectItem key={d.name} value={d.name} data-testid={`report-builder-source-option-${d.name}`}>
                    {textOf(d)}
                  </SelectItem>
                ))}
                {dataset && !datasets.some((d) => d.name === dataset) ? (
                  <SelectItem value={dataset}>{dataset}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            {catalogError ? <p className="text-xs text-destructive">{catalogError}</p> : null}
            {dataset && filter ? <div data-testid="report-builder-filter">{filter}</div> : null}
          </Section>

          <Section title={tt('report.builder.measure.label', 'Measure')} testId="report-builder-measure">
            <Select
              value={measure || undefined}
              onValueChange={(next) => onChange(pickMeasure(report, next, members))}
              disabled={!dataset}
              {...pickerProps('measure')}
            >
              <SelectTrigger className="h-9" data-testid="report-builder-measure-trigger">
                <SelectValue placeholder={tt('report.builder.measure.placeholder', 'Choose a measure')} />
              </SelectTrigger>
              <SelectContent>
                {measures.map((m) => (
                  <SelectItem key={m.name} value={m.name} data-testid={`report-builder-measure-option-${m.name}`}>
                    {textOf(m)}
                  </SelectItem>
                ))}
                {measure && !measures.some((m) => m.name === measure) ? (
                  <SelectItem value={measure}>{measure}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </Section>

          <Section title={tt('report.builder.grouping.label', 'Group by')} testId="report-builder-grouping">
            <Select
              value={grouping.first || NONE}
              onValueChange={(next) =>
                onChange(pickGrouping(report, next === NONE ? '' : next, next === NONE ? '' : grouping.second, members))
              }
              disabled={!dataset}
              {...pickerProps('grouping')}
            >
              <SelectTrigger className="h-9" data-testid="report-builder-grouping-trigger">
                <SelectValue placeholder={tt('report.builder.grouping.placeholder', 'Choose a field')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{tt('report.builder.grouping.none', 'No grouping')}</SelectItem>
                {dimensions.map((d) => (
                  <SelectItem key={d.name} value={d.name} data-testid={`report-builder-grouping-option-${d.name}`}>
                    {textOf(d)}
                  </SelectItem>
                ))}
                {grouping.first && !dimensions.some((d) => d.name === grouping.first) ? (
                  <SelectItem value={grouping.first}>{grouping.first}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            {grouping.first && showSecondLayer ? (
              <div className="flex items-center gap-1.5">
                <Select
                  value={grouping.second || undefined}
                  onValueChange={(next) => onChange(pickGrouping(report, grouping.first, next, members))}
                  {...pickerProps('grouping2')}
                >
                  <SelectTrigger className="h-9" data-testid="report-builder-grouping2-trigger">
                    <SelectValue placeholder={tt('report.builder.grouping.placeholder', 'Choose a field')} />
                  </SelectTrigger>
                  <SelectContent>
                    {dimensions
                      .filter((d) => d.name !== grouping.first)
                      .map((d) => (
                        <SelectItem key={d.name} value={d.name}>
                          {textOf(d)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={tt('report.builder.grouping.removeLayer', 'Remove this layer')}
                  onClick={() => {
                    setShowSecondLayer(false);
                    if (grouping.second) onChange(pickGrouping(report, grouping.first, '', members));
                  }}
                  data-testid="report-builder-grouping2-remove"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : grouping.first ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-fit px-1.5 text-xs text-muted-foreground"
                onClick={() => {
                  setShowSecondLayer(true);
                  setOpenPicker('grouping2');
                }}
                data-testid="report-builder-grouping-add-layer"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {tt('report.builder.grouping.addLayer', 'Add another layer')}
              </Button>
            ) : null}
          </Section>

          <Section title={tt('report.builder.chart.label', 'Chart')} testId="report-builder-chart">
            <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label={tt('report.builder.chart.label', 'Chart')}>
              {REPORT_BUILDER_CHART_TYPES.map((type) => {
                const Icon = CHART_ICONS[type];
                const active = chartType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!dataset}
                    onClick={() => onChange(pickChartType(report, type, members))}
                    className={`flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[11px] leading-none transition-colors disabled:opacity-50 ${
                      active ? 'border-primary bg-primary/5 text-foreground' : 'border-input text-muted-foreground hover:bg-accent'
                    }`}
                    data-testid={`report-builder-chart-${type}`}
                  >
                    <Icon className="h-4 w-4" />
                    {chartLabel(type)}
                  </button>
                );
              })}
            </div>
            {chartType !== 'table' && chartType !== 'metric' ? (
              <div className="flex items-center justify-between gap-2 pt-1">
                <Label htmlFor="report-builder-show-values" className="text-sm font-normal">
                  {tt('report.builder.chart.showValues', 'Show values')}
                </Label>
                <Switch
                  id="report-builder-show-values"
                  checked={showValues}
                  onCheckedChange={(on) => onChange(setShowValues(report, on))}
                  data-testid="report-builder-show-values"
                />
              </div>
            ) : null}
            {chartTakesTargetLine(chartType) ? (
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="report-builder-target" className="text-sm font-normal">
                  {tt('report.builder.chart.targetLine', 'Target line')}
                </Label>
                <Input
                  id="report-builder-target"
                  type="number"
                  inputMode="decimal"
                  className="h-8 w-28"
                  value={target === undefined ? '' : String(target)}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    const value = raw === '' ? undefined : Number(raw);
                    onChange(setTargetLine(report, value, tt('report.builder.chart.targetLabel', 'Target')));
                  }}
                  data-testid="report-builder-target"
                />
              </div>
            ) : null}
            {grouping.second && !chartSplits(chartType) && chartType !== 'table' ? (
              <p className="text-xs text-muted-foreground" data-testid="report-builder-second-layer-note">
                {tt('report.builder.chart.secondLayerTableOnly', 'This chart draws the first grouping; the second is in the computed values.')}
              </p>
            ) : null}
          </Section>
        </aside>
      </div>
    </div>
  );
}
