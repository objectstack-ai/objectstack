/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12743 — the seam: a `date` / `datetime` filter row draws the field
 * widget the HOST registered as `field:date` / `field:datetime`.
 *
 * `packages/components` does not depend on `@object-ui/fields` (that package
 * depends on this one), so the widget here is a stand-in with the platform
 * picker's commit behaviour: it reads its text on blur and on Enter, never per
 * keystroke, and its `datetime` face writes an ISO instant, as a field's
 * stored shape is. The real picker, through the console's list toolbar, is
 * pinned in `plugin-list` (`ListView.filterDatePicker-12743.test.tsx`).
 *
 * What is pinned:
 * - with the widget registered, a date row (scalar and both `between` bounds)
 *   draws it, and no `input[type=date]`;
 * - the row's value keeps its shape: `YYYY-MM-DD` for date, the zoneless
 *   local `YYYY-MM-DDTHH:mm` for datetime (what `datetime-local` wrote);
 * - a typed day reaches the row on blur, on Enter, and on a pointer press
 *   outside the row while the box holds focus (the press blurs it first, so a
 *   popover that closes on that press cannot drop the text);
 * - CONTROL: a text and a number row draw what they drew before, and with
 *   nothing registered a date row keeps the native input.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';

import { FilterBuilder, type FilterBuilderRowGroup } from '../custom/filter-builder';

/** Commit-on-blur stand-in for the platform picker. */
function makeStandIn(withTime: boolean) {
  const StandIn = ({ id, value, onChange }: { id?: string; value?: string; onChange: (next: string) => void }) => {
    const [text, setText] = React.useState(value ?? '');
    const commit = () => {
      if (text === (value ?? '')) return;
      onChange(withTime && text ? new Date(text).toISOString() : text);
    };
    return (
      <input
        id={id}
        type="text"
        data-testid="stand-in-picker"
        placeholder="YYYY/MM/DD"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    );
  };
  return StandIn;
}

function registerStandIns() {
  ComponentRegistry.register('date', makeStandIn(false), { namespace: 'field' });
  ComponentRegistry.register('datetime', makeStandIn(true), { namespace: 'field' });
}

afterEach(() => {
  cleanup();
  ComponentRegistry.unregister('date', 'field');
  ComponentRegistry.unregister('datetime', 'field');
});

const FIELDS = [
  { value: 'due', label: 'Due', type: 'date' },
  { value: 'remind_at', label: 'Remind at', type: 'datetime' },
  { value: 'name', label: 'Name', type: 'text' },
  { value: 'amount', label: 'Amount', type: 'number' },
];

function group(field: string, operator: string, value: unknown): FilterBuilderRowGroup {
  return { id: 'root', logic: 'and', conditions: [{ id: 'c1', field, operator, value }] } as FilterBuilderRowGroup;
}

function mount(value: FilterBuilderRowGroup) {
  const onChange = vi.fn();
  const utils = render(
    <div>
      <button type="button" data-testid="outside">outside</button>
      <FilterBuilder fields={FIELDS} value={value} onChange={onChange} />
    </div>,
  );
  return { ...utils, onChange };
}

/** The value the last emitted group carries on its one row. */
const lastValue = (onChange: ReturnType<typeof vi.fn>) =>
  (onChange.mock.calls.at(-1)?.[0] as FilterBuilderRowGroup).conditions[0].value;

/** The registered widget arrives through the editor's own `Suspense`. */
const findPickers = () => screen.findAllByTestId('stand-in-picker');

function typeInto(input: HTMLElement, text: string) {
  input.focus();
  fireEvent.change(input, { target: { value: text } });
}

