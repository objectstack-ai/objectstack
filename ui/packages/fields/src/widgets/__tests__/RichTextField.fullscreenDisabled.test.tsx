/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A DISABLED `RichTextField` cannot be edited through its fullscreen dialog —
 * objectui#3402.
 *
 * The rich-text half of the same defect the sibling
 * `TextAreaField.fullscreenDisabled.test.tsx` pins, and it is a genuinely
 * separate code path rather than a copy of the assertions: this widget reaches
 * the affordance through `RichTextEditorSurface`'s `overlay` slot, and the
 * dialog renders the SAME surface again. `disabled` therefore has to be
 * resolved once and given to both renderings, exactly like `placeholder`
 * already was — otherwise the two surfaces disagree about whether the field is
 * editable, which is the drift #3301 built the shared surface to prevent.
 *
 * Measured on `origin/main` before the fix, by a dynamic probe (the issue
 * carried static evidence only):
 *
 *     PROBE richtext: inline disabled = true , toggle disabled = false
 *     PROBE richtext: dialog opened = true , dialog input disabled = false
 *     PROBE richtext: onChange calls = [["# EDITED WHILE DISABLED"]]
 *
 * `readonly` was never part of this: the widget early-returns a read-only
 * display before the affordance is computed. That path is untouched by the fix
 * and pinned below as a non-regression.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { RichTextField } from '../RichTextField';
import type { FieldMetadata } from '@object-ui/types';

const fieldMeta = (extra: Record<string, unknown> = {}) =>
  ({
    name: 'notes',
    label: 'Notes',
    type: 'markdown',
    mobile_fullscreen: true,
    ...extra,
  }) as unknown as FieldMetadata;

const toggle = () =>
  screen.queryByTestId('richtext-fullscreen-toggle') as HTMLButtonElement | null;
const dialogInput = () =>
  screen.queryByTestId('richtext-fullscreen-input') as HTMLTextAreaElement | null;
const saveButton = () =>
  screen.queryByTestId('richtext-fullscreen-save') as HTMLButtonElement | null;

