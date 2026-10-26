/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ActionParamDialog — Confirm is disabled while a file/image param's upload is
 * in flight, so a param can't be submitted before its fileId resolves (the
 * value only becomes the fileId once the presigned upload settles). The upload
 * widget is stubbed here so the mid-upload window is deterministic; the real
 * signal path (FileField/ImageField → useUploadingSignal → onUploadingChange)
 * is covered in the fields package.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionParamDef } from '@object-ui/core';

vi.mock('@object-ui/fields', async (importActual) => {
  const actual = await importActual<typeof import('@object-ui/fields')>();
  return {
    ...actual,
    // Stub only the upload widgets with a control that drives onUploadingChange;
    // every other type resolves to its real widget so paramToField resolution
    // and the rest of the dialog stay authentic.
    getLazyFieldWidget: (type: string) => {
      if (type === 'file' || type === 'image') {
        return function FakeUploadWidget({
          onChange,
          onUploadingChange,
        }: {
          onChange: (v: unknown) => void;
          onUploadingChange?: (u: boolean) => void;
        }) {
          return (
            <div>
              <button type="button" data-testid="start-upload" onClick={() => onUploadingChange?.(true)}>
                start
              </button>
              <button
                type="button"
                data-testid="finish-upload"
                onClick={() => {
                  onChange('file_123');
                  onUploadingChange?.(false);
                }}
              >
                finish
              </button>
            </div>
          );
        };
      }
      return actual.getLazyFieldWidget(type);
    },
  };
});

// Import AFTER the mock is registered.
const { ActionParamDialog } = await import('./ActionParamDialog');

function openDialog(params: ActionParamDef[]) {
  const resolve = vi.fn();
  render(<ActionParamDialog state={{ open: true, params, resolve }} onOpenChange={() => {}} />);
  return resolve;
}

const confirmBtn = () => screen.getByText(/actionDialog\.(confirm|uploading)/).closest('button')!;

describe('ActionParamDialog — upload-in-progress guard', () => {
  it('disables Confirm while a file param is uploading and re-enables when it settles', async () => {
    const resolve = openDialog([{ name: 'doc', label: 'Doc', type: 'file' }]);
    await screen.findByTestId('start-upload');

    // Idle → enabled.
    expect(confirmBtn()).not.toBeDisabled();

    // Upload starts → Confirm disabled, label switches.
    fireEvent.click(screen.getByTestId('start-upload'));
    expect(confirmBtn()).toBeDisabled();
    expect(screen.getByText('actionDialog.uploading')).toBeTruthy();

    // Upload settles → Confirm enabled, value captured.
    fireEvent.click(screen.getByTestId('finish-upload'));
    expect(confirmBtn()).not.toBeDisabled();

    fireEvent.click(confirmBtn());
    expect(resolve).toHaveBeenCalledWith({ doc: 'file_123' });
  });

  it('does not submit while an upload is in flight (keyboard-submit guard)', async () => {
    const resolve = openDialog([{ name: 'doc', label: 'Doc', type: 'file' }]);
    await screen.findByTestId('start-upload');
    fireEvent.click(screen.getByTestId('start-upload'));
    // Even a direct click on the (disabled) button must not resolve.
    fireEvent.click(confirmBtn());
    expect(resolve).not.toHaveBeenCalled();
  });
});
