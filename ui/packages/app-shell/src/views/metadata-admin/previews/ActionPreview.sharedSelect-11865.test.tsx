// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An action preview mocks a select param with the shared `Select`
 * (objectui#11865).
 *
 * The action preview's input-dialog mock drew a select param as a disabled
 * browser-native select element, while the dialog it mocks draws the param
 * with `SelectField`, which is the shared Radix `Select`. The card asks for one
 * control for one kind of choice, surface by surface; this suite covers this
 * mock.
 *
 * What is pinned:
 *   - each select param's mock IS the primitive (a Radix combobox trigger)
 *     and no native select is left;
 *   - it shows what the native mock showed: the authored placeholder, else
 *     "Select LABEL", read on the base for a typed param with options, one
 *     with a placeholder and a default, one with no options, and an untyped
 *     field-backed param whose options decide it;
 *   - it is disabled, opens nothing and so writes nothing, as the native mock
 *     wrote nothing (it had no handler);
 *   - it has no accessible name, as the native mock had none (the caption
 *     above it is a `label` that names no control).
 *
 * DIRECTION, observed against the native mock: the primitive pins are red
 * there (a native select is found, and no button trigger); the shown-text
 * literals are what the pre-conversion mock showed, read once on that
 * component.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ActionPreview } from './ActionPreview';

afterEach(() => cleanup());

const DRAFT = {
  name: 'a',
  label: 'A',
  type: 'script',
  target: 'x',
  params: [
    { name: 'stage', label: 'Stage', type: 'select', options: [{ label: 'Open', value: 'open' }, { label: 'Won', value: 'won' }] },
    {
      name: 'stage2',
      label: 'Stage 2',
      type: 'select',
      placeholder: 'Pick one',
      defaultValue: 'won',
      options: [{ label: 'Open', value: 'open' }, { label: 'Won', value: 'won' }],
    },
    { name: 'empty', label: 'Empty', type: 'select' },
    // Untyped and field-backed: its authored options make it a select mock,
    // and one of them carries the value `''`.
    { field: 'status', options: [{ label: 'Draft', value: '' }, { label: 'Live', value: 'live' }] },
  ],
};

/** The select mocks: the comboboxes that pop no dialog (the lookup mock pops one). */
function selectMocks(): HTMLElement[] {
  return screen.getAllByRole('combobox').filter((el) => el.getAttribute('aria-haspopup') !== 'dialog');
}

describe('the action preview mocks a select param with the shared Select (objectui#11865)', () => {
  it('draws each select param as a disabled Radix combobox trigger, with no native select left', () => {
    render(<ActionPreview type="action" name="a" draft={DRAFT} locale="en-US" />);
    expect(document.querySelector('select')).toBeNull();
    const mocks = selectMocks();
    expect(mocks).toHaveLength(4);
    for (const el of mocks) {
      expect(el.tagName).toBe('BUTTON');
      expect(el).toBeDisabled();
      expect(el).not.toHaveAccessibleName();
    }
  });

  it('shows the text the native mock showed, param by param', () => {
    render(<ActionPreview type="action" name="a" draft={DRAFT} locale="en-US" />);
    // Read on the native mock: the selected option's text, which was always its placeholder.
    expect(selectMocks().map((el) => el.textContent)).toEqual(['Select Stage', 'Pick one', 'Select Empty', 'Select status']);
  });

  it('opens nothing, so it writes nothing', () => {
    render(<ActionPreview type="action" name="a" draft={DRAFT} locale="en-US" />);
    for (const el of selectMocks()) {
      fireEvent.keyDown(el, { key: 'Enter' });
      fireEvent.keyDown(el, { key: 'ArrowDown' });
      fireEvent.pointerDown(el, { button: 0, pointerType: 'mouse' });
    }
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
