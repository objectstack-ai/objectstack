/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The filter panel offers relative dates on a `date` / `datetime` row
 * (objectstack#29115): the spec's 13 date-range presets on `between`, and
 * today / yesterday / tomorrow on `before` / `after`.
 *
 * What is pinned is what gets STORED: a preset writes the spec's macro window
 * (`['{week_start}', '{week_end}']`), a point writes the wrapped token
 * (`'{today}'`), never a resolved date and never a preset name. A resolved date
 * is the defect the card names: "this week" saved today means last week on
 * Monday, with no hint.
 *
 * The reverse reading is pinned too: a stored window shows its preset's label
 * (the `{current_*}` aliases folded first), and a placeholder value no preset
 * matches is kept, shown as its own text, and still sent.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  DATE_MACRO_INSTANT_TOKENS,
  DATE_RANGE_PRESETS,
  DATE_RANGE_PRESET_MACRO_WINDOWS,
} from '@objectstack/spec/data';
import { ViewFilterRuleSchema } from '@objectstack/spec/ui';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

import { FilterBuilder } from '../custom/filter-builder';
import {
  RELATIVE_DATE_POINTS,
  dateMacroName,
  dateRangePresetOf,
  dateRangePresetValue,
  relativeDatePointOf,
} from '../custom/filterRelativeDates';

afterEach(cleanup);

const FIELDS = [
  { value: 'close_date', label: 'Close date', type: 'date' },
  { value: 'created_at', label: 'Created at', type: 'datetime' },
  { value: 'due_date', label: 'Due date', type: 'date' },
  { value: 'name', label: 'Name', type: 'text' },
  { value: 'amount', label: 'Amount', type: 'number' },
];

const EN_PRESET_LABELS: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
  next_month: 'Next month',
  this_quarter: 'This quarter',
  last_quarter: 'Last quarter',
  next_quarter: 'Next quarter',
  this_year: 'This year',
  last_year: 'Last year',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  next_30_days: 'Next 30 days',
};

function renderRow(condition: Record<string, unknown>, wrap?: (node: React.ReactNode) => React.ReactNode) {
  const onChange = vi.fn();
  // Hoisted out of the JSX: the sync effect re-seeds on a new `value` identity.
  const value = { id: 'root', logic: 'and', conditions: [{ id: 'c1', ...condition }] };
  const node = <FilterBuilder fields={FIELDS as any} value={value as any} onChange={onChange} />;
  const utils = render(<>{wrap ? wrap(node) : node}</>);
  return { ...utils, onChange };
}

/** The row the component handed back on its most recent `onChange`. */
function lastRow(onChange: ReturnType<typeof vi.fn>) {
  const calls = onChange.mock.calls;
  expect(calls.length, 'the builder never called onChange').toBeGreaterThan(0);
  return calls[calls.length - 1][0].conditions[0];
}

const relativeTrigger = (field: string) => screen.queryByTestId(`filter-relative-date-${field}`);

/** Open a combobox and return the option labels it mounts, in order. */
async function openOptions(trigger: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return waitFor(() => {
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    return options;
  });
}

async function choose(trigger: HTMLElement, label: string) {
  const options = await openOptions(trigger);
  const option = options.find((o) => o.textContent === label);
  expect(option, `no "${label}" option`).toBeTruthy();
  fireEvent.click(option!);
}

async function pickOperator(label: string) {
  await choose(screen.getAllByRole('combobox')[1], label);
}

async function pickField(label: string) {
  await choose(screen.getAllByRole('combobox')[0], label);
}

describe('the reverse lookup reads the spec table', () => {
  it('every relative point is one of the spec instant tokens', () => {
    for (const point of RELATIVE_DATE_POINTS) {
      expect(DATE_MACRO_INSTANT_TOKENS as readonly string[]).toContain(point);
    }
  });

  it.each(DATE_RANGE_PRESETS)('%s: the stored window reads back as the preset', (preset) => {
    const stored = dateRangePresetValue(preset);
    expect(stored).toEqual([...DATE_RANGE_PRESET_MACRO_WINDOWS[preset]]);
    expect(dateRangePresetOf(stored)).toBe(preset);
  });

  it('folds the current_ aliases and the dollar spelling', () => {
    expect(dateRangePresetOf(['{current_week_start}', '{current_week_end}'])).toBe('this_week');
    expect(dateRangePresetOf(['{current_month_start}', '{month_end}'])).toBe('this_month');
    expect(dateRangePresetOf(['${quarter_start}', '${current_quarter_end}'])).toBe('this_quarter');
    expect(dateMacroName('{current_year_end}')).toBe('year_end');
    expect(relativeDatePointOf('${today}')).toBe('today');
  });

  it('a pair no window matches, a date, a preset name and an unknown token read as nothing', () => {
    expect(dateRangePresetOf(['{7_days_ago}', '{tomorrow}'])).toBeUndefined();
    expect(dateRangePresetOf(['2026-11-02', '2026-11-08'])).toBeUndefined();
    expect(dateRangePresetOf(['{week_start}'])).toBeUndefined();
    expect(dateMacroName('this_week')).toBeUndefined();
    expect(dateMacroName('{this_week}')).toBeUndefined();
    expect(relativeDatePointOf('{7_days_ago}')).toBeUndefined();
    expect(relativeDatePointOf('2026-11-02')).toBeUndefined();
  });
});

