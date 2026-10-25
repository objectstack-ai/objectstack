/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The form renderer's built-in `textarea` branch — third of the three surfaces
 * whose fullscreen dialog announced nothing about validation and named nothing
 * at all (objectui#4824 / #4832).
 *
 * This one is the reason the fix could not be scoped to `@object-ui/fields`.
 * `mobile.fullscreenLongText` is ONE form-level promise honoured on two render
 * paths, and a `fields`-scoped sweep cannot see this path at all — it lives
 * here, it is unregistered, and #4824's measurement found it broken in exactly
 * the same way as the two registered widgets (#4250's half-fix lesson, stated
 * as a scope fence).
 *
 * It is also the only one of the three that can be measured against a REAL
 * `<FormMessage>`: this branch renders inside `<FormControl>` with the form's
 * own message node as a sibling, so the forbidden shape has a real target here
 * and the pin can assert it was not taken.
 *
 * ## The forbidden shape, and why it needs its own assertions
 *
 * ⛔ Pointing the dialog control's `aria-describedby` / `aria-errormessage` at
 * the host's `<FormMessage>` id. It is the cheapest-looking fix — the id exists,
 * the node has the right text, every assertion about names and descriptions
 * goes green — and it is an ARIA MUST violation: Radix `aria-hidden`s
 * everything outside the modal for exactly as long as the reference is live.
 * happy-dom and jsdom compute accessible names/descriptions straight off the
 * IDREF, so no amount of `toHaveAccessibleDescription` can tell the two apart.
 *
 * The assertions that can: the named node is INSIDE the dialog, and the id is
 * not the form item's message id. Both are below, on every IDREF this branch
 * emits.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

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

const longText = (over: Record<string, unknown> = {}) => ({
  name: 'notes',
  label: 'F',
  type: 'textarea',
  mobile_fullscreen: true,
  ...over,
});

const submit = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));

/**
 * Fails the form, then opens the dialog — the exact sequence a user hits: the
 * field is already invalid when the fullscreen editor is opened to fix it.
 */
async function failThenOpen(fields: any[] = [longText({ required: true })]) {
  const { container } = renderForm(fields, { notes: '' });
  submit();
  await waitFor(() => {
    expect(screen.getByText('F is required')).toBeInTheDocument();
  });

  const formMessage = screen.getByText('F is required');
  fireEvent.click(screen.getByTestId('form-textarea-fullscreen-toggle'));

  return {
    formMessage,
    // The INLINE control. Located through `container` rather than by label:
    // once the fix lands, the dialog's textarea answers to the field name too
    // (that is #4832), so `getByLabelText('F')` would match both. The dialog is
    // portalled to `document.body`, outside this tree.
    inline: container.querySelector('textarea') as HTMLTextAreaElement,
    dialog: screen.getByTestId('form-textarea-fullscreen-dialog'),
    input: screen.getByTestId('form-textarea-fullscreen-input'),
  };
}

