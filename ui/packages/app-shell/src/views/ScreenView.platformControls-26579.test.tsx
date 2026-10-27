// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26579 — a flow screen's `date` / `datetime` and `boolean` fields
 * draw the platform controls the record form and `ActionParamDialog` draw.
 *
 * A date field was the browser's native input (`mm/dd/yyyy` under zh-CN), a
 * date-time field a bare text box, and a boolean a lone checkbox on the line
 * under its label. Now a date or date-time field is the record form's picker
 * in the display locale's format, writing the stored shape the native input
 * wrote, and a boolean is `ActionParamDialog`'s inline row: the checkbox with
 * its label beside it and the help text under the row.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
// Module scope, per AGENTS.md 测试纪律: the date, date-time and boolean arms
// reach their widgets through `React.lazy` factories inside `@object-ui/fields`;
// importing the barrel here resolves them before any test's `findBy` budget.
import '@object-ui/fields';
import { ScreenView, type ScreenSpec } from './ScreenView';

afterEach(cleanup);

function specOf(fields: ScreenSpec['fields']): ScreenSpec {
  return { nodeId: 'n1', title: 'Step', fields } as ScreenSpec;
}

function renderScreen(
  fields: ScreenSpec['fields'],
  extra: { values?: Record<string, unknown>; onValueChange?: (name: string, v: unknown) => void } = {},
) {
  return render(
    <ScreenView screen={specOf(fields)} values={extra.values ?? {}} onValueChange={extra.onValueChange ?? (() => {})} />,
  );
}

const typeAndCommit = (input: HTMLElement, text: string) => {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
};

describe('objectstack#26579 — a `date` screen field is the platform picker', () => {
  it('draws the locale-format text box and calendar, never input[type=date]', async () => {
    const { container } = renderScreen([{ name: 'start', label: 'Start', type: 'date' }], { values: { start: '2026-10-16' } });
    const input = await screen.findByRole('textbox', { name: 'Start' });
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(input.closest('[data-slot="date-picker"]')).not.toBeNull();
    expect(input).toHaveValue('10/16/2026');
    expect(screen.getByTestId('date-picker-trigger')).toBeTruthy();
  });

  it('a zh session reads and shows the zh format', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <ScreenView screen={specOf([{ name: 'start', label: 'Start', type: 'date' }])} values={{ start: '2026-10-16' }} onValueChange={() => {}} />
      </I18nProvider>,
    );
    const input = await screen.findByRole('textbox', { name: 'Start' });
    expect(input).toHaveValue('2026/10/16');
    expect(input).toHaveAttribute('placeholder', 'YYYY/MM/DD');
  });

  it('typed text is written as the ISO day the native input wrote', async () => {
    const onValueChange = vi.fn();
    renderScreen([{ name: 'start', label: 'Start', type: 'date' }], { onValueChange });
    typeAndCommit(await screen.findByRole('textbox', { name: 'Start' }), '10/20/2026');
    expect(onValueChange).toHaveBeenCalledWith('start', '2026-10-20');
  });

  it('clearing writes the empty string, as the native input did', async () => {
    const onValueChange = vi.fn();
    renderScreen([{ name: 'start', label: 'Start', type: 'date' }], { values: { start: '2026-10-16' }, onValueChange });
    await screen.findByRole('textbox', { name: 'Start' });
    fireEvent.click(screen.getByTestId('date-picker-clear'));
    expect(onValueChange).toHaveBeenCalledWith('start', '');
  });

  it('keeps the required state and the help text on the control', async () => {
    renderScreen([{ name: 'start', label: 'Start', type: 'date', required: true, inlineHelpText: 'Start help' }]);
    const input = await screen.findByRole('textbox', { name: 'Start' });
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAccessibleDescription('Start help');
  });
});

