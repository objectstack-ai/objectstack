/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `FullscreenEditor` (components/custom) — the dialog's editor gets a NAME and
 * a truthful VALIDATION state, both minted here (objectui#4824 / #4832).
 *
 * The control inside the dialog is built from scratch by the host, and for all
 * three surfaces that render this primitive it was built without either. What
 * #4824 measured, with a field that was genuinely invalid at the time:
 *
 *     INLINE  richtext  aria-invalid= true
 *     DIALOG  richtext  aria-invalid= false   aria-describedby= null
 *     INLINE  textarea  aria-invalid= true
 *     DIALOG  textarea  aria-invalid= null    aria-describedby= null
 *
 * and #4832 measured the accessible name of the same four controls as `F`,
 * empty, `F`, empty. The dialog was not merely silent about the failure — the
 * rich-text half was announcing the OPPOSITE of the inline control.
 *
 * The fix is one answer, here, handed to `children` as a required fourth
 * argument. So this file pins the primitive's half of the contract; the three
 * hosts' half (that they actually spread it onto the control they render) is
 * pinned per surface, in `FullscreenFieldEditor.dialogAria.test.tsx` and
 * `renderers/form/__tests__/form-fullscreen-textarea-dialog-aria.test.tsx`.
 *
 * ## Why every assertion about an IDREF also asserts CONTAINMENT
 *
 * The forbidden shape passes a naive test. Pointing the dialog control at the
 * host's `<FormMessage>` id resolves to a real node with the right text — and
 * is an ARIA MUST violation, because Radix `aria-hidden`s everything outside
 * the modal for exactly as long as the reference is live. happy-dom and jsdom
 * both compute accessible names and descriptions straight off the id, so
 * neither can see the difference. `expect(dialog).toContainElement(target)` is
 * what tells the two apart, so no IDREF is asserted here without it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { FullscreenEditor } from '../custom/fullscreen-editor';

afterEach(cleanup);

/**
 * Renders the primitive with a minimal host editor that does the one thing
 * every real host does: spread the fourth argument onto its control.
 */
function renderEditor(over: { label?: string; error?: string; disabled?: boolean } = {}) {
  const { error = undefined, disabled = false } = over;
  // `in`, not a destructuring default: the label-less case passes `undefined`
  // deliberately, and a default would silently substitute "Notes" for it.
  const label = 'label' in over ? over.label : 'Notes';
  const result = render(
    <FullscreenEditor
      value="hello"
      onCommit={vi.fn()}
      label={label}
      testIdPrefix="probe"
      disabled={disabled}
      error={error}
    >
      {(draft, setDraft, editorDisabled, editorAria) => (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={editorDisabled}
          data-testid="probe-fullscreen-input"
          {...editorAria}
        />
      )}
    </FullscreenEditor>,
  );
  fireEvent.click(screen.getByTestId('probe-fullscreen-toggle'));
  return result;
}

const dialog = () => screen.getByTestId('probe-fullscreen-dialog');
const input = () => screen.getByTestId('probe-fullscreen-input');

/** The node an IDREF attribute names, asserted to exist AND to live in the dialog. */
function target(attr: string) {
  const id = input().getAttribute(attr);
  expect(id, `${attr} is set`).toBeTruthy();
  // Single id, never a list: `aria-errormessage` takes one IDREF in this
  // toolchain, and a space-separated value would silently resolve to nothing.
  expect(id).not.toContain(' ');
  const el = document.getElementById(id!);
  expect(el, `${attr} names an existing element`).not.toBeNull();
  expect(dialog()).toContainElement(el);
  return el as HTMLElement;
}

describe('FullscreenEditor — the dialog control is NAMED (objectui#4832)', () => {
  it('names it from the dialog title text, not from a second copy of the label', () => {
    renderEditor({ label: 'Notes' });

    // The reading the issue took: empty before, the field label after.
    expect(input()).toHaveAccessibleName('Notes');
    // …and the name comes from the visible title, so there is still exactly one
    // author for it (#3978). A widget minting `aria-label="Notes"` would pass
    // the line above and fail this one.
    expect(input()).not.toHaveAttribute('aria-label');
    expect(target('aria-labelledby')).toHaveTextContent('Notes');
  });

  it('leaves the DIALOG its own accessible name while doing so', () => {
    // The regression this shape exists to avoid. Radix renders
    // `<h2 id={context.titleId} {...titleProps}>`, so putting our id on
    // `<DialogTitle>` would replace the id `DialogContent`'s `aria-labelledby`
    // names — buying the control a name at the cost of the dialog's (#3393).
    renderEditor({ label: 'Notes' });

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Notes');
  });

  it('falls back to the generic title when the field has no label', () => {
    renderEditor({ label: undefined });

    expect(input()).toHaveAccessibleName('Edit text');
  });
});

describe('FullscreenEditor — the dialog control tells the TRUTH about validation (objectui#4824)', () => {
  it('announces aria-invalid=true and names a dialog-local message node', () => {
    renderEditor({ error: 'Notes is required' });

    expect(input()).toHaveAttribute('aria-invalid', 'true');
    // Container-ownership, not just resolution: see the file header.
    expect(target('aria-errormessage')).toHaveTextContent('Notes is required');
    expect(screen.getByTestId('probe-fullscreen-error')).toHaveTextContent(
      'Notes is required',
    );
  });

  it('renders the host message verbatim rather than re-wording it', () => {
    renderEditor({ error: 'Give the note a body' });

    expect(screen.getByTestId('probe-fullscreen-error')).toHaveTextContent(
      'Give the note a body',
    );
  });

  it('emits neither the attribute nor the node when the field is valid', () => {
    renderEditor({ error: undefined });

    expect(input()).toHaveAttribute('aria-invalid', 'false');
    // Absent, not `aria-errormessage=""`: the attribute is only exposed
    // alongside `aria-invalid="true"`, and there is no node for it to name.
    expect(input()).not.toHaveAttribute('aria-errormessage');
    expect(screen.queryByTestId('probe-fullscreen-error')).not.toBeInTheDocument();
  });

  it('keeps the message out of the accessibility tree while the dialog is closed', () => {
    // The 2026-08-16 restatement of objectui#3222 — "only one copy of the error
    // text is in the accessibility tree at any moment" — has a closed-dialog
    // half: this node may not exist alongside the host's own `<FormMessage>`.
    // Radix unmounts the content, so it does not; a primitive that hoisted the
    // node out of `<DialogContent>` to "keep it stable" would break this.
    render(
      <FullscreenEditor
        value="hello"
        onCommit={vi.fn()}
        label="Notes"
        testIdPrefix="closed"
        error="Notes is required"
      >
        {(draft, _setDraft, _disabled, editorAria) => (
          <textarea readOnly value={draft} {...editorAria} />
        )}
      </FullscreenEditor>,
    );

    expect(screen.queryByTestId('closed-fullscreen-error')).not.toBeInTheDocument();
    expect(screen.queryByText('Notes is required')).not.toBeInTheDocument();
  });

  it('does not fold the message id into the control aria-describedby', () => {
    // `aria-errormessage` and `aria-describedby` are separate channels here.
    // The host owns `aria-describedby` (a character counter rides it), and the
    // primitive contributing to it would either overwrite that or double the
    // announcement of the same sentence.
    renderEditor({ error: 'Notes is required' });

    expect(input()).not.toHaveAttribute('aria-describedby');
  });

  it('keeps name and validation state through a `disabled` that flips mid-edit', () => {
    // `disabled` carries the form's `isSubmitting`, which goes true while the
    // dialog may ALREADY be open — the window the primitive's own doc calls
    // out. A field does not stop being invalid, or stop having a name, because
    // a submit is in flight. (It cannot be opened while disabled: the toggle is
    // inert and `openFullscreen` refuses, which is why this starts enabled.)
    const editor = (disabled: boolean) => (
      <FullscreenEditor
        value="hello"
        onCommit={vi.fn()}
        label="Notes"
        testIdPrefix="probe"
        disabled={disabled}
        error="Notes is required"
      >
        {(draft, setDraft, editorDisabled, editorAria) => (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={editorDisabled}
            data-testid="probe-fullscreen-input"
            {...editorAria}
          />
        )}
      </FullscreenEditor>
    );

    const { rerender } = render(editor(false));
    fireEvent.click(screen.getByTestId('probe-fullscreen-toggle'));
    rerender(editor(true));

    expect(input()).toBeDisabled();
    expect(input()).toHaveAccessibleName('Notes');
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(target('aria-errormessage')).toHaveTextContent('Notes is required');
  });
});

describe('FullscreenEditor — two editors on one page do not share ids (objectui#4824)', () => {
  it('mints per-instance ids so one dialog cannot name the other message node', () => {
    render(
      <>
        <FullscreenEditor
          value="a"
          onCommit={vi.fn()}
          label="Notes"
          testIdPrefix="first"
          error="Notes is required"
        >
          {(draft, _s, _d, aria) => (
            <textarea readOnly value={draft} data-testid="first-input" {...aria} />
          )}
        </FullscreenEditor>
        <FullscreenEditor
          value="b"
          onCommit={vi.fn()}
          label="Summary"
          testIdPrefix="second"
          error="Summary is required"
        >
          {(draft, _s, _d, aria) => (
            <textarea readOnly value={draft} data-testid="second-input" {...aria} />
          )}
        </FullscreenEditor>
      </>,
    );

    fireEvent.click(screen.getByTestId('second-fullscreen-toggle'));

    const secondInput = screen.getByTestId('second-input');
    const secondDialog = screen.getByTestId('second-fullscreen-dialog');
    const errorEl = document.getElementById(
      secondInput.getAttribute('aria-errormessage')!,
    );
    expect(secondDialog).toContainElement(errorEl);
    expect(errorEl).toHaveTextContent('Summary is required');
    expect(secondInput).toHaveAccessibleName('Summary');
  });
});
