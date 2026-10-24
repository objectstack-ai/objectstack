// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ReportDefaultInspector — the curated "home" panel for a Report.
 *
 * Shown as the DEFAULT right panel (no selection) for a report. Mirrors
 * {@link ViewVariantInspector} but for the flat Report document.
 *
 * SPEC-DRIVEN: the per-report-type config fields are NOT hardcoded. They are
 * rendered by feeding the spec's canonical authoring form (`reportForm`) and
 * the spec-derived Report JSONSchema into the generic {@link SchemaForm}. The
 * form's type-conditional `visibleWhen` section (joined blocks) automatically
 * surfaces the right fields — adding a new report type or prop to
 * `@objectstack/spec` flows through with zero code changes here.
 *
 * ADR-0021 single-form: a 9.0 report is dataset-bound — it binds a
 * semantic-layer `dataset` and selects its `values` (measure names) grouped
 * by `rows` (dimension names). The inspector keeps a thin curated layer for
 * the concerns the spec form can't express well on its own:
 *   1. the REPORT TYPE picker (options sourced from the spec `type` enum),
 *   2. the DATASET binding (drives the measure/dimension catalogs), and
 *   3. the VALUES / ROWS lists — add / remove / reorder from the bound
 *      dataset's measures and dimensions.
 * Those fields are pruned from the spec form to avoid double-editing.
 *
 * Unlike a View (a nested document with a variant BODY), a Report is FLAT:
 * label / dataset / type / values / rows all live at the draft top level, so
 * every write is a plain shallow `onPatch`.
 */

import * as React from 'react';
import { Badge, Label } from '@object-ui/components';
import {
  InspectorShell,
  InspectorTextField,
  InspectorSelectField,
  appendArray,
  moveArray,
  spliceArray,
  rosterFrom,
} from './_shared.js';
import { AddFieldPopover, FieldListRow } from '../previews/ViewColumnPanes.js';
import { toFieldNameLoose, toFieldNameOrEmpty } from '../previews/object-fields-io.js';
import type { MetadataDefaultInspectorProps } from '../default-inspector-registry.js';
import { SchemaForm } from '../SchemaForm.js';
import type { ObjectFieldInfo } from '../previews/useObjectFields.js';
import {
  useDatasetCatalog,
  useDatasetSemantics,
  type DatasetCatalogEntry,
  type DatasetDimensionInfo,
  type DatasetMeasureInfo,
} from '../previews/useDatasetCatalog.js';
import { getReportForm, getReportSchema } from '../report-schema.js';
import { mergeServerFields } from '../mergeServerFields.js';
import { t } from '../i18n.js';
import { mapLoaded } from '../loadState.js';
import type { WidgetContext } from '../widgets.js';
import { labelBesideName, datasetPickerOptions, datasetSelectOptions } from './dataset-picker-options.js';
import { pickLocalized, setLocalized, clearLocalized } from '@object-ui/i18n';

/**
 * Top-level report fields this inspector renders with its own dedicated
 * controls (type / dataset / values / rows + identity), so the spec-form
 * graft never double-renders them. Mirrors the `hiddenFields` passed to
 * SchemaForm.
 */
const REPORT_CURATED_FIELDS = new Set([
  'type',
  'label',
  'name',
  'dataset',
  'values',
  'rows',
  'columns', // matrix across-dimensions — dedicated list below
  'chart', // dedicated Chart panel below (type + dataset-aware X/Y pickers)
]);

