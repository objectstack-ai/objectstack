/**
 * ObjectGantt quick-filter bar localization (objectstack#5427).
 *
 * The four `QuickFilterBar` labels used to be Chinese string literals baked
 * into the ObjectGantt call site, so the bar read Chinese under an `en`/`ja`/
 * `es`/`ar` session while the rest of the gantt toolbar localized — and it
 * violated the English-only-codebase rule (AGENTS.md Commandment #-1). They are
 * now `gantt.quickFilter.*` bundle keys.
 *
 * Both directions are asserted on purpose: a positive check alone would stay
 * green if someone re-introduced a hardcoded literal *and* added the key, so
 * each locale also asserts that the OTHER locale's copy is absent. That is what
 * makes this a regression guard rather than a spelling test.
 *
 * GanttView is mocked to a thin shell (as in ObjectGantt.quickfilter.test.tsx)
 * — the real QuickFilterBar renders, since it is the thing under test.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
// Same package ObjectGantt's `useGanttTranslation` reads `useObjectTranslation`
// from, so the provider's i18next instance is the one the component resolves
// against (a second copy of @object-ui/i18n would not share React context).
import { I18nProvider } from '@object-ui/react';
import { ObjectGantt } from './ObjectGantt';

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => <div data-testid="gantt-view" data-count={tasks.length} />,
}));

const INLINE = [
  { id: '1', name: 'Alpha task', start: '2024-01-01', end: '2024-01-05', status: 'todo' },
  { id: '2', name: 'Beta task', start: '2024-02-01', end: '2024-02-10', status: 'doing' },
  { id: '3', name: 'Gamma task', start: '2024-03-01', end: '2024-03-20', status: 'done' },
];

const SCHEMA: any = {
  type: 'gantt',
  startDateField: 'start',
  endDateField: 'end',
  titleField: 'name',
  data: { provider: 'value', items: INLINE },
  quickFilters: [
    { field: 'status', label: 'Status', options: ['todo', 'doing', 'done'] },
    // No `options`, and no record carries `owner` → resolves to zero options,
    // which is the only way to render the `empty` placeholder.
    { field: 'owner', label: 'Owner' },
  ],
};

/**
 * Render inside a provider pinned to `lang`.
 *
 * `detectBrowserLanguage: false` + `persistLanguage={false}` are both load-bearing:
 * the provider's bootstrap otherwise reads a previously persisted language out of
 * localStorage and *overrides* `defaultLanguage` with it (see
 * `resolveBootstrapConfig`), which would make these cases order-dependent — the
 * zh case would decide what the en case renders.
 */
function renderIn(lang: string) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: lang, detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <ObjectGantt schema={SCHEMA} />
    </I18nProvider>,
  );
}

/**
 * Drives the bar into the state where all four labels are observable and
 * returns their rendered text. `clear` only mounts once a filter is active, and
 * `empty` only inside the zero-option dropdown.
 */
async function readLabels(view: ReturnType<typeof render>) {
  const { container, getByTestId } = view;
  await waitFor(() => expect(container.querySelector('[data-testid="gantt-view"]')).toBeTruthy());

  // `empty`: open the dimension that resolved no options.
  fireEvent.click(getByTestId('quick-filter-trigger-owner'));
  const empty = getByTestId('quick-filter-panel-owner').textContent ?? '';
  fireEvent.click(getByTestId('quick-filter-trigger-owner'));

  // `all`: the select-all row inside a dimension that has options.
  fireEvent.click(getByTestId('quick-filter-trigger-status'));
  const all = getByTestId('quick-filter-all-status').textContent ?? '';

  // `clear` + `resultSummary`: narrow to a single task (1 of 3).
  fireEvent.click(getByTestId('quick-filter-option-status-doing'));
  await waitFor(() =>
    expect(getByTestId('gantt-view').getAttribute('data-count')).toBe('1'),
  );

  return {
    all,
    empty,
    clear: getByTestId('quick-filter-clear').textContent ?? '',
    summary: getByTestId('quick-filter-summary').textContent ?? '',
  };
}

describe('ObjectGantt quick-filter bar is localized, not hardcoded (objectstack#5427)', () => {
  it('renders English copy under an `en` session', async () => {
    const labels = await readLabels(renderIn('en'));

    expect(labels.all).toBe('All');
    expect(labels.empty).toBe('No options');
    expect(labels.clear).toBe('Clear filters');
    expect(labels.summary).toBe('Showing 1 / 3 tasks');

    // Reverse assertion: the Chinese literals this issue removed must not
    // reappear — neither as a hardcoded string nor via a mis-keyed lookup.
    const all = Object.values(labels).join(' ');
    expect(all).not.toContain('全部');
    expect(all).not.toContain('清除筛选');
    expect(all).not.toContain('无可选项');
    expect(all).not.toMatch(/显示 .* 项任务/);
  });

  it('renders Chinese copy under a `zh` session', async () => {
    const labels = await readLabels(renderIn('zh'));

    expect(labels.all).toBe('全部');
    expect(labels.empty).toBe('无可选项');
    expect(labels.clear).toBe('清除筛选');
    // The summary is assembled by a literal `.replace` of the SINGLE-brace
    // placeholders, so a pack that respelled them as `{{shown}}` would surface
    // here as an unsubstituted brace rather than a silent miss.
    expect(labels.summary).toBe('显示 1 / 3 项任务');

    // Reverse assertion: no English leaks into a localized session. This is the
    // half that would have failed before the fix only for `en` — here it pins
    // that the zh pack actually carries all four keys instead of falling back.
    const all = Object.values(labels).join(' ');
    expect(all).not.toContain('All');
    expect(all).not.toContain('Clear filters');
    expect(all).not.toContain('No options');
    expect(all).not.toMatch(/Showing \d+ \/ \d+ tasks/);
  });

});
// The provider-less fallback case lives in
// ObjectGantt.quickfilter.i18n.fallback.test.tsx: mounting an I18nProvider here
// leaves react-i18next's *global* instance on that language, so a no-provider
// render in THIS file inherits it (observed: it returned the zh copy, not the
// bundled English default). A separate file is the only clean module state.
