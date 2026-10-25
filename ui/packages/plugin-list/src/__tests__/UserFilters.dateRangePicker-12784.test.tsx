/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12784 — an authored `date-range` user-filter chip draws the
 * platform date picker on both bounds, labelled from the language packs.
 *
 * `@object-ui/fields` is registered as the console registers it, so each
 * bound resolves the host's `field:date` widget from `ComponentRegistry` (the
 * seam the list Filter panel uses since objectui#12743) and the picker
 * arrives through its own lazy chunk.
 *
 * Pinned:
 * - (a) both bounds draw the picker, not `input[type=date]`; in a `zh`
 *   session the placeholder and digit order are `YYYY/MM/DD` and the bounds
 *   are named by the pack's `filterBuilder.rangeStart` / `rangeEnd`;
 * - (b) a typed bound applies on Enter, on blur, and on a press outside the
 *   chip (which closes it), with the same `YYYY-MM-DD` conditions the native
 *   pair emitted; clearing both bounds writes `[]`;
 * - (c) CONTROL: the select, multi-select and text chips draw what they drew
 *   before.
 *
 * The native fallback (nothing registered) keeps the pair of
 * `input[type=date]`, pinned in `user-filter-arity-spec-parity.test.tsx`.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { UserFilters } from '../UserFilters';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
  // Radix popover uses pointer capture; the DOM test environment lacks these.
  if (!(Element.prototype as any).hasPointerCapture) {
    (Element.prototype as any).hasPointerCapture = () => false;
  }
  if (!(Element.prototype as any).setPointerCapture) {
    (Element.prototype as any).setPointerCapture = () => {};
  }
  if (!(Element.prototype as any).releasePointerCapture) {
    (Element.prototype as any).releasePointerCapture = () => {};
  }
});

const objectDef = {
  name: 'tasks',
  fields: {
    due_date: { type: 'date', label: 'Due' },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { label: 'To Do', value: 'todo' },
        { label: 'Done', value: 'done' },
      ],
    },
    name: { type: 'text', label: 'Name' },
  },
};

function mount(fields: Array<Record<string, unknown>>, language?: string) {
  const onFilterChange = vi.fn();
  const filters = (
    <div>
      <button type="button" data-testid="outside">
        outside
      </button>
      <UserFilters
        config={{ element: 'dropdown', fields } as any}
        objectDef={objectDef}
        data={[]}
        onFilterChange={onFilterChange}
      />
    </div>
  );
  render(
    language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        {filters}
      </I18nProvider>
    ) : (
      filters
    ),
  );
  return { onFilterChange };
}

const RANGE = [{ field: 'due_date', type: 'date-range' }];

/** Open the chip and wait for both lazily loaded picker text boxes. */
async function openRange(): Promise<{ range: HTMLElement; from: HTMLInputElement; to: HTMLInputElement }> {
  fireEvent.click(await screen.findByTestId('filter-badge-due_date'));
  const range = await screen.findByTestId('filter-range-due_date');
  const [from, to] = await waitFor(
    () => {
      const inputs = range.querySelectorAll('[data-slot="date-picker"] input');
      if (inputs.length !== 2) throw new Error('date pickers not rendered');
      return Array.from(inputs) as HTMLInputElement[];
    },
    { timeout: 5000 },
  );
  return { range, from, to };
}

function typeInto(input: HTMLInputElement, text: string) {
  input.focus();
  fireEvent.change(input, { target: { value: text } });
}

