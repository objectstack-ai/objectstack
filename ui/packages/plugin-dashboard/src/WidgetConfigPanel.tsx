/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import {
  ConfigPanelRenderer,
  useConfigDraft,
  Combobox,
  Button,
  Input,
  cn,
} from '@object-ui/components';
import { ConfigRow } from '@object-ui/components';
import { X } from 'lucide-react';
import { pickLocalized, setLocalized } from '@object-ui/i18n';
import type { ConfigPanelSchema, ConfigField } from '@object-ui/components';
import type { WidgetDatasetCatalogEntry } from './dataset-catalog';
import { measureRefusal, NEXT_MEASURE_PROBE } from './measureRefusal';
import {
  useConfigPanelTranslation,
  type ConfigPanelTranslate,
} from './useConfigPanelTranslation';

// ---------------------------------------------------------------------------
// Widget type options derived from @object-ui/types DASHBOARD_WIDGET_TYPES
//
// The stored `value` is the spec's widget type and never localizes; the label
// is translated per render (objectui#4748).
//
// Every key is written as a LITERAL argument of `t()` rather than carried in a
// `{ value, key }` table the builder maps over. The table reads more tightly
// and was the first shape here, but it costs both i18n gates their view of
// these keys: `check-i18n-call-site-keys` cannot verify a key it only sees as
// `t(key)` (it counts as a dynamic-key site and is skipped), and
// `check-i18n-dead-keys` cannot see a reader for it either — measured, the
// table shape put all 33 option keys on the dead-key report as NEEDS-REVIEW
// while the 42 keys passed literally elsewhere in these two files stayed off
// it entirely. Literal-at-the-call-site is what makes a key checkable.
// ---------------------------------------------------------------------------

function widgetTypeOptions(t: ConfigPanelTranslate): Array<{ value: string; label: string }> {
  return [
    { value: 'metric', label: t('dashboard.config.widgetType.metric') },
    { value: 'bar', label: t('dashboard.config.widgetType.bar') },
    { value: 'horizontal-bar', label: t('dashboard.config.widgetType.horizontalBar') },
    { value: 'line', label: t('dashboard.config.widgetType.line') },
    { value: 'pie', label: t('dashboard.config.widgetType.pie') },
    { value: 'donut', label: t('dashboard.config.widgetType.donut') },
    { value: 'area', label: t('dashboard.config.widgetType.area') },
    { value: 'scatter', label: t('dashboard.config.widgetType.scatter') },
    { value: 'funnel', label: t('dashboard.config.widgetType.funnel') },
    { value: 'table', label: t('dashboard.config.widgetType.table') },
    { value: 'pivot', label: t('dashboard.config.widgetType.pivot') },
  ];
}

