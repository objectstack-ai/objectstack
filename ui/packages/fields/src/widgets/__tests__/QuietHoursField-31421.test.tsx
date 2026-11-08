/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `quiet-hours`: a notification preference's quiet hours, drawn as a time-zone
 * picker and two times instead of a JSON box (objectstack#31421).
 *
 * The stored shape is `{ tz?, start: 'HH:MM', end: 'HH:MM' }`: an absent `tz`
 * means UTC and the window may run past midnight. The card's pins:
 *
 *  - an empty value writes nothing;
 *  - a 22:00 to 07:00 window round-trips;
 *  - a stored value without `tz` reads as UTC.
 *
 * and its rule for anything else: an unreadable stored value shows as-is with
 * a note and is never silently rewritten.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';
import { QuietHoursField } from '../QuietHoursField';
import { quietHoursZones, readQuietHours } from '../quietHours';
// Module scope: the package entry registers every `field:<widget>` key the
// record form resolves a field's `widget:` hint through.
import { registerAllFields } from '../../index';
// Module scope: the loader `field:quiet-hours` lazily imports, so the record
// form's `React.lazy` resolves at once.
import '../QuietHoursField.js';

const FIELD = { name: 'quiet_hours', type: 'json', widget: 'quiet-hours', label: 'Quiet Hours' } as any;

function mount({
  value,
  onChange = vi.fn(),
  readonly = false,
}: { value: unknown; onChange?: ReturnType<typeof vi.fn>; readonly?: boolean }) {
  const view = render(<QuietHoursField value={value} onChange={onChange} readonly={readonly} field={FIELD} />);
  return { onChange, ...view };
}

function pickZone(zone: string) {
  fireEvent.click(screen.getByTestId('quiet-hours-zone'));
  fireEvent.change(screen.getByTestId('quiet-hours-zone-search'), { target: { value: zone } });
  const listbox = screen.getByRole('listbox');
  fireEvent.click(within(listbox).getByText(zone, { selector: '[cmdk-item]' }));
}

afterEach(() => cleanup());

describe('reading a stored value (objectstack#31421)', () => {
  it.each([
    [null, 'empty'],
    [undefined, 'empty'],
    [{ tz: 'Europe/Berlin', start: '22:00', end: '07:00' }, 'window'],
    [{ start: '22:00', end: '07:00' }, 'window'],
    [{ start: '7:30', end: '9:00' }, 'window'],
    [{}, 'unreadable'],
    [{ start: '22:00' }, 'unreadable'],
    [{ start: '24:00', end: '07:00' }, 'unreadable'],
    [{ start: '22:00', end: '07:60' }, 'unreadable'],
    [{ start: '22:00:00', end: '07:00' }, 'unreadable'],
    [{ tz: '', start: '22:00', end: '07:00' }, 'unreadable'],
    [{ tz: null, start: '22:00', end: '07:00' }, 'unreadable'],
    [{ start: '22:00', end: '07:00', days: ['mon'] }, 'unreadable'],
    ['{"start":"22:00","end":"07:00"}', 'unreadable'],
    [[{ start: '22:00', end: '07:00' }], 'unreadable'],
  ])('%j reads as %s', (value, kind) => {
    expect(readQuietHours(value).kind).toBe(kind);
  });

  it('keeps every part verbatim, so a part nobody edits writes back unchanged', () => {
    expect(readQuietHours({ start: '7:30', end: '9:00' })).toEqual({
      kind: 'window',
      window: { start: '7:30', end: '9:00' },
    });
  });
});

describe('the time-zone list (objectstack#31421)', () => {
  it('offers UTC first, once, then the ICU zones', () => {
    const zones = quietHoursZones();
    expect(zones[0]).toBe('UTC');
    expect(zones.filter((zone) => zone === 'UTC')).toHaveLength(1);
    expect(zones).toContain('Europe/Berlin');
    expect(zones).toContain('Asia/Shanghai');
  });
});

describe('an empty value writes nothing (objectstack#31421)', () => {
  it('draws an empty control and calls onChange for nothing it did not receive', () => {
    const { onChange } = mount({ value: null });
    expect(screen.getByTestId('quiet-hours-zone')).toHaveTextContent('UTC');
    expect(screen.getByTestId('quiet-hours-start')).toHaveValue('');
    expect(screen.getByTestId('quiet-hours-end')).toHaveValue('');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('choosing a zone alone writes nothing', () => {
    const { onChange } = mount({ value: null });
    pickZone('Europe/Berlin');
    expect(screen.getByTestId('quiet-hours-zone')).toHaveTextContent('Europe/Berlin');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('one time without the other writes nothing and marks the missing time invalid', () => {
    const { onChange } = mount({ value: null });
    fireEvent.change(screen.getByTestId('quiet-hours-start'), { target: { value: '22:00' } });
    expect(onChange).not.toHaveBeenCalled();
    const end = screen.getByTestId('quiet-hours-end') as HTMLInputElement;
    expect(end).toHaveAttribute('aria-invalid', 'true');
    expect(end.validationMessage).toBe('Enter both a start and an end time.');
    expect(screen.getByTestId('quiet-hours-incomplete')).toHaveTextContent('Enter both a start and an end time.');
  });

  it('clearing both times of a stored window writes null', () => {
    const { onChange } = mount({ value: { start: '22:00', end: '07:00' } });
    fireEvent.change(screen.getByTestId('quiet-hours-start'), { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('quiet-hours-end'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe('a 22:00 to 07:00 window round-trips (objectstack#31421)', () => {
  it('writes exactly { tz, start, end } once both times and a zone are set', () => {
    const { onChange } = mount({ value: null });
    pickZone('Europe/Berlin');
    fireEvent.change(screen.getByTestId('quiet-hours-start'), { target: { value: '22:00' } });
    fireEvent.change(screen.getByTestId('quiet-hours-end'), { target: { value: '07:00' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toStrictEqual({ tz: 'Europe/Berlin', start: '22:00', end: '07:00' });
    expect(screen.getByTestId('quiet-hours-note')).toHaveTextContent('Runs past midnight and ends the next day.');
  });

  it('reads the stored window back into the control and writes it back unchanged on an edit that restores it', () => {
    const stored = { tz: 'Europe/Berlin', start: '22:00', end: '07:00' };
    const { onChange } = mount({ value: stored });
    expect(screen.getByTestId('quiet-hours-zone')).toHaveTextContent('Europe/Berlin');
    expect(screen.getByTestId('quiet-hours-start')).toHaveValue('22:00');
    expect(screen.getByTestId('quiet-hours-end')).toHaveValue('07:00');
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('quiet-hours-end'), { target: { value: '06:30' } });
    fireEvent.change(screen.getByTestId('quiet-hours-end'), { target: { value: '07:00' } });
    expect(onChange).toHaveBeenLastCalledWith(stored);
    expect(onChange.mock.calls.at(-1)?.[0]).toStrictEqual(stored);
  });

  it('draws the readonly face as the range in its zone', () => {
    mount({ value: { tz: 'Europe/Berlin', start: '22:00', end: '07:00' }, readonly: true });
    expect(screen.getByTestId('quiet-hours-range')).toHaveTextContent('22:00 to 07:00 (Europe/Berlin)');
  });
});

describe('a stored value without tz reads as UTC (objectstack#31421)', () => {
  it('shows UTC, and an edit keeps tz absent until a zone is chosen', () => {
    const { onChange } = mount({ value: { start: '22:00', end: '07:00' } });
    expect(screen.getByTestId('quiet-hours-zone')).toHaveTextContent('UTC');
    fireEvent.change(screen.getByTestId('quiet-hours-start'), { target: { value: '23:00' } });
    expect(onChange.mock.calls.at(-1)?.[0]).toStrictEqual({ start: '23:00', end: '07:00' });
  });

  it('draws the readonly face in UTC', () => {
    mount({ value: { start: '22:00', end: '07:00' }, readonly: true });
    expect(screen.getByTestId('quiet-hours-range')).toHaveTextContent('22:00 to 07:00 (UTC)');
  });

  it('keeps a one-digit stored hour verbatim when only the other time is edited', () => {
    const { onChange } = mount({ value: { start: '7:30', end: '9:00' } });
    expect(screen.getByTestId('quiet-hours-start')).toHaveValue('07:30');
    fireEvent.change(screen.getByTestId('quiet-hours-end'), { target: { value: '10:00' } });
    expect(onChange.mock.calls.at(-1)?.[0]).toStrictEqual({ start: '7:30', end: '10:00' });
  });
});

describe('a stored zone the list does not hold (objectstack#31421)', () => {
  it('stays shown, marked, and is written back as stored', () => {
    const { onChange } = mount({ value: { tz: 'Mars/Olympus', start: '22:00', end: '07:00' } });
    expect(screen.getByTestId('quiet-hours-zone')).toHaveTextContent('Mars/Olympus (not in the list)');
    fireEvent.change(screen.getByTestId('quiet-hours-start'), { target: { value: '21:00' } });
    expect(onChange.mock.calls.at(-1)?.[0]).toStrictEqual({ tz: 'Mars/Olympus', start: '21:00', end: '07:00' });
  });
});

describe('start and end at the same minute (objectstack#31421)', () => {
  it('is written as entered, with a note that nothing is held', () => {
    const { onChange } = mount({ value: null });
    fireEvent.change(screen.getByTestId('quiet-hours-start'), { target: { value: '08:00' } });
    fireEvent.change(screen.getByTestId('quiet-hours-end'), { target: { value: '08:00' } });
    expect(onChange).toHaveBeenLastCalledWith({ start: '08:00', end: '08:00' });
    expect(screen.getByTestId('quiet-hours-note')).toHaveTextContent('Start and end are the same, so nothing is held.');
  });
});

describe('an unreadable stored value is shown as-is and never silently rewritten (objectstack#31421)', () => {
  const UNREADABLE = { start: '22:00', end: '07:00', days: ['mon'] };

  it('shows the stored JSON with a note, writes nothing, and offers to replace it', () => {
    const { onChange } = mount({ value: UNREADABLE });
    const shown = screen.getByTestId('quiet-hours-unreadable');
    expect(shown).toHaveTextContent('"days"');
    expect(shown).toHaveTextContent('This value is not a time range this control can show. It is kept as stored.');
    expect(screen.queryByTestId('quiet-hours-start')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is replaced only once the person sets a new range and fills both times', () => {
    const { onChange } = mount({ value: UNREADABLE });
    fireEvent.click(screen.getByTestId('quiet-hours-replace'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('quiet-hours-start'), { target: { value: '22:00' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('quiet-hours-end'), { target: { value: '07:00' } });
    expect(onChange).toHaveBeenLastCalledWith({ start: '22:00', end: '07:00' });
  });

  it('reads as the stored JSON on the readonly face', () => {
    mount({ value: UNREADABLE, readonly: true });
    expect(screen.getByTestId('quiet-hours-unreadable')).toHaveTextContent('"days"');
  });
});

describe('the record form draws a field declaring widget: quiet-hours with this control (objectstack#31421)', () => {
  beforeAll(() => {
    registerAllFields();
  });

  it('`field:quiet-hours` is registered', () => {
    expect(ComponentRegistry.get('field:quiet-hours')).toBeDefined();
  });

  it('a json field whose metadata declares the hint renders the control, not the JSON box', async () => {
    const Form = ComponentRegistry.get('form')!;
    render(
      <Form
        schema={{
          type: 'form',
          mode: 'edit',
          showSubmit: false,
          showCancel: false,
          defaultValues: { quiet_hours: { tz: 'Europe/Berlin', start: '22:00', end: '07:00' } },
          fields: [{ name: 'quiet_hours', label: 'Quiet Hours', type: 'object', field: FIELD }],
        }}
      />,
    );
    expect(await screen.findByTestId('quiet-hours')).toBeInTheDocument();
    expect(screen.getByTestId('quiet-hours-start')).toHaveValue('22:00');
    expect(screen.getByRole('group', { name: 'Quiet Hours' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('the same field without the hint stays the JSON box', async () => {
    const Form = ComponentRegistry.get('form')!;
    const { widget: _widget, ...bare } = FIELD;
    render(
      <Form
        schema={{
          type: 'form',
          mode: 'edit',
          showSubmit: false,
          showCancel: false,
          defaultValues: { quiet_hours: { start: '22:00', end: '07:00' } },
          fields: [{ name: 'quiet_hours', label: 'Quiet Hours', type: 'object', field: bare }],
        }}
      />,
    );
    expect(await screen.findByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByTestId('quiet-hours')).toBeNull();
  });
});
