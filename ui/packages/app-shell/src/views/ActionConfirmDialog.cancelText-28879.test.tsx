/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28879 — the confirm dialog's dismiss button draws the action's
 * `cancelText`, which the runner hands it as `options.cancelText`
 * (`ActionRunner.confirmCancelText-28879.test.ts` pins that half). Absent or
 * empty, the generic `actionConfirm.cancel` stands. No i18n provider is
 * mounted, so `t()` answers the key, which tells the fallback from the label.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionConfirmDialog } from './ActionConfirmDialog';

function openDialog(options?: { title?: string; confirmText?: string; cancelText?: string }) {
  const resolve = vi.fn();
  render(
    <ActionConfirmDialog
      state={{ open: true, message: 'Cancel this invitation?', options, resolve }}
      onOpenChange={() => {}}
    />,
  );
  return resolve;
}

describe('ActionConfirmDialog — the dismiss button names what dismissing keeps (objectstack#28879)', () => {
  it('draws `options.cancelText` beside the action-named confirm button', async () => {
    openDialog({ title: 'Cancel Invitation', confirmText: 'Cancel Invitation', cancelText: 'Keep invitation' });
    expect(await screen.findByRole('button', { name: 'Keep invitation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel Invitation' })).toBeTruthy();
    expect(screen.queryByText('actionConfirm.cancel')).toBeNull();
  });

  it('CONTROL: without a cancelText the generic Cancel stands', async () => {
    openDialog({ title: 'Cancel Invitation', confirmText: 'Cancel Invitation' });
    expect(await screen.findByRole('button', { name: 'actionConfirm.cancel' })).toBeTruthy();
  });

  it('the labelled button dismisses: the confirm resolves false', async () => {
    const resolve = openDialog({ cancelText: 'Keep invitation' });
    fireEvent.click(await screen.findByRole('button', { name: 'Keep invitation' }));
    expect(resolve).toHaveBeenCalledWith(false);
  });
});
