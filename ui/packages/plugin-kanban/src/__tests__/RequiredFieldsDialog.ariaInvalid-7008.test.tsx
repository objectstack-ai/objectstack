/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7008, end to end: a control in the required-fields dialog that has
 * FAILED required-validation reports `aria-invalid` to assistive tech.
 *
 * ## The defect
 *
 * The dialog has always computed the validation state (`isMissingForRequired`,
 * the presence contract it shares with the form and the server) and rendered it
 * in red text. It could not hand that state to the control: `FieldEditWidget`
 * declared `error` and dropped it, so `aria-invalid` was never set. A sighted
 * user saw "Required"; a screen-reader user was told nothing.
 *
 * ## Why this test lives HERE and not only in `@object-ui/fields`
 *
 * The fields package pins that the factory forwards the key and that a widget
 * turns it into `aria-invalid`. Neither of those would have caught THIS bug,
 * because the missing link was a host that had the error and no way to pass it.
 * The two halves — forwarding in the factory, producing at the host — only add
 * up at this seam, so the seam is where the claim is measured.
 *
 * ## Why a `select` field
 *
 * `SelectField` computes `aria-invalid={!!error}`, so it reports an explicit
 * `"false"` when valid: the pin reads a two-state signal rather than the mere
 * presence of an attribute.
 *
 * ⚠️ This paragraph used to continue: "NOT every inline widget reads `error` —
 * `TextField`, `BooleanField`, `DateField`, `DateTimeField` and `TimeField` do
 * not, so for those types delivering the key is inert today." That was true
 * when this file landed and is NOT true any more — objectui#7126 made all five
 * read it. The sentence is corrected here rather than deleted, because it is
 * the reason `select` was chosen and a reader who finds the choice unexplained
 * will assume the other types still cannot be pinned. They can: the `text`
 * case, and the whole population, are pinned next door in
 * `RequiredFieldsDialog.ariaInvalidText-7126.test.tsx`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { RequiredFieldsDialog } from '../RequiredFieldsDialog';

afterEach(() => cleanup());

const SELECT_FIELD = {
  name: 'stage',
  label: 'Stage',
  def: {
    name: 'stage',
    type: 'select',
    label: 'Stage',
    options: [{ label: 'Won', value: 'won' }],
  },
};

function renderDialog(onSubmit = vi.fn()) {
  render(
    <RequiredFieldsDialog
      open
      fields={[SELECT_FIELD]}
      onCancel={() => {}}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

describe('RequiredFieldsDialog tells assistive tech about a failed required field (objectui#7008)', () => {
  it('marks the control `aria-invalid` once a submit attempt finds it empty', () => {
    const onSubmit = renderDialog();

    // CONTROL, and the reason this is a two-state reading: the dialog opens
    // clean — it does not shout at fields the user has not reached yet — so the
    // control must say "false" here. If this line read "true", the assertion
    // after the click would prove nothing.
    expect(screen.getByTestId('select-trigger-stage')).toHaveAttribute('aria-invalid', 'false');

    fireEvent.click(screen.getByText('Move card'));

    // The submit is refused (that half already worked) …
    expect(onSubmit).not.toHaveBeenCalled();
    // … the visible hint appears (that half already worked too) …
    expect(screen.getByText('Required')).toBeInTheDocument();
    // … and NOW the control says so to a screen reader. This is the assertion
    // that was red before the fix.
    expect(screen.getByTestId('select-trigger-stage')).toHaveAttribute('aria-invalid', 'true');
  });

  it('CONTROL: the marking is PER FIELD — a filled control is not marked invalid', () => {
    // Without this, "the control says true after submit" would be satisfied by
    // a dialog-wide flag that lights up every control, valid ones included.
    // `textarea` is the second type because `TextAreaField` also computes
    // `aria-invalid={!!error}` AND renders a real `<textarea>` that synthetic
    // events can fill — Radix's select trigger cannot be driven that way.
    const onSubmit = vi.fn();
    render(
      <RequiredFieldsDialog
        open
        fields={[
          SELECT_FIELD,
          { name: 'notes', label: 'Notes', def: { name: 'notes', type: 'textarea', label: 'Notes' } },
        ]}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );

    const notes = screen.getByRole('textbox');
    fireEvent.change(notes, { target: { value: 'ready to move' } });

    fireEvent.click(screen.getByText('Move card'));

    // Still refused, because the select is still empty.
    expect(onSubmit).not.toHaveBeenCalled();
    // The empty one is marked …
    expect(screen.getByTestId('select-trigger-stage')).toHaveAttribute('aria-invalid', 'true');
    // … and the filled one is NOT.
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'false');
    // One hint, not two — the same per-field split, read on the visible side.
    expect(screen.getAllByText('Required')).toHaveLength(1);
  });
});