describe('between on a date row offers the spec presets and stores the macro window', () => {
  it('lists the spec presets in spec order, then Custom…', async () => {
    renderRow({ field: 'close_date', operator: 'between', value: [] });
    const options = await openOptions(relativeTrigger('close_date')!);
    expect(options.map((o) => o.textContent)).toEqual([
      ...DATE_RANGE_PRESETS.map((p) => EN_PRESET_LABELS[p]),
      'Custom…',
    ]);
  });

  it('This week sends the week window, not a date and not the preset name', async () => {
    const { onChange } = renderRow({ field: 'close_date', operator: 'between', value: [] });
    await choose(relativeTrigger('close_date')!, 'This week');
    const row = lastRow(onChange);
    expect(row.value).toEqual(['{week_start}', '{week_end}']);
    expect(ViewFilterRuleSchema.safeParse({ field: row.field, operator: row.operator, value: row.value }).success).toBe(true);
  });

  it.each(DATE_RANGE_PRESETS)('%s sends its window from the spec table', async (preset) => {
    const { onChange } = renderRow({ field: 'close_date', operator: 'between', value: [] });
    await choose(relativeTrigger('close_date')!, EN_PRESET_LABELS[preset]);
    const sent = lastRow(onChange).value;
    expect(sent).toEqual([...DATE_RANGE_PRESET_MACRO_WINDOWS[preset]]);
    expect(DATE_RANGE_PRESETS as readonly string[]).not.toContain(sent[0]);
  });

  it('the same on a datetime row', async () => {
    const { onChange } = renderRow({ field: 'created_at', operator: 'between', value: [] });
    await choose(relativeTrigger('created_at')!, 'Last 30 days');
    expect(lastRow(onChange).value).toEqual(['{30_days_ago}', '{today}']);
  });

  it('a chosen preset hides the two date inputs; Custom… brings them back empty', async () => {
    const { onChange, rerender } = renderRow({ field: 'close_date', operator: 'between', value: [] });
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    await choose(relativeTrigger('close_date')!, 'This month');
    const chosen = lastRow(onChange);
    rerender(
      <FilterBuilder fields={FIELDS as any} value={{ id: 'root', logic: 'and', conditions: [chosen] } as any} onChange={onChange} />,
    );
    expect(screen.queryByLabelText('From')).toBeNull();
    expect(relativeTrigger('close_date')).toHaveTextContent('This month');

    await choose(relativeTrigger('close_date')!, 'Custom…');
    expect(lastRow(onChange).value).toEqual([]);
  });

  it('Custom… keeps the two date inputs and they still write dates', () => {
    const { onChange } = renderRow({ field: 'close_date', operator: 'between', value: [] });
    expect(relativeTrigger('close_date')).toHaveTextContent('Custom…');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
    expect(lastRow(onChange).value).toEqual(['2026-11-01', '']);
  });
});

describe('before / after offer today, yesterday and tomorrow', () => {
  it('lists the three points, then Custom…', async () => {
    renderRow({ field: 'close_date', operator: 'before', value: '' });
    const options = await openOptions(relativeTrigger('close_date')!);
    expect(options.map((o) => o.textContent)).toEqual(['Today', 'Yesterday', 'Tomorrow', 'Custom…']);
  });

  it('Today on before sends the wrapped token', async () => {
    const { onChange } = renderRow({ field: 'close_date', operator: 'before', value: '' });
    await choose(relativeTrigger('close_date')!, 'Today');
    expect(lastRow(onChange).value).toBe('{today}');
  });

  it('Tomorrow on after, on a datetime row', async () => {
    const { onChange } = renderRow({ field: 'created_at', operator: 'after', value: '' });
    await choose(relativeTrigger('created_at')!, 'Tomorrow');
    expect(lastRow(onChange).value).toBe('{tomorrow}');
  });

  it('a stored point shows its label and no date input', () => {
    renderRow({ field: 'close_date', operator: 'before', value: '{yesterday}' });
    expect(relativeTrigger('close_date')).toHaveTextContent('Yesterday');
    expect(screen.queryByPlaceholderText('Value')).toBeNull();
  });

  it('a stored fixed date stays Custom… with its date input', () => {
    renderRow({ field: 'close_date', operator: 'before', value: '2026-11-02' });
    expect(relativeTrigger('close_date')).toHaveTextContent('Custom…');
    expect(screen.getByPlaceholderText('Value')).toHaveValue('2026-11-02');
  });
});

