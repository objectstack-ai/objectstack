/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ActionParamDialog draws the action's `submitText` on its submit button
 * (`ActionSchema.submitText`, objectstack#28158): the verb the button performs
 * ("Send", "Log Call") in place of the generic Confirm. The caller hands it the
 * already-resolved text; the dialog falls back to `actionDialog.confirm` when
 * there is none, and says `actionDialog.uploading` while a file param uploads,
 * whatever the verb. No i18n provider is mounted, so `t()` answers the key —
 * which is what lets these assertions tell the fallback from the verb.
 *
 * The upload widget is stubbed the way `ActionParamDialog.uploading.test.tsx`
 * stubs it, so the mid-upload window is deterministic.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionParamDef } from '@object-ui/core';

vi.mock('@object-ui/fields', async (importActual) => {
  const actual = await importActual<typeof import('@object-ui/fields')>();
  return {
    ...actual,
    getLazyFieldWidget: (type: string) => {
      if (type === 'file') {
        return function FakeUploadWidget({ onUploadingChange }: { onUploadingChange?: (u: boolean) => void }) {
          return (
            <button type="button" data-testid="start-upload" onClick={() => onUploadingChange?.(true)}>
              start
            </button>
          );
        };
      }
      return actual.getLazyFieldWidget(type);
    },
  };
});

// Import AFTER the mock is registered.
const { ActionParamDialog } = await import('./ActionParamDialog');

const TEXT_PARAMS: ActionParamDef[] = [{ name: 'subject', label: 'Subject', type: 'text' }];

function openDialog(params: ActionParamDef[], submitText?: string) {
  const resolve = vi.fn();
  render(
    <ActionParamDialog
      state={{ open: true, params, title: 'Send Email', submitText, resolve }}
      onOpenChange={() => {}}
    />,
  );
  return resolve;
}

describe('ActionParamDialog — the submit button names the action\'s verb (objectstack#28158)', () => {
  it('draws the action\'s `submitText` on the submit button', async () => {
    openDialog(TEXT_PARAMS, 'Send');
    const button = await screen.findByRole('button', { name: 'Send' });
    expect(button).toBeTruthy();
    expect(screen.queryByText('actionDialog.confirm')).toBeNull();
  });

  it('falls back to the generic Confirm when the action names no verb', async () => {
    openDialog(TEXT_PARAMS);
    expect(await screen.findByRole('button', { name: 'actionDialog.confirm' })).toBeTruthy();
  });

  it('falls back to Confirm for an empty string, never an empty button', async () => {
    openDialog(TEXT_PARAMS, '');
    expect(await screen.findByRole('button', { name: 'actionDialog.confirm' })).toBeTruthy();
  });

  it('the verb button submits like Confirm does', async () => {
    const resolve = openDialog(TEXT_PARAMS, 'Send');
    fireEvent.change(await screen.findByLabelText(/Subject/), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(resolve).toHaveBeenCalledWith({ subject: 'Hello' });
  });

  it('says Uploading while a file param uploads, whatever the verb', async () => {
    openDialog([{ name: 'doc', label: 'Doc', type: 'file' }], 'Send');
    fireEvent.click(await screen.findByTestId('start-upload'));

    const uploading = screen.getByText('actionDialog.uploading').closest('button')!;
    expect(uploading).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });
});
