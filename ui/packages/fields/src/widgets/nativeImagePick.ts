/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The mobile shell's image picker for the file and image fields.
 *
 * Inside the ObjectStack mobile shell, when it announces `pickImage`, the
 * fields offer "Take photo" and "Choose photo" through the shell's own camera
 * and photo library. What the shell resolves becomes a `File` and goes through
 * the field's existing upload pipeline, the same one an `<input type=file>`
 * pick takes, so there is one upload route. A plain browser and an older shell
 * keep the `<input type=file>` path, unchanged.
 *
 * Internal to `@object-ui/fields`; not exported from the package entry.
 */
import { toast } from '@object-ui/components';
import {
  fileFromNativeFile,
  nativeHostCan,
  nativePickImage,
  useNativeHost,
} from '@object-ui/mobile';
import type { TranslateFn } from './file-size-guard.js';

/**
 * Whether a field may offer the shell's picker: only inside the mobile shell,
 * and only when that shell announces `pickImage`. Re-renders when a late
 * bridge is injected.
 */
export function useNativeImagePickOffered(): boolean {
  return nativeHostCan(useNativeHost(), 'pickImage');
}

/**
 * Open the shell's picker (`camera: true` for the camera, `false` for the
 * library) and resolve the picked image as one `File`, for the caller to hand
 * to its upload pipeline. A cancel resolves no file. A failure (camera
 * permission denied, a picker already open) resolves no file and is shown with
 * the error toast, carrying the shell's message.
 */
export async function pickNativeImage(camera: boolean, t: TranslateFn): Promise<File[]> {
  const result = await nativePickImage({ camera });
  if (result.status === 'ok') return result.value ? [fileFromNativeFile(result.value)] : [];
  if (result.status === 'failed') {
    toast.error(t('fields.file.photoFailed', { defaultValue: 'Could not get the photo' }), {
      description: result.message,
    });
  }
  return [];
}
