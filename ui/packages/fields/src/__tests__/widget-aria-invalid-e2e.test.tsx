/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * End-to-end: a REAL widget, inside the REAL form renderer, announces an
 * invalid field to assistive tech (objectui#3222).
 *
 * The two halves of this contract have unit tests of their own — the widgets
 * mark themselves invalid when handed an `error`
 * (`validation-feedback.test.tsx`), and the form renderer produces one
 * (`form-error-delivery.test.tsx` in `@object-ui/components`). Neither alone
 * would have caught the actual defect, because the defect was precisely that
 * the two halves never met: the widgets read `errorMessage`, the spec's
 * published contract said `error`, and NOTHING in `packages/` or `apps/`
 * produced either. Seven widgets computed `aria-invalid={!!errorMessage}` from
 * a value that was `undefined` forever, so `aria-invalid` had never once been
 * set on a failing field.
 *
 * So this file joins them: real react-hook-form validation, real widget, one
 * assertion per widget that the control is `aria-invalid="true"` after the
 * failure and `"false"` before it. `aria-invalid="false"` up front is the load
 * bearing half of each pair — `<FormControl>` is a Radix `Slot` that hands its
 * child a correct `aria-invalid`, and the widget's own attribute is written
 * AFTER the props spread, so it wins. A widget computing it from a prop nobody
 * passes does not merely miss the signal, it OVERWRITES the correct one with
 * `false`.
 *
 * The widgets are registered raw rather than through `registerAllFields()`,
 * which wraps every loader in `React.lazy`: an unbounded module load inside a
 * bounded `findBy`/`waitFor` window is the repo's known flake generator
 * (AGENTS.md 测试纪律, objectui#3010). Same component, no Suspense boundary.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';

import { EmailField } from '../widgets/EmailField';
import { PhoneField } from '../widgets/PhoneField';
import { UrlField } from '../widgets/UrlField';
import { TextAreaField } from '../widgets/TextAreaField';
import { CurrencyField } from '../widgets/CurrencyField';
import { PercentField } from '../widgets/PercentField';
import { RichTextField } from '../widgets/RichTextField';
import { TextField } from '../widgets/TextField';
import { SelectField } from '../widgets/SelectField';
import { NumberField } from '../widgets/NumberField';

/**
 * The widgets that read the validation slot, by their form-path key: the seven
 * from objectui#3222, plus `select` (objectui#3306) — the widget whose control
 * is a Radix trigger rather than a native input, where every aria-* used to be
 * swallowed by the non-DOM `Select.Root`.
 */
const WIDGETS = [
  ['email', EmailField],
  ['phone', PhoneField],
  ['url', UrlField],
  ['textarea', TextAreaField],
  ['currency', CurrencyField],
  ['percent', PercentField],
  ['markdown', RichTextField],
  ['select', SelectField],
  ['number', NumberField],
] as const;

beforeAll(() => {
  for (const [type, Widget] of WIDGETS) {
    ComponentRegistry.register(type, Widget as any, { namespace: 'field', skipFallback: true });
  }
}, 30000);

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForm(field: any, defaultValue: unknown) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        defaultValues: { [field.name]: defaultValue },
        fields: [field],
        onSubmit: () => {},
      }}
    />,
  );
}

/**
 * The control the widget rendered, located through the form row rather than by
 * role — the seven widgets render `input[type=email|tel|url|number]` and
 * `textarea` between them, and the point of the assertion is the ATTRIBUTE,
 * not which element type carries it.
 */
function controlOf(name: string): Element {
  const control = document.querySelector(
    `[data-field="${name}"] input, [data-field="${name}"] textarea`,
  );
  if (!control) throw new Error(`no control rendered for field "${name}"`);
  return control;
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));

