// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { dashboardForm } from '@objectstack/spec/ui';
import { DashboardDefaultInspector } from './DashboardDefaultInspector';
import { t } from '../i18n';
// The designer rows this suite reads in zh live in `@object-ui/i18n`'s `studio`
// namespace, whose `zh` catalogue is fetched on demand (objectstack#25922).
// Resident before any case, so the zh rows below read synchronously.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

afterEach(cleanup);

const baseProps = {
  type: 'dashboard',
  name: 'sales',
  locale: 'en-US' as const,
  onSelectionChange: vi.fn(),
};

// Scoped to `<label>` on purpose (objectui#8218). The spec-form graft below
// this inspector's curated basics renders the `header.actions[]` table, whose
// column headers used to print the raw JSON Schema keys and now read `Label`,
// `Action Url`, … — so a bare `getByText('Label')` matches the curated Label
// field AND that `<th>`. The helper only ever meant the form label.
function labelledInput(label: string): HTMLInputElement {
  const lab = screen.getByText(label, { selector: 'label' });
  const input = lab.parentElement!.querySelector('input, textarea');
  return input as HTMLInputElement;
}

const draftWithWidget = {
  name: 'sales',
  label: 'Sales Overview',
  description: 'KPIs',
  widgets: [{ id: 'widget_1', type: 'metric', title: 'Revenue' }],
};