/**
 * Top-level keys dropped from the container in the same patch that commits
 * `type: 'joined'` (objectui#10746). A joined report selects per block — each
 * block binds its own `dataset` and picks its own `rows` / `columns` /
 * `values` — so `ReportSchema`'s joined arm refuses the four selection keys on
 * the container ("a `joined` report selects per block — move `KEY` onto
 * `blocks[]`, or delete it", PR objectstack#20160) and has always refused a
 * container `order` ("a `joined` report orders per block"). `chart` is inert
 * on a joined container (objectstack#20161) and is hidden by the same switch.
 *
 * Why CLEAR rather than un-hide: the moment the type becomes `joined` this
 * inspector hides its dataset / values / rows / columns / chart controls
 * (`datasetBound` below) and the spec's own `reportForm` hides its whole
 * "Dataset binding" section — `order` included — through
 * `visibleWhen: "data.type != 'joined'"`. A report that was bound first and
 * switched second kept those keys INVISIBLY, and its save was then refused at
 * a path no control on the Properties tab could reach.
 *
 * The clear is an `undefined`-valued key in the shallow patch — the spelling
 * `commitChart` below and the sibling inspectors already clear with. The host
 * spreads the patch over the draft, so the key becomes an own property holding
 * `undefined`, which `JSON.stringify` omits on the wire and which the spec's
 * refinement skips. `runtimeFilter` and `drilldown` are deliberately NOT here:
 * the joined branch reads both.
 */
const JOINED_CONTAINER_CLEARED_KEYS = ['dataset', 'values', 'rows', 'columns', 'chart', 'order'] as const;

/**
 * Chart types offered in the curated Chart panel. A dataset-bound report plots
 * one measure (yAxis) across one dimension (xAxis), so we surface the families
 * that fit that shape; the renderer maps the rest. (`''` = no chart / table-only.)
 */
const REPORT_CHART_TYPES = ['bar', 'column', 'line', 'area', 'pie', 'donut'] as const;

export interface ReportDefaultInspectorProps extends MetadataDefaultInspectorProps {
  /**
   * Pre-resolved dataset catalog. When supplied, the inspector skips the
   * network fetches (`useDatasetCatalog`) and uses this list instead. Hosts
   * that already hold the catalog pass it to keep the inspector free of any
   * network dependency.
   */
  datasetCatalogOverride?: DatasetCatalogEntry[];
}

/** i18n keys for the spec `type` enum (falls back to the raw value). */
const TYPE_LABEL_KEYS: Record<string, string> = {
  tabular: 'engine.inspector.report.type.tabular',
  summary: 'engine.inspector.report.type.summary',
  matrix: 'engine.inspector.report.type.matrix',
  joined: 'engine.inspector.report.type.joined',
};

/** Build the Report-type picker's options (`InspectorSelectField`) from the spec `type` enum. */
function useTypeOptions(locale: MetadataDefaultInspectorProps['locale']) {
  return React.useMemo(() => {
    const schema = getReportSchema();
    const rawEnum = schema?.properties?.type?.enum;
    const values: string[] =
      Array.isArray(rawEnum) && rawEnum.length
        ? rawEnum.filter((v: unknown): v is string => typeof v === 'string')
        : ['tabular', 'summary', 'matrix', 'joined'];
    const opts = values.map((v) => {
      const key = TYPE_LABEL_KEYS[v];
      // i18n with a raw-value fallback (`t` echoes unknown keys verbatim).
      const label = key ? t(key, locale) : v;
      return { value: v, label: label === key ? v : label };
    });
    // objectui#8488 — a `type` outside the spec enum used to be appended here
    // UNFLAGGED, so an off-spec report type read exactly like an offered one.
    // `InspectorSelectField` synthesises and flags it now.
    return opts;
  }, [locale]);
}

