// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10367 — a flow screen's required `*` stays out of the control's
 * accessible name, and the requirement reaches the control as a STATE.
 *
 * `ScreenView` writes each flat field's label as `Label htmlFor=ff-NAME` and
 * `ScreenFieldInput` puts `ff-NAME` on the control, so everything inside that
 * label is the control's name. The `*` used to be a bare span in there: the
 * required text control was named "Title *", and no control carried `required`
 * or `aria-required`. The objectui#10178 / objectui#3299 shape is the fix: the
 * marker is `aria-hidden`, and `aria-required` goes on the control.
 *
 * `aria-required`, not native `required`, on every arm: the runner
 * (`FlowRunner`) owns required enforcement and counts an unchecked `false` as
 * an answer, while native `required` on a checkbox means "must be checked".
 * So each required case also asserts that native `required` is absent.
 *
 * The marker is located by `data-required-marker` (the locator the shared
 * form renderer already uses), never by the a11y attribute under test.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ScreenView, type ScreenSpec } from './ScreenView';

afterEach(cleanup);

function renderScreen(fields: ScreenSpec['fields']) {
  const spec = { nodeId: 'n1', kind: 'form', title: 'Step', fields } as unknown as ScreenSpec;
  return render(<ScreenView screen={spec} values={{}} onValueChange={() => {}} />);
}

describe('objectui#10367 — ScreenView keeps the required `*` out of the accessible name', () => {
  it('a required text field is found by its bare label and reports required', () => {
    const { container } = renderScreen([{ name: 'title', label: 'Title', type: 'text', required: true }]);

    // The card's named probe: this lookup missed while the name was "Title *".
    const input = screen.getByRole('textbox', { name: 'Title' });
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).not.toHaveAttribute('required');

    // The sighted-user affordance is still drawn, just not announced.
    const marker = container.querySelector('[data-required-marker]');
    expect(marker).not.toBeNull();
    expect(marker).toHaveTextContent('*');
    expect(marker).toHaveAttribute('aria-hidden', 'true');
  });

  it('every other control arm carries aria-required and a name without `*`', () => {
    renderScreen([
      { name: 'note', label: 'Note', type: 'textarea', required: true },
      { name: 'agree', label: 'Agree', type: 'boolean', required: true },
      { name: 'kind', label: 'Kind', type: 'text', required: true, options: [{ label: 'A', value: 'a' }] },
    ]);

    const note = screen.getByRole('textbox', { name: 'Note' });
    expect(note).toHaveAttribute('aria-required', 'true');
    expect(note).not.toHaveAttribute('required');

    const agree = screen.getByRole('checkbox', { name: 'Agree' });
    expect(agree).toHaveAttribute('aria-required', 'true');
    expect(agree).not.toHaveAttribute('required');

    const kind = screen.getByRole('combobox', { name: 'Kind' });
    expect(kind).toHaveAttribute('aria-required', 'true');
  });

  it('CONTROL — an optional field shows no marker and carries no aria-required', () => {
    const { container } = renderScreen([
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'agree', label: 'Agree', type: 'boolean' },
    ]);

    expect(container.querySelector('[data-required-marker]')).toBeNull();
    const input = screen.getByRole('textbox', { name: 'Title' });
    expect(input).not.toBeRequired();
    expect(input).not.toHaveAttribute('aria-required');
    expect(screen.getByRole('checkbox', { name: 'Agree' })).not.toHaveAttribute('aria-required');
  });
});
