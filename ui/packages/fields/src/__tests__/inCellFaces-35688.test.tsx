/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35688 (slice S2) — the faces the option, tags, date, time and
 * colour widgets draw in the list grid's cell editor (`inCell`), and the
 * `onCommit` call that ends an edit on a pick. Without `inCell` each widget
 * keeps its form face.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SelectField } from '../widgets/SelectField';
import { MultiSelectField } from '../widgets/MultiSelectField';
import { TagsField } from '../widgets/TagsField';
import { ColorField } from '../widgets/ColorField';
import { TimeField } from '../widgets/TimeField';
import { DatePickerField, DateTimePickerField } from '../widgets/date-picker/DatePickerField';
import { FieldEditWidget } from '../FieldEditWidget';

afterEach(() => cleanup());

type Field = React.ComponentProps<typeof SelectField>['field'];

const SELECT = {
  name: 'stage',
  type: 'select',
  options: [
    { value: 'new', label: 'New' },
    { value: 'qualified', label: 'Qualified' },
    { value: 'won', label: 'Closed won' },
    { value: 'lost', label: 'Closed lost' },
  ],
} as unknown as Field;

/** The grid's editor wrapper, reduced to the one fact these tests need: did Enter reach it? */
function GridEditor({ onGridKey, children }: { onGridKey: (key: string) => void; children: React.ReactNode }) {
  return <div onKeyDown={(e) => onGridKey(e.key)}>{children}</div>;
}

const optionRows = () => screen.getAllByRole('option');

describe('in-cell single select (objectstack#35688)', () => {
  it('shows the searchable list at once, no trigger to press', () => {
    render(<SelectField field={SELECT} value="qualified" onChange={() => {}} inCell />);
    expect(screen.queryByTestId('select-trigger-stage')).toBeNull();
    const box = screen.getByRole('combobox');
    expect(box.tagName).toBe('INPUT');
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(optionRows().map((o) => o.textContent)).toEqual(['New', 'Qualified', 'Closed won', 'Closed lost']);
    // The current value is checked and active.
    const current = screen.getByTestId('in-cell-option-qualified');
    expect(current.getAttribute('aria-selected')).toBe('true');
    expect(box.getAttribute('aria-activedescendant')).toBe(current.id);
  });

  it('typing filters; Enter picks the first match and does not reach the grid', () => {
    const onChange = vi.fn();
    const onGridKey = vi.fn();
    render(
      <GridEditor onGridKey={onGridKey}>
        <SelectField field={SELECT} value="new" onChange={onChange} inCell />
      </GridEditor>,
    );
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 'closed' } });
    expect(optionRows().map((o) => o.textContent)).toEqual(['Closed won', 'Closed lost']);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('lost');
    expect(onGridKey).not.toHaveBeenCalledWith('ArrowDown');
    expect(onGridKey).not.toHaveBeenCalledWith('Enter');
  });

  it('a click picks; no match says so; Escape goes on to the grid', () => {
    const onChange = vi.fn();
    const onGridKey = vi.fn();
    render(
      <GridEditor onGridKey={onGridKey}>
        <SelectField field={SELECT} value="" onChange={onChange} inCell />
      </GridEditor>,
    );
    fireEvent.click(screen.getByTestId('in-cell-option-won'));
    expect(onChange).toHaveBeenCalledWith('won');
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No matching options')).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(onGridKey).toHaveBeenCalledWith('Escape');
  });

  it('clearing the search puts the active row back on the current value, not on its filtered index', () => {
    const onChange = vi.fn();
    render(<SelectField field={SELECT} value="lost" onChange={onChange} inCell />);
    const box = screen.getByRole('combobox');
    const current = screen.getByTestId('in-cell-option-lost');
    expect(box.getAttribute('aria-activedescendant')).toBe(current.id);
    // "lost" is row 1 of the filtered list and row 3 of the full one.
    fireEvent.change(box, { target: { value: 'closed' } });
    fireEvent.change(box, { target: { value: '' } });
    expect(box.getAttribute('aria-activedescendant')).toBe(screen.getByTestId('in-cell-option-lost').id);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('lost');
  });

  it('with nothing active, Enter goes on to the grid (it commits and moves)', () => {
    const onChange = vi.fn();
    const onGridKey = vi.fn();
    render(
      <GridEditor onGridKey={onGridKey}>
        <SelectField field={SELECT} value="" onChange={onChange} inCell />
      </GridEditor>,
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(onGridKey).toHaveBeenCalledWith('Enter');
  });

  it('CONTROL: without inCell the form face (the Radix trigger) is unchanged', () => {
    render(<SelectField field={SELECT} value="new" onChange={() => {}} />);
    expect(screen.getByTestId('select-trigger-stage')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('in-cell multi-select and tags (objectstack#35688)', () => {
  it('multi-select: a searchable check list; a pick toggles and stages', () => {
    const onChange = vi.fn();
    render(<MultiSelectField field={{ ...SELECT, type: 'multiselect' } as unknown as Field} value={['new']} onChange={onChange} inCell />);
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
    fireEvent.click(screen.getByTestId('in-cell-option-won'));
    expect(onChange).toHaveBeenLastCalledWith(['new', 'won']);
    fireEvent.click(screen.getByTestId('in-cell-option-new'));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('a select declared multiple takes the same face', () => {
    render(<SelectField field={{ ...SELECT, multiple: true } as unknown as Field} value={[]} onChange={() => {}} inCell />);
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
  });

  it('tags: typed text leads with an Add row, and Enter adds it', () => {
    const onChange = vi.fn();
    const onGridKey = vi.fn();
    render(
      <GridEditor onGridKey={onGridKey}>
        <TagsField field={{ name: 'labels', type: 'tags' } as unknown as Field} value={['urgent', 'vip-customer']} onChange={onChange} inCell />
      </GridEditor>,
    );
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 'vip' } });
    const rows = optionRows();
    expect(rows[0].getAttribute('data-testid')).toBe('in-cell-option-add');
    expect(rows[0].textContent).toBe('Add "vip"');
    expect(rows[1].textContent).toBe('vip-customer');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['urgent', 'vip-customer', 'vip']);
    expect(onGridKey).not.toHaveBeenCalledWith('Enter');
  });

  it('tags: unchecking removes a tag and keeps its row on offer', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TagsField field={{ name: 'labels', type: 'tags' } as unknown as Field} value={['a', 'b']} onChange={onChange} inCell />,
    );
    fireEvent.click(screen.getByTestId('in-cell-option-a'));
    expect(onChange).toHaveBeenLastCalledWith(['b']);
    rerender(<TagsField field={{ name: 'labels', type: 'tags' } as unknown as Field} value={['b']} onChange={onChange} inCell />);
    const a = screen.getByTestId('in-cell-option-a');
    expect(a.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(a);
    expect(onChange).toHaveBeenLastCalledWith(['b', 'a']);
  });
});

describe('in-cell date (objectstack#35688)', () => {
  const FIELD = { name: 'close_date', type: 'date' } as unknown as Field;
  const localDay = (offset: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('the calendar shows at once, the value stays in the text box, and the box keeps the focus', () => {
    const { container } = render(<DatePickerField field={FIELD} value="2026-10-16" onChange={() => {}} inCell />);
    const input = container.querySelector('[data-slot="date-picker"] input') as HTMLInputElement;
    expect(input.value).toBe('10/16/2026');
    expect(screen.getByRole('grid')).toBeTruthy();
    input.focus();
    expect(document.activeElement).toBe(input);
    for (const label of ['Today', 'Tomorrow', 'Next week', 'Clear']) expect(screen.getByRole('button', { name: label })).toBeTruthy();
  });

  it('「下周」 is seven days from today, and the pick ends the edit', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<DatePickerField field={FIELD} value="" onChange={onChange} inCell onCommit={onCommit} />);
    fireEvent.click(screen.getByTestId('date-picker-next-week'));
    expect(onChange).toHaveBeenCalledWith(localDay(7));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onChange.mock.invocationCallOrder[0]).toBeLessThan(onCommit.mock.invocationCallOrder[0]);
  });

  it('a day in the calendar and the clear pick end the edit too', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<DatePickerField field={FIELD} value="2026-10-16" onChange={onChange} inCell onCommit={onCommit} />);
    fireEvent.click(within(screen.getByRole('grid')).getByText('20'));
    expect(onChange).toHaveBeenLastCalledWith('2026-10-20');
    expect(onCommit).toHaveBeenCalledTimes(1);
    cleanup();
    render(<DatePickerField field={FIELD} value="2026-10-16" onChange={onChange} inCell onCommit={onCommit} />);
    fireEvent.click(screen.getByTestId('date-picker-clear-pick'));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('datetime: a day pick stays open for the time and does not end the edit', () => {
    const onCommit = vi.fn();
    render(
      <DateTimePickerField field={{ name: 'at', type: 'datetime' } as unknown as Field} value="" onChange={() => {}} inCell onCommit={onCommit} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tomorrow' }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('date-picker-time')).toBeTruthy();
  });

  it('CONTROL: the form face opens closed and offers only today and tomorrow', () => {
    render(<DatePickerField field={FIELD} value="" onChange={() => {}} />);
    expect(screen.queryByRole('grid')).toBeNull();
    fireEvent.click(screen.getByTestId('date-picker-trigger'));
    expect(screen.queryByTestId('date-picker-next-week')).toBeNull();
    expect(screen.queryByTestId('date-picker-clear-pick')).toBeNull();
  });
});

