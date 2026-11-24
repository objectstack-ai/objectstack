/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35688 (slices S2 and S3) — the faces the widgets draw in the
 * list grid's cell editor (`inCell`), and the `onCommit` call that ends an
 * edit on a pick: options, tags, dates, time and colour (S2); the typed
 * inputs, rating and record pickers (S3, with objectstack#36023's flat typed
 * input). Without `inCell` each widget keeps its form face.
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
import { FieldEditWidget, hasFieldEditWidget, hasInCellPanelEditWidget, isInlineExcludedFieldType } from '../FieldEditWidget';
// The rich-content panel's widget sits behind `React.lazy` in `FieldEditWidget`;
// imported here so its factory resolves at once (ui/AGENTS.md, flaky tests).
import '../widgets/RichTextField';
import { TextField } from '../widgets/TextField';
import { EmailField } from '../widgets/EmailField';
import { PhoneField } from '../widgets/PhoneField';
import { UrlField } from '../widgets/UrlField';
import { NumberField } from '../widgets/NumberField';
import { CurrencyField } from '../widgets/CurrencyField';
import { PercentField } from '../widgets/PercentField';
import { RatingField } from '../widgets/RatingField';
import { LookupField } from '../widgets/LookupField';

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

/** The typed-input face: one flat input, marked for the layer, inside a marked box. */
function inCellInput(container: HTMLElement): HTMLInputElement {
  const face = container.querySelector('[data-in-cell-face="input"]');
  expect(face).not.toBeNull();
  const input = face!.querySelector('input[data-in-cell-input]') as HTMLInputElement | null;
  expect(input).not.toBeNull();
  // No border, radius or fill of its own: the layer's frame is the only line.
  expect(input!.className).toContain('border-0');
  expect(input!.className).toContain('bg-transparent');
  expect(input!.className).not.toContain('rounded-md');
  return input!;
}

describe('in-cell typed inputs are the cell itself (objectstack#36023)', () => {
  it('text: a flat input whose sizing copy follows the text, so the layer grows to the right', () => {
    const onChange = vi.fn();
    const { container } = render(<TextField field={{ name: 'name', type: 'text' } as never} value="Acme" onChange={onChange} inCell />);
    const input = inCellInput(container);
    expect(input.type).toBe('text');
    expect(input.value).toBe('Acme');
    const sizer = input.previousElementSibling as HTMLElement;
    expect(sizer.getAttribute('aria-hidden')).toBe('true');
    expect(sizer.textContent).toBe('Acme');
    fireEvent.change(input, { target: { value: 'Acme Corporation International' } });
    expect(onChange).toHaveBeenCalledWith('Acme Corporation International');
  });

  it('email, phone and url take the same face with their input types', () => {
    const cases: Array<[React.ReactElement, string]> = [
      [<EmailField field={{ name: 'e', type: 'email' } as never} value="a@b.co" onChange={() => {}} inCell />, 'email'],
      [<PhoneField field={{ name: 'p', type: 'phone' } as never} value="+1 555" onChange={() => {}} inCell />, 'tel'],
      [<UrlField field={{ name: 'u', type: 'url' } as never} value="https://example.com/a/long/path" onChange={() => {}} inCell />, 'url'],
    ];
    for (const [element, type] of cases) {
      const { container, unmount } = render(element);
      expect(inCellInput(container).type).toBe(type);
      unmount();
    }
  });

  it('number: the raw number, right-aligned', () => {
    const onChange = vi.fn();
    const { container } = render(<NumberField field={{ name: 'qty', type: 'number' } as never} value={1234.5} onChange={onChange} inCell />);
    const input = inCellInput(container);
    expect(input.type).toBe('number');
    expect(input.value).toBe('1234.5');
    expect(input.className).toContain('text-right');
    fireEvent.change(input, { target: { value: '12' } });
    expect(onChange).toHaveBeenCalledWith(12);
  });

  it('currency: the currency code, then the raw amount right-aligned (34,500.50 shows whole)', () => {
    const { container } = render(
      <CurrencyField field={{ name: 'amount', type: 'currency', currency: 'USD' } as never} value={34500.5} onChange={() => {}} inCell />,
    );
    const input = inCellInput(container);
    expect(input.value).toBe('34500.5');
    expect(input.className).toContain('text-right');
    expect(container.querySelector('[data-in-cell-face="input"]')!.textContent).toContain('USD');
  });

  it('percent: the points without a slider, and no binary noise from the fraction', () => {
    const { container } = render(<PercentField field={{ name: 'rate', type: 'percent' } as never} value={0.07} onChange={() => {}} inCell />);
    const input = inCellInput(container);
    expect(input.value).toBe('7');
    expect(screen.queryByTestId('percent-slider')).toBeNull();
    expect(container.textContent).toContain('%');
  });

  it('CONTROL: without inCell the text, number and percent widgets keep their form faces', () => {
    const { container } = render(
      <>
        <TextField field={{ name: 'name', type: 'text' } as never} value="Acme" onChange={() => {}} />
        <NumberField field={{ name: 'qty', type: 'number' } as never} value={3} onChange={() => {}} />
        <PercentField field={{ name: 'rate', type: 'percent' } as never} value={0.07} onChange={() => {}} />
      </>,
    );
    expect(container.querySelector('[data-in-cell-face]')).toBeNull();
    expect(screen.getByTestId('percent-slider')).toBeTruthy();
  });
});

