/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The dashboard config sidebar TRANSLATES — objectui#4748.
 *
 * This is the fix's own pin. Before the change both panels hardcoded ~61
 * English labels and imported no translation hook at all, so every case below
 * was RED: the sidebar rendered `Layout` / `Columns` / `Widget type` inside a
 * `zh-CN` or `de-DE` console whose surrounding chrome was fully translated.
 *
 * Two locales, chosen to cover both halves of the pack set:
 *
 *  - **zh** — a non-Latin pack, where a value byte-identical to `en` is
 *    decidable evidence of an untranslated row (the `untranslated-identity-4376`
 *    probe scans exactly these five packs);
 *  - **de** — a Latin pack, where identity CAN be genuine (`Layout`, `Dashboard`
 *    and `Widget` really are the German words). Asserting a Latin pack matters
 *    for a different reason: it is where a mis-keyed lookup still looks
 *    plausible to an English reader, so the assertions below name the German
 *    strings explicitly rather than merely checking "not English".
 *
 * Values are asserted as literals rather than read back out of the pack: a test
 * that resolves its expectation through the same table it is testing passes on
 * any pack, including an empty one. The byte-identity of the `en` side against
 * the map is a different question and lives in `ConfigPanel.i18nWiring.test.tsx`.
 *
 * ── Provider-less rendering is asserted in a DIFFERENT FILE ────────────────
 * `createI18n` registers its instance as react-i18next's module-global default
 * and the registration survives unmount and `cleanup()`, so any "no provider"
 * assertion in THIS file would silently resolve against whichever language ran
 * last. That leg lives in `ConfigPanel.noProviderLabels.test.tsx`, which mounts
 * no provider at all.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { WidgetConfigPanel } from '../WidgetConfigPanel';
import { DashboardConfigPanel } from '../DashboardConfigPanel';
import type { WidgetDatasetCatalogEntry } from '../dataset-catalog';

afterEach(cleanup);

const catalog: WidgetDatasetCatalogEntry[] = [
  {
    name: 'sales_pipeline',
    label: 'Sales Pipeline',
    dimensions: [{ name: 'stage' }],
    measures: [{ name: 'revenue', aggregate: 'sum' }],
  },
];

function renderWidgetIn(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <WidgetConfigPanel
        open
        onClose={vi.fn()}
        config={{ id: 'w1', type: 'bar', dataset: 'sales_pipeline', dimensions: ['stage'], values: ['revenue'] }}
        onSave={vi.fn()}
        datasets={catalog}
      />
    </I18nProvider>,
  );
}

function renderDashboardIn(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <DashboardConfigPanel
        open
        onClose={vi.fn()}
        config={{ columns: 3, gap: 4, rowHeight: 120 }}
        onSave={vi.fn()}
      />
    </I18nProvider>,
  );
}

const breadcrumbSegments = () =>
  Array.from(screen.getByLabelText('breadcrumb').querySelectorAll('li')).map(
    (li) => li.textContent,
  );

