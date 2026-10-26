/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The required STATE must reach the input control, not just the label
 * (objectui#3290) — the third "declared ≠ delivered" gap in this renderer,
 * after `error` (#3222) and `emptyHint` (#3231).
 *
 * The renderer has always computed a correct `required` (static `required`
 * merged with the `requiredWhen` CEL verdict) and then spent it on exactly one
 * thing: the red asterisk in `<FormLabel>`. That asterisk carried
 * `aria-label="required"`, so the ONLY way the state reached assistive tech was
 * by `<label for>` folding it into the control's ACCESSIBLE NAME — the field
 * was read as "Title required". A state smuggled through a name is broken three
 * ways:
 *
 *   1. it is announced in name order rather than as a state, and "list the
 *      required fields" style navigation cannot see it at all;
 *   2. a field rendered without a `label` (compact layouts, inline grid
 *      editing) draws no asterisk, so the signal disappears completely;
 *   3. `requiredWhen` makes required DYNAMIC — a state channel expresses the
 *      flip, a name does not.
 *
 * The fix costs one host-side prop and zero widget changes: `aria-required` is
 * already declared and typed on the widget props contract
 * (`FieldWidgetComponentProps & AriaAttributes`) and every widget forwards its
 * leftover props to the control it renders; neither strip function touches
 * `aria-*`. That is exactly why #3222 refused to sink a `required` BOOLEAN into
 * the widget contract — a boolean gives the asterisk a second author, and the
 * next AI-written widget draws its own.
 *
 * Two things this deliberately does NOT do, both ruled on in the issue:
 *   • the asterisk keeps rendering but is now `aria-hidden` — the state channel
 *     is the single source, so nothing is announced twice;
 *   • no native `required` attribute — that would arm the browser's own
 *     constraint-validation bubble alongside react-hook-form's messages.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

/**
 * Stands in for a real field widget (`@object-ui/components` tests never load
 * `@object-ui/fields`) and mirrors the mechanism the fix relies on: destructure
 * the props it understands, spread the REST onto the control it renders. That
 * spread is what carries `aria-required` to the DOM with no widget change.
 *
 * `data-aria-required-key` distinguishes "the renderer computed FALSE" from
 * "a strip function ate the prop" — `emptyHint` (#3231) was lost to a strip,
 * not to a missing computation, and key presence is the only thing that tells
 * those two failure modes apart.
 */
function RequiredProbe(props: any) {
  const { name, value, onChange, field: _field, error: _error, ...rest } = props;
  return (
    <input
      data-testid={`probe-${name}`}
      data-aria-required-key={'aria-required' in props ? 'yes' : 'no'}
      name={name}
      value={(value as string) ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      {...rest}
    />
  );
}

beforeAll(() => {
  ComponentRegistry.register('reqprobe', RequiredProbe, { namespace: 'field' });
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

describe('form renderer — `aria-required` reaches the control (objectui#3290)', () => {
  it('sets aria-required="true" on a BUILTIN control for a statically required field', () => {
    renderForm([{ name: 'title', label: 'Title', type: 'input', required: true }], { title: '' });

    expect(screen.getByLabelText(/title/i)).toHaveAttribute('aria-required', 'true');
  });

  it('sets aria-required="true" on a REGISTERED widget for a statically required field', () => {
    // The other half of the fork `renderFieldComponent` makes: registered
    // widgets go through `stripRegisteredFieldProps`, builtins through
    // `stripRendererOnlyProps`. Both must pass `aria-*` through, so both get a
    // test — a strip added to one path only would otherwise land silently.
    renderForm([{ name: 'title', label: 'Title', type: 'reqprobe', required: true }], { title: '' });

    const probe = screen.getByTestId('probe-title');
    expect(probe).toHaveAttribute('aria-required', 'true');
    expect(probe).toHaveAttribute('data-aria-required-key', 'yes');
  });

  it('omits the attribute entirely on an optional field, rather than writing "false"', () => {
    // `|| undefined`, not `String(required)`. `aria-required="false"` is legal
    // but noisier than absence, and absence is what the `requiredWhen` FALSE
    // case below has to produce — asserting it here pins the spelling.
    renderForm(
      [
        { name: 'title', label: 'Title', type: 'input' },
        { name: 'notes', label: 'Notes', type: 'reqprobe' },
      ],
      { title: '', notes: '' },
    );

    expect(screen.getByLabelText(/title/i)).not.toHaveAttribute('aria-required');
    expect(screen.getByTestId('probe-notes')).not.toHaveAttribute('aria-required');
  });

  it('flips the attribute on and off as `requiredWhen` re-evaluates', async () => {
    // The case a name-shaped signal cannot express at all. `requiredWhen` is
    // the same CEL the server enforces, so the announced state has to track it
    // reactively, not just at first paint.
    renderForm(
      [
        { name: 'status', label: 'Status', type: 'input' },
        {
          name: 'paid_on',
          label: 'Paid On',
          type: 'input',
          requiredWhen: "record.status == 'paid'",
        },
      ],
      { status: 'draft', paid_on: '' },
    );

    const paidOn = () => screen.getByLabelText(/paid on/i);
    expect(paidOn()).not.toHaveAttribute('aria-required');

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'paid' } });
    await waitFor(() => expect(paidOn()).toHaveAttribute('aria-required', 'true'));

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'draft' } });
    await waitFor(() => expect(paidOn()).not.toHaveAttribute('aria-required'));
  });

  it('reaches a required field that renders WITHOUT a label', () => {
    // The failure mode that motivated the issue: no label ⇒ no asterisk ⇒
    // under the old design the required signal did not exist at all. The state
    // channel does not depend on a label being rendered.
    renderForm([{ name: 'title', type: 'reqprobe', required: true }], { title: '' });

    expect(screen.getByTestId('probe-title')).toHaveAttribute('aria-required', 'true');
  });
});

