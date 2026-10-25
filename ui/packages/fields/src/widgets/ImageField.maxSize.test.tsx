/**
 * ImageField — a declared `maxSize` is enforced BEFORE any upload starts
 * (objectui#4141).
 *
 * The defect this pins: `paramToField` copies `maxSize` onto the field config
 * for every param type, so the image widget RECEIVES the constraint — it just
 * never read it. An oversized pick therefore fired the whole
 * `presigned → PUT → complete` chain and rendered a preview, while the sibling
 * file param rejected the same pick with zero uploads.
 *
 * So the assertion that matters is **zero upload attempts**, not "no preview":
 * a widget that uploads the bytes and then hides the thumbnail has still
 * stored an over-limit file. The spy sits on the `UploadProvider` adapter —
 * the layer that performs the presigned request — so a call there IS the
 * network attempt.
 *
 * Two upload entry points exist on this widget and both are covered here:
 *   1. the native picker (`handleFileChange`, single and `multiple`);
 *   2. the crop dialog's confirm (`handleCropConfirm`), which uploads a
 *      freshly re-encoded PNG blob — canvas re-encoding can push a crop of an
 *      in-limit JPEG *over* the limit, so it is a real second door.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UploadProvider, type UploadAdapter } from '@object-ui/providers';
import { ImageField } from './ImageField';
// Imported at module scope (not awaited in a hook) so the widget's
// `React.lazy(() => import('./ImageCropperDialog'))` resolves from the ESM
// cache instead of racing RTL's 1000ms `findBy` budget — AGENTS.md §测试纪律.
import './ImageCropperDialog';

const MB = 1024 * 1024;

/** A File whose reported `size` is the declared one (constructor bytes are not). */
function imageOfSize(name: string, bytes: number): File {
  const file = new File(['x'], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

function blobOfSize(bytes: number): Blob {
  const blob = new Blob(['x'], { type: 'image/png' });
  Object.defineProperty(blob, 'size', { value: bytes });
  return blob;
}

function renderField(field: Record<string, unknown>, value: unknown = undefined) {
  // Mints a `sys_file` id, as the ObjectStack flow does: an upload that
  // surfaces none is refused before it reaches `onChange` (objectui#7699), and
  // the in-limit rows below assert that `onChange` fired.
  const upload = vi.fn(async (f: File | Blob) => ({
    url: 'https://cdn.example/uploaded.png',
    name: (f as File).name ?? 'cropped.png',
    size: f.size,
    mimeType: f.type || 'image/png',
    meta: { fileId: 'file_uploaded' },
  }));
  const adapter: UploadAdapter = { name: 'spy', upload };
  const onChange = vi.fn();
  render(
    <UploadProvider adapter={adapter}>
      <ImageField field={field as any} value={value} onChange={onChange} />
    </UploadProvider>,
  );
  return { upload, onChange, input: document.querySelector('input[type="file"]') as HTMLInputElement };
}

describe('ImageField — client-side maxSize guard (#4141)', () => {
  it('never reaches the upload layer for a pick over the declared maxSize', async () => {
    const { upload, onChange, input } = renderField({ name: 'p_cover', maxSize: 5 * MB });

    fireEvent.change(input, { target: { files: [imageOfSize('huge.png', 6.3 * MB)] } });

    // The message is the proof the guard ran; the spy is the proof nothing was sent.
    await screen.findByText(/"huge\.png" exceeds max size \(5\.0 MB\)/);
    expect(upload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still uploads a pick inside the declared maxSize', async () => {
    const { upload, onChange, input } = renderField({ name: 'p_cover', maxSize: 5 * MB });

    fireEvent.change(input, { target: { files: [imageOfSize('ok.png', 1 * MB)] } });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/exceeds max size/)).toBeNull();
  });

  it('uploads unrestricted when the param declares no maxSize', async () => {
    const { upload, onChange, input } = renderField({ name: 'p_cover' });

    fireEvent.change(input, { target: { files: [imageOfSize('enormous.png', 500 * MB)] } });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/exceeds max size/)).toBeNull();
  });

  it('rejects only the oversized picks of a multi-select and uploads the rest', async () => {
    const { upload, onChange, input } = renderField({ name: 'p_gallery', multiple: true, maxSize: 5 * MB });

    fireEvent.change(input, {
      target: { files: [imageOfSize('small.png', 1 * MB), imageOfSize('huge.png', 6.3 * MB)] },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(upload).toHaveBeenCalledTimes(1);
    expect((upload.mock.calls[0][0] as File).name).toBe('small.png');
    expect(screen.getByText(/"huge\.png" exceeds max size \(5\.0 MB\)/)).toBeTruthy();
  });

  it('guards the crop dialog too — an oversized re-encode is never uploaded', async () => {
    const existing = { name: 'cover.png', url: 'https://cdn.example/cover.png', mime_type: 'image/png' };
    const { upload, onChange } = renderField({ name: 'p_cover', maxSize: 5 * MB, crop: true }, existing);

    fireEvent.click(screen.getByTestId('image-field-crop-0'));
    const confirm = await screen.findByTestId('fake-crop-confirm');
    fireEvent.click(confirm);

    await screen.findByText(/exceeds max size \(5\.0 MB\)/);
    expect(upload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still uploads a crop that fits inside the declared maxSize', async () => {
    const existing = { name: 'cover.png', url: 'https://cdn.example/cover.png', mime_type: 'image/png' };
    const { upload, onChange } = renderField({ name: 'p_cover', maxSize: 5 * MB, crop: true }, existing);

    fireEvent.click(screen.getByTestId('image-field-crop-0'));
    fireEvent.click(await screen.findByTestId('fake-crop-confirm-small'));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(upload).toHaveBeenCalledTimes(1);
  });
});

/**
 * The real cropper is a canvas + `toBlob` pipeline that happy-dom cannot run;
 * this stand-in drives the ONE contract ImageField has with it — `onConfirm`
 * hands back a blob and a name — with a blob size on either side of the limit.
 */
vi.mock('./ImageCropperDialog', () => ({
  ImageCropperDialog: ({ onConfirm }: { onConfirm: (blob: Blob, name: string) => void }) => (
    <div>
      <button type="button" data-testid="fake-crop-confirm" onClick={() => onConfirm(blobOfSize(6.3 * MB), 'cover.png')}>
        confirm big
      </button>
      <button
        type="button"
        data-testid="fake-crop-confirm-small"
        onClick={() => onConfirm(blobOfSize(0.5 * MB), 'cover.png')}
      >
        confirm small
      </button>
    </div>
  ),
}));
