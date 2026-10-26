/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ActionParamDialog (app-shell) — required must reach the field WIDGET's
 * control as a state, not sit in the label as a bare `*` (objectui#3299; same
 * shape as #3290/#3298).
 *
 * This dialog routes params through the real `@object-ui/fields` widgets
 * (ADR-0059), so the state travels host → widget props → `toDomProps` (whose
 * whitelist forwards `aria-*` by prefix, objectui#3291) → the rendered
 * control. These tests drive that FULL delivery chain with real widgets — a
 * widget-side strip of `aria-*` would fail here, not just a host-side
 * omission.
 *
 * Deliberately NOT native `required` (#3290 ruling): the dialog runs its own
 * required validation (`requiredError` messages); native required would arm
 * the browser's constraint-validation bubble beside it.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ActionParamDef } from '@object-ui/core';
import { ActionParamDialog } from './ActionParamDialog';

/** Mount the dialog open with the given params (mirrors ActionParamDialog.test.tsx). */
function openDialog(params: ActionParamDef[]) {
  const resolve = vi.fn();
  render(
    <ActionParamDialog
      state={{ open: true, params, resolve }}
      onOpenChange={() => {}}
    />,
  );
  return resolve;
}

const def = (over: Partial<ActionParamDef>): ActionParamDef => ({
  name: 'p1',
  label: 'Param One',
  type: 'text',
  ...over,
});

describe('app-shell ActionParamDialog — `aria-required` reaches the widget control (objectui#3299)', () => {
  it('sets aria-required="true" on a required text param, delivered through the real widget', async () => {
    openDialog([def({ name: 'note', type: 'text', required: true })]);

    const input = await screen.findByLabelText(/Param One/);
    expect(input).toHaveAttribute('aria-required', 'true');
  });

  it('omits the attribute entirely on an optional param, rather than writing "false"', async () => {
    openDialog([def({ name: 'note', type: 'text' })]);

    const input = await screen.findByLabelText(/Param One/);
    expect(input).not.toHaveAttribute('aria-required');
  });

  it('sets aria-required="true" on the boolean branch too (checkbox row)', async () => {
    // The boolean branch is a SEPARATE render path (inline checkbox row) —
    // fixing only the default branch would leave this one silent.
    openDialog([def({ name: 'force', type: 'boolean', required: true })]);

    const checkbox = await screen.findByRole('checkbox');
    expect(checkbox).toHaveAttribute('aria-required', 'true');
  });

  it('keeps the asterisk OUT of the accessible name — state announced once, not "asterisk"', async () => {
    // Pre-fix the bare `*` inside `<Label htmlFor>` folded into the control's
    // accessible name ("Param One asterisk"). Only the computed name shows
    // that regression, so that is what gets pinned.
    openDialog([def({ name: 'note', type: 'text', required: true })]);

    const input = await screen.findByLabelText(/Param One/);
    expect(input).toHaveAccessibleName('Param One');

    const label = document.querySelector('label[for="note"]');
    expect(label).not.toBeNull();
    const marker = label!.querySelector('span');
    expect(marker).not.toBeNull();
    expect(marker).toHaveTextContent('*');
    expect(marker).toHaveAttribute('aria-hidden', 'true');
  });

  it('never sets the native `required` attribute (#3290: no double validation UI)', async () => {
    openDialog([def({ name: 'note', type: 'text', required: true })]);

    const input = (await screen.findByLabelText(/Param One/)) as HTMLInputElement;
    // NOT `toBeRequired()` — jest-dom counts `aria-required="true"` as
    // required, so it cannot distinguish the channel under test.
    await waitFor(() => expect(input).toHaveAttribute('aria-required', 'true'));
    expect(input).not.toHaveAttribute('required');
    expect(input.required).toBe(false);
  });
});

/**
 * The HOST owns the control id on the boolean branch too (objectui#3962).
 *
 * The boolean branch renders `<Label htmlFor={param.name}>` but used to pass no
 * `id` to the widget, so the association only held because `BooleanField`'s
 * fallback chain happened to reach the same string (`config.name`, which
 * `paramToField` seeds from `param.name`). Two consequences, one of them a real
 * defect:
 *
 * 1. The association was IMPLICIT — it lived in another package's fallback, not
 *    in this host's own output. The generic branch a few dozen lines below has
 *    always passed `id={param.name}`; this branch now matches it.
 * 2. Receiving no host id, the widget could not know the host had already
 *    rendered a label, so it emitted its own `sr-only` one as well. Two label
 *    elements pointing at one control CONCATENATE into the accessible name
 *    (accname §2D), so the control announced "Confirm This Confirm This".
 *
 * Both `for` targets resolved, so this was never the dangling-label failure of
 * #3341/#3952 — it was a duplicated name. The measurable half is therefore the
 * NAME, not clickability: the pins below assert one label element and an
 * un-doubled accessible name. `getAllByLabelText` deliberately is NOT the
 * probe — it de-dupes its matches through a `Set` and splits multi-label names,
 * so it returns exactly one control in both the broken and the fixed tree.
 */
describe('app-shell ActionParamDialog — the boolean branch names its control ONCE (objectui#3962)', () => {
  const boolParam = def({ name: 'confirmed', label: 'Confirm This', type: 'boolean' });

  it('gives the boolean control the host id and exactly one label element', async () => {
    openDialog([boolParam]);

    const checkbox = await screen.findByRole('checkbox');
    // Explicit, not inherited: the id the dialog's own `<Label htmlFor>` names.
    expect(checkbox).toHaveAttribute('id', 'confirmed');

    const labels = Array.from(document.querySelectorAll('label[for="confirmed"]'));
    expect(labels).toHaveLength(1);
    // …and the surviving one is the dialog's VISIBLE label, not the widget's
    // sr-only copy — a checkbox row whose only name is screen-reader-only
    // would pass a bare count while showing the user nothing.
    expect(labels[0].className).not.toContain('sr-only');
    expect(labels[0]).toHaveTextContent('Confirm This');
  });

  it('announces the label once, not twice concatenated', async () => {
    openDialog([boolParam]);

    const checkbox = await screen.findByRole('checkbox');
    expect(checkbox).toHaveAccessibleName('Confirm This');
  });

  it('still names a required boolean param without folding in the asterisk', async () => {
    // The `*` marker lives inside the visible label; suppressing the widget's
    // duplicate must not drag the visual-only marker into the name (#3299).
    openDialog([def({ name: 'confirmed', label: 'Confirm This', type: 'boolean', required: true })]);

    const checkbox = await screen.findByRole('checkbox');
    expect(checkbox).toHaveAccessibleName('Confirm This');
    expect(checkbox).toHaveAttribute('aria-required', 'true');
  });

  it('leaves the generic branch exactly as it was — host id, one label, one name', async () => {
    // The generic branch already passed `id={param.name}`; this is the
    // unchanged-direction half of the pin, so a future "simplification" that
    // moves id ownership back into the widgets fails here as well.
    openDialog([def({ name: 'note', label: 'Note This', type: 'text' })]);

    const input = await screen.findByLabelText('Note This');
    expect(input).toHaveAttribute('id', 'note');
    expect(document.querySelectorAll('label[for="note"]')).toHaveLength(1);
    expect(input).toHaveAccessibleName('Note This');
  });
});
