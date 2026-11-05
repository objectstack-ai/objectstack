/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "Take photo" / "Choose photo" on the file and image fields, through the
 * ObjectStack mobile shell's `pickImage()` bridge method (objectstack-ai/mobile
 * `docs/HYBRID-SHELL.md`, "Files").
 *
 * The stub below is `window.ObjectStackNative` with the members the fields
 * read. The picked image must reach the field's EXISTING upload pipeline: the
 * spy adapter behind `UploadProvider` is the one an `<input type=file>` pick
 * reaches, and the `maxSize` case proves the picked file is size-checked by
 * that same pipeline. The control cases are a desktop browser (no global) and
 * an older shell (`has('pickImage')` says no): no shell button, and the
 * `<input type=file>` path as before.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { toast } from '@object-ui/components';
import { UploadProvider } from './UploadProvider';
import type { UploadAdapter } from '@object-ui/types';
import { FileField } from './FileField';
import { ImageField } from './ImageField';
import './ImageCropperDialog';

const GLOBAL = 'ObjectStackNative';
/** "hello", five bytes. */
const PICKED = { base64: 'aGVsbG8=', name: 'IMG_0001.jpg', mime: 'image/jpeg' };

type PickAnswer = typeof PICKED | null | Error;

function installShell(opts: { capabilities?: string[]; answer?: PickAnswer } = {}) {
  const capabilities = opts.capabilities ?? ['haptic', 'pickImage'];
  const pickImage = vi.fn(async (_opts?: { camera?: boolean }) => {
    const answer = opts.answer === undefined ? PICKED : opts.answer;
    if (answer instanceof Error) throw answer;
    return answer;
  });
  (window as unknown as Record<string, unknown>)[GLOBAL] = {
    version: 1,
    platform: 'ios',
    appVersion: '2.2.0',
    capabilities,
    safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
    has: (c: string) => capabilities.includes(c),
    haptic: vi.fn(async () => null),
    pickImage,
    ready: vi.fn(),
    routeChanged: vi.fn(),
  };
  return pickImage;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>)[GLOBAL];
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function tap(testId: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
  await settle();
}

function renderWidget(Widget: typeof FileField, field: Record<string, unknown> = {}) {
  const upload = vi.fn(async (f: File | Blob) => {
    const name = (f as File).name;
    return { url: `https://cdn.example/${name}`, name, size: f.size, mimeType: f.type, meta: { fileId: 'file_picked' } };
  });
  const adapter: UploadAdapter = { name: 'spy', upload };
  const onChange = vi.fn();
  render(
    <UploadProvider adapter={adapter}>
      <Widget field={{ name: 'photo', ...field } as never} value={null} onChange={onChange} />
    </UploadProvider>,
  );
  return { upload, onChange };
}

function expectUploadedPick(upload: ReturnType<typeof vi.fn>) {
  expect(upload).toHaveBeenCalledTimes(1);
  const file = upload.mock.calls[0][0] as File;
  expect(file).toBeInstanceOf(File);
  expect(file.name).toBe('IMG_0001.jpg');
  expect(file.type).toBe('image/jpeg');
  expect(file.size).toBe(5);
}