/** Read a `string[]` draft field defensively. */
function readNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/*
 * ── The author's text in the dataset pickers (objectui#11161) ─────────────────
 *
 * The catalog carries each member's `label` and the dataset's `description`,
 * already resolved in the designer locale (`useDatasetCatalog`). Every option
 * list both dataset inspectors render reads them in ONE form: the author's
 * label beside the machine name, the name alone when no label is declared, and
 * a measure's ` · aggregate` hint where it has always shown. Each primitive
 * places the name its own way:
 *
 *   • the add-member list (`AddFieldPopover`) prints an option's `name` in a
 *     code chip beside its `label` whenever the two differ, so the label there
 *     is the author's text alone — `Revenue · sum` beside `revenue`;
 *   • a slot that renders text only (a select item) writes `LABEL (name)`, the
 *     form the dataset picker has always used — `Revenue (revenue) · sum`;
 *   • `InspectorComboField` prints each option's value itself, so a member
 *     option there carries the author's text alone.
 *
 * The dataset's `description` rides as the option's `hint`, the slot name
 * `InspectorComboField` renders as a muted suffix; a text-only item appends it
 * after ` — ` (the objectui#11028 form). An option's VALUE is always the
 * machine name — the label never reaches what a binding stores.
 *
 * The dataset options themselves (`datasetPickerOptions`, `labelBesideName`)
 * live in `./dataset-picker-options.ts` since objectui#11601, so the spec-form
 * `ref:dataset` widget offers them too without importing this inspector.
 * `datasetPickerOptions` stays exported from here for the inspectors that
 * already import it from this module.
 */
export { datasetPickerOptions };

/** A measure's aggregate hint, appended where the options have always shown it. */
function withAggregate(text: string, aggregate: string | undefined): string {
  return aggregate ? `${text} · ${aggregate}` : text;
}

/** The bound dataset's measures as add-member options (the name rides in `name`). */
export function datasetMeasureOptions(measures: DatasetMeasureInfo[]): ObjectFieldInfo[] {
  return measures.map((m) => ({
    name: m.name,
    label: withAggregate(m.label ?? m.name, m.aggregate),
    type: 'number',
    hidden: false,
  }));
}

/** The bound dataset's dimensions as add-member options (the name rides in `name`). */
export function datasetDimensionOptions(dimensions: DatasetDimensionInfo[]): ObjectFieldInfo[] {
  return dimensions.map((d) => ({
    name: d.name,
    label: d.label ?? d.name,
    type: d.type ?? 'text',
    hidden: false,
  }));
}

/**
 * A reorderable list of dataset member names (the report's `values` or
 * `rows`) with an add-popover fed by the bound dataset's catalog. Exported so
 * the Dashboard widget inspector can bind the same governed dimensions/measures
 * the same way (single source of truth for dataset-member editing).
 */
export function DatasetNamesEditor({
  label,
  emptyText,
  names,
  options,
  loading,
  error,
  readOnly,
  onCommit,
}: {
  label: string;
  emptyText: string;
  names: string[];
  /** Picker options from the dataset's semantic layer. */
  options: ObjectFieldInfo[];
  loading: boolean;
  error: string | null;
  readOnly?: boolean;
  onCommit: (next: string[]) => void;
}) {
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [overIndex, setOverIndex] = React.useState<number | null>(null);
  const used = React.useMemo(() => new Set(names), [names]);
  const typeByName = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) m.set(o.name, o.type);
    return m;
  }, [options]);

  return (
    <div className="border-t pt-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Badge variant="outline" className="text-[10px]">
          {names.length}
        </Badge>
      </div>

      {names.length === 0 ? (
        <p className="rounded-md border border-dashed bg-muted/30 px-3 py-3 text-center text-[11px] text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <div className="space-y-1">
          {names.map((name, i) => (
            <FieldListRow
              key={`${name}-${i}`}
              index={i}
              label={name}
              fieldName={name}
              fieldType={typeByName.get(name) ?? 'number'}
              selected={false}
              canEdit={!readOnly}
              dragging={dragIndex !== null}
              dropBefore={overIndex === i && dragIndex !== null && dragIndex !== i}
              onSelect={() => {}}
              onRemove={() => onCommit(spliceArray(names, i, null))}
              onDragStart={() => setDragIndex(i)}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragOverRow={() => setOverIndex(i)}
              onDropRow={() => {
                if (dragIndex != null && dragIndex !== i) onCommit(moveArray(names, dragIndex, i));
                setDragIndex(null);
                setOverIndex(null);
              }}
            />
          ))}
        </div>
      )}

      {!readOnly && (
        <AddFieldPopover
          fields={options}
          usedNames={used}
          loading={loading}
          error={error}
          onAdd={(f) => onCommit(appendArray(names, f.name))}
        />
      )}
    </div>
  );
}

