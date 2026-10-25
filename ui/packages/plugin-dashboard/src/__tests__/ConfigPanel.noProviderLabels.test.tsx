/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The dashboard config sidebar still renders the SAME English bytes when no
 * `I18nProvider` is mounted — objectui#4748.
 *
 * Routing a literal through `t()` without a working default is exactly how a
 * provider-less consumer breaks, and it breaks somewhere other than the console:
 * both panels are exported from the package barrel and mounted by
 * `DashboardWithConfig`, so any host that renders them without a provider (this
 * package's own tests, the preview gallery, an embedding app) reads whatever
 * `CONFIG_PANEL_DEFAULT_TRANSLATIONS` says. A missing map row would surface
 * here as a raw `dashboard.config.…` key in the DOM.
 *
 * Direction, predicted before running: GREEN before the change and GREEN after.
 * It pins the FALLBACK, not the fix — the fix is asserted in
 * `ConfigPanel.localeLabels.test.tsx`, and the key-level wiring in
 * `ConfigPanel.i18nWiring.test.tsx`.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` calls `instance.use(initReactI18next)`, which registers that
 * instance as react-i18next's module-global default, and the registration
 * survives unmount and `cleanup()`. The moment any test in a file mounts an
 * `I18nProvider`, every later "no provider" render in that same file silently
 * resolves against that instance — a green-looking file asserting nothing about
 * the fallback. The `dom` project runs with `isolate: true`, so a file that
 * never mounts a provider gets a genuinely clean global. Keep it that way:
 * **do not import or mount `I18nProvider` here.**
 *
 * This file covers what the schema walk in `ConfigPanel.i18nWiring.test.tsx`
 * structurally cannot: the strings produced inside the `custom` fields'
 * `render()` callbacks (dataset combobox, member chips, add control, empty
 * states), which are not properties of the schema object.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WidgetConfigPanel } from '../WidgetConfigPanel';
import { DashboardConfigPanel } from '../DashboardConfigPanel';
import type { WidgetDatasetCatalogEntry } from '../dataset-catalog';

afterEach(cleanup);

const catalog: WidgetDatasetCatalogEntry[] = [
  {
    name: 'sales_pipeline',
    label: 'Sales Pipeline',
    dimensions: [{ name: 'stage' }, { name: 'owner' }],
    measures: [{ name: 'revenue', aggregate: 'sum' }],
  },
];

/** Always with the catalog. The no-catalog shape omits the prop entirely — a
 * default parameter here would swallow an explicit `undefined` and silently
 * test the catalog path twice. */
function renderWidget(config: Record<string, any>) {
  return render(
    <WidgetConfigPanel
      open
      onClose={vi.fn()}
      config={config}
      onSave={vi.fn()}
      datasets={catalog}
    />,
  );
}

/** No raw key ever reaches the DOM on the provider-less path. */
function expectNoRawKeys() {
  expect(screen.getByTestId('config-panel').textContent ?? '').not.toMatch(/dashboard\.config\./);
}

describe('WidgetConfigPanel — provider-less English', () => {
  it('renders the breadcrumb, section titles and field labels unchanged', () => {
    renderWidget({ id: 'w1', type: 'bar', dataset: 'sales_pipeline', dimensions: ['stage'], values: ['revenue'] });

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Chart')).toBeInTheDocument();

    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Data Binding')).toBeInTheDocument();
    expect(screen.getByText('Layout')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();

    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Widget type')).toBeInTheDocument();
    expect(screen.getByText('Dataset')).toBeInTheDocument();
    expect(screen.getByText('Dimensions')).toBeInTheDocument();
    expect(screen.getByText('Values')).toBeInTheDocument();
    expect(screen.getByText('Width (columns)')).toBeInTheDocument();
    expect(screen.getByText('Height (rows)')).toBeInTheDocument();

    expect(screen.getByPlaceholderText('Widget title')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Widget description')).toBeInTheDocument();

    expectNoRawKeys();
  });

  it('names the chip remove control with the member name spliced in', () => {
    renderWidget({ id: 'w1', type: 'bar', dataset: 'sales_pipeline', dimensions: ['stage'], values: ['revenue'] });
    // The interpolation is the only hole in the whole namespace; `Remove stage`
    // is byte-for-byte what the template literal produced before #4748.
    expect(screen.getByLabelText('Remove stage')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove revenue')).toBeInTheDocument();
  });

  it('renders the empty states and the dataset placeholder', () => {
    renderWidget({ id: 'w1', type: 'bar' });
    expect(screen.getByText('No dimensions selected.')).toBeInTheDocument();
    expect(screen.getByText('No measures selected.')).toBeInTheDocument();
    expect(screen.getByText('Select dataset…')).toBeInTheDocument();
    expectNoRawKeys();
  });

  it('falls back to the free-text dataset input when no catalog is supplied', () => {
    render(
      <WidgetConfigPanel
        open
        onClose={vi.fn()}
        config={{ id: 'w1', type: 'bar' }}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText('Dataset name')).toBeInTheDocument();
    expect(screen.queryByText('Select dataset…')).not.toBeInTheDocument();
  });

  it('offers the free-text add control once every catalog member is used', () => {
    // `stage` and `owner` are the whole dimension catalog, so the combobox has
    // nothing left to offer and the Input + Add button take over.
    renderWidget({
      id: 'w1', type: 'bar', dataset: 'sales_pipeline',
      dimensions: ['stage', 'owner'], values: ['revenue'],
    });
    expect(screen.getAllByRole('button', { name: 'Add' }).length).toBeGreaterThan(0);
  });

  it('renders the three help sentences under their controls', () => {
    // `ConfigFieldRenderer` shows `field.helpText` for every control type,
    // custom ones included — these are the longest strings the panel serves.
    renderWidget({ id: 'w1', type: 'bar', dataset: 'sales_pipeline', values: ['revenue'] });
    expect(
      screen.getByText('The semantic-layer dataset this widget binds to (ADR-0021).'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Group/split the values by these dataset dimensions.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Measure(s) from the dataset to display (at least one).'),
    ).toBeInTheDocument();
  });

  it('swaps the dimensions help sentence on a pivot', () => {
    renderWidget({ id: 'w1', type: 'pivot', dataset: 'sales_pipeline', values: ['revenue'] });
    expect(
      screen.getByText('Group/split fields. The last dimension spreads across as columns.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Group/split the values by these dataset dimensions.'),
    ).not.toBeInTheDocument();
  });

  it('shows the appearance controls once the section is expanded', () => {
    renderWidget({ id: 'w1', type: 'bar', dataset: 'sales_pipeline', values: ['revenue'] });
    fireEvent.click(screen.getByTestId('section-header-appearance'));
    expect(screen.getByText('Color variant')).toBeInTheDocument();
    expectNoRawKeys();
  });

  it('varies only the breadcrumb tail with the widget type', () => {
    const tail = (type: string) => {
      cleanup();
      renderWidget({ id: 'w1', type, dataset: 'sales_pipeline', values: ['revenue'] });
      const items = screen.getByLabelText('breadcrumb').querySelectorAll('li');
      return Array.from(items).map((li) => li.textContent);
    };
    expect(tail('pivot')).toEqual(['Dashboard', 'Pivot table']);
    expect(tail('table')).toEqual(['Dashboard', 'Table']);
    expect(tail('line')).toEqual(['Dashboard', 'Chart']);
    expect(tail('metric')).toEqual(['Dashboard', 'Widget']);
  });
});

describe('DashboardConfigPanel — provider-less English', () => {
  function renderDashboard() {
    return render(
      <DashboardConfigPanel
        open
        onClose={vi.fn()}
        config={{ columns: 3, gap: 4, rowHeight: 120 }}
        onSave={vi.fn()}
      />,
    );
  }

  it('renders the breadcrumb, section titles and layout labels unchanged', () => {
    renderDashboard();
    const items = screen.getByLabelText('breadcrumb').querySelectorAll('li');
    expect(Array.from(items).map((li) => li.textContent)).toEqual(['Dashboard', 'Configuration']);

    expect(screen.getByText('Layout')).toBeInTheDocument();
    expect(screen.getByText('Data')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();

    expect(screen.getByText('Columns')).toBeInTheDocument();
    expect(screen.getByText('Gap')).toBeInTheDocument();
    expect(screen.getByText('Row height (px)')).toBeInTheDocument();
    expect(screen.getByText('Auto refresh')).toBeInTheDocument();

    expectNoRawKeys();
  });

  it('renders the appearance controls and their placeholders once expanded', () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId('section-header-appearance'));

    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Show description')).toBeInTheDocument();
    expect(screen.getByText('Theme')).toBeInTheDocument();

    expect(screen.getByPlaceholderText('Dashboard title')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Short summary shown under the title'),
    ).toBeInTheDocument();

    expectNoRawKeys();
  });
});