describe('a stored value reads back', () => {
  it('the current_ alias pair shows This week and is not rewritten', () => {
    const { onChange } = renderRow({
      field: 'close_date',
      operator: 'between',
      value: ['{current_week_start}', '{current_week_end}'],
    });
    expect(relativeTrigger('close_date')).toHaveTextContent('This week');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a pair no preset matches is shown as text, kept, and still sent', async () => {
    const { onChange } = renderRow({
      field: 'close_date',
      operator: 'between',
      value: ['{7_days_ago}', '{tomorrow}'],
    });
    expect(relativeTrigger('close_date')).toHaveTextContent('{7_days_ago} – {tomorrow}');
    expect(screen.queryByLabelText('From')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    // Still part of the group: the next edit re-emits the row unchanged.
    fireEvent.click(screen.getByText('Add filter'));
    expect(onChange.mock.calls.at(-1)![0].conditions[0].value).toEqual(['{7_days_ago}', '{tomorrow}']);
  });

  it('shows the zh label for a stored week window', async () => {
    renderRow({ field: 'close_date', operator: 'between', value: ['{week_start}', '{week_end}'] }, (node) => (
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        {node}
      </I18nProvider>
    ));
    await waitFor(() => expect(relativeTrigger('close_date')).toHaveTextContent('本周'));
  });
});

describe('operator and field switches', () => {
  it('before -> after keeps the point', async () => {
    const { onChange } = renderRow({ field: 'close_date', operator: 'before', value: '{today}' });
    await pickOperator('After');
    expect(lastRow(onChange)).toMatchObject({ operator: 'after', value: '{today}' });
  });

  it('before -> between starts the range empty instead of carrying half a window', async () => {
    const { onChange } = renderRow({ field: 'close_date', operator: 'before', value: '{today}' });
    await pickOperator('Between');
    expect(lastRow(onChange)).toMatchObject({ operator: 'between', value: [] });
  });

  it('a window -> equals starts empty instead of a token the date input cannot show', async () => {
    const { onChange } = renderRow({ field: 'close_date', operator: 'between', value: ['{week_start}', '{week_end}'] });
    await pickOperator('Equals');
    expect(lastRow(onChange)).toMatchObject({ operator: 'equals', value: '' });
  });

  it('a field switch between two date columns keeps the window', async () => {
    const { onChange } = renderRow({ field: 'close_date', operator: 'between', value: ['{week_start}', '{week_end}'] });
    await pickField('Due date');
    expect(lastRow(onChange)).toMatchObject({ field: 'due_date', value: ['{week_start}', '{week_end}'] });
  });
});

describe('CONTROL: rows without relative dates are unchanged', () => {
  it('equals on a date row has no relative choice', () => {
    renderRow({ field: 'close_date', operator: 'equals', value: '' });
    expect(relativeTrigger('close_date')).toBeNull();
  });

  it('text and number rows have no relative choice', () => {
    renderRow({ field: 'name', operator: 'equals', value: 'acme' });
    expect(relativeTrigger('name')).toBeNull();
    cleanup();
    renderRow({ field: 'amount', operator: 'equals', value: 5 });
    expect(relativeTrigger('amount')).toBeNull();
  });

  it('every label key is present in all ten packs', () => {
    const keys = [
      'dashboard.filters.custom',
      'fields.datePicker.tomorrow',
      ...DATE_RANGE_PRESETS.map((p) => `dashboard.filters.range.${p}`),
    ];
    const read = (node: unknown, path: string) =>
      path.split('.').reduce<unknown>((acc, seg) => (acc && typeof acc === 'object' ? (acc as any)[seg] : undefined), node);
    const missing = Object.entries(builtInLocales).flatMap(([code, pack]) =>
      keys.filter((key) => typeof read(pack, key) !== 'string').map((key) => `${code}:${key}`),
    );
    expect(missing).toEqual([]);
  });
});