describe('objectstack#26579 — a `datetime` screen field is the platform date-time picker', () => {
  it('draws the picker and writes an ISO instant', async () => {
    const onValueChange = vi.fn();
    const { container } = renderScreen([{ name: 'remind', label: 'Remind', type: 'datetime' }], { onValueChange });
    const input = await screen.findByRole('textbox', { name: 'Remind' });
    expect(input.closest('[data-slot="date-picker"]')).not.toBeNull();
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
    typeAndCommit(input, '10/16/2026 14:30');
    expect(onValueChange).toHaveBeenCalledWith('remind', new Date(2026, 9, 16, 14, 30).toISOString());
  });
});

describe('objectstack#26579 — a `boolean` screen field is the inline checkbox row', () => {
  it('draws the label BESIDE the checkbox, in one row', async () => {
    renderScreen([{ name: 'estimate', label: 'Estimated amount', type: 'boolean' }]);
    const box = await screen.findByRole('checkbox', { name: 'Estimated amount' });
    const label = screen.getByText('Estimated amount');
    const row = label.parentElement as HTMLElement;
    expect(row).toHaveClass('flex');
    expect(row.contains(box)).toBe(true);
    // The control comes first, the label after it.
    expect(box.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a `checkbox` widget hint draws the same row', async () => {
    renderScreen([{ name: 'submit_now', label: 'Submit now', type: 'checkbox' }]);
    const box = await screen.findByRole('checkbox', { name: 'Submit now' });
    expect((screen.getByText('Submit now').parentElement as HTMLElement).contains(box)).toBe(true);
  });

  it('ticking answers `true` and unticking `false`; clicking the label toggles it', async () => {
    const onValueChange = vi.fn();
    const { rerender } = renderScreen([{ name: 'estimate', label: 'Estimated amount', type: 'boolean' }], { onValueChange });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Estimated amount' }));
    expect(onValueChange).toHaveBeenLastCalledWith('estimate', true);
    rerender(
      <ScreenView
        screen={specOf([{ name: 'estimate', label: 'Estimated amount', type: 'boolean' }])}
        values={{ estimate: true }}
        onValueChange={onValueChange}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Estimated amount' })).toBeChecked();
    fireEvent.click(screen.getByText('Estimated amount'));
    expect(onValueChange).toHaveBeenLastCalledWith('estimate', false);
  });

  it('only a real `true` is checked', async () => {
    renderScreen([{ name: 'estimate', label: 'Estimated amount', type: 'boolean' }], { values: { estimate: 'true' } });
    expect(await screen.findByRole('checkbox', { name: 'Estimated amount' })).not.toBeChecked();
  });

  it('carries the required state and marker, and its help text under the row describes it', async () => {
    renderScreen([{ name: 'estimate', label: 'Estimated amount', type: 'boolean', required: true, inlineHelpText: 'Tick when estimated' }]);
    const box = await screen.findByRole('checkbox', { name: 'Estimated amount' });
    expect(box).toHaveAttribute('aria-required', 'true');
    expect(box).toHaveAccessibleDescription('Tick when estimated');
    const label = screen.getByText('Estimated amount');
    expect(label.querySelector('[data-required-marker="true"]')).not.toBeNull();
    const help = screen.getByText('Tick when estimated');
    expect(help.parentElement?.contains(label.parentElement)).toBe(true);
    expect(label.parentElement?.contains(help)).toBe(false);
  });

  it('the widget draws no second label for the host-named control', async () => {
    const { container } = renderScreen([{ name: 'estimate', label: 'Estimated amount', type: 'boolean' }]);
    await screen.findByRole('checkbox', { name: 'Estimated amount' });
    expect(container.querySelectorAll('label[for="ff-estimate"]')).toHaveLength(1);
  });

  it('CONTROL — a boolean field declaring `options` stays a select with its label above', () => {
    const { container } = renderScreen([
      { name: 'flag', label: 'Flag', type: 'boolean', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    ]);
    expect(screen.getByRole('combobox', { name: 'Flag' })).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(container.querySelector('.space-y-1\\.5')?.children).toHaveLength(2);
  });
});
