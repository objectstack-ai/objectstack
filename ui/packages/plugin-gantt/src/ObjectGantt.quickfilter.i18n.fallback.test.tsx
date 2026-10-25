/**
 * ObjectGantt quick-filter labels with NO I18nProvider mounted (objectstack#5427).
 *
 * Standalone embeds and most unit tests render ObjectGantt without a provider.
 * Turning the four labels into `gantt.quickFilter.*` bundle keys moved the
 * failure mode: where the old hardcoded literals always rendered *something*,
 * an unregistered key renders as the raw key — the bar would read
 * `gantt.quickFilter.all`. `GANTT_DEFAULT_TRANSLATIONS` is what prevents that,
 * and this file is what pins it.
 *
 * Deliberately a separate file from ObjectGantt.quickfilter.i18n.test.tsx:
 * mounting an I18nProvider leaves react-i18next's global instance on that
 * language, so the un-provided case is only meaningful in a module state where
 * no provider was ever constructed.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectGantt } from './ObjectGantt';
import { GANTT_DEFAULT_TRANSLATIONS } from './useGanttTranslation';

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => <div data-testid="gantt-view" data-count={tasks.length} />,
}));

const SCHEMA: any = {
  type: 'gantt',
  startDateField: 'start',
  endDateField: 'end',
  titleField: 'name',
  data: {
    provider: 'value',
    items: [
      { id: '1', name: 'Alpha task', start: '2024-01-01', end: '2024-01-05', status: 'todo' },
      { id: '2', name: 'Beta task', start: '2024-02-01', end: '2024-02-10', status: 'doing' },
      { id: '3', name: 'Gamma task', start: '2024-03-01', end: '2024-03-20', status: 'done' },
    ],
  },
  quickFilters: [
    { field: 'status', label: 'Status', options: ['todo', 'doing', 'done'] },
    // No record carries `owner` → zero options → renders the `empty` placeholder.
    { field: 'owner', label: 'Owner' },
  ],
};

describe('ObjectGantt quick-filter labels without an I18nProvider (objectstack#5427)', () => {
  it('renders the bundled English defaults — never a raw bundle key', async () => {
    const { container, getByTestId } = render(<ObjectGantt schema={SCHEMA} />);
    await waitFor(() => expect(container.querySelector('[data-testid="gantt-view"]')).toBeTruthy());

    fireEvent.click(getByTestId('quick-filter-trigger-owner'));
    const empty = getByTestId('quick-filter-panel-owner').textContent ?? '';
    fireEvent.click(getByTestId('quick-filter-trigger-owner'));

    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    const all = getByTestId('quick-filter-all-status').textContent ?? '';

    fireEvent.click(getByTestId('quick-filter-option-status-doing'));
    await waitFor(() => expect(getByTestId('gantt-view').getAttribute('data-count')).toBe('1'));

    const clear = getByTestId('quick-filter-clear').textContent ?? '';
    const summary = getByTestId('quick-filter-summary').textContent ?? '';

    expect(all).toBe(GANTT_DEFAULT_TRANSLATIONS['gantt.quickFilter.all']);
    expect(empty).toBe(GANTT_DEFAULT_TRANSLATIONS['gantt.quickFilter.empty']);
    expect(clear).toBe(GANTT_DEFAULT_TRANSLATIONS['gantt.quickFilter.clear']);
    expect(summary).toBe('Showing 1 / 3 tasks');

    const rendered = [all, empty, clear, summary].join(' ');
    // The regression this file exists for.
    expect(rendered).not.toContain('gantt.quickFilter');
    // Placeholders must be substituted by the call site's literal `.replace`,
    // not rendered to the user.
    expect(rendered).not.toContain('{shown}');
    expect(rendered).not.toContain('{total}');
    // And the Chinese literals this issue removed must not come back.
    expect(rendered).not.toContain('全部');
    expect(rendered).not.toContain('清除筛选');
    expect(rendered).not.toContain('无可选项');
    expect(rendered).not.toMatch(/显示 .* 项任务/);
  });
});
