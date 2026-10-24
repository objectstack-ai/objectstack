/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7126, end to end: a required **text** field in the required-fields
 * dialog reports `aria-invalid` once its validation fails — and so do the other
 * four types whose widgets did not read the delivered key.
 *
 * ## Why this file exists next to the #7008 one
 *
 * `RequiredFieldsDialog.ariaInvalid-7008.test.tsx` pinned the same claim for
 * `select` and `textarea`, and its own header recorded WHY it could not use
 * `text`: `TextField`, `BooleanField`, `DateField`, `DateTimeField` and
 * `TimeField` did not read `error`, so for their types the dialog's delivery
 * was inert. That was the gap objectui#7126 closed, and this is the same
 * measurement taken again at the same seam now that the widgets read it.
 *
 * ⭐ `text` is why the gap was p2 rather than tidiness. It is the most common
 * field type in any object, so it is the likeliest thing a column makes
 * required — the live case in which a sighted user saw the red "Required" and a
 * screen-reader user was told nothing.
 *
 * ## What is NOT claimed
 *
 * Only the MARKING. The objectui#3222 slot drives `aria-invalid` and renders no
 * text; the visible hint is still the dialog's own red span, exactly as before.
 * Nothing became visible here that was not visible before.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { RequiredFieldsDialog } from '../RequiredFieldsDialog';

afterEach(() => cleanup());

const TEXT_FIELD = {
  name: 'title',
  label: 'Title',
  def: { name: 'title', type: 'text', label: 'Title' },
};

/** The control `TextField` renders for a single-line `text` field. */
function textControl(name = 'title'): Element {
  const el = document.querySelector(`input[type="text"][name="${name}"], input[type="text"]`);
  if (!el) throw new Error('no text control rendered');
  return el;
}

const moveCard = () => fireEvent.click(screen.getByText('Move card'));

describe('RequiredFieldsDialog marks a failed required TEXT field (objectui#7126)', () => {
  it('a required text field reports aria-invalid once a submit attempt finds it empty', () => {
    const onSubmit = vi.fn();
    render(
      <RequiredFieldsDialog open fields={[TEXT_FIELD]} onCancel={() => {}} onSubmit={onSubmit} />,
    );

    // CONTROL, and what makes this a two-state reading: the dialog opens clean
    // (`showErrors` is false until a submit attempt), so the control must say
    // "false" here. If this line read "true" the assertion after the click
    // would prove nothing — and if it read *nothing at all*, that is the
    // pre-#7126 state, in which `TextField` set no `aria-invalid` whatsoever.
    expect(textControl()).toHaveAttribute('aria-invalid', 'false');

    moveCard();

    // The submit is refused (that half already worked) …
    expect(onSubmit).not.toHaveBeenCalled();
    // … the visible hint appears (that half already worked too — and it is the
    // ONLY thing that renders the message; the widget renders none) …
    expect(screen.getByText('Required')).toBeInTheDocument();
    // … and NOW the control says so to a screen reader. This is the assertion
    // that was red before objectui#7126.
    expect(textControl()).toHaveAttribute('aria-invalid', 'true');
    // On the control itself — an `<input>` is focusable, so this is not a
    // wrapper mark (the objectui#5223 line).
    expect(textControl().tagName).toBe('INPUT');
  });

  it('CONTROL: the marking is PER FIELD — a filled text field is not marked invalid', () => {
    // Without this, "the control says true after submit" would be satisfied by
    // a dialog-wide flag that lights up every control, valid ones included.
    const onSubmit = vi.fn();
    render(
      <RequiredFieldsDialog
        open
        fields={[
          TEXT_FIELD,
          { name: 'stage', label: 'Stage', def: { name: 'stage', type: 'select', label: 'Stage', options: [{ label: 'Won', value: 'won' }] } },
        ]}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(textControl(), { target: { value: 'Ship it' } });

    moveCard();

    // Still refused, because the select is still empty.
    expect(onSubmit).not.toHaveBeenCalled();
    // The empty one is marked …
    expect(screen.getByTestId('select-trigger-stage')).toHaveAttribute('aria-invalid', 'true');
    // … and the filled TEXT one is NOT.
    expect(textControl()).toHaveAttribute('aria-invalid', 'false');
    // One hint, not two — the same per-field split, read on the visible side.
    expect(screen.getAllByText('Required')).toHaveLength(1);
  });

  it('the whole objectui#7126 population reports through this dialog, on focusable controls', async () => {
    // The five widgets serve six inline types between them. The dialog renders
    // whatever the target column made required, so all of them are reachable
    // here — and each renders a DIFFERENT element, which is what makes this
    // more than a repeat of the `text` case above.
    const onSubmit = vi.fn();
    render(
      <RequiredFieldsDialog
        open
        fields={[
          TEXT_FIELD,
          { name: 'active', label: 'Active', def: { name: 'active', type: 'boolean', label: 'Active' } },
          { name: 'flagged', label: 'Flagged', def: { name: 'flagged', type: 'toggle', label: 'Flagged' } },
          { name: 'due', label: 'Due', def: { name: 'due', type: 'date', label: 'Due' } },
          { name: 'at', label: 'At', def: { name: 'at', type: 'datetime', label: 'At' } },
          { name: 'start', label: 'Start', def: { name: 'start', type: 'time', label: 'Start' } },
        ]}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );

    // Prove the failure actually happened before reading aria off anything — a
    // dialog that silently submitted would leave every control valid and this
    // whole case would read as a pass over nothing.
    moveCard();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText('Required')).toHaveLength(6);
    // `date` and `datetime` draw the platform date picker, loaded lazily
    // (objectui#12664): wait for both text boxes before reading them.
    await waitFor(() => expect(document.querySelectorAll('[data-slot="date-picker"] input')).toHaveLength(2));

    // `boolean` and `toggle` both resolve to `BooleanField`, whose control is a
    // Radix `<button role="switch">`; `time` renders one native input, and
    // `date` / `datetime` each render the platform picker's text box
    // (objectui#12664). Selected by their OWN element so a mark that landed on
    // BooleanField's wrapper `div` instead cannot satisfy this.
    const carriers: ReadonlyArray<readonly [string, string]> = [
      ['text', 'input[type="text"]'],
      ['boolean', 'button[role="switch"]'],
      ['date / datetime', '[data-slot="date-picker"] input'],
      ['time', 'input[type="time"]'],
    ];

    for (const [label, selector] of carriers) {
      const found = Array.from(document.querySelectorAll(selector));
      expect(found.length, `${label}: no control matched ${selector}`).toBeGreaterThan(0);
      for (const el of found) {
        expect(el, `${label} (${selector}) was not marked invalid`).toHaveAttribute(
          'aria-invalid',
          'true',
        );
      }
    }
    // `boolean` + `toggle` are two fields sharing one widget — both switches
    // must be there, or the loop above would have passed on a single one.
    expect(document.querySelectorAll('button[role="switch"]')).toHaveLength(2);
  });
});
