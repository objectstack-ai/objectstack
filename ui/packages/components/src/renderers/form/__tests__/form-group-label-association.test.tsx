/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A field whose widget is NOT a labelable element gets its label associated by
 * IDREF instead of `for` (objectui#3961) — the host half of the fix.
 *
 * The defect: `<FormLabel>` emits `htmlFor={formItemId}` unconditionally. For a
 * single `<input>` that is correct and complete. For a composite widget it is
 * inert HTML: `address` / `geolocation` overwrote the handed-down id with their
 * sub-input ids, so the `for` named an id NOTHING carried; `checkboxes` / `radio`
 * / `rating` / `file` kept it, but on a `div`, and `<label for>` pointing at a
 * non-labelable element activates nothing and contributes no accessible name
 * (`HTMLLabelElement.control` is `null`). Measured on `origin/main`, all six
 * visible group labels were the accessible name of NOTHING.
 *
 * The host cannot infer which case it is from the DOM the widget renders, so the
 * widget DECLARES it (`ComponentMeta.labelling`) and this renderer branches:
 *
 *   • `'group'` → the label publishes an `id` and drops its `for`; the widget
 *     receives `aria-labelledby` pointing at it (IDREF works on any element).
 *   • anything else, including undeclared → unchanged, byte for byte.
 *
 * That second bullet is why the tests below assert on KEY PRESENCE as well as on
 * values: the single-control path must not acquire a second naming channel. One
 * fact, one author — the same rule that kept `required` out of the widget
 * contract (#3290), the message text out of it (#3222), and the duplicate label
 * out of `BooleanField` (#3952).
 *
 * No `ui/form.tsx` change is involved (AGENTS.md #7 Shadcn no-touch):
 * `<FormLabel>` spreads its props onto `Label` AFTER its own `htmlFor`, so both
 * halves travel as ordinary props.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

/**
 * Stands in for a real composite widget (`@object-ui/components` tests never load
 * `@object-ui/fields`) and mirrors the mechanism the fix relies on: spread the
 * leftover props onto the container it renders, and answer a host-supplied
 * `aria-labelledby` with the matching role.
 *
 * `data-labelledby-key` distinguishes "the renderer computed nothing" from "a
 * strip function ate the prop" — the failure mode #3231's `emptyHint` had, and
 * the only thing that tells the two apart.
 */
function GroupProbe(props: any) {
  const { name, value, onChange, field: _field, error: _error, ...rest } = props;
  return (
    <div
      data-testid={`group-${name}`}
      data-labelledby-key={'aria-labelledby' in props ? 'yes' : 'no'}
      role={props['aria-labelledby'] ? 'group' : undefined}
      {...rest}
    >
      <label htmlFor={`${name}-part-a`}>Part A</label>
      <input id={`${name}-part-a`} value={(value as string) ?? ''} onChange={(e) => onChange?.(e.target.value)} />
    </div>
  );
}

/** Same widget, registered WITHOUT the declaration — the control path. */
function ControlProbe(props: any) {
  const { name, value, onChange, field: _field, error: _error, ...rest } = props;
  return (
    <input
      data-testid={`control-${name}`}
      data-labelledby-key={'aria-labelledby' in props ? 'yes' : 'no'}
      value={(value as string) ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      {...rest}
    />
  );
}

beforeAll(() => {
  ComponentRegistry.register('groupprobe', GroupProbe, { namespace: 'field', labelling: 'group' });
  ComponentRegistry.register('controlprobe', ControlProbe, { namespace: 'field' });
  // Declared `group` under a name the renderer treats as BUILTIN. Nothing should
  // read this declaration: `renderFieldComponent` never consults the registry for
  // a builtin type, so honouring it here would re-address the label of a control
  // this widget does not render. Pinned by the last test in this file.
  ComponentRegistry.register('select', GroupProbe, { namespace: 'field', labelling: 'group' });
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
        showSubmit: false,
        showCancel: false,
        defaultValues,
        fields,
      }}
    />,
  );
}

/** The visible label of `name`'s form item. */
function hostLabel(name: string): HTMLLabelElement {
  const el = document.querySelector(`[data-field="${name}"] label`);
  if (!el) throw new Error(`no label rendered for field "${name}"`);
  return el as HTMLLabelElement;
}

describe('form renderer — a declared GROUP widget is labelled by IDREF (objectui#3961)', () => {
  it('names the group container, which a `for` could not do', () => {
    renderForm([{ name: 'shipping', label: 'Shipping Address', type: 'groupprobe' }]);

    // The one assertion that was 0 before the fix and is 1 after: an element in
    // the accessibility tree whose NAME is the visible group label.
    const group = screen.getByRole('group', { name: 'Shipping Address' });
    expect(group).toBe(screen.getByTestId('group-shipping'));
  });

  it('gives the label an id and takes its `for` away', () => {
    renderForm([{ name: 'shipping', label: 'Shipping Address', type: 'groupprobe' }]);

    const label = hostLabel('shipping');
    // `htmlFor: undefined` through the props spread is not a no-op — `<FormLabel>`
    // sets `htmlFor` BEFORE spreading, so this is what removes the attribute. A
    // `for` left in place beside the `aria-labelledby` would give one label two
    // association channels, one of them inert.
    expect(label).not.toHaveAttribute('for');
    expect(label.id).not.toBe('');
    expect(screen.getByTestId('group-shipping')).toHaveAttribute('aria-labelledby', label.id);
  });

  it('the IDREF resolves to an element that exists', () => {
    // `aria-labelledby` pointing at a missing id fails SILENTLY — no warning, no
    // name, nothing to notice. Measured while writing this fix: a dangling IDREF
    // and a correct one are indistinguishable in the markup.
    renderForm([{ name: 'shipping', label: 'Shipping Address', type: 'groupprobe' }]);

    const idref = screen.getByTestId('group-shipping').getAttribute('aria-labelledby')!;
    expect(document.getElementById(idref)).toBe(hostLabel('shipping'));
  });

  it('two group fields in one form get distinct label ids', () => {
    renderForm([
      { name: 'shipping', label: 'Shipping Address', type: 'groupprobe' },
      { name: 'billing', label: 'Billing Address', type: 'groupprobe' },
    ]);

    const shipping = hostLabel('shipping').id;
    const billing = hostLabel('billing').id;
    expect(shipping).not.toBe(billing);
    // A shared id would make BOTH groups announce the first label.
    expect(screen.getByRole('group', { name: 'Shipping Address' })).toBe(screen.getByTestId('group-shipping'));
    expect(screen.getByRole('group', { name: 'Billing Address' })).toBe(screen.getByTestId('group-billing'));
  });

  it('emits an id with no whitespace, because IDREFs are space-separated', () => {
    // `aria-labelledby` is a LIST attribute. An id containing a space silently
    // resolves to two ids, neither of which exists — the dangling-IDREF failure
    // above, arrived at from a field name rather than from a bug.
    renderForm([{ name: 'ship to', label: 'Ship To', type: 'groupprobe' }]);

    const id = hostLabel('ship to').id;
    expect(id).not.toMatch(/\s/);
    expect(document.getElementById(id)).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Ship To' })).toHaveAttribute('aria-labelledby', id);
  });

  it('passes no label id when the field renders no label at all', () => {
    // Compact layouts and inline grid editing render a field with no `<FormLabel>`.
    // There is then no element to point at, and an `aria-labelledby` naming a
    // missing id is worse than none: it suppresses nothing but resolves to
    // nothing either.
    renderForm([{ name: 'shipping', type: 'groupprobe' }]);

    const probe = screen.getByTestId('group-shipping');
    expect(probe).toHaveAttribute('data-labelledby-key', 'no');
    expect(probe).not.toHaveAttribute('aria-labelledby');
    expect(probe).not.toHaveAttribute('role');
  });
});

describe('form renderer — the single-control path is untouched (objectui#3961)', () => {
  it('keeps `for` → id and hands the widget no second naming channel', () => {
    renderForm([{ name: 'title', label: 'Title', type: 'controlprobe' }]);

    const input = screen.getByTestId('control-title');
    const label = hostLabel('title');
    // Unchanged association: `for` names the id `<FormControl>`'s Slot injected.
    expect(label.getAttribute('for')).toBe(input.getAttribute('id'));
    expect(label.id).toBe('');
    // Not merely "no attribute" — the KEY never reaches the widget. An
    // `aria-labelledby` alongside the working `for` would give one label two
    // authors, and `aria-labelledby` WINS over `<label for>`, so a future
    // divergence between them would silently rename every field.
    expect(input).toHaveAttribute('data-labelledby-key', 'no');
    expect(input).not.toHaveAttribute('aria-labelledby');
    expect(screen.getByLabelText('Title')).toBe(input);
  });

  it('an UNDECLARED composite still takes the control path — and stays detectable', () => {
    // The safe default, and the reason the declaration is worth its cost: a new
    // composite widget that forgets to declare itself does not silently emit an
    // `aria-labelledby` onto a role-less container. It keeps the `for`, which the
    // label-association pins (objectui#3952 / this issue's fields e2e) report as
    // an association that resolves to a non-labelable element.
    ComponentRegistry.register('undeclaredgroup', GroupProbe, { namespace: 'field' });
    renderForm([{ name: 'shipping', label: 'Shipping Address', type: 'undeclaredgroup' }]);

    const label = hostLabel('shipping');
    expect(label).toHaveAttribute('for');
    const target = document.getElementById(label.getAttribute('for')!);
    expect(target).toBe(screen.getByTestId('group-shipping'));
    // …and that target is a `div`: the inert association this issue is about.
    expect(target!.tagName.toLowerCase()).toBe('div');
    expect(screen.queryAllByLabelText('Shipping Address')).toHaveLength(0);
  });

  it('a BUILTIN type ignores a registry declaration under the same name', () => {
    // `renderFieldComponent` resolves a bare `select` to the builtin `<Select>`
    // branch and never consults the registry, so `resolveFieldLabelling` must not
    // either — reading `field:select`'s declaration would strip the `for` off a
    // label whose control is the builtin trigger, breaking a working field on
    // behalf of a widget that is not rendering.
    renderForm([
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        options: [{ label: 'Draft', value: 'draft' }],
      },
    ]);

    const label = hostLabel('status');
    expect(label).toHaveAttribute('for');
    expect(label.id).toBe('');
    expect(document.querySelector('[data-testid="group-status"]')).toBeNull();
  });
});