describe('zh — the sidebar is Chinese, not English', () => {
  it('translates the widget panel chrome', () => {
    renderWidgetIn('zh');

    expect(breadcrumbSegments()).toEqual(['仪表盘', '图表']);

    expect(screen.getByText('基本')).toBeInTheDocument();
    expect(screen.getByText('数据绑定')).toBeInTheDocument();
    expect(screen.getByText('布局')).toBeInTheDocument();
    expect(screen.getByText('外观')).toBeInTheDocument();

    expect(screen.getByText('标题')).toBeInTheDocument();
    expect(screen.getByText('描述')).toBeInTheDocument();
    expect(screen.getByText('组件类型')).toBeInTheDocument();
    expect(screen.getByText('数据集')).toBeInTheDocument();
    expect(screen.getByText('维度')).toBeInTheDocument();
    expect(screen.getByText('度量值')).toBeInTheDocument();
    expect(screen.getByText('宽度 (列数)')).toBeInTheDocument();
    expect(screen.getByText('高度 (行数)')).toBeInTheDocument();

    expect(screen.getByPlaceholderText('组件标题')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('组件描述')).toBeInTheDocument();

    // The interpolated accessible name keeps the member name verbatim — it is
    // data, not copy — while the verb around it translates.
    expect(screen.getByLabelText('移除 stage')).toBeInTheDocument();

    // The help sentences under each dataset control translate too — they are
    // the longest copy the panel serves, and `ConfigFieldRenderer` shows them
    // for custom control types as well.
    expect(screen.getByText('该组件绑定的语义层数据集 (ADR-0021)。')).toBeInTheDocument();
    expect(screen.getByText('按这些数据集维度对度量值进行分组/拆分。')).toBeInTheDocument();
    expect(screen.getByText('要展示的数据集度量 (至少一个)。')).toBeInTheDocument();

    // The English these keys replaced is gone from the panel entirely.
    expect(screen.queryByText('General')).not.toBeInTheDocument();
    expect(screen.queryByText('Data Binding')).not.toBeInTheDocument();
    expect(screen.queryByText('Widget type')).not.toBeInTheDocument();
    expect(
      screen.queryByText('The semantic-layer dataset this widget binds to (ADR-0021).'),
    ).not.toBeInTheDocument();
  });

  it('translates the dashboard panel chrome, including the collapsed section', () => {
    renderDashboardIn('zh');

    expect(breadcrumbSegments()).toEqual(['仪表盘', '配置']);
    expect(screen.getByText('布局')).toBeInTheDocument();
    expect(screen.getByText('数据')).toBeInTheDocument();
    expect(screen.getByText('列数')).toBeInTheDocument();
    expect(screen.getByText('间距')).toBeInTheDocument();
    expect(screen.getByText('行高 (px)')).toBeInTheDocument();
    expect(screen.getByText('自动刷新')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('section-header-appearance'));
    expect(screen.getByText('显示描述')).toBeInTheDocument();
    expect(screen.getByText('主题')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('仪表盘标题')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('显示在标题下方的简短说明')).toBeInTheDocument();

    expect(screen.queryByText('Columns')).not.toBeInTheDocument();
    expect(screen.queryByText('Show description')).not.toBeInTheDocument();
  });

  it('translates the empty states inside the member pickers', () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <WidgetConfigPanel
          open
          onClose={vi.fn()}
          config={{ id: 'w1', type: 'bar' }}
          onSave={vi.fn()}
          datasets={catalog}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('未选择维度。')).toBeInTheDocument();
    expect(screen.getByText('未选择度量。')).toBeInTheDocument();
    expect(screen.getByText('选择数据集…')).toBeInTheDocument();
    expect(screen.queryByText('No dimensions selected.')).not.toBeInTheDocument();
  });
});

describe('de — a Latin pack translates too', () => {
  it('translates the widget panel chrome', () => {
    renderWidgetIn('de');

    // `Dashboard` is genuinely the German word; the tail is not.
    expect(breadcrumbSegments()).toEqual(['Dashboard', 'Diagramm']);

    expect(screen.getByText('Allgemein')).toBeInTheDocument();
    expect(screen.getByText('Datenbindung')).toBeInTheDocument();
    expect(screen.getByText('Darstellung')).toBeInTheDocument();

    expect(screen.getByText('Titel')).toBeInTheDocument();
    expect(screen.getByText('Beschreibung')).toBeInTheDocument();
    expect(screen.getByText('Widget-Typ')).toBeInTheDocument();
    expect(screen.getByText('Datensatz')).toBeInTheDocument();
    expect(screen.getByText('Dimensionen')).toBeInTheDocument();
    expect(screen.getByText('Werte')).toBeInTheDocument();
    expect(screen.getByText('Breite (Spalten)')).toBeInTheDocument();
    expect(screen.getByText('Höhe (Zeilen)')).toBeInTheDocument();

    expect(screen.getByPlaceholderText('Widget-Titel')).toBeInTheDocument();
    expect(screen.getByLabelText('stage entfernen')).toBeInTheDocument();

    expect(screen.queryByText('General')).not.toBeInTheDocument();
    expect(screen.queryByText('Widget type')).not.toBeInTheDocument();
  });

  it('translates the dashboard panel chrome', () => {
    renderDashboardIn('de');

    expect(breadcrumbSegments()).toEqual(['Dashboard', 'Konfiguration']);
    expect(screen.getByText('Spalten')).toBeInTheDocument();
    expect(screen.getByText('Abstand')).toBeInTheDocument();
    expect(screen.getByText('Zeilenhöhe (px)')).toBeInTheDocument();
    expect(screen.getByText('Automatisch aktualisieren')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('section-header-appearance'));
    expect(screen.getByText('Beschreibung anzeigen')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Dashboard-Titel')).toBeInTheDocument();

    expect(screen.queryByText('Auto refresh')).not.toBeInTheDocument();
    expect(screen.queryByText('Row height (px)')).not.toBeInTheDocument();
  });
});
