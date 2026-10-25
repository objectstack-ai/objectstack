/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The dashboard config panels are wired through `t()`, and every English string
 * they used to hardcode still renders byte for byte — objectui#4748.
 *
 * Three legs, each answering a question the others cannot:
 *
 *  1. **No literal survives.** Both schema builders are pure functions of a
 *     `t`, so calling them with the identity translator `(key) => key` makes
 *     every translated string in the result equal to its own key. Every
 *     user-visible string in the built schema is then asserted to BE a key of
 *     `CONFIG_PANEL_DEFAULT_TRANSLATIONS` — a surviving English literal is not
 *     a key and fails by naming itself. This is the card's grep as an
 *     assertion, and it is stronger: the grep only reads `label:`-shaped lines,
 *     this walks the actual schema.
 *  2. **The right key in the right place.** The same identity render is
 *     compared against the full expected layout, so a wiring that swaps two
 *     keys (a placeholder key used as a section title) fails even though both
 *     are keys.
 *  3. **The bytes did not move.** `ORIGINAL_LITERALS` is the pre-#4748 English,
 *     transcribed from `origin/main`, and every row is compared against BOTH
 *     the defaults map (what a provider-less host renders) and the `en` pack
 *     (what the console renders). Both directions, because
 *     `createSafeTranslation` serves one of the two depending on the host and a
 *     row that drifts renders two labels for one control (the objectui#4401
 *     class).
 *
 * ## What this file does NOT cover, and where that lives instead
 *
 * The strings produced INSIDE a `custom` field's `render()` — the dataset
 * combobox's placeholder/search/empty text, the member picker's chips, add
 * control and empty states — are not properties of the schema object, so the
 * walk cannot see them. They are asserted in the DOM by
 * `ConfigPanel.noProviderLabels.test.tsx` (English, no provider) and
 * `ConfigPanel.localeLabels.test.tsx` (zh + de, with one).
 *
 * This file mounts nothing and imports no provider. It is a `.tsx` despite
 * carrying no JSX so that it lands in the `dom` vitest project: the modules
 * under test pull in `@object-ui/components`, which is not import-safe under
 * the `unit` project's node environment.
 */

import { describe, it, expect } from 'vitest';
import { en } from '@object-ui/i18n';
import { buildWidgetSchema } from '../WidgetConfigPanel';
import { buildDashboardSchema } from '../DashboardConfigPanel';
import { CONFIG_PANEL_DEFAULT_TRANSLATIONS } from '../useConfigPanelTranslation';
import type { ConfigPanelSchema } from '@object-ui/components';
import type { WidgetDatasetCatalogEntry } from '../dataset-catalog';

/** Renders every translated string as its own key. */
const identityT = (key: string) => key;

/** Resolve a dotted key against a pack; `undefined` at any miss. */
const packValueAt = (key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);

/** Codepoints, so a failure distinguishes `…` from `...` and NBSP from a space. */
const codepoints = (s: string) => [...s].map((c) => c.codePointAt(0)).join(',');

/**
 * Every user-visible string the schema object itself carries, in render order.
 * `helpText` counts: `ConfigFieldRenderer` wraps every control in a `<p>` that
 * shows it, so those four sentences are on screen like the labels are.
 */
function visibleStrings(schema: ConfigPanelSchema): string[] {
  const out: string[] = [...schema.breadcrumb];
  for (const section of schema.sections) {
    out.push(section.title);
    for (const field of section.fields) {
      out.push(field.label);
      if (field.placeholder !== undefined) out.push(field.placeholder);
      if (field.helpText !== undefined) out.push(field.helpText);
      for (const opt of field.options ?? []) out.push(opt.label);
    }
  }
  return out;
}

const catalog: WidgetDatasetCatalogEntry[] = [
  {
    name: 'sales_pipeline',
    label: 'Sales Pipeline',
    dimensions: [{ name: 'stage' }],
    measures: [{ name: 'revenue', aggregate: 'sum' }],
  },
];

/**
 * The English these keys replaced, transcribed from the two panels at
 * `origin/main` (616a2a547). Hand-written rather than derived from the map —
 * derived, leg 3 would be a tautology.
 */