export function ReportDefaultInspector({
  name,
  draft,
  onPatch,
  readOnly,
  locale,
  datasetCatalogOverride,
  serverSchema,
}: ReportDefaultInspectorProps) {
  const tr = React.useCallback((key: string) => t(key, locale), [locale]);

  // In create mode the host passes an empty `name` (the PK is assigned on
  // first save). Mirror ObjectDefaultInspector: expose an editable Name that
  // auto-derives a snake_case slug from the label until the author edits it
  // directly. Without this, a report created through the canvas would save
  // with an empty name and fail the snake_case identity rule (the create flow
  // would dead-end exactly the way it did before report-create used the canvas).
  const createMode = !name;
  const nameValue = typeof draft.name === 'string' ? (draft.name as string) : '';

  const reportType =
    typeof draft.type === 'string' ? (draft.type as string) : 'tabular';
  const typeOptions = useTypeOptions(locale);

  // `ReportSchema.label` is an `I18nLabel` — a plain string OR an inline
  // per-locale map (measured on @objectstack/spec 17.4.0). Narrowing it to the
  // string arm painted an EMPTY Label box over a report that has a label, and
  // the empty box is what invites the retype that flattens the map
  // (objectui#9274). READ through the repo's one resolver for the union.
  const labelValue = pickLocalized(draft.label, locale);
  // objectui#12680 — whether the author has edited the name is read off the
  // DRAFT, not kept in this component: the name still follows the label while
  // it is empty or equals the identifier the label as it stands derives. A ref
  // here was reset whenever the host remounted this panel (a Properties →
  // Source → Properties round trip does), and the next label keystroke then
  // replaced the name the author had typed.
  // objectui#12789 — the comparison uses the same derivation as the Label
  // handler below, so a Name left empty by a non-Latin Label still follows a
  // later Latin one, and a Name the author typed is never mistaken for the
  // `field` placeholder.
  const nameFollowsLabel = createMode && (nameValue === '' || nameValue === toFieldNameOrEmpty(labelValue));
  const datasetName =
    typeof draft.dataset === 'string' ? (draft.dataset as string) : '';
  const values = React.useMemo(() => readNames(draft.values), [draft.values]);
  const rows = React.useMemo(() => readNames(draft.rows), [draft.rows]);
  const columnsAcross = React.useMemo(() => readNames(draft.columns), [draft.columns]);

  // Dataset catalog (binding options) + the bound dataset's semantic layer
  // (measure/dimension picker options).
  const catalog = useDatasetCatalog(datasetCatalogOverride);
  const semantics = useDatasetSemantics(datasetName || undefined, catalog);

  // A FOURTH hand-rolled copy of the unknown-value rule used to sit here, and
  // it was the one that got the rule wrong: it appended the stored name with no
  // marker at all, so a dataset the catalog had dropped rendered exactly like a
  // dataset it offered. That is the direction objectui#8488 refused — it makes
  // "stored" and "offered" indistinguishable on screen, trading a display
  // defect for a semantic one. `InspectorSelectField` now synthesises the row
  // AND flags it; the catalog is all this list owes.
  //
  // objectui#11161 — a select item renders text only, so a declared
  // description follows the label after ` — `.
  const datasetOptions = React.useMemo(
    () => datasetSelectOptions(catalog.datasets),
    [catalog.datasets],
  );

  // objectui#11601 — the SAME catalog, handed to the spec form below, so a row
  // that declares `widget: 'ref:dataset'` (a joined report's block row, once
  // objectstack#21714 declares it) renders the dataset picker. The row spec is
  // the one authority for which control a block's `dataset` gets; this host
  // only supplies the catalog the widget reads. `rosterFrom` carries the
  // hook's loading and error into the widget's `LoadState`, failure first.
  //
  // `conditionScope` is required on every `WidgetContext`: `none` is this
  // surface's ruled verdict (`report` in `CONDITION_SCOPE_BY_METADATA_TYPE`),
  // and the bundled `ReportSchema` carries no predicate-named key the
  // condition detector would match, so it changes no field this form renders.
  const widgetContext = React.useMemo<WidgetContext>(
    () => ({
      conditionScope: 'none',
      datasets: mapLoaded(
        rosterFrom({ loading: catalog.loading, error: catalog.error }),
        () => catalog.datasets,
      ),
    }),
    [catalog.datasets, catalog.loading, catalog.error],
  );

  const measureOptions: ObjectFieldInfo[] = React.useMemo(
    () => datasetMeasureOptions(semantics.measures),
    [semantics.measures],
  );
  const dimensionOptions: ObjectFieldInfo[] = React.useMemo(
    () => datasetDimensionOptions(semantics.dimensions),
    [semantics.dimensions],
  );

  // Embedded chart (ADR-0021) — edited via the dedicated panel below so authors
  // pick the X dimension / Y measure from dropdowns sourced from the bound
  // dataset (instead of free-typing field names), and the generic spec-form
  // graft excludes `chart`. Patching merges into the chart object; clearing the
  // type drops the chart entirely.
  const chart =
    draft.chart && typeof draft.chart === 'object'
      ? (draft.chart as Record<string, unknown>)
      : {};
  const chartType = typeof chart.type === 'string' ? (chart.type as string) : '';
  const chartX = typeof chart.xAxis === 'string' ? (chart.xAxis as string) : '';
  const chartY = typeof chart.yAxis === 'string' ? (chart.yAxis as string) : '';
  const chartTitle = pickLocalized(chart.title, locale);
  const commitChart = (patch: Record<string, unknown>) => {
    const next = { ...chart, ...patch };
    onPatch({ chart: next.type ? next : undefined });
  };
  // Both axis rosters used to append an out-of-catalog axis unflagged
  // (objectui#8488): visible, but indistinguishable from a dimension the
  // dataset actually offers. The flag is `InspectorSelectField`'s job now.
  // objectui#11161 — a select item renders text only, so each axis reads
  // `LABEL (name)`; the stored axis is the name.
  const chartXOptions = React.useMemo(
    () => semantics.dimensions.map((d) => ({ value: d.name, label: labelBesideName(d.name, d.label) })),
    [semantics.dimensions],
  );
  const chartYOptions = React.useMemo(
    () =>
      semantics.measures.map((m) => ({
        value: m.name,
        label: withAggregate(labelBesideName(m.name, m.label), m.aggregate),
      })),
    [semantics.measures],
  );

  // A `joined` report carries its data on dataset-bound `blocks` (edited via
  // the spec form's repeater) — the top-level binding only applies otherwise.
  const datasetBound = reportType !== 'joined';

  // objectui#10746 — see `JOINED_CONTAINER_CLEARED_KEYS`. Only keys the draft
  // carries are named, so a host that mirrors each patched key to a live
  // preview (`ReportConfigPanel`'s `onFieldChange`) sees no phantom clears and
  // an unbound report's switch stays the one-key patch it always was.
  // Switching AWAY from `joined` restores nothing: the binding was dropped when
  // the type left, `onPatch` has no undo stack behind it, and the author
  // re-binds. `blocks` is never touched in either direction.
  const commitType = (nextType: string) => {
    const patch: Record<string, unknown> = { type: nextType };
    if (nextType === 'joined') {
      for (const key of JOINED_CONTAINER_CLEARED_KEYS) {
        if (draft[key] !== undefined) patch[key] = undefined;
      }
    }
    onPatch(patch);
  };

  // Graft any server-only top-level fields onto the bundled-spec form so they
  // are directly editable here even when the bundled `@objectstack/spec` lags
  // the running server (skew root-cure).
  const { schema, form } = React.useMemo(
    () =>
      mergeServerFields({
        bundledSchema: getReportSchema(),
        bundledForm: getReportForm(),
        serverSchema,
        excludeFields: REPORT_CURATED_FIELDS,
        sectionTitle: t('engine.inspector.moreFields', locale),
      }),
    [serverSchema, locale],
  );

  return (
    <InspectorShell
      kindLabel={tr('engine.inspector.report.kind')}
      title={String(labelValue || draft.name || tr('engine.inspector.report.kind'))}
      onClose={() => {}}
      closeLabel={tr('engine.inspector.report.close')}
      hideClose
    >
      {createMode && (
        <InspectorTextField
          label={tr('engine.inspector.report.name')}
          value={nameValue}
          // objectui#12746 — this box commits on every keystroke, so it takes
          // the prefix-stable form: the strict `toFieldName` trims a trailing
          // `_` before the next key arrives, and `qavrf_rev` typed key by key
          // read `qavrfrev`. The object designer's Name does the same. The
          // strict form stays where the name is derived from the Label, and
          // the spec's identifier rule judges the result.
          onCommit={(v) => onPatch({ name: toFieldNameLoose(v) })}
          placeholder={tr('engine.inspector.report.namePlaceholder')}
          disabled={readOnly}
          mono
        />
      )}
      <InspectorTextField
        label={tr('engine.inspector.report.label')}
        value={labelValue}
        onCommit={(v) => {
          // Same `I18nLabel` union, same inspector, same destructive shape as
          // the chart title (objectui#9274) — and `label` is REQUIRED on every
          // report, so it is the more reachable of the two. A required key
          // spells "empty" as `''`, not as an absent key, so the clear arm's
          // `undefined` (nothing localized left) is mapped back onto it.
          const patch: Record<string, unknown> = {
            label: v ? setLocalized(draft.label, locale, v) : (clearLocalized(draft.label, locale) ?? ''),
          };
          // Live-derive the snake_case name from the label until the author
          // edits the Name field directly (create mode only). `v` is the plain
          // string the author just typed, which is what the slug must read.
          // objectui#12789 — a Label that yields no machine name (a non-Latin
          // script, or a cleared Label) leaves the Name empty, as the object
          // designer does, so the save path asks the author for one; it never
          // writes the `field` placeholder.
          if (nameFollowsLabel) patch.name = toFieldNameOrEmpty(v);
          onPatch(patch);
        }}
        placeholder={tr('engine.inspector.report.labelPlaceholder')}
        disabled={readOnly}
      />
      <InspectorSelectField
        label={tr('engine.inspector.report.type')}
        value={reportType}
        options={typeOptions}
        onCommit={commitType}
        disabled={readOnly}
      />

      {datasetBound && (
        <>
          {catalog.datasets.length > 0 || datasetName ? (
            <InspectorSelectField
              label={tr('engine.inspector.report.dataset')}
              value={datasetName}
              options={datasetOptions}
              // objectui#8862 — the gate above keeps the picker mounted while a
              // dataset is bound, so an in-flight catalog reaches it as `[]` and
              // a live binding read as "(not found)" until the list landed.
              // objectui#9651 — a catalog that FAILED reaches it the same way
              // and never recovers, so the hook's `error` travels with the
              // in-flight signal as one state instead of beside it.
              roster={rosterFrom({ loading: catalog.loading, error: catalog.error })}
              rosterFailureLabel={tr('engine.form.optionsLoadFailedTitle')}
              onCommit={(v) => onPatch({ dataset: v })}
              disabled={readOnly}
            />
          ) : (
            // No catalog (offline / older server) — fall back to manual entry.
            <InspectorTextField
              label={tr('engine.inspector.report.dataset')}
              value={datasetName}
              onCommit={(v) => onPatch({ dataset: v })}
              placeholder={tr('engine.inspector.report.datasetPlaceholder')}
              disabled={readOnly}
              mono
            />
          )}

          <DatasetNamesEditor
            label={tr('engine.inspector.report.values')}
            emptyText={tr('engine.inspector.report.valuesEmpty')}
            names={values}
            options={measureOptions}
            loading={semantics.loading}
            error={semantics.error}
            readOnly={readOnly}
            onCommit={(next) => onPatch({ values: next })}
          />
          <DatasetNamesEditor
            label={tr('engine.inspector.report.rows')}
            emptyText={tr('engine.inspector.report.rowsEmpty')}
            names={rows}
            options={dimensionOptions}
            loading={semantics.loading}
            error={semantics.error}
            readOnly={readOnly}
            onCommit={(next) => onPatch({ rows: next })}
          />
          {reportType === 'matrix' && (
            // ADR-0021 D2 — a matrix pivots rows × columns (across dimensions).
            <DatasetNamesEditor
              label={tr('engine.inspector.report.columnsAcross')}
              emptyText={tr('engine.inspector.report.columnsAcrossEmpty')}
              names={columnsAcross}
              options={dimensionOptions}
              loading={semantics.loading}
              error={semantics.error}
              readOnly={readOnly}
              onCommit={(next) => onPatch({ columns: next })}
            />
          )}

          <div className="border-t pt-3 space-y-2">
            <Label className="text-xs text-muted-foreground">
              {tr('engine.inspector.report.chart')}
            </Label>
            <InspectorSelectField
              label={tr('engine.inspector.report.chartType')}
              value={chartType}
              options={[
                { value: '', label: tr('engine.inspector.report.chartNone') },
                ...REPORT_CHART_TYPES.map((tp) => ({ value: tp, label: tp })),
              ]}
              onCommit={(v) => commitChart({ type: v || undefined })}
              disabled={readOnly}
            />
            {chartType ? (
              <>
                <InspectorTextField
                  label={tr('engine.inspector.report.chartTitle')}
                  value={chartTitle}
                  onCommit={(v) =>
                    // ⛔ Never `{ title: v }` — with a stored locale map that is
                    // the flattening write objectui#9274 exists to remove. The
                    // clear arm removes ONLY this locale's entry (and drops the
                    // key once nothing localized is left, which is exactly what
                    // clearing a plain-string title has always done).
                    commitChart({
                      title: v
                        ? setLocalized(chart.title, locale, v)
                        : clearLocalized(chart.title, locale),
                    })
                  }
                  disabled={readOnly}
                />
                {/* objectui#8862 — both axis rosters come from the bound
                    dataset's semantic layer, which is fetched: the in-flight
                    signal is what keeps a valid axis from being flagged while
                    that fetch is out. objectui#9651 — `DatasetNamesEditor`
                    above already consumes this hook's `error` too, and these two
                    were the pickers that dropped it; a failed semantic layer
                    flagged a real axis permanently. Both facts travel as one
                    state. */}
                <InspectorSelectField
                  label={tr('engine.inspector.report.chartX')}
                  value={chartX}
                  options={chartXOptions}
                  roster={rosterFrom({ loading: semantics.loading, error: semantics.error })}
                  rosterFailureLabel={tr('engine.form.optionsLoadFailedTitle')}
                  onCommit={(v) => commitChart({ xAxis: v })}
                  disabled={readOnly}
                />
                <InspectorSelectField
                  label={tr('engine.inspector.report.chartY')}
                  value={chartY}
                  options={chartYOptions}
                  roster={rosterFrom({ loading: semantics.loading, error: semantics.error })}
                  rosterFailureLabel={tr('engine.form.optionsLoadFailedTitle')}
                  onCommit={(v) => commitChart({ yAxis: v })}
                  disabled={readOnly}
                />
              </>
            ) : null}
          </div>
        </>
      )}

      <div className="border-t pt-3">
        {schema ? (
          <SchemaForm
            schema={schema}
            form={form}
            value={draft}
            hiddenFields={['type', 'label', 'name', 'dataset', 'values', 'rows', 'columns', 'chart']}
            readOnly={readOnly}
            widgetContext={widgetContext}
            onChange={(next) => onPatch(next)}
          />
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {tr('engine.inspector.report.noSchema')}
          </p>
        )}
      </div>
    </InspectorShell>
  );
}