describe('form renderer built-in textarea — the dialog tells the truth about validation (objectui#4824)', () => {
  it('announces aria-invalid="true" on the dialog control', async () => {
    const { input } = await failThenOpen();

    // Measured `null` before: the attribute was absent entirely, on the surface
    // the phone user is actually typing into.
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('names a message node that lives INSIDE the dialog, not the form FormMessage', async () => {
    const { formMessage, dialog, input } = await failThenOpen();

    const id = input.getAttribute('aria-errormessage');
    expect(id).toBeTruthy();
    // Single IDREF — a list resolves to nothing in this toolchain.
    expect(id).not.toContain(' ');

    const named = document.getElementById(id!);
    expect(named).toHaveTextContent('F is required');
    // ⛔ THE assertion. `formMessage` has the same text and a resolvable id, so
    // every text-based check passes for the forbidden shape; only ownership
    // separates them.
    expect(dialog).toContainElement(named);
    expect(dialog).not.toContainElement(formMessage);
    expect(id).not.toBe(formMessage.id);
  });

  it('does not point the dialog control describedby at anything outside the dialog', async () => {
    const { dialog, input } = await failThenOpen();

    // The built-in branch's dialog textarea composes no description of its own,
    // so the only way this attribute could appear is a host id leaking in —
    // and every host id names a node the modal has hidden.
    const describedBy = input.getAttribute('aria-describedby');
    if (describedBy) {
      for (const id of describedBy.split(/\s+/)) {
        expect(dialog).toContainElement(document.getElementById(id));
      }
    }
  });

  it('leaves the inline control pointing at the form message as before', async () => {
    // The other direction: the dialog getting its own node must not have moved
    // the INLINE control off `<FormControl>`'s wiring.
    const { formMessage, inline } = await failThenOpen();

    expect(inline).toHaveAttribute('aria-invalid', 'true');
    expect(inline.getAttribute('aria-describedby')).toContain(formMessage.id);
  });

  it('renders no message node while the field is valid', async () => {
    renderForm([longText({ required: true })], { notes: 'already filled in' });

    fireEvent.click(screen.getByTestId('form-textarea-fullscreen-toggle'));

    const input = screen.getByTestId('form-textarea-fullscreen-input');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input).not.toHaveAttribute('aria-errormessage');
    expect(
      screen.queryByTestId('form-textarea-fullscreen-error'),
    ).not.toBeInTheDocument();
  });

  it('keeps ONE readable copy of the message text in the dialog', async () => {
    // The 2026-08-16 restatement of objectui#3222. Both copies exist in the
    // document while the dialog is open — that is unavoidable, `<FormMessage>`
    // stays mounted behind the overlay — but only one is inside the modal, and
    // the modal is the only part of the tree assistive technology can reach.
    const { dialog } = await failThenOpen();

    const copies = screen.getAllByText('F is required');
    expect(copies).toHaveLength(2);
    expect(copies.filter((el) => dialog.contains(el))).toHaveLength(1);
  });
});

describe('form renderer built-in textarea — the dialog control is NAMED (objectui#4832)', () => {
  it('takes its name from the dialog title, which is the field label', async () => {
    const { dialog, input } = await failThenOpen();

    // Measured empty before, against `F` on the inline control.
    expect(input).toHaveAccessibleName('F');
    // From the visible title, not a second string author (#3978).
    expect(input).not.toHaveAttribute('aria-label');
    const labelledBy = document.getElementById(input.getAttribute('aria-labelledby')!);
    expect(labelledBy).toHaveTextContent('F');
    expect(dialog).toContainElement(labelledBy);
  });

  it('leaves the dialog itself named (objectui#3393)', async () => {
    await failThenOpen();

    expect(screen.getByRole('dialog')).toHaveAccessibleName('F');
  });

  it('names the control on a valid field too', async () => {
    renderForm([longText()], { notes: 'hello' });
    fireEvent.click(screen.getByTestId('form-textarea-fullscreen-toggle'));

    expect(screen.getByTestId('form-textarea-fullscreen-input')).toHaveAccessibleName('F');
  });

  it('gives two long-text fields on one form two DISTINCT dialog control names', async () => {
    renderForm([longText(), longText({ name: 'summary', label: 'Summary' })], {
      notes: 'a',
      summary: 'b',
    });

    fireEvent.click(screen.getAllByTestId('form-textarea-fullscreen-toggle')[1]);

    expect(screen.getByTestId('form-textarea-fullscreen-input')).toHaveAccessibleName(
      'Summary',
    );
  });
});

describe('form renderer built-in textarea — `error` stays off the DOM (objectui#3222)', () => {
  it('puts no `error` attribute on the inline or the dialog control', async () => {
    // `error` is forwarded to this branch by name, off the PRE-strip props,
    // exactly like `label` — `stripRendererOnlyProps` still discards it, so it
    // must not reappear as a stray attribute on either textarea.
    const { inline, input } = await failThenOpen();

    expect(input).not.toHaveAttribute('error');
    expect(inline).not.toHaveAttribute('error');
  });
});
