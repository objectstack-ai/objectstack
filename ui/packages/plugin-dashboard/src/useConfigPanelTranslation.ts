/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The dashboard config sidebar's vocabulary — objectui#4748.
 *
 * `WidgetConfigPanel` and `DashboardConfigPanel` build a `ConfigPanelSchema`
 * (breadcrumb, section titles, field labels, placeholders, option labels) and
 * hand it to `ConfigPanelRenderer`. Until this map existed, every one of those
 * strings was an English literal in the schema builder and neither file
 * imported a translation hook at all, so the sidebar a user opens to configure
 * a dashboard or a widget stayed English inside an otherwise translated
 * console.
 *
 * ## Fresh keys, not the retired `configPanel.*` block
 *
 * The packs used to carry a top-level `configPanel.*` namespace of 16 keys
 * whose vocabulary reads like this panel's (`layout`, `columns`, `gap`,
 * `rowHeight`, `appearance`, `theme`, `showDescription`, `general`, …). It had
 * ZERO readers — no `t()` call site, no textual footprint — and is being
 * deleted as dead. These keys are authored fresh against the wording the panels
 * actually ship today rather than restored from that block, for two measured
 * reasons: the old vocabulary was never validated against a shipped label (it
 * is the vocabulary someone expected the panel to use), and the surface is 61
 * literal labels against 16 keys, so most of the panel had no candidate key at
 * all. Where the two happen to name the same word the TRANSLATIONS are reused —
 * consistency of wording is the part of that block that was worth keeping.
 *
 * ## Namespace: `dashboard.config.*`
 *
 * Measured against the pack structure this package already reads rather than
 * chosen: `MetricWidget` reads `dashboard.trend.*` and `DashboardFilterBar`
 * reads `dashboard.filters.*`, both through `createSafeTranslation`. A third
 * area of the same `dashboard` namespace is the shape those two establish.
 *
 * ## Every value here is byte-identical to the literal it replaced
 *
 * `createSafeTranslation` serves this map when no `I18nProvider` is mounted and
 * the `en` pack when one is, so a row that drifts from either renders two
 * different labels for one control. Both directions are pinned:
 * `__tests__/ConfigPanel.i18nWiring.test.tsx` compares this map against a frozen
 * table of the pre-#4748 literals AND against the `en` pack, row by row, and
 * `__tests__/ConfigPanel.noProviderLabels.test.tsx` renders both panels with no
 * provider mounted to prove those bytes reach the DOM.
 */

import { createSafeTranslation } from '@object-ui/i18n';

/**
 * Default English translations for the dashboard config panels.
 *
 * Used as the fallback when no `I18nProvider` is available (standalone embeds,
 * the preview gallery, this package's own unit tests). Every row's key exists
 * in all ten packs and every row's value equals the `en` pack's.
 */
