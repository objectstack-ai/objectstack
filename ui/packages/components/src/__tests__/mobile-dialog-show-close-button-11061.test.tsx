/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `MobileDialogContent`'s `showCloseButton` switch (objectui#11061).
 *
 * The wrapper used to draw its close (X) button unconditionally, so
 * `plugin-form`'s `ModalForm` had no way to honour an authored
 * `modalCloseButton: false`. The switch defaults to `true`, which keeps every
 * existing caller's button; only an explicit `false` leaves it out of the DOM.
 * Hiding the X must not trap the user: Escape still reaches the `Dialog`'s
 * `onOpenChange(false)`.
 *
 * No I18nProvider is mounted, so the button's accessible name is the English
 * "Close" (see `mobile-dialog-close-no-provider-4024.test.tsx`).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Dialog, DialogTitle, DialogDescription } from '../ui/dialog';
import { MobileDialogContent } from '../custom/mobile-dialog-content';

afterEach(() => cleanup());

function renderDialog(showCloseButton?: boolean, onOpenChange = vi.fn()) {
  render(
    <Dialog open onOpenChange={onOpenChange}>
      <MobileDialogContent showCloseButton={showCloseButton}>
        <DialogTitle>Acme Corp</DialogTitle>
        <DialogDescription>Record modal</DialogDescription>
      </MobileDialogContent>
    </Dialog>,
  );
  return onOpenChange;
}

describe('MobileDialogContent showCloseButton (objectui#11061)', () => {
  it('renders the close button by default', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('renders the close button when showCloseButton is true', () => {
    renderDialog(true);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('leaves the close button out of the DOM when showCloseButton is false', () => {
    renderDialog(false);
    const dialog = screen.getByRole('dialog');
    // The dialog itself still renders its content...
    expect(screen.getByText('Acme Corp')).toBeTruthy();
    // ...but carries no button at all, and the switch is not leaked onto the
    // Radix content element as an unknown DOM attribute.
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
    expect(dialog.querySelector('button')).toBeNull();
    expect(dialog.hasAttribute('showclosebutton')).toBe(false);
  });

  it('still closes on Escape with the close button hidden', () => {
    const onOpenChange = renderDialog(false);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