const ORIGINAL_LITERALS: Record<string, string> = {
  'dashboard.config.breadcrumb.dashboard': 'Dashboard',
  'dashboard.config.breadcrumb.configuration': 'Configuration',
  'dashboard.config.breadcrumb.widget': 'Widget',
  'dashboard.config.breadcrumb.chart': 'Chart',
  'dashboard.config.breadcrumb.table': 'Table',
  'dashboard.config.breadcrumb.pivotTable': 'Pivot table',

  'dashboard.config.section.general': 'General',
  'dashboard.config.section.layout': 'Layout',
  'dashboard.config.section.data': 'Data',
  'dashboard.config.section.dataBinding': 'Data Binding',
  'dashboard.config.section.appearance': 'Appearance',

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

  'dashboard.config.empty.datasets': 'No datasets found.',
  'dashboard.config.empty.dimensions': 'No dimensions selected.',
  'dashboard.config.empty.measures': 'No measures selected.',
  'dashboard.config.empty.nothingToAdd': 'Nothing left to add.',

  'dashboard.config.help.dataset':
    'The semantic-layer dataset this widget binds to (ADR-0021).',
  'dashboard.config.help.dimensions':
    'Group/split the values by these dataset dimensions.',
  'dashboard.config.help.dimensionsPivot':
    'Group/split fields. The last dimension spreads across as columns.',
  'dashboard.config.help.values': 'Measure(s) from the dataset to display (at least one).',

  'dashboard.config.action.add': 'Add',
  // `aria-label={`Remove ${name}`}` became an i18next hole. The rendered bytes
  // are unchanged; the interpolation is what makes it translatable.
  'dashboard.config.action.remove': 'Remove {{name}}',

  'dashboard.config.refresh.off': 'Off',
  'dashboard.config.refresh.every30s': 'Every 30s',
  'dashboard.config.refresh.every1m': 'Every 1 min',
  'dashboard.config.refresh.every5m': 'Every 5 min',
  'dashboard.config.refresh.every15m': 'Every 15 min',
  'dashboard.config.refresh.every30m': 'Every 30 min',
  'dashboard.config.refresh.every1h': 'Every 1 hour',

  'dashboard.config.themeOption.light': 'Light',
  'dashboard.config.themeOption.dark': 'Dark',
  'dashboard.config.themeOption.auto': 'Auto',

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

  'dashboard.config.color.default': 'Default',
  'dashboard.config.color.blue': 'Blue',
  'dashboard.config.color.teal': 'Teal',
  'dashboard.config.color.orange': 'Orange',
  'dashboard.config.color.purple': 'Purple',
  'dashboard.config.color.success': 'Success',
  'dashboard.config.color.warning': 'Warning',
  'dashboard.config.color.danger': 'Danger',
};

describe('leg 1 — no English literal survives in either schema', () => {
  const cases: Array<[string, ConfigPanelSchema]> = [
    ['DashboardConfigPanel', buildDashboardSchema(identityT)],
    ['WidgetConfigPanel (chart, catalog)', buildWidgetSchema(identityT, catalog, 'bar')],
    ['WidgetConfigPanel (pivot, catalog)', buildWidgetSchema(identityT, catalog, 'pivot')],
    ['WidgetConfigPanel (metric, no catalog)', buildWidgetSchema(identityT, undefined, 'metric')],
    ['WidgetConfigPanel (table, no catalog)', buildWidgetSchema(identityT, undefined, 'table')],
    ['WidgetConfigPanel (no type at all)', buildWidgetSchema(identityT, catalog, undefined)],
  ];

  for (const [name, schema] of cases) {
    it(`${name}: every user-visible string is a translation key`, () => {
      const strings = visibleStrings(schema);
      // Non-vacuity: a builder that returned an empty schema would satisfy
      // "every string is a key" trivially.
      expect(strings.length).toBeGreaterThan(10);
      const notKeys = strings.filter((s) => !(s in CONFIG_PANEL_DEFAULT_TRANSLATIONS));
      expect(notKeys).toEqual([]);
    });
  }
});

