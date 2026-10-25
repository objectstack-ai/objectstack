/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * GATE: the three things a form host hands a field widget all reach an element
 * that can carry them — for the two widgets that forwarded NONE of them
 * (objectui#3318's ledger remainder).
 *
 * ## Why one file for three channels
 *
 * The registry sweep next door measures ONE axis, `aria-invalid`, and that is
 * what put `slider` and `signature` on its ledger. But the cause was never
 * per-attribute: neither widget spread `toDomProps(props)` at all, so
 * `<FormControl>`'s Slot delivered its whole payload into nothing. Measured on
 * `origin/main`, a real form, the field required and freshly failed:
 *
 * ```
 * slider     ariaInvalidTrue=[]  labelFor=…-form-item -> DANGLING  descConsumers=0  ids=[]
 * signature  ariaInvalidTrue=[]  labelFor=…-form-item -> DANGLING  descConsumers=0  ids=[]
 * text       ariaInvalidTrue=[input]  labelFor -> input            descConsumers=1  (control)
 * ```
 *
 * `ids=[]` is the tell: not "the id was overwritten" (objectui#3952's shape on
 * `boolean`) but "no element in the row carried an id at all". Removing one
 * ledger row therefore closes three defects, and pinning only the one the
 * ledger names would leave the other two free to regress with the sweep still
 * green — which is exactly how they survived the first delivery batch.
 *
 * ## Why the label channel needed more than the spread
 *
 * A `for` that RESOLVES is not a label that WORKS. `<label for>` only addresses
 * HTML's labelable elements (`button`, `input`, `meter`, `output`, `progress`,
 * `select`, `textarea`); a slider's control is Radix's `span[role="slider"]`
 * thumb and a signature's is a `<canvas>`, so handing either the host id would
 * merely upgrade a dangling `for` to an inert one. Both are therefore declared
 * `labelling: 'group'` (objectui#3961's route, `file`'s shape rather than a
 * composite's) and named by IDREF. This file registers them WITH that
 * declaration, because it is the production registration and the association
 * cannot be observed without it.
 *
 * ## The asymmetry between the two, and why it is deliberate
 *
 * `slider` HAS a focusable control, so it takes the full DOM pass-through and
 * carries its own validation state. `signature` has none — the canvas offers no
 * keyboard path and Clear is disabled while the pad is empty — so it takes the
 * name and the description on a `role="group"` container and NOT the control
 * state, the boundary `toHostGroupProps` draws. Both directions are pinned
 * below, so neither "spread it all" nor "take it all back" can pass quietly.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';

import { withFieldCarrier } from '../withFieldCarrier';
import { SliderField } from '../widgets/SliderField';
import { SignatureField } from '../widgets/SignatureField';
import { TextField } from '../widgets/TextField';

const HELP = 'How firmly do you agree';

beforeAll(() => {
  // Registered exactly as `registerField` does for a member of
  // FIELD_WIDGET_LABELLING — the declaration is half of what is under test.
  // Registered one by one rather than over a tuple: the two widgets implement
  // `FieldWidgetComponentProps` at different value types, and a shared loop
  // variable would only unify them through `any`.
  ComponentRegistry.register('slider', withFieldCarrier(SliderField) as any, {
    namespace: 'field',
    skipFallback: true,
    labelling: 'group',
  });
  ComponentRegistry.register('signature', withFieldCarrier(SignatureField) as any, {
    namespace: 'field',
    skipFallback: true,
    labelling: 'group',
  });
  // Positive control: an ordinary single-control widget, undeclared, whose
  // label reaches a labelable element the plain way.
  ComponentRegistry.register('text', withFieldCarrier(TextField) as any, {
    namespace: 'field',
    skipFallback: true,
  });
}, 60000);

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForm(type: string, opts: { readonly?: boolean } = {}) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        defaultValues: { f: null },
        fields: [
          {
            name: 'f',
            label: 'Confidence',
            type: `field:${type}`,
            required: true,
            description: HELP,
            ...(opts.readonly ? { readonly: true } : {}),
          },
        ],
        onSubmit: () => {},
      }}
    />,
  );
}

async function formRow(): Promise<Element> {
  return waitFor(() => {
    const row = document.querySelector('[data-field="f"]');
    if (!row) throw new Error('field row never rendered');
    return row;
  });
}

/** Submit and prove the failure RENDERED before reading any aria off it. */
async function failValidation(): Promise<Element> {
  fireEvent.click(screen.getByRole('button', { name: /create/i }));
  await waitFor(() => {
    expect(document.querySelector('[data-field="f"]')?.textContent ?? '').toContain('is required');
  });
  return formRow();
}

/** The rendered `<FormDescription>` and everything that references it. */
function describedByConsumers(row: Element): Element[] {
  const desc = Array.from(row.querySelectorAll('p')).find((p) => p.textContent === HELP);
  const id = desc?.getAttribute('id');
  expect(desc, 'the field rendered no description to point at').toBeTruthy();
  expect(id, 'the rendered description carries no id to be referenced by').toBeTruthy();
  return Array.from(row.querySelectorAll('[aria-describedby]')).filter((el) =>
    (el.getAttribute('aria-describedby') ?? '').split(/\s+/).includes(id!),
  );
}

