/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The BUILT-IN `select` branch hands the host's control props to the control it
 * actually renders — objectui#3976.
 *
 * Radix's `Select.Root` renders no DOM element of its own, so every prop it does
 * not recognise is silently DROPPED instead of reaching an element. The branch
 * used to spread its whole DOM pass-through onto that Root, which is where
 * `<FormControl>`'s Slot puts the field's `id` / `aria-describedby` /
 * `aria-invalid` and the call site puts `aria-required`. Measured before the
 * fix, for a plain `{ name: 'status', label: 'Status', type: 'select' }`:
 *
 *     label for="_r_1_-form-item"   ->  no element carries that id
 *     getByLabelText(/status/i)     ->  0 matches
 *     trigger button                ->  no id, no aria-describedby,
 *                                       no aria-invalid, no aria-required
 *
 * i.e. the visible "Status" label pointed at nothing (clicking it did nothing),
 * the field had no accessible name, and neither the validation message nor the
 * required state was announced.
 *
 * This is the same mechanism objectui#3306 fixed on the WIDGET side, where
 * `SelectField` now routes its pass-through to `SelectTrigger`. The two `select`
 * paths diverge because `BUILTIN_FIELD_TYPES` contains `'select'`: a bare
 * `type: 'select'` renders the built-in branch and never consults the registry,
 * while an object-driven `field:select` (`mapFieldTypeToFormType`) resolves to
 * the widget. Only the built-in half was broken, which is why the fork itself is
 * pinned below — both halves have to keep working independently, and a "fix"
 * that quietly rerouted bare `select` to the registry would change which
 * component renders for every hand-written form schema in existence.
 *
 * Reverse verification (run before writing the fix, direction predicted first):
 * restoring the spread onto `<Select>` turns the built-in describe RED — the
 * label-resolution, accessible-name, aria-required, aria-invalid and
 * aria-describedby cases all fail — while the registry describe stays GREEN,
 * because that path never went through Root.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

const OPTIONS = [
  { label: 'Open', value: 'open' },
  { label: 'Closed', value: 'closed' },
];

/**
 * Stands in for a registered option widget (`@object-ui/components` tests never
 * load `@object-ui/fields`) and mirrors the one mechanism the registry path
 * relies on: spread the leftover props onto the control it renders. Registered
 * under the REAL `field:select` key so the fork below is measured, not assumed —
 * the issue's finding was that the built-in branch wins even when that key
 * resolves.
 */
function SelectWidgetProbe(props: any) {
  const { name, value: _value, onChange: _onChange, field: _field, error: _error, options: _options, ...rest } = props;
  return (
    <button type="button" role="combobox" data-testid={`probe-${name}`} {...rest} />
  );
}

beforeAll(() => {
  ComponentRegistry.register('select', SelectWidgetProbe, { namespace: 'field' });
}, 30000);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForm(fields: any[], defaultValues: Record<string, unknown> = {}) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        defaultValues,
        fields,
        onSubmit: () => {},
      }}
    />,
  );
}

const STATUS_FIELD = { name: 'status', label: 'Status', type: 'select', options: OPTIONS };

/** The trigger button, by role — fails loudly if it stops being a combobox. */
function triggerOf(name: string): Element {
  const el = document.querySelector(`[data-field="${name}"] [role="combobox"]`);
  if (!el) throw new Error(`no select trigger rendered for field "${name}"`);
  return el;
}

/** Every `<label for=…>` in the document, paired with its resolved target. */
function labelTargets(): Array<{ text: string; forId: string; resolves: boolean }> {
  return Array.from(document.querySelectorAll('label'))
    .map((el) => ({
      text: (el.textContent ?? '').trim(),
      forId: el.getAttribute('for') ?? '',
      resolves: !!el.getAttribute('for') && !!document.getElementById(el.getAttribute('for')!),
    }))
    .filter((l) => l.forId !== '');
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));

