/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * CreateViewDialog — the three always-required controls (display label,
 * machine name, and each type-specific required-field select) must announce
 * required as a STATE, not as a bare `*` in the label (objectui#3299; same
 * shape as #3290/#3298).
 *
 * Pre-fix, all three drew `<span>*</span>` inside `<label htmlFor>` with no
 * `aria-hidden` and no state on the control — screen readers heard
 * "…asterisk" in the name and "list required fields" navigation saw nothing.
 *
 * These fields are unconditionally required (the dialog's own submit gating
 * treats them so), hence the static `aria-required="true"` rather than the
 * conditional `required || undefined` shape the param dialogs use.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CreateViewDialog } from './CreateViewDialog';

afterEach(cleanup);

function openDialog() {
  return render(
    <CreateViewDialog open onOpenChange={() => {}} onCreate={vi.fn()} />,
  );
}

/** The asterisk `<span>` inside the label pointing at `id` — must be a11y-hidden. */
function markerFor(id: string) {
  const label = document.querySelector(`label[for="${id}"]`);
  expect(label).not.toBeNull();
  const marker = label!.querySelector('span');
  expect(marker).not.toBeNull();
  expect(marker).toHaveTextContent('*');
  return marker!;
}

describe('CreateViewDialog — `aria-required` reaches the controls (objectui#3299)', () => {
  it('sets aria-required="true" on the display-label input, with the asterisk a11y-hidden', () => {
    openDialog();

    const input = screen.getByTestId('create-view-name-input');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(markerFor('create-view-name-input')).toHaveAttribute('aria-hidden', 'true');
  });

  it('sets aria-required="true" on the machine-name input, with the asterisk a11y-hidden', () => {
    openDialog();

    const input = screen.getByTestId('create-view-machine-name-input');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(markerFor('create-view-machine-name-input')).toHaveAttribute('aria-hidden', 'true');
  });

  it('sets aria-required="true" on a type-specific required-field select (kanban group-by)', () => {
    openDialog();

    // The required-fields section only renders for types that declare
    // required config — switch to kanban to mount its group-by selector.
    fireEvent.click(screen.getByTestId('create-view-type-kanban'));

    const select = screen.getByTestId('create-view-required-groupByField');
    expect(select).toHaveAttribute('aria-required', 'true');
    expect(markerFor('create-view-required-groupByField')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the asterisk OUT of the accessible name (state announced once)', () => {
    openDialog();

    // `t()` resolves to the key itself in tests; pre-fix the name would have
    // been "console.objectView.title *" — "…asterisk" to a screen reader.
    const input = screen.getByTestId('create-view-name-input');
    expect(input).toHaveAccessibleName('console.objectView.title');
  });

  it('never sets the native `required` attribute (#3290: no double validation UI)', () => {
    openDialog();

    // NOT `toBeRequired()` — jest-dom counts `aria-required="true"` as
    // required, so it cannot distinguish the channel under test.
    for (const id of ['create-view-name-input', 'create-view-machine-name-input']) {
      const input = screen.getByTestId(id) as HTMLInputElement;
      expect(input).toHaveAttribute('aria-required', 'true');
      expect(input).not.toHaveAttribute('required');
      expect(input.required).toBe(false);
    }
  });
});