describe('FileField: the shell photo buttons', () => {
  it('CONTROL: a plain browser draws no shell button and keeps the input', () => {
    renderWidget(FileField);
    expect(screen.queryByTestId('file-field-library-button')).toBeNull();
    // jsdom is no touch device, so the web camera button stays off, as before.
    expect(screen.queryByTestId('file-field-camera-button')).toBeNull();
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('CONTROL: an older shell without pickImage draws no shell button', () => {
    const pickImage = installShell({ capabilities: ['haptic', 'scan'] });
    renderWidget(FileField);
    expect(screen.queryByTestId('file-field-library-button')).toBeNull();
    expect(screen.queryByTestId('file-field-camera-button')).toBeNull();
    expect(pickImage).not.toHaveBeenCalled();
  });

  it('"Take photo" opens the shell camera and uploads the picked image through the field pipeline', async () => {
    const pickImage = installShell();
    const { upload, onChange } = renderWidget(FileField);
    // The shell takes over the camera button: no `capture` input is drawn.
    expect(screen.queryByTestId('file-field-camera-input')).toBeNull();
    await tap('file-field-camera-button');
    expect(pickImage).toHaveBeenCalledWith({ camera: true });
    expectUploadedPick(upload);
    expect(onChange).toHaveBeenCalledWith('file_picked');
  });

  it('"Choose photo" opens the shell library', async () => {
    const pickImage = installShell();
    const { upload, onChange } = renderWidget(FileField);
    await tap('file-field-library-button');
    expect(pickImage).toHaveBeenCalledWith({ camera: false });
    expectUploadedPick(upload);
    expect(onChange).toHaveBeenCalledWith('file_picked');
  });

  it('a cancel (null) uploads nothing', async () => {
    installShell({ answer: null });
    const { upload, onChange } = renderWidget(FileField);
    await tap('file-field-library-button');
    expect(upload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a shell failure shows the error toast with the shell message and uploads nothing', async () => {
    installShell({ answer: Object.assign(new Error('Camera permission denied'), { code: 'failed' }) });
    const toastError = vi.spyOn(toast, 'error');
    const { upload } = renderWidget(FileField);
    await tap('file-field-camera-button');
    expect(toastError).toHaveBeenCalledWith('Could not get the photo', { description: 'Camera permission denied' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('`capture: false` keeps the camera off; the library stays offered', () => {
    installShell();
    renderWidget(FileField, { capture: false });
    expect(screen.queryByTestId('file-field-camera-button')).toBeNull();
    expect(screen.getByTestId('file-field-library-button')).toBeInTheDocument();
  });

  it('a field that accepts no images offers no photo button', () => {
    installShell();
    renderWidget(FileField, { accept: ['.pdf'] });
    expect(screen.queryByTestId('file-field-library-button')).toBeNull();
    expect(screen.queryByTestId('file-field-camera-button')).toBeNull();
  });
});

describe('ImageField: the shell photo buttons', () => {
  it('CONTROL: a plain browser and an older shell draw no shell button', () => {
    renderWidget(ImageField as unknown as typeof FileField);
    expect(screen.queryByTestId('image-field-camera-button')).toBeNull();
    expect(screen.queryByTestId('image-field-library-button')).toBeNull();
    cleanup();
    installShell({ capabilities: ['haptic'] });
    renderWidget(ImageField as unknown as typeof FileField);
    expect(screen.queryByTestId('image-field-camera-button')).toBeNull();
    expect(screen.getByTestId('image-field-upload-button')).toBeInTheDocument();
  });

  it('"Take photo" and "Choose photo" upload the picked image through the field pipeline', async () => {
    const pickImage = installShell();
    const { upload, onChange } = renderWidget(ImageField as unknown as typeof FileField);
    await tap('image-field-camera-button');
    expect(pickImage).toHaveBeenLastCalledWith({ camera: true });
    expectUploadedPick(upload);
    expect(onChange).toHaveBeenLastCalledWith('file_picked');
    await tap('image-field-library-button');
    expect(pickImage).toHaveBeenLastCalledWith({ camera: false });
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('a cancel (null) uploads nothing', async () => {
    installShell({ answer: null });
    const { upload, onChange } = renderWidget(ImageField as unknown as typeof FileField);
    await tap('image-field-library-button');
    expect(upload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the picked image meets the same maxSize check an input pick does', async () => {
    installShell();
    const { upload, onChange } = renderWidget(ImageField as unknown as typeof FileField, { maxSize: 4 });
    await tap('image-field-camera-button');
    expect(upload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/IMG_0001\.jpg/)).toBeInTheDocument();
  });
});