describe('built-in select — the host id reaches the trigger (objectui#3976)', () => {
  it('emits no label pointing at an id nothing carries', () => {
    renderForm([STATUS_FIELD], { status: undefined });

    const labels = labelTargets();
    expect(labels.length).toBeGreaterThan(0);
    // The defect verbatim: `for="_r_N_-form-item"` with no owner in the document.
    expect(labels.filter((l) => !l.resolves)).toEqual([]);
  });

  it('resolves the visible label to the trigger, not to a wrapper', () => {
    renderForm([STATUS_FIELD], { status: undefined });

    // `getAllByLabelText` walks `for`→id, so it guards the association itself:
    // before the fix it returned 0 matches (the id had no owner at all).
    const labelled = screen.getAllByLabelText('Status');
    expect(labelled).toHaveLength(1);
    expect(labelled[0]).toBe(triggerOf('status'));
    // …and the element carrying the id is the focusable control, not the row.
    expect(labelled[0].tagName).toBe('BUTTON');
  });

  it('gives the combobox the label as its accessible name', () => {
    renderForm([STATUS_FIELD], { status: undefined });

    // The user-visible consequence, asserted on the computed name rather than on
    // markup: pre-fix the control was reachable by role but ANONYMOUS, so a
    // screen reader announced "combobox" with no field name.
    const combobox = screen.getByRole('combobox', { name: 'Status' });
    expect(combobox).toHaveAccessibleName('Status');
    expect(combobox).toBe(triggerOf('status'));
  });

  it('keeps `for` as the association channel — no second naming channel', () => {
    // The built-in `select` renders a labelable `<button>`, so `resolveFieldLabelling`
    // correctly classifies it as `'control'` (objectui#3961/#3978): plain `for`,
    // and NO `aria-labelledby`. Two channels for one label is the failure the
    // group-labelling work exists to avoid, and this fix must not introduce it.
    renderForm([STATUS_FIELD], { status: undefined });

    expect(screen.getByText('Status').getAttribute('for')).toBe(
      triggerOf('status').getAttribute('id'),
    );
    expect(triggerOf('status')).not.toHaveAttribute('aria-labelledby');
  });

  it('carries aria-required on the trigger, and nothing when optional', () => {
    renderForm([{ ...STATUS_FIELD, required: true }], { status: undefined });
    expect(triggerOf('status')).toHaveAttribute('aria-required', 'true');

    cleanup();
    renderForm([STATUS_FIELD], { status: undefined });
    expect(triggerOf('status')).not.toHaveAttribute('aria-required');
  });

  it('announces invalid on the trigger only AFTER validation fails', async () => {
    renderForm([{ ...STATUS_FIELD, required: true }], { status: undefined });

    // The explicit "false" half is load-bearing (#3222/#3306): a valid field
    // SAYS it is valid rather than staying mute.
    expect(triggerOf('status')).toHaveAttribute('aria-invalid', 'false');

    submit();

    // Prove the failure actually rendered before reading aria off it.
    await waitFor(() => expect(screen.getAllByText('Status is required')).toHaveLength(1));
    expect(triggerOf('status')).toHaveAttribute('aria-invalid', 'true');
  });

  it('links aria-describedby to the rendered error message', async () => {
    renderForm([{ ...STATUS_FIELD, required: true }], { status: undefined });

    submit();

    const message = await screen.findByText('Status is required');
    // The association is only real if the id chain closes: the trigger must
    // point at the exact element carrying the message text.
    expect(message.id).not.toBe('');
    const describedBy = triggerOf('status').getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(/\s+/)).toContain(message.id);
  });

  it('leaves `name` on Root, where the submitted hidden select is', () => {
    // The whitelist half of the fix, and a regression fence against "move
    // everything to the trigger": `name` is the ONE key Root genuinely consumes
    // — it forwards it to the hidden native `<select>` that takes part in form
    // submission. On the trigger it would sit uselessly on a non-submitter
    // `<button>`.
    renderForm([STATUS_FIELD], { status: undefined });

    const hidden = document.querySelector('[data-field="status"] select[aria-hidden="true"]');
    expect(hidden).toHaveAttribute('name', 'status');
    expect(triggerOf('status')).not.toHaveAttribute('name');
  });

  it('still keeps `disabled` a single-authority prop on Root', () => {
    // Root disables the trigger, the items and the hidden select together, so
    // the raw prop must not gain a second author on the trigger.
    renderForm([{ ...STATUS_FIELD, disabled: true }], { status: undefined });

    expect(triggerOf('status')).toBeDisabled();
  });

  it('two selects in one form each name their own trigger', () => {
    renderForm(
      [STATUS_FIELD, { name: 'stage', label: 'Stage', type: 'select', options: OPTIONS }],
      { status: undefined, stage: undefined },
    );

    expect(labelTargets().filter((l) => !l.resolves)).toEqual([]);
    // A shared/colliding id would make both labels resolve to the same control.
    expect(screen.getByRole('combobox', { name: 'Status' })).toBe(triggerOf('status'));
    expect(screen.getByRole('combobox', { name: 'Stage' })).toBe(triggerOf('stage'));
  });
});

describe('the two select paths stay separate (objectui#3976 / #3231)', () => {
  it('a bare `type: select` renders the BUILT-IN branch even though field:select resolves', () => {
    // Measured, not inferred: `renderFieldComponent` skips the registry entirely
    // for a `BUILTIN_FIELD_TYPES` member, so the probe registered above under
    // the real `field:select` key does NOT win. That is why #3976 had to be
    // fixed in the built-in branch — rerouting bare `select` to the registry is
    // a design change (it swaps the rendered component for every hand-written
    // form schema), not a bug fix.
    expect(ComponentRegistry.get('field:select')).toBe(SelectWidgetProbe);

    renderForm([STATUS_FIELD], { status: undefined });

    expect(screen.queryByTestId('probe-status')).toBeNull();
    // The Radix trigger + its hidden native select — the built-in branch's DOM.
    expect(triggerOf('status')).toHaveAttribute('aria-autocomplete', 'none');
    expect(document.querySelector('[data-field="status"] select[aria-hidden="true"]')).not.toBeNull();
  });

  it('a registered `field:select` widget still receives the host props (positive control)', () => {
    // The path #3306 already fixed. It must be untouched by this change: the
    // widget gets the id / aria-* as PROPS (the Slot clones the element it
    // returns) and puts them on the control it renders.
    renderForm(
      [{ name: 'choice', label: 'Choice', type: 'field:select', required: true, options: OPTIONS }],
      { choice: undefined },
    );

    const probe = screen.getByTestId('probe-choice');
    expect(labelTargets().filter((l) => !l.resolves)).toEqual([]);
    expect(screen.getByRole('combobox', { name: 'Choice' })).toBe(probe);
    expect(probe).toHaveAttribute('aria-required', 'true');
    expect(probe).toHaveAttribute('aria-invalid', 'false');
    expect(probe.getAttribute('id')).toMatch(/-form-item$/);
  });
});
