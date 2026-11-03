/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ActionParamDialog draws the action's `cancelText` on its dismiss button
 * (`ActionSchema.cancelText`, objectstack#28879) in place of the generic
 * Cancel. The caller hands it the already-resolved text; the dialog falls back
 * to `actionDialog.cancel` when there is none. No i18n provider is mounted, so
 * `t()` answers the key, which is what lets these assertions tell the fallback
 * from the label.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionParamDef } from '@object-ui/core';
import { ActionParamDialog } from './ActionParamDialog';

const TEXT_PARAMS: ActionParamDef[] = [{ name: 'subject', label: 'Subject', type: 'text' }];

function openDialog(cancelText?: string) {
  const resolve = vi.fn();
  render(
    <ActionParamDialog
      state={{ open: true, params: TEXT_PARAMS, title: 'Send Email', submitText: 'Send', cancelText, resolve }}
      onOpenChange={() => {}}
    />,
  );
  return resolve;
}

describe('ActionParamDialog — the dismiss button names what dismissing keeps (objectstack#28879)', () => {
  it('draws the action\'s `cancelText` on the dismiss button', async () => {
    openDialog('Keep draft');
    expect(await screen.findByRole('button', { name: 'Keep draft' })).toBeTruthy();
    expect(screen.queryByText('actionDialog.cancel')).toBeNull();
    // The submit button keeps its own label.
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('falls back to the generic Cancel when the action names no label', async () => {
    openDialog();
    expect(await screen.findByRole('button', { name: 'actionDialog.cancel' })).toBeTruthy();
  });

  it('falls back to Cancel for an empty string, never an empty button', async () => {
    openDialog('');
    expect(await screen.findByRole('button', { name: 'actionDialog.cancel' })).toBeTruthy();
  });

  it('the labelled button dismisses like Cancel does: the dialog resolves null', async () => {
    const resolve = openDialog('Keep draft');
    fireEvent.click(await screen.findByRole('button', { name: 'Keep draft' }));
    expect(resolve).toHaveBeenCalledWith(null);
  });
});
