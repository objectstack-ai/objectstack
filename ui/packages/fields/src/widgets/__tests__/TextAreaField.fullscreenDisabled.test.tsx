/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A DISABLED `TextAreaField` cannot be edited through its fullscreen dialog —
 * objectui#3402.
 *
 * `disabled` used to land on the inline `<Textarea>` and nowhere else:
 * `showFullscreenButton` did not consult it, the call site did not forward it,
 * and `FullscreenFieldEditor` did not declare it. Measured on `origin/main`
 * with a probe equivalent to the cases below (the issue itself carried only
 * static evidence, so the premise was reproduced dynamically before any fix):
 *
 *     PROBE textarea: inline disabled = true
 *     PROBE textarea: toggle present = true, toggle disabled = false
 *     PROBE textarea: dialog opened = true
 *     PROBE textarea: dialog input disabled = false
 *     PROBE textarea: onChange calls = [["EDITED WHILE DISABLED"]]
 *
 * That last line is the defect: a disabled field's value changed. The state is
 * nastier than the read-only one precisely because it LOOKS right — the inline
 * control is greyed out, and the only way around it is the button sitting on
 * top of it.
 *
 * This is the registered-path half of the same family #3400/PR #3401 fixed on
 * the built-in `form.tsx` path, and the two are deliberately pinned to the same
 * behaviours so one form-level setting keeps producing one behaviour:
 *
 *   - `readonly` → no affordance at all. Untouched here: this widget's
 *     early-return renders a read-only display before the button is computed.
 *     Pinned below as a NON-REGRESSION, because the fix must not have moved it.
 *   - `disabled` → the button stays but is inert, and the dialog locks on its
 *     own. `disabled` is not only a static flag: the form renderer computes it
 *     as `disabled || fieldDisabled || isSubmitting || …`, so it can flip to
 *     true while the dialog is already open, at which point the button is no
 *     longer the gate.
 *
 * Reachability is not exotic. `ObjectForm` stamps `mobile_fullscreen: true`
 * onto EVERY long-text field when `ObjectFormSchema.mobile.fullscreenLongText`
 * is set, without consulting readonly/disabled, and `stripRegisteredFieldProps`
 * does not strip `disabled` from what registered widgets receive.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { TextAreaField } from '../TextAreaField';
import type { FieldMetadata } from '@object-ui/types';

const fieldMeta = (extra: Record<string, unknown> = {}) =>
  ({
    name: 'description',
    label: 'Description',
    type: 'textarea',
    mobile_fullscreen: true,
    ...extra,
  }) as unknown as FieldMetadata;

const toggle = () =>
  screen.queryByTestId('textarea-fullscreen-toggle') as HTMLButtonElement | null;
const dialogInput = () =>
  screen.queryByTestId('textarea-fullscreen-input') as HTMLTextAreaElement | null;
const saveButton = () =>
  screen.queryByTestId('textarea-fullscreen-save') as HTMLButtonElement | null;