describe('form renderer — the asterisk is visual only (objectui#3290)', () => {
  it('keeps required OUT of the accessible name now that it is a state', () => {
    // Asserted on the COMPUTED ACCESSIBLE NAME, not on markup: the regression
    // being pinned is "assistive tech hears required twice", and only the name
    // computation shows that. Pre-fix this read "Title required".
    renderForm([{ name: 'title', label: 'Title', type: 'input', required: true }], { title: '' });

    const input = screen.getByRole('textbox', { name: 'Title' });
    expect(input).toHaveAccessibleName('Title');
    expect(input).toHaveAttribute('aria-required', 'true');
  });

  it('still renders the asterisk for sighted users, hidden from the a11y tree', () => {
    const { container } = renderForm(
      [{ name: 'title', label: 'Title', type: 'input', required: true }],
      { title: '' },
    );

    const marker = container.querySelector('span[data-required-marker]');
    expect(marker).not.toBeNull();
    expect(marker).toHaveTextContent('*');
    expect(marker).toHaveAttribute('aria-hidden', 'true');
    // The old a11y-attribute-as-test-hook is gone; nothing should reintroduce
    // it, or the double announcement comes back with it.
    expect(marker).not.toHaveAttribute('aria-label');
  });

  it('renders no marker at all for an optional field', () => {
    const { container } = renderForm([{ name: 'title', label: 'Title', type: 'input' }], {
      title: '',
    });

    expect(container.querySelector('span[data-required-marker]')).toBeNull();
  });
});

describe('form renderer — no native `required` (objectui#3290)', () => {
  it('never sets the native attribute, on either render path', () => {
    // Ruled out deliberately: a native `required` arms the browser's own
    // validation bubble on top of react-hook-form's `<FormMessage/>` — two
    // validators disagreeing about the same field. `aria-required` announces
    // the state without triggering native constraint validation. This is a
    // regression fence: the "obvious" follow-up to this fix is exactly the
    // change that must not happen.
    renderForm(
      [
        { name: 'title', label: 'Title', type: 'input', required: true },
        { name: 'notes', label: 'Notes', type: 'reqprobe', required: true },
      ],
      { title: '', notes: '' },
    );

    // NOT `toBeRequired()` — jest-dom counts `aria-required="true"` as
    // required, so that matcher can never distinguish the two channels and
    // would pass no matter which one we shipped. The native attribute (and the
    // `required` IDL property that arms constraint validation) is the thing
    // under test, so assert on it directly.
    const builtin = screen.getByLabelText(/title/i) as HTMLInputElement;
    expect(builtin).toHaveAttribute('aria-required', 'true');
    expect(builtin).not.toHaveAttribute('required');
    expect(builtin.required).toBe(false);

    const widget = screen.getByTestId('probe-notes') as HTMLInputElement;
    expect(widget).toHaveAttribute('aria-required', 'true');
    expect(widget).not.toHaveAttribute('required');
    expect(widget.required).toBe(false);
  });
});