describe('leg 2 — each key sits where it belongs', () => {
  it('DashboardConfigPanel builds the expected key layout', () => {
    expect(buildDashboardSchema(identityT)).toEqual({
      breadcrumb: [
        'dashboard.config.breadcrumb.dashboard',
        'dashboard.config.breadcrumb.configuration',
      ],
      sections: [
        {
          key: 'layout',
          title: 'dashboard.config.section.layout',
          collapsible: true,
          fields: [
            expect.objectContaining({ key: 'columns', label: 'dashboard.config.field.columns' }),
            expect.objectContaining({ key: 'gap', label: 'dashboard.config.field.gap' }),
            expect.objectContaining({ key: 'rowHeight', label: 'dashboard.config.field.rowHeight' }),
          ],
        },
        {
          key: 'data',
          title: 'dashboard.config.section.data',
          collapsible: true,
          fields: [
            expect.objectContaining({
              key: 'refreshIntervalSeconds',
              label: 'dashboard.config.field.autoRefresh',
              options: [
                { value: '0', label: 'dashboard.config.refresh.off' },
                { value: '30', label: 'dashboard.config.refresh.every30s' },
                { value: '60', label: 'dashboard.config.refresh.every1m' },
                { value: '300', label: 'dashboard.config.refresh.every5m' },
                { value: '900', label: 'dashboard.config.refresh.every15m' },
                { value: '1800', label: 'dashboard.config.refresh.every30m' },
                { value: '3600', label: 'dashboard.config.refresh.every1h' },
              ],
            }),
          ],
        },
        {
          key: 'appearance',
          title: 'dashboard.config.section.appearance',
          collapsible: true,
          defaultCollapsed: true,
          fields: [
            expect.objectContaining({
              key: 'title',
              label: 'dashboard.config.field.title',
              placeholder: 'dashboard.config.placeholder.dashboardTitle',
            }),
            expect.objectContaining({
              key: 'description',
              label: 'dashboard.config.field.description',
              placeholder: 'dashboard.config.placeholder.dashboardDescription',
            }),
            expect.objectContaining({
              key: 'showDescription',
              label: 'dashboard.config.field.showDescription',
            }),
            expect.objectContaining({
              key: 'theme',
              label: 'dashboard.config.field.theme',
              options: [
                { value: 'light', label: 'dashboard.config.themeOption.light' },
                { value: 'dark', label: 'dashboard.config.themeOption.dark' },
                { value: 'auto', label: 'dashboard.config.themeOption.auto' },
              ],
            }),
          ],
        },
      ],
    });
  });

  it('WidgetConfigPanel names its sections, fields and widget-type options', () => {
    const schema = buildWidgetSchema(identityT, catalog, 'bar');
    expect(schema.sections.map((s) => [s.key, s.title])).toEqual([
      ['general', 'dashboard.config.section.general'],
      ['data', 'dashboard.config.section.dataBinding'],
      ['layout', 'dashboard.config.section.layout'],
      ['appearance', 'dashboard.config.section.appearance'],
    ]);

    const general = schema.sections[0].fields;
    expect(general.map((f) => [f.key, f.label, f.placeholder])).toEqual([
      ['title', 'dashboard.config.field.title', 'dashboard.config.placeholder.widgetTitle'],
      [
        'description',
        'dashboard.config.field.description',
        'dashboard.config.placeholder.widgetDescription',
      ],
      ['type', 'dashboard.config.field.widgetType', undefined],
    ]);
    expect(general[2].options).toEqual([
      { value: 'metric', label: 'dashboard.config.widgetType.metric' },
      { value: 'bar', label: 'dashboard.config.widgetType.bar' },
      { value: 'horizontal-bar', label: 'dashboard.config.widgetType.horizontalBar' },
      { value: 'line', label: 'dashboard.config.widgetType.line' },
      { value: 'pie', label: 'dashboard.config.widgetType.pie' },
      { value: 'donut', label: 'dashboard.config.widgetType.donut' },
      { value: 'area', label: 'dashboard.config.widgetType.area' },
      { value: 'scatter', label: 'dashboard.config.widgetType.scatter' },
      { value: 'funnel', label: 'dashboard.config.widgetType.funnel' },
      { value: 'table', label: 'dashboard.config.widgetType.table' },
      { value: 'pivot', label: 'dashboard.config.widgetType.pivot' },
    ]);

    expect(schema.sections[2].fields.map((f) => [f.key, f.label])).toEqual([
      ['layoutW', 'dashboard.config.field.width'],
      ['layoutH', 'dashboard.config.field.height'],
    ]);
    expect(schema.sections[3].fields[0].options).toEqual([
      { value: 'default', label: 'dashboard.config.color.default' },
      { value: 'blue', label: 'dashboard.config.color.blue' },
      { value: 'teal', label: 'dashboard.config.color.teal' },
      { value: 'orange', label: 'dashboard.config.color.orange' },
      { value: 'purple', label: 'dashboard.config.color.purple' },
      { value: 'success', label: 'dashboard.config.color.success' },
      { value: 'warning', label: 'dashboard.config.color.warning' },
      { value: 'danger', label: 'dashboard.config.color.danger' },
    ]);
  });

  it('the breadcrumb tail follows the widget type', () => {
    const tail = (type?: string) => buildWidgetSchema(identityT, catalog, type).breadcrumb[1];
    expect(tail('pivot')).toBe('dashboard.config.breadcrumb.pivotTable');
    expect(tail('table')).toBe('dashboard.config.breadcrumb.table');
    expect(tail('bar')).toBe('dashboard.config.breadcrumb.chart');
    expect(tail('donut')).toBe('dashboard.config.breadcrumb.chart');
    expect(tail('metric')).toBe('dashboard.config.breadcrumb.widget');
    expect(tail(undefined)).toBe('dashboard.config.breadcrumb.widget');
    // The head is the same segment on both panels.
    expect(buildWidgetSchema(identityT, catalog, 'bar').breadcrumb[0]).toBe(
      'dashboard.config.breadcrumb.dashboard',
    );
  });

  it('the dataset field keys its help text and its two authoring shapes', () => {
    const withCatalog = buildWidgetSchema(identityT, catalog, 'bar').sections[1].fields;
    expect(withCatalog.map((f) => [f.key, f.label, f.helpText])).toEqual([
      ['dataset', 'dashboard.config.field.dataset', 'dashboard.config.help.dataset'],
      ['dimensions', 'dashboard.config.field.dimensions', 'dashboard.config.help.dimensions'],
      ['values', 'dashboard.config.field.values', 'dashboard.config.help.values'],
    ]);
    // No catalog: the dataset field falls back to a free-text input, which is
    // the only shape carrying a placeholder.
    const noCatalog = buildWidgetSchema(identityT, undefined, 'bar').sections[1].fields[0];
    expect(noCatalog.type).toBe('input');
    expect(noCatalog.placeholder).toBe('dashboard.config.placeholder.datasetName');
    // Pivot swaps the dimensions hint for the columns-spread wording.
    expect(buildWidgetSchema(identityT, catalog, 'pivot').sections[1].fields[1].helpText).toBe(
      'dashboard.config.help.dimensionsPivot',
    );
  });
});

describe('leg 3 — the English bytes did not move', () => {
  it('the frozen table covers the whole map, and nothing else', () => {
    expect(Object.keys(ORIGINAL_LITERALS).sort()).toEqual(
      Object.keys(CONFIG_PANEL_DEFAULT_TRANSLATIONS).sort(),
    );
    // Non-vacuity: the surface the card measured is 61 literals over 75 keys
    // (shared labels collapse, option groups expand).
    expect(Object.keys(ORIGINAL_LITERALS)).toHaveLength(75);
  });

  for (const [key, original] of Object.entries(ORIGINAL_LITERALS)) {
    it(`${key}: defaults map and en pack both still say the original English`, () => {
      const fromMap = CONFIG_PANEL_DEFAULT_TRANSLATIONS[key];
      const fromPack = packValueAt(key);
      expect(
        `${key} (map) ${codepoints(fromMap ?? '')}`,
      ).toBe(`${key} (map) ${codepoints(original)}`);
      expect(typeof fromPack).toBe('string');
      expect(
        `${key} (en pack) ${codepoints(fromPack as string)}`,
      ).toBe(`${key} (en pack) ${codepoints(original)}`);
    });
  }
});
