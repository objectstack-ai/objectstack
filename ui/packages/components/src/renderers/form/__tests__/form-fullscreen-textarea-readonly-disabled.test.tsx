/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The fullscreen long-text path honours `readonly` / `disabled` — objectui#3400.
 *
 * `renderFieldComponent` destructures `readonly` off its props at the top, so it
 * is NOT in the `...rest` each branch spreads. The built-in `textarea` branch has
 * two exits and only ONE of them put it back:
 *
 *   - the plain exit spelled `readOnly={readonly}` and the read-only tint;
 *   - the `mobile_fullscreen` exit spelled neither.
 *
 * `FullscreenTextarea` then renders THREE controls — the inline textarea, the
 * expand button, and the dialog's own textarea — and only the first ever saw a
 * spread prop at all. The result, measured on the issue:
 *
 *   READONLY: expand button present = true
 *   READONLY: inline readOnly = false          ← editable in place, no dialog needed
 *   READONLY: dialog readOnly = false / disabled = false
 *   READONLY: value after Done = "EDITED WHILE READONLY"   ← in form state
 *
 *   DISABLED: expand button present = true, button disabled = false
 *   DISABLED: inline disabled = true           ← this one exit WAS held
 *   DISABLED: dialog disabled = false
 *   DISABLED: value after Done = "EDITED WHILE DISABLED"   ← bypassed
 *
 * The disabled case is the nastier of the two precisely because it LOOKS right:
 * the inline control is greyed out, and only the expand button next to it is a
 * way around itself.
 *
 * None of this is an exotic authoring combination. `ObjectForm` stamps
 * `mobile_fullscreen: true` onto EVERY long-text field when
 * `ObjectFormSchema.mobile.fullscreenLongText` is set, without consulting
 * readonly/disabled; `readonly` is also resolved at runtime from a `readonlyWhen`
 * CEL rule; and `disabled` is additionally true for the whole form while
 * `isSubmitting` — so a submit in flight did not stop a long-text edit.
 *
 * The two states are pinned to two DIFFERENT behaviours, deliberately:
 *
 *   - `readonly` → no expand button, matching the registered path
 *     (`fields/src/widgets/TextAreaField.tsx` early-returns a read-only display
 *     before `showFullscreenButton` is computed). objectui#3398 recorded the two
 *     implementations as "behaviourally identical"; this was the first real
 *     divergence, and these cases are the alignment pin that keeps it closed.
 *   - `disabled` → button present but disabled, because disabled means "not
 *     interactive, muted", not "shown plainly" — the same distinction the call
 *     site already draws when it forwards the two as separate props.
 *
 * Beyond the affordance, both states are pinned INSIDE the dialog too. That is
 * not belt-and-braces: `disabled` is also `isSubmitting`, which can flip to true
 * while the dialog is already open, at which point the expand button is no
 * longer the gate.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

function renderForm(schema: Record<string, any>, extraProps: Record<string, any> = {}) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <Form
        schema={{ type: 'form', showSubmit: false, showCancel: false, ...schema }}
        {...extraProps}
      />
    </I18nProvider>,
  );
}

const longText = (extra: Record<string, any> = {}) => ({
  name: 'notes',
  label: 'Notes',
  type: 'textarea',
  mobile_fullscreen: true,
  ...extra,
});

/**
 * The inline control, i.e. the one `<FormLabel>` is associated with.
 *
 * Filtered by tag rather than queried bare: while the dialog is open its
 * `aria-labelledby` points at a title that says "Notes" too, so the dialog
 * `<div role="dialog">` is ALSO labelled "Notes" and a bare `getByLabelText`
 * finds two elements.
 */
const inlineTextarea = () =>
  screen
    .getAllByLabelText('Notes')
    .find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
const expandButton = () =>
  screen.queryByTestId('form-textarea-fullscreen-toggle') as HTMLButtonElement | null;
const dialogInput = () =>
  screen.queryByTestId('form-textarea-fullscreen-input') as HTMLTextAreaElement | null;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('form renderer — a read-only long text field is read-only (objectui#3400)', () => {
  it('renders NO expand button, so the dialog has no entry point', () => {
    renderForm({ fields: [longText({ readonly: true })] });

    expect(expandButton()).toBeNull();
    // The dialog is not merely closed — nothing can open it.
    expect(screen.queryByTestId('form-textarea-fullscreen-dialog')).not.toBeInTheDocument();
  });

  it('forwards `readOnly` and the read-only tint to the inline control', () => {
    // The half the fullscreen exit dropped outright: with the flag on, a
    // read-only field was editable WITHOUT ever opening the dialog.
    renderForm({ fields: [longText({ readonly: true })] });

    const inline = inlineTextarea();
    expect(inline.readOnly).toBe(true);
    expect(inline.className).toContain('bg-muted/40');
    // `readonly` is "shown plainly, not editable" — not the greyed-out look.
    expect(inline.disabled).toBe(false);
  });

  it('refuses the edit the issue measured landing in form state', () => {
    renderForm({ fields: [longText({ readonly: true })] });

    fireEvent.change(inlineTextarea(), { target: { value: 'EDITED WHILE READONLY' } });

    expect(inlineTextarea().value).toBe('');
  });

  it('drops the button gutter when there is no button to reserve it for', () => {
    // `pr-10` exists to keep text clear of the expand button. With no button it
    // is dead space, and the control should look like the plain read-only
    // textarea the non-fullscreen exit renders.
    renderForm({ fields: [longText({ readonly: true })] });
    expect(inlineTextarea().className).not.toContain('pr-10');

    cleanup();
    renderForm({ fields: [longText()] });
    expect(inlineTextarea().className).toContain('pr-10');
  });

  it('holds when `readonly` is resolved at runtime by a readonlyWhen rule', () => {
    // Reachability, not a second code path: `readonly` reaching the branch as a
    // CEL verdict rather than a static flag is how a real form gets there.
    // An EDIT form (`previousValues` supplied): a create form does not apply
    // `readonlyWhen` at all, as the server exempts INSERT (objectui#13436).
    renderForm({
      defaultValues: { status: 'locked' },
      previousValues: { status: 'locked' },
      fields: [
        { name: 'status', label: 'Status', type: 'input' },
        longText({ readonlyWhen: "record.status == 'locked'" }),
      ],
    });

    expect(expandButton()).toBeNull();
    expect(inlineTextarea().readOnly).toBe(true);
  });

  it('leaves an editable long-text field alone', () => {
    // The control case for every assertion above — otherwise "no button" would
    // pass just as well by never rendering one.
    renderForm({ fields: [longText()] });

    expect(expandButton()).not.toBeNull();
    expect(inlineTextarea().readOnly).toBe(false);
    expect(inlineTextarea().className).not.toContain('bg-muted/40');
  });
});

