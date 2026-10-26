/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12743 — `filter-ui`'s `date` and `date-range` filters draw the
 * field widget the HOST registered as `field:date`.
 *
 * `plugin-view` does not depend on `@object-ui/fields`, so the widget here is
 * a stand-in with the platform picker's commit behaviour: it reads its text
 * on blur and on Enter, never per keystroke. The real picker is pinned
 * through the console's list toolbar in `plugin-list`
 * (`ListView.filterDatePicker-12743.test.tsx`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';

import { FilterUI } from '../FilterUI';

function StandIn({ id, value, onChange }: { id?: string; value?: string; onChange: (next: string) => void }) {
  const [text, setText] = React.useState(value ?? '');
  const commit = () => {
    if (text !== (value ?? '')) onChange(text);
  };
  return (
    <input
      id={id}
      type="text"
      data-testid="stand-in-picker"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

afterEach(() => {
  cleanup();
  ComponentRegistry.unregister('date', 'field');
});

const SCHEMA = {
  type: 'filter-ui' as const,
  filters: [
    { field: 'due', label: 'Due', type: 'date' as const },
    { field: 'period', label: 'Period', type: 'date-range' as const },
    { field: 'name', label: 'Name', type: 'text' as const },
  ],
};

function mount() {
  const onChange = vi.fn();
  const utils = render(
    <div>
      <button type="button" data-testid="outside">outside</button>
      <FilterUI schema={SCHEMA} onChange={onChange} />
    </div>,
  );
  return { ...utils, onChange };
}

function typeInto(input: HTMLElement, text: string) {
  input.focus();
  fireEvent.change(input, { target: { value: text } });
}

describe('FilterUI date filters draw the host-registered date widget (objectui#12743)', () => {
  it('date and date-range draw the registered widget, not input[type=date]', async () => {
    ComponentRegistry.register('date', StandIn, { namespace: 'field' });
    const { container } = mount();
    const pickers = await screen.findAllByTestId('stand-in-picker');
    expect(pickers).toHaveLength(3);
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(screen.getByLabelText('Due')).toBe(pickers[0]);
  });

  it('typed day + blur, and typed day + a pointer press outside, write YYYY-MM-DD', async () => {
    ComponentRegistry.register('date', StandIn, { namespace: 'field' });
    const { onChange } = mount();
    const [due, start] = await screen.findAllByTestId('stand-in-picker');
    typeInto(due, '2026-10-20');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(due);
    expect(onChange).toHaveBeenLastCalledWith({ due: '2026-10-20' });

    typeInto(start, '2026-10-01');
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(start).not.toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith({ due: '2026-10-20', period: { start: '2026-10-01', end: '' } });
  });

  it('CONTROL: the text filter is unchanged, and with nothing registered date keeps the native input', () => {
    const { container } = mount();
    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(3);
    expect(screen.getByPlaceholderText('Filter by Name')).toBeInTheDocument();
    expect(screen.queryByTestId('stand-in-picker')).toBeNull();
  });
});