describe('RichTextField fullscreen — disabled keeps the affordance but makes it inert (objectui#3402)', () => {
  it('keeps the expand button and disables it', () => {
    render(
      <RichTextField value="# hello" onChange={() => {}} field={fieldMeta()} disabled />,
    );

    expect(toggle()).not.toBeNull();
    expect(toggle()!.disabled).toBe(true);
  });

  it('does not open the dialog when that button is clicked anyway', () => {
    render(
      <RichTextField value="# hello" onChange={() => {}} field={fieldMeta()} disabled />,
    );

    fireEvent.click(toggle()!);

    expect(screen.queryByTestId('richtext-fullscreen-dialog')).not.toBeInTheDocument();
    expect(dialogInput()).toBeNull();
  });

  it('still disables the inline editing surface', () => {
    render(
      <RichTextField value="# hello" onChange={() => {}} field={fieldMeta()} disabled />,
    );

    const inline = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement;
    expect(inline.disabled).toBe(true);
  });

  it('never commits a value while disabled', () => {
    const onChange = vi.fn();
    render(
      <RichTextField value="# hello" onChange={onChange} field={fieldMeta()} disabled />,
    );

    fireEvent.click(toggle()!);

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('RichTextField fullscreen — the dialog holds on its own when disabled arrives mid-edit (objectui#3402)', () => {
  /**
   * The `isSubmitting` shape at widget level: the form renderer has already
   * OR-ed `isSubmitting` into the `disabled` this widget receives, so a submit
   * starting under an open dialog looks exactly like this rerender.
   */
  function openThenDisable(onChange: () => void) {
    const { rerender } = render(
      <RichTextField value="# hello" onChange={onChange} field={fieldMeta()} />,
    );
    fireEvent.click(toggle()!);
    expect(dialogInput()).not.toBeNull();

    rerender(
      <RichTextField value="# hello" onChange={onChange} field={fieldMeta()} disabled />,
    );
  }

  it('locks the dialog controls', () => {
    openThenDisable(vi.fn());

    expect(dialogInput()).not.toBeNull();
    expect(dialogInput()!.disabled).toBe(true);
    expect(saveButton()!.disabled).toBe(true);
  });

  /** Split from the attribute assertions for the reason its textarea sibling
   * spells out: as a tail on them it could only run when the native attribute
   * was already doing the work. */
  it('refuses the write-back even when "Done" is driven directly', () => {
    const onChange = vi.fn();
    openThenDisable(onChange);

    fireEvent.change(dialogInput()!, { target: { value: '# EDITED WHILE SUBMITTING' } });
    fireEvent.click(saveButton()!);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('still lets the user out of the dialog', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextField value="# hello" onChange={onChange} field={fieldMeta()} />,
    );

    fireEvent.click(toggle()!);
    rerender(
      <RichTextField value="# hello" onChange={onChange} field={fieldMeta()} disabled />,
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByTestId('richtext-fullscreen-dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('RichTextField fullscreen — the states the fix must not have moved (objectui#3402)', () => {
  it('still edits fullscreen and commits when the field is editable', () => {
    const onChange = vi.fn();
    render(<RichTextField value="# hello" onChange={onChange} field={fieldMeta()} />);

    expect(toggle()!.disabled).toBe(false);
    fireEvent.click(toggle()!);

    const input = dialogInput()!;
    expect(input.disabled).toBe(false);
    expect(saveButton()!.disabled).toBe(false);

    fireEvent.change(input, { target: { value: '# hello from fullscreen' } });
    fireEvent.click(saveButton()!);

    expect(onChange).toHaveBeenCalledWith('# hello from fullscreen');
  });

  /**
   * The indicator's VEHICLE changed with objectui#5498, and the indicator
   * itself went with objectui#12110; what this case pins did not.
   *
   * It was written with `fieldMeta({ format: 'html' })` on a `markdown`-typed
   * fixture, and the `'html'` string was doing real work: the widget derived the
   * header from `field.format || 'markdown'`, so an authored `format` was the
   * only way to make the RESOLVED label differ from the default a second,
   * independently-computing surface would have produced. That is what gave
   * `toHaveLength(2)` its teeth — a dialog computing its own label would have
   * shown "Format: markdown" and the count would have been 1.
   *
   * objectui#5498 removed that read, deliberately. `format` is a spec-declared
   * optional string on every `FieldSchema`, but its meaning in this renderer is
   * type-scoped and it is honoured by exactly two readers, both on types that
   * DECLARE it: `resolveCellRendererType` promotes a GENERIC textual base type
   * to a richer renderer (`text` + `format: 'phone'`) and explicitly does not
   * apply to explicit types, and the date renderer reads `DateFieldMetadata
   * .format`. No rich-content metadata type declares `format`, nothing else in
   * the platform reads it for one, and `getCellRenderer` keys on `type` alone —
   * so honouring it here made this widget the one place where the header could
   * name a syntax the whole platform does not render the value through.
   *
   * So the fixture moved from `format` to `type`, and the case was parameterised
   * over all three registry keys rather than losing the teeth: each type's OWN
   * label had to appear exactly twice.
   *
   * objectui#12110 (ruled B) then removed the header from every surface, the
   * format label with it. Each type's label is now asserted ABSENT in both
   * positions, and the "same surface" teeth moved to the authored
   * `placeholder`: `RichTextField` resolves it once and hands it to both
   * renderings, so it appears exactly twice only when the dialog holds the
   * real surface — a bare `<Textarea>` in the dialog carries none, and the
   * count would be 1. The `disabled` half — #3402's actual subject — is
   * untouched.
   */
  it.each([
    ['markdown', 'Format: markdown'],
    ['html', 'Format: html'],
    ['richtext', 'Format: html'],
  ])('keeps the dialog holding the REAL editor, disabled and not (%s)', (type, label) => {
    // #3301's acceptance criterion, re-pinned under `disabled`: the dialog
    // shows the same surface as the inline one (same authored placeholder, and
    // no header in either), and now the same interactivity too — the very
    // thing that had drifted.
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextField
        value=""
        onChange={onChange}
        field={fieldMeta({ type, placeholder: 'Write the notes' })}
      />,
    );

    fireEvent.click(toggle()!);
    expect(screen.getAllByPlaceholderText('Write the notes')).toHaveLength(2);
    expect(screen.queryAllByText(label)).toHaveLength(0);
    expect(screen.queryAllByText('Rich text editor (basic)')).toHaveLength(0);

    rerender(
      <RichTextField
        value=""
        onChange={onChange}
        field={fieldMeta({ type, placeholder: 'Write the notes' })}
        disabled
      />,
    );

    // Both surfaces present, both inert, neither with a header.
    expect(screen.getAllByPlaceholderText('Write the notes')).toHaveLength(2);
    expect(screen.queryAllByText(label)).toHaveLength(0);
    expect(screen.queryAllByText('Rich text editor (basic)')).toHaveLength(0);
    // Queried off the document rather than by role: the dialog is modal, so
    // Radix marks the background `aria-hidden` and a role query sees only the
    // dialog's own control — which is precisely the textarea NOT at issue here.
    // Both surfaces have to be disabled, so both are read directly.
    const textareas = Array.from(
      document.body.querySelectorAll('textarea'),
    ) as HTMLTextAreaElement[];
    expect(textareas).toHaveLength(2);
    expect(textareas.every((el) => el.disabled)).toBe(true);
  });

  it('still renders no affordance at all in readonly mode', () => {
    // The untouched early return — why readonly was never part of this defect.
    render(
      <RichTextField value="# hello" onChange={() => {}} readonly field={fieldMeta()} />,
    );

    expect(toggle()).toBeNull();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('# hello')).toBeInTheDocument();
  });

  it('still renders no affordance when the metadata does not opt in, disabled or not', () => {
    const { rerender } = render(
      <RichTextField
        value="# hello"
        onChange={() => {}}
        field={fieldMeta({ mobile_fullscreen: false })}
      />,
    );
    expect(toggle()).toBeNull();

    rerender(
      <RichTextField
        value="# hello"
        onChange={() => {}}
        field={fieldMeta({ mobile_fullscreen: false })}
        disabled
      />,
    );
    expect(toggle()).toBeNull();
  });
});
