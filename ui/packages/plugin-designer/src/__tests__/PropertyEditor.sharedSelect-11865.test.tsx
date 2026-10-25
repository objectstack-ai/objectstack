/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The designers' property panel draws a `select` field with the shared
 * `Select` (objectui#11865).
 *
 * `PropertyEditor` (the panel `ProcessDesigner`, `PageDesigner`,
 * `ReportDesigner` and `DataModelDesigner` edit their selection in) drew a
 * `select` field with a browser-native select, beside the shared Radix
 * `Select` the rest of the console picks with. The card asks for one control
 * for one kind of choice, surface by surface; this suite covers that field
 * editor (`PropertySelect`).
 *
 * What is pinned:
 *   - the field editor IS the primitive (a Radix combobox trigger), shows the
 *     field's value, and no native select is left;
 *   - it keeps the name the native control had, which is none: the field's
 *     caption is a `<label>` beside it that names no control;
 *   - every option writes the `onChange(name, value)` call the native control
 *     wrote, compared as JSON text, an option whose value is `''` included;
 *   - re-picking the current option writes nothing;
 *   - a value no option carries is what the trigger shows, and a field with no
 *     value shows nothing;
 *   - the keyboard alone opens the field editor and selects.
 *
 * Read-only: the panel has no such state (`PropertyEditorProps` and
 * `PropertyField` declare none), so there is nothing to disable.
 *
 * DIRECTION, observed against the native control: every pin here but the
 * name pin is red there, because each one reads the field editor as the
 * primitive's trigger. The name pin is green there too: it pins what the
 * conversion kept. The write literals and the name were read once on the
 * pre-conversion panel with these fixtures, by a `change` event on its native
 * control. That event fired for the current option too, which a browser's
 * native select does not do, so the re-pick rows pin the primitive.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PropertyEditor, type PropertyField } from '../components/PropertyEditor';

afterEach(cleanup);

const KIND_OPTIONS = [
  { label: 'None', value: '' },
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b' },
];

function renderField(value: unknown, options: PropertyField['options'] = KIND_OPTIONS) {
  const onChange = vi.fn();
  const utils = render(
    <PropertyEditor fields={[{ name: 'kind', label: 'Kind', type: 'select', value, options }]} onChange={onChange} />,
  );
  return { ...utils, onChange, trigger: screen.getByRole('combobox') };
}

/** Open the field editor from the keyboard and return the options it lists, in order. */
async function openPicker(trigger: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

describe('a select field is drawn with the shared Select (objectui#11865)', () => {
  it('renders the field editor as the Radix combobox trigger, showing the field’s value', () => {
    const { container, trigger } = renderField('b');
    expect(container.querySelector('select')).toBeNull();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.textContent).toBe('Beta');
  });

  // Green against the native control too, by design: it pins what the conversion kept.
  it('keeps the name the native control had, which is none', () => {
    const { trigger } = renderField('b');
    expect(screen.getByRole('combobox', { name: '' })).toBe(trigger);
  });

  it('lists the options in the order the native control did', async () => {
    const { trigger } = renderField('b');
    expect((await openPicker(trigger)).map((o) => o.textContent)).toEqual(['None', 'Alpha', 'Beta']);
  });
});

/**
 * [the field's value, option label, the JSON text of `onChange`'s calls].
 * `null`: nothing is written — the option is the current one.
 */
const WRITES: ReadonlyArray<readonly [unknown, string, string | null]> = [
  ['b', 'None', '[["kind",""]]'],
  ['b', 'Alpha', '[["kind","a"]]'],
  ['b', 'Beta', null],
  ['', 'None', null],
  ['', 'Alpha', '[["kind","a"]]'],
  ['', 'Beta', '[["kind","b"]]'],
];

describe('every option writes what the native control wrote', () => {
  it.each(WRITES.map((row) => [`${JSON.stringify(row[0])} → ${row[1]}`, ...row] as const))(
    '%s',
    async (_name, value, label, json) => {
      const { onChange, trigger } = renderField(value);
      const option = (await openPicker(trigger)).find((o) => o.textContent === label);
      fireEvent.click(option!);
      if (json === null) expect(onChange).not.toHaveBeenCalled();
      else expect(JSON.stringify(onChange.mock.calls)).toBe(json);
    },
  );
});

describe('a value no option carries is what the trigger shows', () => {
  const AB = [
    { label: 'Alpha', value: 'a' },
    { label: 'Beta', value: 'b' },
  ];

  it('a value the options do not carry: shown and listed first, and re-picking it writes nothing', async () => {
    const { onChange, trigger } = renderField('zeta', AB);
    // The native control showed "Alpha" here, as if the field held `a`.
    expect(trigger.textContent).toBe('zeta');
    const listed = await openPicker(trigger);
    expect(listed.map((o) => o.textContent)).toEqual(['zeta', 'Alpha', 'Beta']);
    fireEvent.click(listed[0]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a field with no value and no empty option shows nothing, and lists no extra item', async () => {
    const { trigger } = renderField(undefined, AB);
    // The native control showed "Alpha" here too.
    expect(trigger.textContent).toBe('');
    expect((await openPicker(trigger)).map((o) => o.textContent)).toEqual(['Alpha', 'Beta']);
  });

  it('CONTROL: the value is matched as a string, and an absent value matches an empty option, as natively', () => {
    expect(
      renderField(3, [
        { label: 'One', value: '1' },
        { label: 'Three', value: '3' },
      ]).trigger.textContent,
    ).toBe('Three');
    cleanup();
    expect(renderField(undefined).trigger.textContent).toBe('None');
  });
});

describe('the keyboard alone picks', () => {
  it('Enter opens the field editor and Enter on an option selects it', async () => {
    const { onChange, trigger } = renderField('b');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'Alpha' }), { key: 'Enter' });
    expect(JSON.stringify(onChange.mock.calls)).toBe('[["kind","a"]]');
  });
});