describe('TextAreaField fullscreen — disabled keeps the affordance but makes it inert (objectui#3402)', () => {
  it('keeps the expand button and disables it', () => {
    render(
      <TextAreaField value="hello" onChange={() => {}} field={fieldMeta()} disabled />,
    );

    // The affordance stays: `disabled` means "not interactive, muted", which is
    // a different state from `readonly`'s "shown plainly" (no button at all).
    expect(toggle()).not.toBeNull();
    expect(toggle()!.disabled).toBe(true);
  });

  it('does not open the dialog when that button is clicked anyway', () => {
    // The attribute stops a real user. The handler's own `if (disabled) return`
    // is pinned separately here because the attribute is not the only thing
    // that can be lost — a `pointer-events` rule and the attribute both live in
    // a className/props soup that refactors touch.
    render(
      <TextAreaField value="hello" onChange={() => {}} field={fieldMeta()} disabled />,
    );

    fireEvent.click(toggle()!);

    expect(screen.queryByTestId('textarea-fullscreen-dialog')).not.toBeInTheDocument();
    expect(dialogInput()).toBeNull();
  });

  it('still disables the inline control', () => {
    // The one exit that always held. Kept so a fix that moved `disabled` onto
    // the dialog and off the inline textarea would be caught.
    render(
      <TextAreaField value="hello" onChange={() => {}} field={fieldMeta()} disabled />,
    );

    const inline = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement;
    expect(inline.disabled).toBe(true);
  });

  it('never commits a value while disabled', () => {
    const onChange = vi.fn();
    render(
      <TextAreaField value="hello" onChange={onChange} field={fieldMeta()} disabled />,
    );

    fireEvent.click(toggle()!);

    // The measured defect, in one assertion: the probe above got
    // `[["EDITED WHILE DISABLED"]]` here.
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('TextAreaField fullscreen — the dialog holds on its own when disabled arrives mid-edit (objectui#3402)', () => {
  /**
   * Open the dialog while editable, then flip `disabled` under it — the
   * `isSubmitting` case. This widget never sees `isSubmitting`; it sees
   * `disabled`, which the form renderer has already OR-ed it into, so the honest
   * widget-level reproduction is the prop flipping true while the dialog is
   * open, which is exactly what a submit does to it. (The form-level
   * composition itself is pinned on the built-in path by #3400/PR #3401.)
   */
  function openThenDisable(onChange: () => void) {
    const { rerender } = render(
      <TextAreaField value="hello" onChange={onChange} field={fieldMeta()} />,
    );
    // Opened while the field is still editable — the legitimate state.
    fireEvent.click(toggle()!);
    expect(dialogInput()).not.toBeNull();

    // Submit starts. The dialog is still on screen; the button is no longer
    // the gate.
    rerender(
      <TextAreaField value="hello" onChange={onChange} field={fieldMeta()} disabled />,
    );
  }

  it('locks the dialog controls', () => {
    openThenDisable(vi.fn());

    expect(dialogInput()).not.toBeNull();
    expect(dialogInput()!.disabled).toBe(true);
    expect(saveButton()!.disabled).toBe(true);
  });

  /**
   * Deliberately a SEPARATE test from the attribute assertions above, not a tail
   * on them. Sharing one test made this assertion unreachable whenever an
   * attribute assertion failed — i.e. it could only ever run in the world where
   * the native attribute was already doing the work, which is no pin at all.
   * Split, it is `commitFullscreen`'s own `if (!disabled)` guard that answers
   * when the attribute is gone. Verified by removing each in turn: drop the
   * `disabled` attribute from "Done" and this test stays green (the guard
   * refuses); drop the guard as well and it turns red with
   * `onChange` called with "EDITED WHILE SUBMITTING".
   */
  it('refuses the write-back even when "Done" is driven directly', () => {
    const onChange = vi.fn();
    openThenDisable(onChange);

    fireEvent.change(dialogInput()!, { target: { value: 'EDITED WHILE SUBMITTING' } });
    fireEvent.click(saveButton()!);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('still lets the user out of the dialog', () => {
    // Cancel and Esc must stay live in every state, or a submit in flight traps
    // the user inside a modal they can no longer use.
    const onChange = vi.fn();
    const { rerender } = render(
      <TextAreaField value="hello" onChange={onChange} field={fieldMeta()} />,
    );

    fireEvent.click(toggle()!);
    rerender(
      <TextAreaField value="hello" onChange={onChange} field={fieldMeta()} disabled />,
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByTestId('textarea-fullscreen-dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('TextAreaField fullscreen — the states the fix must not have moved (objectui#3402)', () => {
  it('still edits fullscreen and commits when the field is editable', () => {
    // The control case for every "does not" above: without it they would all
    // pass just as well on a widget that renders no affordance at all.
    const onChange = vi.fn();
    render(<TextAreaField value="hello" onChange={onChange} field={fieldMeta()} />);

    expect(toggle()!.disabled).toBe(false);
    fireEvent.click(toggle()!);

    const input = dialogInput()!;
    expect(input.disabled).toBe(false);
    expect(saveButton()!.disabled).toBe(false);

    fireEvent.change(input, { target: { value: 'hello from fullscreen' } });
    fireEvent.click(saveButton()!);

    expect(onChange).toHaveBeenCalledWith('hello from fullscreen');
  });

  it('still renders no affordance at all in readonly mode', () => {
    // The early return this change deliberately did NOT touch: `readonly`
    // returns a read-only display before `showFullscreenButton` is computed,
    // which is why readonly was never part of this defect.
    render(
      <TextAreaField value="hello" onChange={() => {}} readonly field={fieldMeta()} />,
    );

    expect(toggle()).toBeNull();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('still renders no affordance when the metadata does not opt in, disabled or not', () => {
    const { rerender } = render(
      <TextAreaField value="hello" onChange={() => {}} field={fieldMeta({ mobile_fullscreen: false })} />,
    );
    expect(toggle()).toBeNull();

    rerender(
      <TextAreaField
        value="hello"
        onChange={() => {}}
        field={fieldMeta({ mobile_fullscreen: false })}
        disabled
      />,
    );
    expect(toggle()).toBeNull();
  });
});