describe('in-cell time and colour (objectstack#35688)', () => {
  it('time: the browser picker shows on the first focus only', () => {
    const showPicker = vi.fn();
    const { container } = render(<TimeField field={{ name: 't', type: 'time' } as unknown as Field} value="09:30" onChange={() => {}} inCell />);
    const input = container.querySelector('input[type="time"]') as HTMLInputElement & { showPicker?: () => void };
    input.showPicker = showPicker;
    fireEvent.focus(input);
    fireEvent.blur(input);
    fireEvent.focus(input);
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('09:30');
  });

  it('colour: the hex box comes first; a swatch picks and ends the edit', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { container } = render(
      <ColorField field={{ name: 'c', type: 'color' } as unknown as Field} value="#3b82f6" onChange={onChange} inCell onCommit={onCommit} />,
    );
    const first = container.querySelector('input,button') as HTMLInputElement;
    expect(first.type).toBe('text');
    expect(first.value).toBe('#3b82f6');
    expect(screen.getByTestId('color-swatch-3b82f6').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('color-swatch-ef4444'));
    expect(onChange).toHaveBeenCalledWith('#ef4444');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

describe('FieldEditWidget hands the cell face on (objectstack#35688)', () => {
  it('forwards inCell and onCommit to the widget', () => {
    const onCommit = vi.fn();
    const element = FieldEditWidget({ field: { name: 'c', type: 'color' } as unknown as Field, value: '', onChange: () => {}, inCell: true, onCommit });
    const forwarded = element!.props as Record<string, unknown>;
    expect(forwarded.inCell).toBe(true);
    expect(forwarded.onCommit).toBe(onCommit);
  });
});