describe('field widgets announce an invalid field to AT (objectui#3222)', () => {
  // `field:textarea` because the bare `textarea` key is a BUILTIN_FIELD_TYPE in
  // the form renderer and never reaches the registry — it is the prefixed id
  // (`mapFieldTypeToFormType`) that resolves to this package's widget.
  it.each([
    ['email', 'email', ''],
    ['phone', 'phone', ''],
    ['url', 'url', ''],
    ['field:textarea', 'notes', ''],
    ['currency', 'amount', null],
    ['percent', 'ratio', null],
    ['markdown', 'body', ''],
    ['number', 'quantity', null],
  ] as const)(
    'a required %s field is aria-invalid only AFTER validation fails',
    async (type, name, emptyValue) => {
      renderForm({ name, label: name, type, required: true }, emptyValue);

      // Before the submit there is no error, and the widget must say so —
      // this is the half that a Slot-provided `aria-invalid` cannot fake.
      expect(controlOf(name)).toHaveAttribute('aria-invalid', 'false');

      submit();

      await waitFor(() => {
        expect(controlOf(name)).toHaveAttribute('aria-invalid', 'true');
      });
    },
  );

  it('the message itself is rendered once, by the form — not by the widget', async () => {
    // Responsibility split (the ruling's scope item 3): the widget consumes
    // `error` for `aria-invalid` ONLY. `<FormMessage/>` owns the text; a widget
    // that printed it too would show the user the same sentence twice.
    renderForm({ name: 'email', label: 'Email', type: 'email', required: true }, '');

    submit();

    await waitFor(() => expect(screen.getAllByText('Email is required')).toHaveLength(1));
    // And the message is NOT inside the control the widget rendered.
    expect(controlOf('email')).not.toHaveTextContent('Email is required');
  });

  it('a widget that does NOT read `error` is still marked invalid, by the Slot', async () => {
    // The counterpart that makes the diagnosis precise: `TextField` never
    // computed its own `aria-invalid`, so `<FormControl>`'s Slot value reached
    // its input untouched and it announced invalid fields correctly all along.
    // Only the seven widgets that DID compute one were broken — they wrote
    // theirs after the props spread, so `!!undefined` won.
    //
    // Pinned because the obvious "cleanup" here is to stop forwarding `error`
    // to widgets that do not declare a use for it. That cannot be known (a
    // third-party widget is exactly the case the contract exists for), and
    // withholding it would recreate declared-≠-delivered one widget at a time.
    ComponentRegistry.register('plaintext', TextField as any, { namespace: 'field', skipFallback: true });
    renderForm({ name: 'title', label: 'Title', type: 'plaintext', required: true }, '');

    submit();

    await waitFor(() => expect(controlOf('title')).toHaveAttribute('aria-invalid', 'true'));
  });

  it('clears the invalid state when the field becomes valid again', async () => {
    renderForm({ name: 'email', label: 'Email', type: 'email', required: true }, '');

    submit();
    await waitFor(() => expect(controlOf('email')).toHaveAttribute('aria-invalid', 'true'));

    fireEvent.change(controlOf('email'), { target: { value: 'a@example.com' } });

    await waitFor(() => expect(controlOf('email')).toHaveAttribute('aria-invalid', 'false'));
  });
});

describe('field:select announces validation state on its TRIGGER (objectui#3306)', () => {
  // Radix `Select.Root` renders no DOM element and silently drops every prop
  // it does not recognise. The widget used to spread its DOM pass-through onto
  // Root, so `aria-invalid` / `aria-describedby` / `aria-required` all
  // vanished: a failed required select showed the red message while assistive
  // tech was told nothing. The real control is the focusable
  // `<button role="combobox">` the trigger renders — that is where every
  // assertion below reads from, never a wrapper.
  //
  // `field:select` (not bare `select`) because `select` is a
  // BUILTIN_FIELD_TYPE in the form renderer and never reaches the registry —
  // same reason as `field:textarea` above.
  const OPTIONS = [
    { label: 'Alpha', value: 'alpha' },
    { label: 'Beta', value: 'beta' },
  ];

  const selectField = {
    name: 'choice',
    label: 'Choice',
    type: 'field:select',
    required: true,
    options: OPTIONS,
  };

  /** The trigger button, by role — fails loudly if it stops being a combobox. */
  function trigger(): Element {
    const el = document.querySelector('[data-field="choice"] [role="combobox"]');
    if (!el) throw new Error('no select trigger rendered for field "choice"');
    return el;
  }

  it('a required select is aria-invalid only AFTER validation fails, on the trigger', async () => {
    renderForm(selectField, null);

    // The explicit "false" half is load-bearing, same as the widgets above: a
    // valid field SAYS it is valid rather than staying mute.
    expect(trigger()).toHaveAttribute('aria-invalid', 'false');

    submit();

    // Prove the failure actually rendered before reading aria off it — an
    // error variant that silently produces no error tests nothing.
    await waitFor(() =>
      expect(screen.getAllByText('Choice is required')).toHaveLength(1),
    );
    expect(trigger()).toHaveAttribute('aria-invalid', 'true');
  });

  it('carries aria-required on the trigger — the state channel of objectui#3290', () => {
    renderForm(selectField, null);

    // Root would swallow it; the trigger is "the control" for a Radix select.
    expect(trigger()).toHaveAttribute('aria-required', 'true');
  });

  it('aria-describedby on the trigger references the rendered error message', async () => {
    renderForm(selectField, null);

    submit();

    const message = await screen.findByText('Choice is required');
    // The association is only real if the id chain closes: the trigger must
    // point at the exact element carrying the message text.
    expect(message.id).not.toBe('');
    const describedBy = trigger().getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(/\s+/)).toContain(message.id);
  });
});