describe('DashboardDefaultInspector — basics', () => {
  it('renders the curated dashboard home (label / description / widgets)', () => {
    render(
      <DashboardDefaultInspector
        {...baseProps}
        draft={draftWithWidget}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(labelledInput('Label').value).toBe('Sales Overview');
    expect(labelledInput('Description').value).toBe('KPIs');
    // The single existing widget row shows.
    expect(screen.getByText('Revenue')).toBeInTheDocument();
  });

  it('commits label / description edits via onPatch', () => {
    const onPatch = vi.fn();
    render(
      <DashboardDefaultInspector
        {...baseProps}
        draft={draftWithWidget}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    fireEvent.change(labelledInput('Label'), { target: { value: 'Sales 2' } });
    expect(onPatch).toHaveBeenCalledWith({ label: 'Sales 2' });
    fireEvent.change(labelledInput('Description'), { target: { value: 'More' } });
    expect(onPatch).toHaveBeenCalledWith({ description: 'More' });
  });

  it('drills into a widget by its id on selection', () => {
    const onSelectionChange = vi.fn();
    render(
      <DashboardDefaultInspector
        {...baseProps}
        onSelectionChange={onSelectionChange}
        draft={draftWithWidget}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    fireEvent.click(screen.getByText('Revenue'));
    expect(onSelectionChange).toHaveBeenCalledWith({
      kind: 'widget',
      id: 'widget_1',
      label: 'Revenue',
    });
  });

  it('renders Chinese labels under zh-CN', () => {
    render(
      <DashboardDefaultInspector
        {...baseProps}
        locale={'zh-CN'}
        draft={draftWithWidget}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(screen.getByText('仪表盘')).toBeInTheDocument();
  });

  it('disables inputs when readOnly', () => {
    render(
      <DashboardDefaultInspector
        {...baseProps}
        draft={draftWithWidget}
        onPatch={vi.fn()}
        readOnly
      />,
    );
    expect(labelledInput('Label')).toBeDisabled();
    expect(labelledInput('Description')).toBeDisabled();
  });
});

// objectui#11659 ruling 5: the widgets list names each widget's kind in the
// designer's language — the name the add-widget picker shows for it — not the
// stored `type` id. The acceptance run read 「按客户状态统计数量 · bar」.
describe('DashboardDefaultInspector — the widgets list names each kind (objectui#11659)', () => {
  const draftWithChart = {
    name: 'crm',
    label: 'CRM',
    widgets: [
      { id: 'w_bar', type: 'bar', title: '按客户状态统计数量' },
      { id: 'w_kpi', type: 'metric', title: 'Revenue' },
      { id: 'w_odd', type: 'not-a-catalogued-type', title: 'Legacy' },
    ],
  };
  const kindOf = (id: string) =>
    document.querySelector(`[data-widget-kind="${id}"]`) as HTMLElement | null;

  for (const locale of ['zh-CN', 'en-US'] as const) {
    it(`${locale}: a bar widget reads the picker's name for a bar chart, and keeps its id on hover`, () => {
      render(
        <DashboardDefaultInspector
          {...baseProps}
          locale={locale}
          draft={draftWithChart}
          onPatch={vi.fn()}
          readOnly={false}
        />,
      );
      const bar = kindOf('bar');
      expect(bar).not.toBeNull();
      const name = t('engine.widgetPicker.type.bar', locale);
      // A real row, not the key echoed back.
      expect(name).not.toBe('engine.widgetPicker.type.bar');
      expect(bar!.textContent).toBe(name);
      expect(bar!.textContent).not.toBe('bar');
      expect(bar).toHaveAttribute('title', 'bar');
      expect(kindOf('metric')!.textContent).toBe(t('engine.widgetPicker.type.metric', locale));
      // No row prints a bare stored id where the catalogue has a name for it.
      expect(screen.queryByText('bar', { selector: 'code' })).toBeNull();
    });
  }

  it('a type the catalogue does not know still prints its id', () => {
    render(
      <DashboardDefaultInspector
        {...baseProps}
        locale={'zh-CN'}
        draft={draftWithChart}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(kindOf('not-a-catalogued-type')!.textContent).toBe('not-a-catalogued-type');
  });
});

/**
 * objectstack#36949 — the Default Period select (Filters → Date Range → Default
 * Period) listed each option by its stored preset, `this_month`, in English and
 * Chinese alike: the spec form's `dateRange` composite declared no children.
 * It now offers the report form's named options, and a zh designer reads the
 * names from the console's locale packs, as on the report inspector.
 *
 * POSITIVE CONTROL in the zh case: the row's own zh label (默认时间段, from the
 * metadata-form overlay), so a dead locale channel cannot pass for "not
 * relabelled".
 */
describe('DashboardDefaultInspector — the Default Period select names its periods (objectstack#36949)', () => {
  function specOptions(): Array<{ label: string; value: string }> {
    for (const section of dashboardForm.sections ?? []) {
      for (const field of (section.fields ?? []) as any[]) {
        if (field?.field !== 'dateRange') continue;
        const child = (field.fields ?? []).find((c: any) => c?.field === 'defaultRange');
        if (child?.options) return child.options;
      }
    }
    throw new Error('dashboardForm declares no dateRange.defaultRange options');
  }

  function renderIn(language: string, locale: 'en-US' | 'zh-CN') {
    return render(
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        <DashboardDefaultInspector
          {...baseProps}
          locale={locale}
          draft={{ ...draftWithWidget, dateRange: { defaultRange: 'this_quarter' } }}
          onPatch={vi.fn()}
          readOnly={false}
        />
      </I18nProvider>,
    );
  }

  async function openDefaultPeriod(sectionTitle: string, rowLabel: string): Promise<string[]> {
    fireEvent.click(await screen.findByText(sectionTitle));
    const trigger = await screen.findByRole('combobox', { name: rowLabel });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
    return screen.getAllByRole('option').map((o) => o.textContent ?? '');
  }

  it('en: every option reads the spec name, never a stored preset', async () => {
    renderIn('en', 'en-US');
    const offered = await openDefaultPeriod('Filters', 'Default Period');
    expect(offered).toEqual(expect.arrayContaining(specOptions().map((o) => o.label)));
    expect(offered).toContain('This quarter');
    for (const { value } of specOptions()) expect(offered, value).not.toContain(value);
  });

  it('zh: every option reads the locale pack name', async () => {
    renderIn('zh', 'zh-CN');
    // POSITIVE CONTROL: the row label comes through the zh overlay.
    const offered = await openDefaultPeriod('筛选', '默认时间段');
    await waitFor(() => expect(offered).toContain('本季度'));
    expect(offered).toEqual(expect.arrayContaining(['本月', '今天', '近 30 天', '自定义…']));
    for (const { value, label } of specOptions()) {
      expect(offered, value).not.toContain(value);
      expect(offered, label).not.toContain(label);
    }
  });
});