describe('FilterBuilder date rows draw the host-registered date widget (objectui#12743)', () => {
  it('a date row draws the registered widget, not input[type=date]', async () => {
    registerStandIns();
    const { container } = mount(group('due', 'equals', '2026-10-01'));
    const [picker] = await findPickers();
    expect((picker as HTMLInputElement).value).toBe('2026-10-01');
    expect(container.querySelector('input[type="date"]')).toBeNull();
    // Its accessible name rides on the editor's hidden label.
    expect(screen.getByLabelText('Value')).toBe(picker);
  });

  it('typed day + blur writes YYYY-MM-DD', async () => {
    registerStandIns();
    const { onChange } = mount(group('due', 'equals', ''));
    const [picker] = await findPickers();
    typeInto(picker, '2026-10-20');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(picker);
    expect(lastValue(onChange)).toBe('2026-10-20');
  });

  it('typed day + Enter writes YYYY-MM-DD', async () => {
    registerStandIns();
    const { onChange } = mount(group('due', 'equals', ''));
    const [picker] = await findPickers();
    typeInto(picker, '2026-10-20');
    fireEvent.keyDown(picker, { key: 'Enter' });
    expect(lastValue(onChange)).toBe('2026-10-20');
  });

  it('typed day + a pointer press outside: the press blurs the box first, so the day is written', async () => {
    registerStandIns();
    const { onChange } = mount(group('due', 'equals', ''));
    const [picker] = await findPickers();
    typeInto(picker, '2026-10-20');
    // `fireEvent.pointerDown` moves no focus; only the editor's capture
    // listener can have blurred the box.
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(picker).not.toHaveFocus();
    expect(lastValue(onChange)).toBe('2026-10-20');
  });

  it('a pointer press INSIDE the editor does not blur it', async () => {
    registerStandIns();
    const { onChange } = mount(group('due', 'equals', ''));
    const [picker] = await findPickers();
    typeInto(picker, '2026-10-20');
    fireEvent.pointerDown(picker);
    expect(picker).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Escape discards: nothing is written, also after a later outside press', async () => {
    registerStandIns();
    const { onChange } = mount(group('due', 'equals', ''));
    const [picker] = await findPickers();
    typeInto(picker, '2026-10-20');
    fireEvent.keyDown(picker, { key: 'Escape' });
    // The host closes on Escape and the row unmounts with the text unread.
    cleanup();
    fireEvent.pointerDown(document.body);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a datetime row keeps the zoneless local shape datetime-local wrote', async () => {
    registerStandIns();
    const { onChange } = mount(group('remind_at', 'equals', '2026-10-01T09:15'));
    const [picker] = await findPickers();
    expect((picker as HTMLInputElement).value).toBe('2026-10-01T09:15');
    // The stand-in writes the ISO instant of this local wall clock.
    typeInto(picker, '2026-10-20T14:30');
    fireEvent.blur(picker);
    expect(lastValue(onChange)).toBe('2026-10-20T14:30');
  });

  it('`between` on a date column draws the widget for BOTH bounds, each named', async () => {
    registerStandIns();
    const { container, onChange } = mount(group('due', 'between', []));
    const pickers = await findPickers();
    expect(pickers).toHaveLength(2);
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(screen.getByLabelText('From')).toBe(pickers[0]);
    expect(screen.getByLabelText('To')).toBe(pickers[1]);
    typeInto(pickers[0], '2026-10-01');
    fireEvent.blur(pickers[0]);
    expect(lastValue(onChange)).toEqual(['2026-10-01', '']);
  });

  it('CONTROL: text and number rows draw what they drew before', async () => {
    registerStandIns();
    const text = mount(group('name', 'equals', 'acme'));
    expect(text.container.querySelector('input[type="text"]')).toHaveValue('acme');
    expect(screen.queryByTestId('stand-in-picker')).toBeNull();
    cleanup();
    const number = mount(group('amount', 'equals', 5));
    expect(number.container.querySelector('input[type="number"]')).toHaveValue(5);
    expect(screen.queryByTestId('stand-in-picker')).toBeNull();
  });

  it('CONTROL: with nothing registered, a date row keeps the native input', () => {
    const { container } = mount(group('due', 'equals', '2026-10-01'));
    expect(container.querySelector('input[type="date"]')).toHaveValue('2026-10-01');
    expect(screen.queryByTestId('stand-in-picker')).toBeNull();
  });
});