function colorVariantOptions(t: ConfigPanelTranslate): Array<{ value: string; label: string }> {
  return [
    { value: 'default', label: t('dashboard.config.color.default') },
    { value: 'blue', label: t('dashboard.config.color.blue') },
    { value: 'teal', label: t('dashboard.config.color.teal') },
    { value: 'orange', label: t('dashboard.config.color.orange') },
    { value: 'purple', label: t('dashboard.config.color.purple') },
    { value: 'success', label: t('dashboard.config.color.success') },
    { value: 'warning', label: t('dashboard.config.color.warning') },
    { value: 'danger', label: t('dashboard.config.color.danger') },
  ];
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHART_TYPES = ['bar', 'horizontal-bar', 'line', 'area', 'pie', 'donut', 'scatter', 'funnel'];
// Single-value widgets — a metric shows ONE aggregated value, so it selects
// `values` but never `dimensions` (adding a dimension would fan it out into a
// series, which the metric renderer can't display).
const METRIC_LIKE_TYPES = ['metric', 'gauge', 'solid-gauge', 'kpi', 'bullet'];

// Widget types that support drill-down. Aggregating widgets (chart / pivot /
// metric) drill *through* — clicking a cell/segment opens a filtered list of
// underlying records. Record widgets (table / list) drill *to record* —
// clicking a row opens that record's detail. Pairs with the @object-ui/core
// `drill-down` helpers and the `DrillDownConfig.mode` discriminator.
const DRILL_DOWN_TYPES = [
  'pivot', 'metric', 'bar', 'horizontal-bar', 'line', 'area', 'pie', 'donut', 'funnel',
  'scatter', 'treemap', 'sankey', 'table', 'list',
];

function isChartType(t: string | undefined): boolean {
  return !!t && CHART_TYPES.includes(t);
}

/** Whether a widget of this type selects dataset `dimensions` (group/split). */
function usesDimensions(t: string | undefined): boolean {
  return !!t && !METRIC_LIKE_TYPES.includes(t);
}

export function supportsDrillDown(t: string | undefined): boolean {
  return !!t && DRILL_DOWN_TYPES.includes(t);
}

/**
 * The breadcrumb's second segment, by widget type.
 *
 * Keyed separately from the widget-type PICKER labels on purpose: the picker
 * offers `Pivot Table`, the breadcrumb reads `Pivot table`. Same word, two
 * authored strings, so two keys — see useConfigPanelTranslation.ts.
 */
function widgetBreadcrumbLabel(
  t: ConfigPanelTranslate,
  widgetType: string | undefined,
): string {
  if (widgetType === 'pivot') return t('dashboard.config.breadcrumb.pivotTable');
  if (widgetType === 'table') return t('dashboard.config.breadcrumb.table');
  return isChartType(widgetType)
    ? t('dashboard.config.breadcrumb.chart')
    : t('dashboard.config.breadcrumb.widget');
}

// ---------------------------------------------------------------------------
// Dataset member (dimensions / values) multi-picker
//
// A self-contained control: removable chips for the current selection plus an
// "add" control. When the bound dataset's members are known (catalog present)
// the add control is a Combobox of the unused members; otherwise it falls back
// to a free-text input (Enter to add) so authoring still works without a
// catalog. Mirrors app-shell's DatasetNamesEditor, which plugin-dashboard
// cannot import (layering).
// ---------------------------------------------------------------------------

function DatasetNamesField({
  names,
  options,
  placeholder,
  emptyText,
  onChange,
  canAdd = true,
  refusal,
}: {
  names: string[];
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  emptyText: string;
  onChange: (next: string[]) => void;
  /** `false` withholds the add control: the widget door refuses one more name. */
  canAdd?: boolean;
  /** The widget door's refusal of the CURRENT names, shown verbatim under them. */
  refusal?: string;
}) {
  // Its own hook call rather than a forwarded `t`: this is a component, and the
  // three strings below are its own chrome (chip remove button, add control),
  // not part of the schema its parent builds.
  const { t } = useConfigPanelTranslation();
  const [draftName, setDraftName] = React.useState('');
  const used = React.useMemo(() => new Set(names), [names]);
  const addable = React.useMemo(
    () => options.filter((o) => !used.has(o.value)),
    [options, used],
  );

  const add = (name: string) => {
    const v = name.trim();
    if (!canAdd || !v || used.has(v)) return;
    onChange([...names, v]);
    setDraftName('');
  };
  const remove = (name: string) => onChange(names.filter((n) => n !== name));

  return (
    <div className="space-y-1.5">
      {names.length === 0 ? (
        <p className="rounded border border-dashed px-2 py-1.5 text-center text-[11px] text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {names.map((name) => (
            <span
              key={name}
              data-testid={`dataset-name-chip-${name}`}
              className={cn(
                'inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5',
                'font-mono text-[11px] text-foreground',
              )}
            >
              {name}
              <button
                type="button"
                aria-label={t('dashboard.config.action.remove', { name })}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => remove(name)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {refusal && (
        <p
          role="alert"
          data-testid="dataset-names-refusal"
          className="break-words text-[11px] leading-snug text-destructive"
        >
          {refusal}
        </p>
      )}

      {!canAdd ? null : addable.length > 0 ? (
        <Combobox
          options={addable}
          value=""
          onValueChange={add}
          placeholder={placeholder}
          searchPlaceholder={t('dashboard.config.placeholder.searchMembers')}
          emptyText={t('dashboard.config.empty.nothingToAdd')}
          className="h-7 w-full text-xs"
        />
      ) : (
        <div className="flex items-center gap-1">
          <Input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(draftName);
              }
            }}
            placeholder={placeholder}
            className="h-7 flex-1 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => add(draftName)}
            disabled={!draftName.trim()}
          >
            {t('dashboard.config.action.add')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schema builder — creates a ConfigPanelSchema for the dataset (ADR-0021)
// authoring shape. `dataset` picks a named semantic-layer dataset; `dimensions`
// and `values` select that dataset's members by name.
// ---------------------------------------------------------------------------

export function buildWidgetSchema(
  t: ConfigPanelTranslate,
  datasets: WidgetDatasetCatalogEntry[] | undefined,
  widgetType?: string,
): ConfigPanelSchema {
  const catalog = datasets ?? [];
  const hasCatalog = catalog.length > 0;

  const datasetOptions = catalog.map((d) => ({
    value: d.name,
    label: d.label && d.label !== d.name ? `${d.label} (${d.name})` : d.name,
  }));

  const entryFor = (name: unknown): WidgetDatasetCatalogEntry | undefined =>
    typeof name === 'string' ? catalog.find((d) => d.name === name) : undefined;

  // ---- Dataset selector (Combobox over the catalog, free-text fallback) ----
  const datasetLabel = t('dashboard.config.field.dataset');
  const datasetHelp = t('dashboard.config.help.dataset');

  const datasetField: ConfigField = hasCatalog
    ? {
        key: 'dataset',
        label: datasetLabel,
        type: 'custom',
        helpText: datasetHelp,
        render: (value: any, onChange: (v: any) => void) => (
          <ConfigRow label={datasetLabel}>
            <div data-testid="config-field-dataset">
              <Combobox
                options={datasetOptions}
                value={value ?? ''}
                onValueChange={onChange}
                placeholder={t('dashboard.config.placeholder.selectDataset')}
                searchPlaceholder={t('dashboard.config.placeholder.searchDatasets')}
                emptyText={t('dashboard.config.empty.datasets')}
                className="h-7 w-40 text-xs"
              />
            </div>
          </ConfigRow>
        ),
      }
    : {
        key: 'dataset',
        label: datasetLabel,
        type: 'input',
        placeholder: t('dashboard.config.placeholder.datasetName'),
        helpText: datasetHelp,
      };

  const dimensionsLabel = t('dashboard.config.field.dimensions');

  const dimensionsField: ConfigField = {
    key: 'dimensions',
    label: dimensionsLabel,
    type: 'custom',
    visibleWhen: (d: Record<string, any>) => usesDimensions(d.type),
    helpText:
      widgetType === 'pivot'
        ? t('dashboard.config.help.dimensionsPivot')
        : t('dashboard.config.help.dimensions'),
    render: (value: any, onChange: (v: any) => void, draft: Record<string, any>) => {
      const entry = entryFor(draft.dataset);
      const options = (entry?.dimensions ?? []).map((dim) => ({
        value: dim.name,
        label: dim.label && dim.label !== dim.name ? `${dim.label} (${dim.name})` : dim.name,
      }));
      return (
        <ConfigRow label={dimensionsLabel}>
          <div data-testid="config-field-dimensions" className="w-40">
            <DatasetNamesField
              names={Array.isArray(value) ? value : []}
              options={options}
              placeholder={t('dashboard.config.placeholder.addDimension')}
              emptyText={t('dashboard.config.empty.dimensions')}
              onChange={onChange}
            />
          </div>
        </ConfigRow>
      );
    },
  };

  const valuesLabel = t('dashboard.config.field.values');

  const valuesField: ConfigField = {
    key: 'values',
    label: valuesLabel,
    type: 'custom',
    helpText: t('dashboard.config.help.values'),
    render: (value: any, onChange: (v: any) => void, draft: Record<string, any>) => {
      const entry = entryFor(draft.dataset);
      const options = (entry?.measures ?? []).map((m) => ({
        value: m.name,
        label: m.aggregate ? `${m.label ?? m.name} · ${m.aggregate}` : (m.label ?? m.name),
      }));
      const names: string[] = Array.isArray(value) ? value : [];
      // ── The widget door decides how many measures this widget takes
      // (objectui#8894) ─────────────────────────────────────────────────────
      // A metric-family tile answers ONE number, and the spec refuses a second
      // measure on it (ruling D). The picker asks the same door rather than
      // carrying a list of types (`measureRefusal`), judging the widget as a
      // save would emit it (`sanitizeDraftForType` — a metric-like type sheds
      // its dimensions there):
      //  - one more measure would be refused → the add control is not offered;
      //  - the measures already chosen are refused (a stored document, or a
      //    type switched under them) → the door's own message is shown at once,
      //    so the author meets the refusal here rather than at publish.
      const saved = sanitizeDraftForType(draft);
      const judged = { id: saved.id, type: saved.type, dimensions: saved.dimensions };
      const refusal = names.length > 0 ? measureRefusal({ ...judged, values: names }) : undefined;
      const canAdd = !measureRefusal({ ...judged, values: [...names, NEXT_MEASURE_PROBE] });
      return (
        <ConfigRow label={valuesLabel}>
          <div data-testid="config-field-values" className="w-40">
            <DatasetNamesField
              names={names}
              options={options}
              placeholder={t('dashboard.config.placeholder.addMeasure')}
              emptyText={t('dashboard.config.empty.measures')}
              onChange={onChange}
              canAdd={canAdd}
              refusal={refusal}
            />
          </div>
        </ConfigRow>
      );
    },
  };

  return {
    breadcrumb: [
      t('dashboard.config.breadcrumb.dashboard'),
      widgetBreadcrumbLabel(t, widgetType),
    ],
    sections: [
      // ----- General (always visible) -------------------------------------
      {
        key: 'general',
        title: t('dashboard.config.section.general'),
        fields: [
          {
            key: 'title',
            label: t('dashboard.config.field.title'),
            type: 'input',
            placeholder: t('dashboard.config.placeholder.widgetTitle'),
          },
          {
            key: 'description',
            label: t('dashboard.config.field.description'),
            type: 'input',
            placeholder: t('dashboard.config.placeholder.widgetDescription'),
          },
          {
            key: 'type',
            label: t('dashboard.config.field.widgetType'),
            type: 'select',
            options: widgetTypeOptions(t),
            defaultValue: 'metric',
          },
        ],
      },

      // ----- Data binding (ADR-0021 dataset shape) ------------------------
      {
        key: 'data',
        title: t('dashboard.config.section.dataBinding'),
        collapsible: true,
        fields: [
          datasetField,
          dimensionsField,
          valuesField,
        ],
      },

      // ----- Layout (always visible) --------------------------------------
      {
        key: 'layout',
        title: t('dashboard.config.section.layout'),
        collapsible: true,
        fields: [
          {
            key: 'layoutW',
            label: t('dashboard.config.field.width'),
            type: 'slider',
            min: 1,
            max: 12,
            step: 1,
            defaultValue: 1,
          },
          {
            key: 'layoutH',
            label: t('dashboard.config.field.height'),
            type: 'slider',
            min: 1,
            max: 6,
            step: 1,
            defaultValue: 1,
          },
        ],
      },

      // ----- Behavior --------------------------------------------------
      // Deliberately absent. The group held exactly one field, a
      // "Click-through URL" bound to `actionUrl` — a widget-level key the spec
      // RETIRED in @objectstack/spec 17.0.0-rc.3 (objectstack#5010, ADR-0049
      // D2) alongside `actionType` / `actionIcon`. All three are `retiredKey`
      // tombstones: `DashboardWidgetSchema` types them `never` and refuses any
      // value, so the field was authoring a parse error into stored metadata
      // (objectstack#7129). It was also inert on the render side — no dashboard
      // widget renderer ever read `widget.actionUrl`; every action the
      // dashboard dispatches comes from `header.actions[]`, which keeps its own
      // (live, string-typed) `actionUrl`. Do not reintroduce it here: pinned by
      // `__tests__/WidgetConfigPanel.retiredActionKeys.test.tsx`.

      // ----- Appearance (always visible, collapsed by default) ------------
      {
        key: 'appearance',
        title: t('dashboard.config.section.appearance'),
        collapsible: true,
        defaultCollapsed: true,
        fields: [
          {
            key: 'colorVariant',
            label: t('dashboard.config.field.colorVariant'),
            type: 'select',
            options: colorVariantOptions(t),
            defaultValue: 'default',
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WidgetConfigPanelProps {
  /** Whether the panel is open */
  open: boolean;
  /** Close handler */
  onClose: () => void;
  /** Widget configuration (flattened: layout.w → layoutW, layout.h → layoutH) */
  config: Record<string, any>;
  /** Persist the updated widget config */
  onSave: (config: Record<string, any>) => void;
  /** Optional live-update callback */
  onFieldChange?: (field: string, value: any) => void;
  /** Extra content rendered in the header row (e.g. delete button) */
  headerExtra?: React.ReactNode;
  /**
   * Analytics dataset catalog (ADR-0021). When supplied, the dataset selector
   * and the dimensions/values pickers bind to the live schema instead of
   * free-text. Hosts resolve it (e.g. via the metadata client) and inject it;
   * absent → free-text authoring still works.
   */
  datasets?: WidgetDatasetCatalogEntry[];
  /** Whether the dataset catalog is still loading (reserved for future UX). */
  datasetsLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// `I18nLabel` display and write-back (objectui#5301)
//
// A private `resolveLabel(v)` used to sit here, documented as resolving an
// `I18nLabel` while reading `obj.defaultValue || obj.key` — the key-reference
// form `@objectstack/spec` RETIRED at 17.0.0-rc.6 (objectstack#5055). The
// inline per-locale map `I18nLabelSchema` actually admits has neither limb, so
// it resolved `{ en: 'Revenue', 'zh-CN': '收入' }` to `''`. That was not a
// display bug: the resolved value seeds the editable draft below, so a widget
// whose stored title is a map opened with an EMPTY Title field and the next
// save wrote `''` over the author's map. It was the fourth private copy of that
// resolver; objectui#4032 swept the other three out of `DashboardRenderer`,
// `MetricWidget` and `MetricCard`.
//
// Both halves now come from `@object-ui/i18n`, which is where the read rule and
// the write rule are stated once (they have to agree — see `setLocalized`):
//
//   READ  `pickLocalized(value, language)` — show the active locale, like every
//         sibling surface post-#4032.
//   WRITE `setLocalized(stored, language, edited)` — replace ONLY the active
//         locale's entry and carry every other locale across untouched.
//
// A full multi-locale editor — authoring every locale from this panel — is NOT
// what this panel offers; it edits the active locale only. That remains an OPEN
// product question and is deliberately not deferred to a tracker here: the
// deferral this replaced named objectui#4163, which closed as completed on
// 2026-08-15 with the question still unanswered.
// ---------------------------------------------------------------------------

/**
 * The config keys this panel edits as plain single-line text while the spec
 * types them `I18nLabel` — i.e. the keys whose stored value may be an inline
 * locale map that one `<input >` cannot represent.
 */
const I18N_LABEL_KEYS = ['title', 'description'] as const;

/** Is this stored value an inline locale map (rather than a plain string)? */
function isLocaleMap(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Put the `I18nLabel` keys of a draft back into the shape they were stored in.
 *
 * The draft carries ONE string per label key — the active locale's, which is
 * what the text input can hold. Persisting that string as the whole value is
 * the data loss this card is about, so before a save each label key is mapped
 * back against the value the panel was handed:
 *
 * - stored value is a plain string (or absent): nothing was ever collapsed, so
 *   the draft's string is already the correct whole value — passed through.
 * - stored value is a map and the draft's string still equals what the panel
 *   DISPLAYED: the author never touched this field, so the **original object is
 *   returned by reference**. An untouched title survives an unrelated config
 *   edit byte-identically — the round trip the ruling requires, and the reason
 *   this is an identity restore rather than a rebuild that would happen to
 *   produce an equal object (a rebuild would add an entry for the active locale
 *   to a map that never had one).
 * - stored value is a map and the string differs: the edit lands in the active
 *   locale's entry via `setLocalized`, every other locale preserved.
 *
 * Exported for direct unit testing — the panel path reaches it only through
 * `useConfigDraft`, so a component test alone would be asserting that hook's
 * behaviour as much as this rule.
 */
export function restoreI18nLabels(
  draft: Record<string, any>,
  source: Record<string, any>,
  language: string | undefined,
): Record<string, any> {
  let out = draft;
  for (const key of I18N_LABEL_KEYS) {
    const stored = source?.[key];
    if (!isLocaleMap(stored)) continue;
    const edited = draft[key];
    // Not a string ⇒ the draft still holds the stored value itself; there is
    // nothing to merge back and nothing to lose.
    if (typeof edited !== 'string') continue;
    if (out === draft) out = { ...draft };
    out[key] =
      edited === pickLocalized(stored, language)
        ? stored
        : setLocalized(stored, language, edited);
  }
  return out;
}

/**
 * Strip keys that are not relevant to the current widget type, and scrub the
 * removed pre-ADR-0021 inline analytics keys so switching type (or saving a
 * legacy widget) never re-emits the dead shape. Metric-like widgets show a
 * single value, so their `dimensions` are dropped.
 *
 * Also scrubs the three widget-level action keys retired in
 * @objectstack/spec 17.0.0-rc.3 (objectstack#5010, ADR-0049 D2). They are
 * `retiredKey` tombstones — `DashboardWidgetSchema` types them `never` and
 * refuses any value — so re-emitting one turns a stored dashboard into a parse
 * error. The authoring field that produced `actionUrl` is gone (see the
 * Behavior note in `buildWidgetSchema`); this is the second line of defence,
 * for a stored widget that already carries the keys or a host that hands the
 * panel a config containing them (objectstack#7129).
 */
const RETIRED_ACTION_KEYS = ['actionUrl', 'actionType', 'actionIcon'];

const LEGACY_ANALYTICS_KEYS = [
  'object', 'categoryField', 'categoryGranularity', 'valueField', 'aggregate',
  'aggregation', 'rowField', 'columnField', 'xAxisField', 'yAxisFields',
  'xAxisLabel', 'yAxisLabel', 'measures',
  'rowSortBy', 'rowSortOrder', 'columnSortBy', 'columnSortOrder',
  'showRowLabels', 'showRowTotals', 'showColumnLabels', 'showColumnTotals',
  'format', 'showLegend', 'searchable', 'pagination',
];

export function sanitizeDraftForType(draft: Record<string, any>): Record<string, any> {
  const t = draft.type as string | undefined;
  const out = { ...draft };
  for (const key of LEGACY_ANALYTICS_KEYS) delete out[key];
  for (const key of RETIRED_ACTION_KEYS) delete out[key];
  if (!usesDimensions(t)) delete out.dimensions;
  return out;
}

export function WidgetConfigPanel({
  open,
  onClose,
  config,
  onSave,
  onFieldChange,
  headerExtra,
  datasets,
  datasetsLoading: _datasetsLoading,
}: WidgetConfigPanelProps) {
  const { t, language } = useConfigPanelTranslation();

  // Pre-process config to resolve any I18nLabel values for title/description
  // down to the ONE string a single-line text input can hold. `language` is a
  // dependency and has to be: it is the locale the draft was seeded from, and
  // `restoreI18nLabels` compares the draft against `pickLocalized(stored,
  // language)` to tell "untouched" from "edited". Leaving it out would let a
  // language switch mid-session leave a draft seeded from the OLD locale being
  // compared against the NEW one — every untouched label would read as edited
  // and get merged into the wrong entry. Re-seeding costs an in-progress edit
  // on a language switch, which is the cheap half of that trade.
  const normalizedConfig: Record<string, any> = React.useMemo(() => ({
    ...config,
    title: typeof config.title === 'object' ? pickLocalized(config.title, language) : config.title,
    description:
      typeof config.description === 'object'
        ? pickLocalized(config.description, language)
        : config.description,
  }), [config, language]);

  // The live-update callback is the panel's OTHER way out, and it is a
  // data-loss path of its own: hosts feed it straight back into the widget they
  // re-open the panel from (`DashboardWithConfig` writes it into `liveSchema`,
  // which is exactly where the next `config` prop comes from), and some persist
  // it. Forwarding the bare editor string would put a plain string where the
  // map was — the map then gone before a save ever ran. Same rule as the save
  // path, applied per field.
  const handleFieldChange = React.useCallback(
    (field: string, value: any) => {
      if (!onFieldChange) return;
      const stored = config?.[field];
      const localized =
        (I18N_LABEL_KEYS as readonly string[]).includes(field) &&
        isLocaleMap(stored) &&
        typeof value === 'string';
      onFieldChange(field, localized ? setLocalized(stored, language, value) : value);
    },
    [onFieldChange, config, language],
  );

  const { draft, isDirty, updateField, discard } = useConfigDraft(normalizedConfig, {
    onUpdate: handleFieldChange,
  });

  const schema = React.useMemo(
    () => buildWidgetSchema(t, datasets, draft.type),
    [t, datasets, draft.type],
  );

  return (
    <ConfigPanelRenderer
      open={open}
      onClose={onClose}
      schema={schema}
      draft={draft}
      isDirty={isDirty}
      onFieldChange={updateField}
      onSave={() =>
        onSave(sanitizeDraftForType(restoreI18nLabels(draft, config, language)))
      }
      onDiscard={discard}
      headerExtra={headerExtra}
    />
  );
}
