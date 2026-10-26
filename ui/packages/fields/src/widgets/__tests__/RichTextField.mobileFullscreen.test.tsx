/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RichTextField` honours `mobile_fullscreen` (objectui#3301).
 *
 * `ObjectFormSchema.mobile.fullscreenLongText` has always promised, in its own
 * JSDoc, that "textarea/rich-text get an expand button", and `ObjectForm` has
 * always stamped `mobile_fullscreen` onto `field:markdown` / `field:html`
 * fields to deliver it. This widget — the one both of those types resolve to —
 * simply never read the flag. Producer present, consumer absent: the flag
 * arrived at the widget and nothing happened, with nothing anywhere reporting
 * that half the documented feature was inert.
 *
 * So the assertions below are about the READ and the interaction it drives.
 * The sibling file `TextAreaField.mobileFullscreen.test.tsx` pins the same
 * contract for the other widget; both now go through the shared
 * `FullscreenFieldEditor`, and the pair is what keeps one form-level setting
 * producing one behaviour. Divergence in either widget fails one of the two.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { RichTextField } from '../RichTextField';
import type { FieldWidgetComponentProps } from '../types';
import type { FieldMetadata } from '@object-ui/types';

const fieldMeta = (extra: Record<string, unknown> = {}) =>
  ({
    name: 'notes',
    label: 'Notes',
    type: 'markdown',
    ...extra,
  }) as unknown as FieldMetadata;

describe('RichTextField mobile fullscreen — the metadata flag is the only source', () => {
  it('renders the expand affordance when the field metadata sets mobile_fullscreen', () => {
    render(
      <RichTextField
        value="# hello"
        onChange={() => {}}
        field={fieldMeta({ mobile_fullscreen: true })}
      />,
    );

    expect(screen.getByTestId('richtext-fullscreen-toggle')).toBeInTheDocument();
  });

  it('renders no affordance when the metadata does not opt in', () => {
    render(<RichTextField value="# hello" onChange={() => {}} field={fieldMeta()} />);

    expect(screen.queryByTestId('richtext-fullscreen-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('richtext-fullscreen-dialog')).not.toBeInTheDocument();
  });

  it('opens the fullscreen dialog and commits the edited draft', () => {
    const onChange = vi.fn();
    render(
      <RichTextField
        value="# hello"
        onChange={onChange}
        field={fieldMeta({ mobile_fullscreen: true })}
      />,
    );

    // Closed until the affordance is used — the dialog is not just mounted.
    expect(screen.queryByTestId('richtext-fullscreen-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('richtext-fullscreen-toggle'));
    expect(screen.getByTestId('richtext-fullscreen-dialog')).toBeInTheDocument();

    const dialogInput = screen.getByTestId('richtext-fullscreen-input');
    expect(dialogInput).toHaveValue('# hello');

    fireEvent.change(dialogInput, { target: { value: '# hello from fullscreen' } });
    // The draft is local until "Done" — the host is not notified per keystroke,
    // so a react-hook-form field is not marked dirty by an edit the user may
    // still cancel.
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('richtext-fullscreen-save'));
    expect(onChange).toHaveBeenCalledWith('# hello from fullscreen');
  });

  it('discards the draft on Cancel', () => {
    const onChange = vi.fn();
    render(
      <RichTextField
        value="# hello"
        onChange={onChange}
        field={fieldMeta({ mobile_fullscreen: true })}
      />,
    );

    fireEvent.click(screen.getByTestId('richtext-fullscreen-toggle'));
    fireEvent.change(screen.getByTestId('richtext-fullscreen-input'), {
      target: { value: 'thrown away' },
    });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('richtext-fullscreen-dialog')).not.toBeInTheDocument();

    // …and re-opening seeds from the COMMITTED value, not from the abandoned
    // draft. Holding the draft across opens would silently resurrect an edit
    // the user explicitly cancelled.
    fireEvent.click(screen.getByTestId('richtext-fullscreen-toggle'));
    expect(screen.getByTestId('richtext-fullscreen-input')).toHaveValue('# hello');
  });

  it('puts the REAL editor in the dialog, not a degraded copy of it', () => {
    // The acceptance criterion that the dialog holds the rich editor itself:
    // the same surface renders in both positions (same authored placeholder,
    // same editor), so whatever this widget's editor grows into, the fullscreen
    // view gets it too rather than drifting into a bare textarea.
    render(
      <RichTextField
        value=""
        onChange={() => {}}
        // `type: 'html'` rather than `format: 'html'` since objectui#5498 (no
        // rich-content type declares `format`; see the note in
        // `RichTextField.fullscreenDisabled.test.tsx`). The "Format: html"
        // header that type used to draw is gone from both surfaces since
        // objectui#12110, so it is asserted absent; the placeholder carries
        // the "same surface" count.
        field={fieldMeta({ mobile_fullscreen: true, type: 'html', placeholder: 'Write HTML' })}
      />,
    );

    expect(screen.queryByText('Format: html')).toBeNull();

    fireEvent.click(screen.getByTestId('richtext-fullscreen-toggle'));

    // Inline + dialog: the placeholder is present twice, a header in neither.
    expect(screen.queryAllByText('Format: html')).toHaveLength(0);
    expect(screen.getAllByPlaceholderText('Write HTML')).toHaveLength(2);
    expect(screen.getByTestId('richtext-fullscreen-input')).toBeEnabled();
  });

  it('titles the dialog and the affordance with the field label', () => {
    render(
      <RichTextField
        value=""
        onChange={() => {}}
        field={fieldMeta({ mobile_fullscreen: true, label: 'Release notes' })}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Edit Release notes fullscreen' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('richtext-fullscreen-toggle'));
    expect(screen.getByRole('heading', { name: 'Release notes' })).toBeInTheDocument();
  });

  it('renders no affordance at all in readonly mode', () => {
    render(
      <RichTextField
        value="# hello"
        onChange={() => {}}
        readonly
        field={fieldMeta({ mobile_fullscreen: true })}
      />,
    );

    expect(screen.queryByTestId('richtext-fullscreen-toggle')).not.toBeInTheDocument();
  });
});

describe('RichTextField mobile fullscreen — no second carrier', () => {
  it('ignores the flag on prop spellings a host might invent', () => {
    // Same convergence `TextAreaField` went through in objectui#3232/#3233:
    // the metadata is the ONE carrier. A host passing the flag as a prop must
    // get nothing — a tolerant `??` chain here is exactly where a misspelled
    // AI-authored flag would hide and look supported.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const hostProps = {
        mobileFullscreen: true,
        mobile_fullscreen: true,
        schema: fieldMeta({ mobile_fullscreen: true }),
      } as unknown as Partial<FieldWidgetComponentProps<string>>;

      render(
        <RichTextField value="" onChange={() => {}} field={fieldMeta()} {...hostProps} />,
      );

      expect(screen.queryByTestId('richtext-fullscreen-toggle')).not.toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