describe('form renderer — a disabled long text field cannot be edited via the dialog (objectui#3400)', () => {
  it('keeps the expand button but disables it', () => {
    renderForm({ fields: [longText({ disabled: true })] });

    const button = expandButton();
    expect(button).not.toBeNull();
    // The affordance stays (disabled ≠ read-only), but it is inert.
    expect(button!.disabled).toBe(true);
  });

  it('does not open the dialog when that button is clicked anyway', () => {
    // `disabled` on a <button> stops the real user; the click handler is pinned
    // separately because a programmatic dispatch is not the only way past it —
    // `pointer-events` styling and the attribute can both be lost in a refactor.
    renderForm({ fields: [longText({ disabled: true })] });

    fireEvent.click(expandButton()!);

    expect(screen.queryByTestId('form-textarea-fullscreen-dialog')).not.toBeInTheDocument();
    expect(dialogInput()).toBeNull();
  });

  it('keeps the inline control disabled', () => {
    renderForm({ fields: [longText({ disabled: true })] });
    expect(inlineTextarea().disabled).toBe(true);
  });
});

describe('form renderer — the dialog holds on its own when disabled arrives mid-edit (objectui#3400)', () => {
  /**
   * `disabled` is not only a static flag: the call site ORs in `isSubmitting`,
   * which flips for the whole form once a submit is in flight. If that happens
   * while the dialog is open, the expand button is no longer the gate — the
   * dialog's own controls are. This is the case the issue called out as "提交
   * 进行中仍可通过全屏对话框改值".
   */
  function renderSubmittableForm() {
    // Never resolves → `isSubmitting` stays true for the rest of the test.
    const onAction = vi.fn(() => new Promise<never>(() => {}));
    const { container } = renderForm(
      { showSubmit: true, submitLabel: 'Save', fields: [longText()] },
      { onAction },
    );
    return { container, onAction };
  }

  it('locks the open dialog and refuses the write-back once submitting', async () => {
    const { container } = renderSubmittableForm();

    // Open while the form is still idle — the legitimate state.
    fireEvent.click(expandButton()!);
    expect(dialogInput()).not.toBeNull();

    // Submit starts; the dialog is still on screen. `handleSubmit` is async, so
    // `isSubmitting` lands a tick later.
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(dialogInput()!.disabled).toBe(true));

    const input = dialogInput();
    expect(input).not.toBeNull();

    const save = screen.getByTestId('form-textarea-fullscreen-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    // The gate that actually matters: even driven directly, "Done" must not
    // move a value into form state. Nothing native guards this handler — it is
    // a click handler on a different control reading React state.
    fireEvent.change(input!, { target: { value: 'EDITED WHILE SUBMITTING' } });
    fireEvent.click(save);

    expect(inlineTextarea().value).toBe('');
  });

  it('disables the expand button for the duration of a submit', async () => {
    const { container } = renderSubmittableForm();

    expect(expandButton()!.disabled).toBe(false);
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(expandButton()!.disabled).toBe(true));
  });
});

describe('form renderer — an editable long text field still edits fullscreen (objectui#3400)', () => {
  it('opens, edits and writes the value back on Done', () => {
    // The feature itself. Every assertion above is about NOT doing something,
    // so without this one they would all pass on a component that renders
    // nothing at all.
    renderForm({ fields: [longText()] });

    fireEvent.click(expandButton()!);
    const input = dialogInput()!;
    expect(input.readOnly).toBe(false);
    expect(input.disabled).toBe(false);

    fireEvent.change(input, { target: { value: 'A long note' } });
    fireEvent.click(screen.getByTestId('form-textarea-fullscreen-save'));

    expect(inlineTextarea().value).toBe('A long note');
  });

  it('still discards the draft on Cancel', () => {
    renderForm({ fields: [longText()] });

    fireEvent.click(expandButton()!);
    fireEvent.change(dialogInput()!, { target: { value: 'discarded' } });
    fireEvent.click(screen.getByText('Cancel'));

    expect(inlineTextarea().value).toBe('');
  });

  it('still edits inline', () => {
    renderForm({ fields: [longText()] });

    fireEvent.change(inlineTextarea(), { target: { value: 'typed inline' } });

    expect(inlineTextarea().value).toBe('typed inline');
  });
});
