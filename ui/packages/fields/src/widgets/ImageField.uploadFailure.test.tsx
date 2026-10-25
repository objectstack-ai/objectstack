/**
 * ImageField — a FAILED upload is reported inline, the image is not added,
 * and the rejection never escapes the handler (objectui#10226).
 *
 * The defect this pins: both upload paths (`handleFileChange` for the native
 * picker, `handleCropConfirm` for the crop dialog) were `try … finally` with no
 * `catch`. Both are invoked fire-and-forget — React ignores the promise an
 * `onChange` handler returns, and the cropper calls `onConfirm` without
 * awaiting it — so a rejecting upload surfaced as an unhandled promise
 * rejection and the user saw nothing at all. FileField, on the same failure
 * through the same `useUpload()` transport, renders `fields.file.uploadFailed`.
 *
 * So each failure case asserts three facts together: the translated failure
 * text is in the DOM, `onChange` was not called with the failed image, and the
 * process saw zero `unhandledRejection` events. The success cases are the
 * control — the same harness with a resolving transport still adds the image.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UploadProvider, type UploadAdapter } from '@object-ui/providers';
import { ImageField } from './ImageField';
// Imported at module scope (not awaited in a hook) so the widget's
// `React.lazy(() => import('./ImageCropperDialog'))` resolves from the ESM
// cache instead of racing RTL's 1000ms `findBy` budget — AGENTS.md §测试纪律.
import './ImageCropperDialog';

function image(name: string): File {
  return new File(['x'], name, { type: 'image/png' });
}

/** The `sys_file` id the spy adapter mints for `name` — id-shaped, so `isFileIdToken` accepts it. */
const idOf = (name: string) => `file_${name.replace(/[^A-Za-z0-9_-]/g, '_')}`;

/**
 * `upload` rejects for any name listed in `failing`, resolves otherwise. A crop
 * uploads a bare `Blob`, which carries no name, so it is keyed `cropped.png`.
 * A resolving upload mints a `sys_file` id, as the ObjectStack flow does: since
 * objectui#7699 an upload that surfaces none is refused rather than submitted,
 * and that arm has its own pins in `fileSubmitRequiresId-7699.test.tsx`.
 */
function renderField(field: Record<string, unknown>, value: unknown, failing: string[]) {
  const upload = vi.fn(async (f: File | Blob) => {
    const name = (f as File).name ?? 'cropped.png';
    if (failing.includes(name)) throw new Error('network down');
    return {
      url: `https://cdn.example/${name}`,
      name,
      size: f.size,
      mimeType: 'image/png',
      meta: { fileId: idOf(name) },
    };
  });
  const adapter: UploadAdapter = { name: 'spy', upload };
  const onChange = vi.fn();
  render(
    <UploadProvider adapter={adapter}>
      <ImageField field={field as any} value={value} onChange={onChange} />
    </UploadProvider>,
  );
  return { upload, onChange, input: document.querySelector('input[type="file"]') as HTMLInputElement };
}

/**
 * Node's `process`, reached through `globalThis` with only the two members this
 * file uses typed — this package's test program deliberately carries no
 * `@types/node` (see `tsconfig.test.json`).
 */
type RejectionListener = (reason: unknown) => void;
const nodeProcess = (globalThis as unknown as {
  process: {
    on(event: 'unhandledRejection', listener: RejectionListener): void;
    off(event: 'unhandledRejection', listener: RejectionListener): void;
  };
}).process;

/** Lets the event loop turn so a pending `unhandledRejection` is dispatched. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const existing = { name: 'cover.png', url: 'https://cdn.example/cover.png', mime_type: 'image/png' };

describe('ImageField — a failed upload is reported, not swallowed (#10226)', () => {
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  beforeEach(() => {
    unhandled = [];
    nodeProcess.on('unhandledRejection', onUnhandled);
  });
  afterEach(() => {
    nodeProcess.off('unhandledRejection', onUnhandled);
  });

  it('picker: shows the translated failure, adds nothing, leaks no rejection', async () => {
    const { upload, onChange, input } = renderField({ name: 'p_cover' }, undefined, ['bad.png']);

    fireEvent.change(input, { target: { files: [image('bad.png')] } });

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await settle();
    expect.soft(unhandled).toHaveLength(0);
    expect.soft(onChange).not.toHaveBeenCalled();
    await screen.findByText('Failed to upload "bad.png": network down');
    // The button leaves its uploading state, so the user can retry.
    expect(screen.getByTestId('image-field-upload-button').hasAttribute('disabled')).toBe(false);
  });

  it('picker (multiple): adds the successful picks and reports only the failed one', async () => {
    const { upload, onChange, input } = renderField({ name: 'p_gallery', multiple: true }, undefined, ['bad.png']);

    fireEvent.change(input, { target: { files: [image('good.png'), image('bad.png')] } });

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await settle();
    expect.soft(unhandled).toHaveLength(0);
    await screen.findByText('Failed to upload "bad.png": network down');
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const added = onChange.mock.calls[0][0] as unknown[];
    // The reference form the adapter minted for the good pick — and only that.
    expect(added).toEqual([idOf('good.png')]);
    expect(JSON.stringify(added)).not.toContain('bad.png');
  });

  it('picker control: a resolving upload is still added', async () => {
    const { onChange, input } = renderField({ name: 'p_cover' }, undefined, []);

    fireEvent.change(input, { target: { files: [image('good.png')] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    await settle();
    expect(onChange.mock.calls[0][0]).toBe(idOf('good.png'));
    expect(screen.queryByText(/Failed to upload/)).toBeNull();
    expect(unhandled).toHaveLength(0);
  });

  it('crop: shows the translated failure, keeps the original image, leaks no rejection', async () => {
    const { upload, onChange } = renderField({ name: 'p_cover', crop: true }, existing, ['cropped.png']);

    fireEvent.click(screen.getByTestId('image-field-crop-0'));
    fireEvent.click(await screen.findByTestId('fake-crop-confirm'));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await settle();
    expect.soft(unhandled).toHaveLength(0);
    expect.soft(onChange).not.toHaveBeenCalled();
    await screen.findByText('Failed to upload "cover.png": network down');
    // The dialog closes so the message is not hidden behind it.
    expect(screen.queryByTestId('fake-crop-confirm')).toBeNull();
  });

  it('crop control: a resolving upload still replaces the image', async () => {
    const { onChange } = renderField({ name: 'p_cover', crop: true }, existing, []);

    fireEvent.click(screen.getByTestId('image-field-crop-0'));
    fireEvent.click(await screen.findByTestId('fake-crop-confirm'));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    await settle();
    expect(onChange.mock.calls[0][0]).toBe(idOf('cropped.png'));
    expect(screen.queryByText(/Failed to upload/)).toBeNull();
    expect(unhandled).toHaveLength(0);
  });
});

/**
 * The real cropper is a canvas + `toBlob` pipeline that happy-dom cannot run;
 * this stand-in drives the one contract ImageField has with it — `onConfirm`
 * hands back a blob and a name, fire-and-forget, exactly as the real dialog
 * calls it (it does not await the returned promise).
 */
vi.mock('./ImageCropperDialog', () => ({
  ImageCropperDialog: ({ onConfirm }: { onConfirm: (blob: Blob, name: string) => void }) => (
    <button
      type="button"
      data-testid="fake-crop-confirm"
      onClick={() => onConfirm(new Blob(['x'], { type: 'image/png' }), 'cover.png')}
    >
      confirm
    </button>
  ),
}));
