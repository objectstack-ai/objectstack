/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ActionParamDialog — Confirm is held while an `avatar` param's upload is in
 * flight, exactly as for `file` / `image` (objectui#10785).
 *
 * `AvatarField` now uploads through the ambient `UploadProvider` and hands the
 * `sys_file` id to `onChange` only once the adapter settles; it reports the
 * in-flight state through `onUploadingChange`. The dialog handed that callback
 * to `file` and `image` alone, so Confirm stayed enabled during an avatar
 * upload and resolved the params without the avatar.
 *
 * Unlike `ActionParamDialog.uploading.test.tsx`, which stubs the upload widget
 * to make the window deterministic, this drives the REAL `AvatarField` under a
 * real `UploadProvider` whose adapter holds its promise — so the pin also reads
 * the widget's own `onUploadingChange` claim end to end.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { UploadProvider, type UploadResult } from '@object-ui/providers';
import type { ActionParamDef } from '@object-ui/core';
import { ActionParamDialog } from './ActionParamDialog';

/** uuid/nanoid-shaped, so the platform's `isFileIdToken` accepts it. */
const MINTED_ID = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';

afterEach(() => {
  cleanup();
});

describe('ActionParamDialog holds Confirm while an avatar upload is in flight (objectui#10785)', () => {
  it('disabled while the upload is held, enabled once it settles, and the id is resolved', async () => {
    const pending: Array<() => void> = [];
    const upload = vi.fn(async (f: File | Blob): Promise<UploadResult> => {
      await new Promise<void>((release) => {
        pending.push(release);
      });
      return {
        url: `/api/v1/storage/files/${MINTED_ID}`,
        name: (f as File).name,
        size: f.size,
        mimeType: f.type,
        meta: { fileId: MINTED_ID },
      };
    });
    const resolve = vi.fn();
    const params: ActionParamDef[] = [{ name: 'photo', label: 'Photo', type: 'avatar' }];
    render(
      <UploadProvider adapter={{ name: 'held', upload }}>
        <ActionParamDialog state={{ open: true, params, resolve }} onOpenChange={() => {}} />
      </UploadProvider>,
    );

    // The dialog renders in a portal; the real widget's hidden picker, once its lazy chunk is in.
    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull());
    const confirm = () => screen.getByText(/actionDialog\.(confirm|uploading)/).closest('button')!;
    expect(confirm()).not.toBeDisabled();

    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] },
    });
    // The upload IS in flight: the adapter holds it.
    await waitFor(() => expect(pending).toHaveLength(1));

    await waitFor(() => expect(confirm()).toBeDisabled());
    expect(screen.getByText('actionDialog.uploading')).toBeTruthy();
    // A click on the held control resolves nothing.
    fireEvent.click(confirm());
    expect(resolve).not.toHaveBeenCalled();

    pending[0]();

    await waitFor(() => expect(confirm()).not.toBeDisabled());
    fireEvent.click(confirm());
    expect(resolve).toHaveBeenCalledWith({ photo: MINTED_ID });
  });
});
