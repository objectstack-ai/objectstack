/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The fullscreen dialog's editor announces the field's NAME and its VALIDATION
 * state — on BOTH registered long-text widgets (objectui#4824 / #4832).
 *
 * `mobile.fullscreenLongText` is a shipped opt-in: with it on, the phone user
 * writes long text in this dialog and nowhere else. What #4824 measured there,
 * with the field genuinely invalid at that moment:
 *
 *     INLINE  richtext  aria-invalid= true
 *     DIALOG  richtext  aria-invalid= false   aria-describedby= null
 *     INLINE  textarea  aria-invalid= true
 *     DIALOG  textarea  aria-invalid= null    aria-describedby= null
 *
 * The rich-text row is the sharp one: the dialog was not silent, it was
 * announcing the OPPOSITE of the inline control for the same field at the same
 * moment, because `RichTextEditorSurface` computed `aria-invalid={!!error}`
 * from an `error` prop the dialog rendering never received. #4832 measured the
 * accessible name of the same dialog controls as empty while the inline ones
 * read `F`.
 *
 * Both widgets are pinned in ONE file on purpose. The pair is what keeps a
 * single form-level setting producing a single behaviour; #4250's lesson is
 * that half a fix on a two-surface feature is worse than a symmetric gap,
 * because nothing reports the asymmetry. The third surface — the form
 * renderer's built-in `textarea` branch — lives in `@object-ui/components`
 * and is pinned there (`form-fullscreen-textarea-dialog-aria.test.tsx`),
 * because a `fields`-scoped sweep cannot see it.
 *
 * ## Every IDREF assertion carries a containment assertion
 *
 * The shortcut this fix must not become is pointing the dialog control at the
 * host's `<FormMessage>` id. It resolves, it has the right text, and it is an
 * ARIA MUST violation — Radix `aria-hidden`s everything outside the modal for
 * exactly as long as the reference is live. happy-dom computes names and
 * descriptions straight off the id and cannot tell the two apart, so the pin
 * has to be "the named node is inside THIS dialog", never "the named node
 * exists".
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { TextAreaField } from '../TextAreaField';
import { RichTextField } from '../RichTextField';
import type { FieldMetadata } from '@object-ui/types';

afterEach(cleanup);

const fieldMeta = (extra: Record<string, unknown> = {}) =>
  ({
    name: 'notes',
    label: 'F',
    type: 'textarea',
    mobile_fullscreen: true,
    ...extra,
  }) as unknown as FieldMetadata;

/**
 * The two widgets under one description, so every case below runs on both and
 * neither can be fixed alone. `inlineTestId` is how each widget's INLINE
 * control is found — the reading the dialog has to match.
 */
const SURFACES = [
  {
    name: 'textarea',
    prefix: 'textarea',
    dialogInputTestId: 'textarea-fullscreen-input',
    render: (props: { error?: string; extra?: Record<string, unknown> }) =>
      render(
        <TextAreaField
          value="hello"
          onChange={() => {}}
          field={fieldMeta({ type: 'textarea', ...(props.extra ?? {}) })}
          error={props.error}
        />,
      ),
  },
  {
    name: 'richtext',
    prefix: 'richtext',
    dialogInputTestId: 'richtext-fullscreen-input',
    render: (props: { error?: string; extra?: Record<string, unknown> }) =>
      render(
        <RichTextField
          value="hello"
          onChange={() => {}}
          field={fieldMeta({ type: 'markdown', ...(props.extra ?? {}) })}
          error={props.error}
        />,
      ),
  },
] as const;

describe.each(SURFACES)(
  '$name fullscreen dialog — validation state and name (objectui#4824 / #4832)',
  ({ prefix, dialogInputTestId, render: renderSurface }) => {
    const open = (props: { error?: string; extra?: Record<string, unknown> } = {}) => {
      renderSurface(props);
      fireEvent.click(screen.getByTestId(`${prefix}-fullscreen-toggle`));
      return {
        dialog: screen.getByTestId(`${prefix}-fullscreen-dialog`),
        input: screen.getByTestId(dialogInputTestId),
      };
    };

    /** The node an IDREF names — asserted to exist AND to be owned by the dialog. */
    const target = (el: HTMLElement, dialog: HTMLElement, attr: string) => {
      const id = el.getAttribute(attr);
      expect(id, `${attr} is set`).toBeTruthy();
      // `aria-errormessage` takes a SINGLE IDREF in this toolchain; a list
      // silently resolves to nothing.
      expect(id).not.toContain(' ');
      const node = document.getElementById(id!);
      expect(node, `${attr} names an existing element`).not.toBeNull();
      expect(dialog).toContainElement(node);
      return node as HTMLElement;
    };

    it('announces aria-invalid="true" when the field is invalid', () => {
      const { input } = open({ error: 'F is required' });

      // richtext read `false` here (its own `!!error` over an undefined prop);
      // textarea had no attribute at all.
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('announces aria-invalid="false" when the field is valid', () => {
      const { input } = open({});

      expect(input).toHaveAttribute('aria-invalid', 'false');
      expect(input).not.toHaveAttribute('aria-errormessage');
      expect(screen.queryByTestId(`${prefix}-fullscreen-error`)).not.toBeInTheDocument();
    });

    it('points aria-errormessage at a message node INSIDE the dialog', () => {
      const { dialog, input } = open({ error: 'F is required' });

      expect(target(input, dialog, 'aria-errormessage')).toHaveTextContent('F is required');
    });

    it('agrees with the inline control instead of contradicting it', () => {
      // The defect stated as a relation rather than an attribute value: the two
      // surfaces are the same field, so they may not disagree about whether it
      // has failed. Read the inline control BEFORE opening — it stays mounted
      // behind the overlay either way.
      const { container } = renderSurface({ error: 'F is required' });
      const inline = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(inline).toHaveAttribute('aria-invalid', 'true');

      fireEvent.click(screen.getByTestId(`${prefix}-fullscreen-toggle`));

      expect(screen.getByTestId(dialogInputTestId)).toHaveAttribute(
        'aria-invalid',
        inline.getAttribute('aria-invalid')!,
      );
    });

    it('gives the dialog control the field name (objectui#4832)', () => {
      const { dialog, input } = open({ error: 'F is required' });

      expect(input).toHaveAccessibleName('F');
      // From the visible dialog title, so the label keeps a single author
      // (#3978) — an `aria-label` string minted by the widget would pass the
      // line above and fail these two.
      expect(input).not.toHaveAttribute('aria-label');
      expect(target(input, dialog, 'aria-labelledby')).toHaveTextContent('F');
    });

    it('leaves the dialog itself named too', () => {
      // #3393 put the field label in `DialogTitle` and Radix turns that into the
      // dialog's own `aria-labelledby`. Naming the control must not be paid for
      // out of that.
      open({ error: 'F is required' });

      expect(screen.getByRole('dialog')).toHaveAccessibleName('F');
    });

    it('renders exactly one copy of the message inside the dialog', () => {
      // The 2026-08-16 restatement of objectui#3222: one copy of the error text
      // in the accessibility tree at any moment. The host's `<FormMessage>` is
      // `aria-hidden` behind the modal for this whole window; a widget that
      // ALSO printed the text next to its control would put two readable copies
      // in the dialog.
      const { dialog } = open({ error: 'F is required' });

      expect(screen.getAllByText('F is required')).toHaveLength(1);
      expect(dialog).toContainElement(screen.getByText('F is required'));
    });

    it('drops the message node again when the dialog closes', () => {
      open({ error: 'F is required' });
      expect(screen.getByTestId(`${prefix}-fullscreen-error`)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      expect(screen.queryByTestId(`${prefix}-fullscreen-error`)).not.toBeInTheDocument();
    });
  },
);

describe('textarea fullscreen dialog — the counter description still composes (objectui#3417)', () => {
  it('keeps aria-describedby on the character count and out of the error channel', () => {
    // `aria-errormessage` is a separate channel from `aria-describedby` on
    // purpose: this surface's `aria-describedby` already carries the fullscreen
    // counter's sentence, so folding the message id in would either overwrite
    // that (trading "no cap announced" for nothing gained) or announce the same
    // failure twice.
    render(
      <TextAreaField
        value="hello"
        onChange={() => {}}
        field={fieldMeta({ maxLength: 500 })}
        error="F is required"
      />,
    );
    fireEvent.click(screen.getByTestId('textarea-fullscreen-toggle'));

    const input = screen.getByTestId('textarea-fullscreen-input');
    const describedBy = input.getAttribute('aria-describedby');
    const errorMessage = input.getAttribute('aria-errormessage')!;

    expect(describedBy).toBeTruthy();
    expect(describedBy).not.toContain(errorMessage);
    expect(document.getElementById(describedBy!)).toHaveTextContent(/500/);
    // Still the counter's description, still owned by the dialog.
    expect(screen.getByTestId('textarea-fullscreen-dialog')).toContainElement(
      document.getElementById(describedBy!),
    );
  });
});
