/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12664 — the kanban required-fields dialog draws the platform date
 * picker for a `date` / `datetime` field, through `FieldEditWidget`, and the
 * typed value reaches the submit.
 *
 * The dialog is a form-shaped host: the user types, then presses "Move card",
 * which takes focus — and that blur is where the picker reads its text, as on
 * the action-param and bulk dialogs. Nothing in the dialog changed; this pins
 * that the inline factory's new face rides the dialog's existing seam.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { RequiredFieldsDialog } from '../RequiredFieldsDialog';

afterEach(() => cleanup());

async function pickerBox(): Promise<HTMLInputElement> {
  return waitFor(() => {
    const el = document.querySelector('[data-slot="date-picker"] input');
    if (!el) throw new Error('date picker not rendered');
    return el as HTMLInputElement;
  });
}

/** Type into the box, then press "Move card" the way a pointer does: focus leaves the box first. */
function typeThenMove(input: HTMLInputElement, text: string) {
  input.focus();
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByText('Move card'));
}

describe('RequiredFieldsDialog — date / datetime draw the platform picker (objectui#12664)', () => {
  it('a date field: the picker, not input[type=date], and the typed day is submitted', async () => {
    const onSubmit = vi.fn();
    render(
      <RequiredFieldsDialog
        open
        fields={[{ name: 'due', label: 'Due', def: { name: 'due', type: 'date', label: 'Due' } }]}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );
    const input = await pickerBox();
    expect(input.type).toBe('text');
    expect(input.placeholder).toBe('MM/DD/YYYY');
    expect(document.querySelector('input[type="date"]')).toBeNull();
    typeThenMove(input, '10/20/2026');
    expect(onSubmit).toHaveBeenCalledWith({ due: '2026-10-20' });
  });

  it('a datetime field: the typed date and time are submitted as that local instant', async () => {
    const onSubmit = vi.fn();
    render(
      <RequiredFieldsDialog
        open
        fields={[{ name: 'at', label: 'At', def: { name: 'at', type: 'datetime', label: 'At' } }]}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );
    const input = await pickerBox();
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    typeThenMove(input, '10/20/2026 14:30');
    expect(onSubmit).toHaveBeenCalledWith({ at: new Date(2026, 9, 20, 14, 30).toISOString() });
  });
});