export const CONFIG_PANEL_DEFAULT_TRANSLATIONS: Record<string, string> = {
  // ---- Breadcrumb ---------------------------------------------------------
  // `WidgetConfigPanel`'s second segment varies by widget type and is NOT the
  // same string as the widget-type option of the same name: the option reads
  // `Pivot Table` (a name in a picker) and the breadcrumb `Pivot table` (a
  // location in a sentence). Two keys, because collapsing them would silently
  // change one of the two English strings.
  'dashboard.config.breadcrumb.dashboard': 'Dashboard',
  'dashboard.config.breadcrumb.configuration': 'Configuration',
  'dashboard.config.breadcrumb.widget': 'Widget',
  'dashboard.config.breadcrumb.chart': 'Chart',
  'dashboard.config.breadcrumb.table': 'Table',
  'dashboard.config.breadcrumb.pivotTable': 'Pivot table',

  // ---- Section titles -----------------------------------------------------
  'dashboard.config.section.general': 'General',
  'dashboard.config.section.layout': 'Layout',
  'dashboard.config.section.data': 'Data',
  'dashboard.config.section.dataBinding': 'Data Binding',
  'dashboard.config.section.appearance': 'Appearance',

  // ---- Field labels -------------------------------------------------------
  // `title` / `description` are shared by both panels deliberately: the label
  // above the control is the same word in both, and one key keeps a locale from
  // spelling it two ways on two screens of the same editor.
  'dashboard.config.field.title': 'Title',
  'dashboard.config.field.description': 'Description',
  'dashboard.config.field.columns': 'Columns',
  'dashboard.config.field.gap': 'Gap',
  'dashboard.config.field.rowHeight': 'Row height (px)',
  'dashboard.config.field.autoRefresh': 'Auto refresh',
  'dashboard.config.field.showDescription': 'Show description',
  'dashboard.config.field.theme': 'Theme',
  'dashboard.config.field.widgetType': 'Widget type',
  'dashboard.config.field.colorVariant': 'Color variant',
  'dashboard.config.field.dataset': 'Dataset',
  'dashboard.config.field.dimensions': 'Dimensions',
  'dashboard.config.field.values': 'Values',
  'dashboard.config.field.width': 'Width (columns)',
  'dashboard.config.field.height': 'Height (rows)',

  // ---- Placeholders -------------------------------------------------------
  'dashboard.config.placeholder.dashboardTitle': 'Dashboard title',
  'dashboard.config.placeholder.dashboardDescription': 'Short summary shown under the title',
  'dashboard.config.placeholder.widgetTitle': 'Widget title',
  'dashboard.config.placeholder.widgetDescription': 'Widget description',
  'dashboard.config.placeholder.datasetName': 'Dataset name',
  'dashboard.config.placeholder.selectDataset': 'Select dataset…',
  'dashboard.config.placeholder.searchDatasets': 'Search datasets…',
  'dashboard.config.placeholder.addDimension': 'Add dimension…',
  'dashboard.config.placeholder.addMeasure': 'Add measure…',
  'dashboard.config.placeholder.searchMembers': 'Search…',

  // ---- Empty states -------------------------------------------------------
  'dashboard.config.empty.datasets': 'No datasets found.',
  'dashboard.config.empty.dimensions': 'No dimensions selected.',
  'dashboard.config.empty.measures': 'No measures selected.',
  'dashboard.config.empty.nothingToAdd': 'Nothing left to add.',

  // ---- Help text ----------------------------------------------------------
  // Rendered by `ConfigFieldRenderer`, which wraps every control type — custom
  // ones included — in a `<p>` carrying `field.helpText`. These are full
  // sentences rather than labels, so they are the longest untranslated strings
  // the panel used to show.
  'dashboard.config.help.dataset': 'The semantic-layer dataset this widget binds to (ADR-0021).',
  'dashboard.config.help.dimensions': 'Group/split the values by these dataset dimensions.',
  'dashboard.config.help.dimensionsPivot':
    'Group/split fields. The last dimension spreads across as columns.',
  'dashboard.config.help.values': 'Measure(s) from the dataset to display (at least one).',

  // ---- Member-picker chrome ----------------------------------------------
  // `remove` is the chip's accessible name and the ONLY value in this map with
  // an interpolation hole. Double braces because i18next fills it from an
  // argument (`t(key, { name })`); the member name is runtime data, so the
  // hole must survive translation in all ten packs.
  'dashboard.config.action.add': 'Add',
  'dashboard.config.action.remove': 'Remove {{name}}',

  // ---- Auto-refresh options ----------------------------------------------
  // Keyed per interval rather than interpolating a number into an English
  // sentence: `Every 30s` and `Every 1 hour` are not one sentence with a hole,
  // and the abbreviation habits differ per locale.
  'dashboard.config.refresh.off': 'Off',
  'dashboard.config.refresh.every30s': 'Every 30s',
  'dashboard.config.refresh.every1m': 'Every 1 min',
  'dashboard.config.refresh.every5m': 'Every 5 min',
  'dashboard.config.refresh.every15m': 'Every 15 min',
  'dashboard.config.refresh.every30m': 'Every 30 min',
  'dashboard.config.refresh.every1h': 'Every 1 hour',

  // ---- Theme options ------------------------------------------------------
  'dashboard.config.themeOption.light': 'Light',
  'dashboard.config.themeOption.dark': 'Dark',
  'dashboard.config.themeOption.auto': 'Auto',

  // ---- Widget-type options ------------------------------------------------
  'dashboard.config.widgetType.metric': 'Metric',
  'dashboard.config.widgetType.bar': 'Bar Chart',
  'dashboard.config.widgetType.horizontalBar': 'Horizontal Bar',
  'dashboard.config.widgetType.line': 'Line Chart',
  'dashboard.config.widgetType.pie': 'Pie Chart',
  'dashboard.config.widgetType.donut': 'Donut Chart',
  'dashboard.config.widgetType.area': 'Area Chart',
  'dashboard.config.widgetType.scatter': 'Scatter Plot',
  'dashboard.config.widgetType.funnel': 'Funnel',
  'dashboard.config.widgetType.table': 'Table',
  'dashboard.config.widgetType.pivot': 'Pivot Table',

  // ---- Colour-variant options --------------------------------------------
  // `default` is the variant's own name in `colorVariants.ts`, not the word
  // "default" used as a fallback marker, so it is a label like the others.
  'dashboard.config.color.default': 'Default',
  'dashboard.config.color.blue': 'Blue',
  'dashboard.config.color.teal': 'Teal',
  'dashboard.config.color.orange': 'Orange',
  'dashboard.config.color.purple': 'Purple',
  'dashboard.config.color.success': 'Success',
  'dashboard.config.color.warning': 'Warning',
  'dashboard.config.color.danger': 'Danger',
};

/**
 * Safe translation hook for the dashboard config panels.
 *
 * Falls back to {@link CONFIG_PANEL_DEFAULT_TRANSLATIONS} when no
 * `I18nProvider` is mounted. The name matches the repo's `use*Translation`
 * convention, which is what `scripts/check-i18n-call-site-keys.mjs` classifies
 * as a pack-backed translator — so every key the panels ask for is checked
 * against the `en` pack, and `scripts/check-i18n-dead-keys.mjs` sees the
 * namespace as read.
 */
export const useConfigPanelTranslation = createSafeTranslation(
  CONFIG_PANEL_DEFAULT_TRANSLATIONS,
  'dashboard.config.section.general',
);

/** The translate function the schema builders receive. */
export type ConfigPanelTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;