describe('slider delivers all three host channels to its thumb (objectui#3318)', () => {
  it('marks the FOCUSABLE control invalid — not the wrapper Radix renders', async () => {
    renderForm('slider');
    const row = await formRow();

    // No premature alarm, and the explicit "false": a valid field SAYS so.
    expect(row.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(screen.getByRole('slider')).toHaveAttribute('aria-invalid', 'false');

    const after = await failValidation();
    const marked = after.querySelectorAll('[aria-invalid="true"]');

    expect(marked).toHaveLength(1);
    // The whole point of the components-level change: the attribute is on the
    // element with the widget role, not on Root's role-less span. Asserting the
    // ROLE (rather than "some element in the row") is what makes this fail if a
    // later refactor moves the delivery back up to the wrapper.
    expect(marked[0]).toBe(screen.getByRole('slider'));
  });

  it('is NAMED by its visible label, by IDREF', async () => {
    renderForm('slider');
    const row = await formRow();

    const label = row.querySelector('label')!;
    // A `for` here could only dangle or resolve to a non-labelable span, so the
    // group route drops it and publishes an id instead.
    expect(label).not.toHaveAttribute('for');
    expect(label.id).toBeTruthy();

    const thumb = screen.getByRole('slider');
    expect(thumb).toHaveAttribute('aria-labelledby', label.id);
    // The IDREF resolves, and the name that comes out is the visible one.
    expect(document.getElementById(label.id)).toBe(label);
    expect(screen.getByRole('slider', { name: /Confidence/ })).toBe(thumb);
  });

  it('is DESCRIBED by its help text, on the same control', async () => {
    renderForm('slider');
    const row = await formRow();

    const consumers = describedByConsumers(row);
    expect(consumers).toHaveLength(1);
    expect(consumers[0]).toBe(screen.getByRole('slider'));
  });

  it('carries the host id on the thumb, and only there', async () => {
    renderForm('slider');
    const row = await formRow();

    const thumb = screen.getByRole('slider');
    expect(thumb.id).toBeTruthy();
    // Exactly one element may answer to a given id. The root-half of the
    // primitive patch is what keeps this true; without it the id would sit on
    // the wrapper as well and `getElementById` would answer with the wrapper.
    expect(document.getElementById(thumb.id)).toBe(thumb);
    expect(row.querySelectorAll(`[id="${thumb.id}"]`)).toHaveLength(1);
  });

  it('leaks no renderer plumbing onto the thumb (objectui#3291)', async () => {
    renderForm('slider');
    await formRow();

    const thumb = screen.getByRole('slider');
    // `name` is DOM-legal on form controls only; on this span it is the leak
    // class the sweep exists for. It stays on Root, which owns the hidden input.
    expect(thumb).not.toHaveAttribute('name');
    expect(thumb).not.toHaveAttribute('thumbprops');
    // The thumb keeps its own shape: a host className must not replace it.
    expect(thumb.className).toContain('rounded-full');
  });

  it('readonly: the row that renders no control is still named and described', async () => {
    renderForm('slider', { readonly: true });
    const row = await formRow();

    const label = row.querySelector('label')!;
    const named = row.querySelector('[role="group"]')!;
    expect(named).toHaveAttribute('aria-labelledby', label.id);
    expect(describedByConsumers(row)).toEqual([named]);
    // Control-channel state does not follow it there (objectui#4005's line).
    expect(named).not.toHaveAttribute('aria-invalid');
  });
});

describe('signature is named and described, and marks nothing (objectui#3318)', () => {
  it('is NAMED by its visible label on a container that can carry a name', async () => {
    renderForm('signature');
    const row = await formRow();

    const label = row.querySelector('label')!;
    expect(label).not.toHaveAttribute('for');

    const group = screen.getByRole('group');
    expect(group).toHaveAttribute('aria-labelledby', label.id);
    expect(screen.getByRole('group', { name: /Confidence/ })).toBe(group);
    // The canvas is inside the named group; it is not itself the name carrier,
    // because a role-less element cannot take an author name.
    expect(group.querySelector('canvas')).toBeTruthy();
  });

  it('is DESCRIBED by its help text on that same container', async () => {
    renderForm('signature');
    const row = await formRow();

    const consumers = describedByConsumers(row);
    expect(consumers).toHaveLength(1);
    expect(consumers[0]).toBe(screen.getByRole('group'));
  });

  it('does NOT take control-channel state, because it has no control', async () => {
    renderForm('signature');
    await formRow();
    const after = await failValidation();

    // The other half of objectui#3318's split verdict for this widget, pinned
    // from the positive side so a later "just spread everything" is caught
    // here as well as by the sweep's NOT_APPLICABLE guard.
    expect(after.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(screen.getByRole('group')).not.toHaveAttribute('aria-required');
  });
});

describe('the single-control path is untouched (control group)', () => {
  it('text keeps a working `for` and takes no IDREF name', async () => {
    renderForm('text');
    const row = await formRow();

    const label = row.querySelector('label')!;
    const input = row.querySelector('input')!;
    expect(label).toHaveAttribute('for', input.id);
    // Two channels naming one control is the thing the declaration avoids.
    expect(input).not.toHaveAttribute('aria-labelledby');
    expect(describedByConsumers(row)).toEqual([input]);
  });
});