describe('UserFilters date-range chip draws the platform date picker (objectui#12784)', () => {
  it('(a) both bounds draw the picker, not input[type=date], named From / To', async () => {
    mount(RANGE);
    const { range, from, to } = await openRange();
    expect(range.querySelector('input[type="date"]')).toBeNull();
    expect(from.type).toBe('text');
    expect(from.placeholder).toBe('MM/DD/YYYY');
    expect(screen.getByLabelText('From')).toBe(from);
    expect(screen.getByLabelText('To')).toBe(to);
  });

  it('(a) zh session: the console-locale placeholder, and the bound labels from the zh pack', async () => {
    mount(RANGE, 'zh');
    const { from, to } = await openRange();
    expect(from.placeholder).toBe('YYYY/MM/DD');
    expect(to.placeholder).toBe('YYYY/MM/DD');
    expect(screen.getByLabelText('起始值')).toBe(from);
    expect(screen.getByLabelText('结束值')).toBe(to);
    expect(screen.queryByText('From')).toBeNull();
    expect(screen.queryByText('To')).toBeNull();
  });

  it('(b) a typed From applies on Enter, a typed To on blur, with YYYY-MM-DD bounds', async () => {
    const { onFilterChange } = mount(RANGE);
    const { from, to } = await openRange();
    typeInto(from, '10/01/2026');
    expect(onFilterChange).not.toHaveBeenCalled();
    fireEvent.keyDown(from, { key: 'Enter' });
    expect(onFilterChange).toHaveBeenLastCalledWith([['due_date', '>=', '2026-10-01']]);

    typeInto(to, '10/31/2026');
    fireEvent.blur(to);
    expect(onFilterChange).toHaveBeenLastCalledWith([
      ['due_date', '>=', '2026-10-01'],
      ['due_date', '<=', '2026-10-31'],
    ]);
  });

  it('(b) zh session: a day typed in the console format applies as YYYY-MM-DD', async () => {
    const { onFilterChange } = mount(RANGE, 'zh');
    const { to } = await openRange();
    typeInto(to, '2026/10/31');
    fireEvent.keyDown(to, { key: 'Enter' });
    expect(onFilterChange).toHaveBeenLastCalledWith([['due_date', '<=', '2026-10-31']]);
  });

  it('(b) a typed bound + a press outside: the chip closes and the day is applied', async () => {
    const { onFilterChange } = mount(RANGE);
    const { from } = await openRange();
    typeInto(from, '10/20/2026');
    // `fireEvent` moves no focus, so only the bound's capture listener (the
    // pointerdown blur) can have read the typed text before Radix dismisses
    // the popover on the click that follows.
    const outside = screen.getByTestId('outside');
    fireEvent.pointerDown(outside);
    fireEvent.click(outside);
    await waitFor(() => expect(screen.queryByTestId('filter-range-due_date')).toBeNull());
    expect(onFilterChange).toHaveBeenLastCalledWith([['due_date', '>=', '2026-10-20']]);
  });

  it('(b) clearing the only set bound writes no condition', async () => {
    const { onFilterChange } = mount(RANGE);
    const { range, from } = await openRange();
    typeInto(from, '10/20/2026');
    fireEvent.keyDown(from, { key: 'Enter' });
    expect(onFilterChange).toHaveBeenLastCalledWith([['due_date', '>=', '2026-10-20']]);
    fireEvent.click(within(range).getByTestId('date-picker-clear'));
    expect(onFilterChange).toHaveBeenLastCalledWith([]);
  });

  it('(c) CONTROL: select, multi-select and text chips draw what they drew before', async () => {
    mount([
      { field: 'status', type: 'select' },
      { field: 'name', type: 'text' },
    ]);
    fireEvent.click(screen.getByTestId('filter-badge-status'));
    const options = await screen.findByTestId('filter-options-status');
    expect(options.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(options.querySelector('[data-slot="date-picker"]')).toBeNull();
    fireEvent.click(screen.getByTestId('filter-badge-name'));
    expect(await screen.findByTestId('filter-text-name')).toHaveAttribute('type', 'search');
  });

  it('(c) CONTROL: a multi-select chip keeps its checkboxes', async () => {
    mount([{ field: 'status', type: 'multi-select' }]);
    fireEvent.click(screen.getByTestId('filter-badge-status'));
    const options = await screen.findByTestId('filter-options-status');
    expect(options.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });
});
