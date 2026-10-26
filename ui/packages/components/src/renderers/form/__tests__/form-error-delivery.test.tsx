/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The validation message must actually REACH a registered field widget
 * (objectui#3222) — the producer half of "declared ≠ delivered", again.
 *
 * `@objectstack/spec/ui`'s `FieldWidgetPropsSchema` has declared `error?:
 * string` on the field-widget props contract for as long as the contract has
 * been published, and the protocol page teaches widgets to destructure it.
 * objectui declared its own slot under a different name (`errorMessage`) —
 * but the measured fact was sharper than a naming split:
 *
 *     producers of `errorMessage` anywhere in packages/ + apps/ :  0
 *     reads of `errorMessage` in packages/fields/src            : 15
 *     reads of `props.error`                                    :  0
 *
 * The slot was dead under BOTH spellings. This renderer showed validation text
 * through its own `<FormMessage/>` and never forwarded the prop, so seven
 * widgets computed `aria-invalid={!!errorMessage}` from a permanent
 * `undefined`: `aria-invalid` was never once set, and a screen reader was
 * never told the field had failed. Renaming alone would have swapped one dead
 * key for another, so #3222 landed the rename together with THIS — the
 * renderer producing `fieldState.error?.message` as `error`.
 *
 * Note what a widget must NOT do with it: render the text. `<FormMessage/>`
 * below the control already owns the message; a widget that prints it too
 * double-displays it. The widget's whole job here is `aria-invalid`, which has
 * to live on the input element — and only the widget renders that element.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

/**
 * Stands in for a real field widget (`@object-ui/components` tests never load
 * `@object-ui/fields`), and mirrors what the seven real ones do: compute
 * `aria-invalid` from `error`, render no message text of its own.
 *
 * It deliberately does NOT spread its leftover props onto the input. That
 * matters: `<FormControl>` is a Radix `Slot` and hands its child a correct
 * `aria-invalid` already, so a probe that spread it would go green whether or
 * not the renderer produced `error` — the assertion has to come from the prop.
 * (In production the real widgets have the inverse problem: their own
 * `aria-invalid` is written AFTER the spread, so it OVERRIDES the Slot's — a
 * widget computing it from a prop nobody passed actively unsets the correct
 * value. That is the defect this delivery closes.)
 */
function ErrorProbe(props: any) {
  const { error, name, value, onChange } = props;
  return (
    <input
      aria-label={name}
      data-testid={`probe-${name}`}
      data-has-error-key={'error' in props ? 'yes' : 'no'}
      data-error={error === undefined ? 'NONE' : String(error)}
      aria-invalid={!!error}
      value={(value as string) ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}

beforeAll(() => {
  ComponentRegistry.register('probe', ErrorProbe, { namespace: 'field' });
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

function renderForm(fields: any[], defaultValues: Record<string, unknown> = {}, onSubmit?: any) {
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
        onSubmit: onSubmit ?? (() => {}),
      }}
    />,
  );
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));

describe('form renderer — `error` delivery to registered widgets (objectui#3222)', () => {
  it('a registered widget marks its control aria-invalid when validation fails', async () => {
    // THE test the issue makes a hard requirement. Before #3222 this asserted
    // nothing that could ever be true: the prop had no producer, so the probe's
    // `!!error` was `!!undefined` no matter how badly the field failed.
    renderForm([{ name: 'title', label: 'Title', type: 'probe', required: true }], { title: '' });

    const probe = screen.getByTestId('probe-title');
    expect(probe).toHaveAttribute('aria-invalid', 'false');

    submit();

    await waitFor(() => {
      expect(screen.getByTestId('probe-title')).toHaveAttribute('aria-invalid', 'true');
    });
    // …and it is the real message, not a boolean smuggled through — a widget
    // may want it for `aria-errormessage` or a title attribute.
    expect(screen.getByTestId('probe-title')).toHaveAttribute('data-error', 'Title is required');
  });

  it('delivers a field-authored message verbatim, not the generated one', async () => {
    renderForm(
      [
        {
          name: 'title',
          label: 'Title',
          type: 'probe',
          required: true,
          validation: { required: 'Give the task a name' },
        },
      ],
      { title: '' },
    );

    submit();

    await waitFor(() => {
      expect(screen.getByTestId('probe-title')).toHaveAttribute('data-error', 'Give the task a name');
    });
  });

  it('renders the message exactly ONCE — the widget drives a11y, `<FormMessage/>` owns the text', async () => {
    // Scope item the ruling is explicit about: splitting the responsibility is
    // the point. If a widget also printed `error`, the user would read the same
    // sentence twice. The probe keeps it in an attribute, so exactly one node
    // carries the text.
    renderForm([{ name: 'title', label: 'Title', type: 'probe', required: true }], { title: '' });

    submit();

    await waitFor(() => expect(screen.getAllByText('Title is required')).toHaveLength(1));
  });

  it('withdraws the message once the field becomes valid again', async () => {
    renderForm([{ name: 'title', label: 'Title', type: 'probe', required: true }], { title: '' });

    submit();
    await waitFor(() => {
      expect(screen.getByTestId('probe-title')).toHaveAttribute('aria-invalid', 'true');
    });

    fireEvent.change(screen.getByTestId('probe-title'), { target: { value: 'Write the report' } });

    await waitFor(() => {
      expect(screen.getByTestId('probe-title')).toHaveAttribute('aria-invalid', 'false');
    });
    expect(screen.getByTestId('probe-title')).toHaveAttribute('data-error', 'NONE');
  });

  it('always passes the KEY, so a widget can tell "valid" from "not forwarded"', () => {
    // `emptyHint` (objectui#3231) was lost to a strip, not to a missing
    // computation — key presence is what distinguishes the two failure modes,
    // and `stripRegisteredFieldProps` must never start eating this one.
    renderForm([{ name: 'title', label: 'Title', type: 'probe' }], { title: 'ok' });

    const probe = screen.getByTestId('probe-title');
    expect(probe).toHaveAttribute('data-has-error-key', 'yes');
    expect(probe).toHaveAttribute('data-error', 'NONE');
  });
});

describe('form renderer — `error` is not leaked to the DOM by the builtin branch', () => {
  it('a builtin control gets aria-invalid from <FormControl>, and no stray `error` attribute', async () => {
    // Builtin types render their control directly inside `<FormControl>`, whose
    // Slot already injects `aria-invalid`/`aria-describedby`. There is no widget
    // to consume `error` there, so `stripRendererOnlyProps` drops it rather than
    // spilling `error="Title is required"` into the markup.
    renderForm([{ name: 'title', label: 'Title', type: 'input', required: true }], { title: '' });

    submit();

    const input = screen.getByLabelText(/title/i);
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    expect(input).not.toHaveAttribute('error');
  });
});
