/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InlineFieldInput } from '../InlineFieldInput';

/**
 * `<InlineFieldInput>` is the edit-input branch extracted verbatim from
 * `DetailSection` (objectui#2407, step 0) so the details body and the highlights
 * strip render an identical editor. These tests pin the parity contract the
 * extraction must preserve: type-aware widget routing, `$expand`-ed reference
 * safety, ISO date coercion, object-value guarding, and auto-focus.
 *
 * Assertions are provider-free (matching the existing DetailSection inline-edit
 * suites) so they hold whether or not i18n / permission providers are mounted.
 */
describe('InlineFieldInput', () => {
  it('renders an editable text input and emits typed values via onChange', () => {
    const onChange = vi.fn();
    render(
      <InlineFieldInput
        field={{ name: 'title', type: 'text' }}
        value="Hello"
        onChange={onChange}
      />,
    );
    const input = screen.getByDisplayValue('Hello');
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Hi there' } });
    expect(onChange).toHaveBeenCalledWith('Hi there');
  });

  it('never leaks "[object Object]" for an $expand-ed reference value', () => {
    render(
      <InlineFieldInput
        field={{ name: 'project', type: 'master_detail', reference: 'projects' }}
        value={{ _id: 'p1', name: 'Apollo' }}
        onChange={vi.fn()}
      />,
    );
    // The reference renders the lookup picker (not a raw text input), so the
    // stringified object must never surface anywhere.
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
    expect(screen.queryByDisplayValue(/\[object Object\]/)).toBeNull();
  });

  it('never leaks "[object Object]" for an object value on a plain field', () => {
    render(
      <InlineFieldInput
        field={{ name: 'meta', type: 'text' }}
        value={{ foo: 'bar' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByDisplayValue(/\[object Object\]/)).toBeNull();
  });

  /** The platform date picker's text box (lazy, objectui#12759). */
  const pickerBox = (container: HTMLElement) =>
    waitFor(() => {
      const el = container.querySelector('[data-slot="date-picker"] input');
      if (!el) throw new Error('date picker not rendered');
      return el as HTMLInputElement;
    });

  it('reads an ISO timestamp as its day for a `date` field and writes the entered day back unchanged (objectui#12206)', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <InlineFieldInput
        field={{ name: 'due', type: 'date' }}
        value="2026-02-14T14:46:20.862Z"
        onChange={onChange}
      />,
    );
    const input = await pickerBox(container);
    expect(input.value).toBe('02/14/2026');
    fireEvent.change(input, { target: { value: '03/01/2026' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    // The plain day, as the Edit form writes it — never local midnight as an
    // instant, which names the day before east of UTC. The zone cases are in
    // `InlineFieldInput.dateOnlyWriteZone-12206.test.tsx`.
    expect(onChange).toHaveBeenCalledWith('2026-03-01');
  });

  it('writes a `datetime` field as the ISO instant of the entered date AND time, not local midnight (objectui#12759)', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <InlineFieldInput
        field={{ name: 'due_at', type: 'datetime' }}
        value="2026-02-14T14:46:20.862Z"
        onChange={onChange}
      />,
    );
    const input = await pickerBox(container);
    fireEvent.change(input, { target: { value: '03/01/2026 14:46' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    // The suite runs in UTC (`vitest.config.mts`); the zone cases are in
    // `InlineFieldInput.datetimePicker-12759.test.tsx`.
    expect(onChange).toHaveBeenCalledWith('2026-03-01T14:46:00.000Z');
  });

  it('passes an $expand-ed reference value through so the picker shows the name without re-fetching (objectui#2572)', async () => {
    const findOne = vi.fn();
    const find = vi.fn().mockResolvedValue({ data: [], total: 0 });
    render(
      <InlineFieldInput
        field={{ name: 'account', type: 'lookup', reference: 'accounts' }}
        value={{ id: 'a1', name: 'Northwind Traders' }}
        onChange={vi.fn()}
        dataSource={{ find, findOne }}
      />,
    );
    // The expanded record already carries its display name — the chip must
    // render it synchronously, with NO hydration fetch for the id.
    expect(await screen.findByText('Northwind Traders')).toBeInTheDocument();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('renders currency as a numeric input honoring the metadata min (objectui#2572)', () => {
    const onChange = vi.fn();
    render(
      <InlineFieldInput
        field={{ name: 'budget', type: 'currency', min: 0 }}
        value={5000}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('min', '0');
    fireEvent.change(input, { target: { value: '6000' } });
    // Numeric widgets emit real numbers (not free-typed strings).
    expect(onChange).toHaveBeenCalledWith(6000);
  });

  it('renders number as a numeric input emitting numbers, honoring scale', () => {
    const onChange = vi.fn();
    render(
      <InlineFieldInput
        field={{ name: 'headcount', type: 'number', scale: 0 }}
        value={12}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole('spinbutton');
    // `scale: 0` must step by 1 (whole numbers), not fall back to "any".
    expect(input).toHaveAttribute('step', '1');
    fireEvent.change(input, { target: { value: '15' } });
    expect(onChange).toHaveBeenCalledWith(15);
  });

  it('renders percent with the display conversion (stored fraction ↔ shown %)', () => {
    const onChange = vi.fn();
    render(
      <InlineFieldInput
        field={{ name: 'completion', type: 'percent' }}
        value={0.5}
        onChange={onChange}
      />,
    );
    // Stored 0.5 renders as "50" (%); typing 75 stores 0.75.
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveValue(50);
    fireEvent.change(input, { target: { value: '75' } });
    expect(onChange).toHaveBeenCalledWith(0.75);
  });

  it('auto-focuses the input when autoFocus is set', () => {
    render(
      <InlineFieldInput
        field={{ name: 'title', type: 'text' }}
        value="Hello"
        onChange={vi.fn()}
        autoFocus
      />,
    );
    expect(screen.getByDisplayValue('Hello')).toHaveFocus();
  });
});