describe('in-cell rating (objectstack#35688)', () => {
  it('draws the stars at the cell size and no "n / max" caption; a click picks', () => {
    const onChange = vi.fn();
    const { container } = render(<RatingField field={{ name: 'score', type: 'rating' } as never} value={2} onChange={onChange} inCell />);
    expect(container.textContent).not.toContain('2 / 5');
    const stars = container.querySelectorAll('button');
    expect(stars).toHaveLength(5);
    expect(stars[0].querySelector('svg')!.getAttribute('class')).toContain('w-3.5');
    fireEvent.click(stars[3]);
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('CONTROL: the form face keeps its caption', () => {
    const { container } = render(<RatingField field={{ name: 'score', type: 'rating' } as never} value={2} onChange={() => {}} />);
    expect(container.textContent).toContain('2 / 5');
  });
});

const PRIORITY = {
  type: 'lookup',
  name: 'priority',
  label: 'Priority',
  reference: 'priorities',
  options: [
    { label: 'High', value: 'high' },
    { label: 'Normal', value: 'normal' },
  ],
} as never;

describe('in-cell record picker (objectstack#35688)', () => {
  it('shows the searchable candidate list at once, no trigger to press; a click picks and ends the edit', () => {
    const calls: string[] = [];
    render(
      <LookupField
        field={PRIORITY}
        value={undefined}
        onChange={(v: unknown) => calls.push(`change:${String(v)}`)}
        onCommit={() => calls.push('commit')}
        inCell
      />,
    );
    expect(screen.queryByRole('button', { name: /select/i })).toBeNull();
    const panel = screen.getByTestId('lookup-in-cell');
    expect(within(panel).getByRole('listbox')).toBeTruthy();
    fireEvent.click(within(panel).getByText('Normal'));
    // The value is handed over first, then the edit ends.
    expect(calls).toEqual(['change:normal', 'commit']);
  });

  it('Enter on the active candidate picks it and does not reach the grid', () => {
    const onGridKey = vi.fn();
    const onChange = vi.fn();
    render(
      <GridEditor onGridKey={onGridKey}>
        <LookupField field={PRIORITY} value={undefined} onChange={onChange} onCommit={() => {}} inCell />
      </GridEditor>,
    );
    const box = screen.getByRole('combobox');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('high');
    expect(onGridKey).not.toHaveBeenCalledWith('Enter');
  });

  it('Clear is offered while the cell holds a value, and clearing ends the edit', () => {
    const calls: string[] = [];
    render(
      <LookupField
        field={PRIORITY}
        value="high"
        onChange={(v: unknown) => calls.push(`change:${String(v)}`)}
        onCommit={() => calls.push('commit')}
        inCell
      />,
    );
    fireEvent.click(screen.getByTestId('lookup-in-cell-clear'));
    expect(calls).toEqual(['change:null', 'commit']);
  });

  it('CONTROL: without inCell the trigger stays and the list is closed', () => {
    render(<LookupField field={PRIORITY} value={undefined} onChange={() => {}} />);
    expect(screen.queryByTestId('lookup-in-cell')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('in-cell rich-content panel (objectstack#36023)', () => {
  it('markdown, html and rich text get the text box only when the cell face is asked for', () => {
    for (const type of ['markdown', 'html', 'richtext']) {
      expect(hasInCellPanelEditWidget(type), type).toBe(true);
      // Every other host keeps them out, exactly as before.
      expect(hasFieldEditWidget(type), type).toBe(false);
      expect(isInlineExcludedFieldType(type), type).toBe(true);
    }
    // CONTROL: no other type, excluded or in-place, is a panel text box.
    for (const type of ['text', 'textarea', 'address', 'password', 'secret', 'object', 'file', undefined]) {
      expect(hasInCellPanelEditWidget(type), String(type)).toBe(false);
    }
  });

  it('draws the stored source in a text box; typing stages it; Enter is left to the text box (a new line)', async () => {
    const onChange = vi.fn();
    const onGridKey = vi.fn();
    render(
      <GridEditor onGridKey={onGridKey}>
        <FieldEditWidget field={{ name: 'notes', type: 'richtext' } as unknown as Field} value="<p>Hello</p>" onChange={onChange} inCell />
      </GridEditor>,
    );
    const box = (await screen.findByRole('textbox')) as HTMLTextAreaElement;
    expect(box.tagName).toBe('TEXTAREA');
    expect(box.value).toBe('<p>Hello</p>');
    fireEvent.change(box, { target: { value: '<p>Hello</p>\n<p>World</p>' } });
    expect(onChange).toHaveBeenLastCalledWith('<p>Hello</p>\n<p>World</p>');
    // The widget does not take Enter: it reaches the grid's wrapper with its
    // default intact, and the wrapper commits a text box only on Ctrl/Cmd+Enter.
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(true);
    expect(onGridKey).toHaveBeenCalledWith('Enter');
  });

  it('CONTROL: without the cell face the same field gets no editor', () => {
    const { container } = render(
      <FieldEditWidget field={{ name: 'notes', type: 'markdown' } as unknown as Field} value="# Hi" onChange={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
