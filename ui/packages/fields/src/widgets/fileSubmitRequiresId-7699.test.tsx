/**
 * A file or image upload is submitted as the `sys_file` id the adapter
 * surfaced, or refused by name — never as the legacy inline blob
 * (objectui#7699).
 *
 * ## The defect
 *
 * `fileValueForSubmit` used to fall back to `{ name, original_name, size,
 * mime_type, url }` when the upload adapter surfaced no `meta.fileId`. That was
 * the one client path in either repo still producing the pre-D3 inline object
 * for a record field value: the backend's stored contract has been id-only
 * since spec `17.0.0`, so the fallback turned an upload into a save the engine
 * refused (`invalid_type`) on every deployment that had verified its
 * file-as-reference migration, and into a warned-about legacy value on the
 * rest. ADR-0104's 2026-09-05 addendum fixes the physical column to the bare id
 * as well, so there is no deployment left whose contract accepts the blob.
 *
 * ## What is pinned, through the REAL widgets
 *
 * Each pin drives the shipping `FileField`, `FileCell` or `ImageField` (both of
 * its upload paths — the native picker and the crop dialog) under a real
 * `UploadProvider` whose adapter is a spy. Two arms per widget:
 *
 *   - the adapter returns a `fileId`  → that id, and only that id, reaches
 *     `onChange`;
 *   - the adapter returns none        → the translated refusal is in the DOM,
 *     `onChange` is never called, and no argument anywhere carries `url` or
 *     `mime_type` — the blob is not merely renamed, it is not built.
 *
 * ⛔ "onChange was not called" alone would pass on a widget that never uploads,
 * so each refusal arm also asserts the adapter WAS invoked exactly once: the
 * refusal sits after the transport, not instead of it.
 *
 * ## The controls
 *
 *   - ADR-0104's dual-read window is a READ rule: a legacy blob already on the
 *     record still renders, and on a `multiple` field it is passed through
 *     UNTOUCHED beside the new id — a stored value, not a new write of that
 *     shape. Asserted by reference identity, not by shape.
 *   - `useUpload()` fails OPEN to the object-URL default when no provider is
 *     mounted (objectui#10131). That arm now ends in the same refusal: the
 *     default adapter is invoked (`URL.createObjectURL` is called) and nothing
 *     reaches `onChange`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { UploadProvider, type UploadAdapter, type UploadResult } from '@object-ui/providers';
import { FileField, FileCell } from './FileField';
import { ImageField } from './ImageField';
// Imported at module scope (not awaited in a hook) so the widget's
// `React.lazy(() => import('./ImageCropperDialog'))` resolves from the ESM
// cache instead of racing RTL's 1000ms `findBy` budget — AGENTS.md §测试纪律.
import './ImageCropperDialog';

/** uuid/nanoid-shaped, so the platform's `isFileIdToken` accepts it. */
const MINTED_ID = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';

/**
 * The refusal's ruled NAME ("did not complete") for the named pick. The rest of
 * the sentence is translatable copy nobody parses, so it is deliberately not
 * pinned; the prefix is enough to tell it from the transport failure's
 * `Failed to upload "NAME": ...` row.
 */
const refusalFor = (name: string) =>
  new RegExp(`^Upload of "${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" did not complete`);

/** A legacy inline blob, as a record written before file-as-reference holds it. */
const LEGACY_BLOB = {
  name: 'legacy.pdf',
  original_name: 'Legacy (signed).pdf',
  size: 12,
  mime_type: 'application/pdf',
  url: 'https://cdn.example/legacy.pdf',
};
const LEGACY_IMAGE = { name: 'cover.png', url: 'https://cdn.example/cover.png', mime_type: 'image/png' };

function pick(name: string, type = 'application/pdf'): File {
  return new File(['x'], name, { type });
}

/**
 * A spy adapter. `withId` decides whether the result carries `meta.fileId`; the
 * rest of the result is the same either way, URL included — so the refusal arm
 * measures the absence of the id and nothing else.
 */
function spyAdapter(withId: boolean) {
  const upload = vi.fn(async (f: File | Blob): Promise<UploadResult> => {
    const name = (f as File).name ?? 'cropped.png';
    return {
      url: `https://cdn.example/${name}`,
      name,
      size: f.size,
      mimeType: f.type || 'image/png',
      ...(withId ? { meta: { fileId: MINTED_ID } } : {}),
    };
  });
  const adapter: UploadAdapter = { name: 'spy', upload };
  return { adapter, upload };
}

/** Every argument `onChange` ever received, serialised, for the "no blob" reading. */
function everythingHandedOver(onChange: ReturnType<typeof vi.fn>): string {
  return JSON.stringify(onChange.mock.calls);
}

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // The no-provider arm stubs `URL`; undone here, not inline, so a failing
  // assertion cannot leak the stub into the next test.
  vi.unstubAllGlobals();
});

describe('FileField submits the sys_file id or refuses (objectui#7699)', () => {
  it('a fileId ⇒ the id string reaches onChange', async () => {
    const { adapter, upload } = spyAdapter(true);
    const onChange = vi.fn();
    render(
      <UploadProvider adapter={adapter}>
        <FileField field={{ name: 'attachment', type: 'file' } as any} value={undefined} onChange={onChange} />
      </UploadProvider>,
    );

    fireEvent.change(fileInput(), { target: { files: [pick('contract.pdf')] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe(MINTED_ID);
  });

  it('no fileId ⇒ a named refusal is shown, onChange never fires, and no blob is built', async () => {
    const { adapter, upload } = spyAdapter(false);
    const onChange = vi.fn();
    render(
      <UploadProvider adapter={adapter}>
        <FileField field={{ name: 'attachment', type: 'file' } as any} value={undefined} onChange={onChange} />
      </UploadProvider>,
    );

    fireEvent.change(fileInput(), { target: { files: [pick('contract.pdf')] } });

    await screen.findByText(refusalFor('contract.pdf'));
    // The refusal sits AFTER the transport: the adapter ran and reported success.
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(everythingHandedOver(onChange)).not.toMatch(/url|mime_type/);
    // The widget leaves its uploading state, so the user can retry with a
    // destination that mints an id.
    expect(screen.queryByTestId('file-field-uploading')).toBeNull();
  });

  it('multiple: the picks that carried an id land, the pick that did not is refused by name', async () => {
    // One adapter, two behaviours, keyed by file name.
    const upload = vi.fn(async (f: File | Blob): Promise<UploadResult> => {
      const name = (f as File).name;
      return {
        url: `https://cdn.example/${name}`,
        name,
        size: f.size,
        mimeType: f.type,
        ...(name === 'good.pdf' ? { meta: { fileId: MINTED_ID } } : {}),
      };
    });
    const onChange = vi.fn();
    render(
      <UploadProvider adapter={{ name: 'spy', upload }}>
        <FileField
          field={{ name: 'attachments', type: 'file', multiple: true } as any}
          value={undefined}
          onChange={onChange}
        />
      </UploadProvider>,
    );

    fireEvent.change(fileInput(), { target: { files: [pick('good.pdf'), pick('bad.pdf')] } });

    await screen.findByText(refusalFor('bad.pdf'));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0]).toEqual([MINTED_ID]);
    expect(everythingHandedOver(onChange)).not.toMatch(/url|mime_type|bad\.pdf/);
  });

  it('THE READ CONTROL: a legacy blob on the record still renders and passes through untouched beside a new id', async () => {
    const { adapter } = spyAdapter(true);
    const onChange = vi.fn();
    render(
      <UploadProvider adapter={adapter}>
        <FileField
          field={{ name: 'attachments', type: 'file', multiple: true } as any}
          value={[LEGACY_BLOB]}
          onChange={onChange}
        />
      </UploadProvider>,
    );
    // The dual-read window: the legacy value renders by its own name.
    expect(screen.getByText('legacy.pdf')).toBeTruthy();

    fireEvent.change(fileInput(), { target: { files: [pick('contract.pdf')] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const submitted = onChange.mock.calls[0][0] as unknown[];
    expect(submitted).toHaveLength(2);
    // The stored value goes back as the SAME object — not re-derived, not
    // re-shaped, not a new write of that shape.
    expect(submitted[0]).toBe(LEGACY_BLOB);
    expect(submitted[1]).toBe(MINTED_ID);
  });

  it('no provider mounted: the object-URL default is invoked and refused, nothing reaches onChange', async () => {
    const createObjectURL = vi.fn(() => 'blob:probe/1');
    // happy-dom does not implement it; the default adapter calls it unconditionally.
    vi.stubGlobal('URL', Object.assign(Object.create(URL), URL, { createObjectURL }));
    const onChange = vi.fn();
    render(<FileField field={{ name: 'attachment', type: 'file' } as any} value={undefined} onChange={onChange} />);

    fireEvent.change(fileInput(), { target: { files: [pick('contract.pdf')] } });

    await screen.findByText(refusalFor('contract.pdf'));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(everythingHandedOver(onChange)).not.toMatch(/blob:|url|mime_type/);
  });
});

describe('FileCell (line-item grid) shares the pipeline (objectui#7699)', () => {
  it('a fileId ⇒ the id; no fileId ⇒ the refusal and no onChange', async () => {
    const withId = spyAdapter(true);
    const onChangeA = vi.fn();
    const first = render(
      <UploadProvider adapter={withId.adapter}>
        <FileCell value={null} onChange={onChangeA} aria-label="Receipt" />
      </UploadProvider>,
    );
    fireEvent.change(fileInput(), { target: { files: [pick('receipt.png', 'image/png')] } });
    await waitFor(() => expect(onChangeA).toHaveBeenCalledWith(MINTED_ID));
    first.unmount();

    const withoutId = spyAdapter(false);
    const onChangeB = vi.fn();
    render(
      <UploadProvider adapter={withoutId.adapter}>
        <FileCell value={null} onChange={onChangeB} aria-label="Receipt" />
      </UploadProvider>,
    );
    fireEvent.change(fileInput(), { target: { files: [pick('receipt.png', 'image/png')] } });
    // The cell's error row shows the first message and titles the whole list.
    await screen.findByText(refusalFor('receipt.png'));
    expect(withoutId.upload).toHaveBeenCalledTimes(1);
    expect(onChangeB).not.toHaveBeenCalled();
  });
});

describe('ImageField submits the sys_file id or refuses — both upload paths (objectui#7699)', () => {
  function renderImage(field: Record<string, unknown>, value: unknown, withId: boolean) {
    const { adapter, upload } = spyAdapter(withId);
    const onChange = vi.fn();
    render(
      <UploadProvider adapter={adapter}>
        <ImageField field={field as any} value={value} onChange={onChange} />
      </UploadProvider>,
    );
    return { upload, onChange };
  }

  it('picker, a fileId ⇒ the id string reaches onChange', async () => {
    const { upload, onChange } = renderImage({ name: 'p_cover' }, undefined, true);

    fireEvent.change(fileInput(), { target: { files: [pick('good.png', 'image/png')] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe(MINTED_ID);
  });

  it('picker, no fileId ⇒ the refusal, no onChange, no blob', async () => {
    const { upload, onChange } = renderImage({ name: 'p_cover' }, undefined, false);

    fireEvent.change(fileInput(), { target: { files: [pick('bad.png', 'image/png')] } });

    await screen.findByText(refusalFor('bad.png'));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(everythingHandedOver(onChange)).not.toMatch(/url|mime_type/);
    // The button leaves its uploading state, so the user can retry.
    expect(screen.getByTestId('image-field-upload-button').hasAttribute('disabled')).toBe(false);
  });

  it('crop, a fileId ⇒ the id replaces the image', async () => {
    const { upload, onChange } = renderImage({ name: 'p_cover', crop: true }, LEGACY_IMAGE, true);

    fireEvent.click(screen.getByTestId('image-field-crop-0'));
    fireEvent.click(await screen.findByTestId('fake-crop-confirm'));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe(MINTED_ID);
  });

  it('crop, no fileId ⇒ the refusal, the original image stays, no onChange, no blob', async () => {
    const { upload, onChange } = renderImage({ name: 'p_cover', crop: true }, LEGACY_IMAGE, false);

    fireEvent.click(screen.getByTestId('image-field-crop-0'));
    fireEvent.click(await screen.findByTestId('fake-crop-confirm'));

    await screen.findByText(refusalFor('cover.png'));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(everythingHandedOver(onChange)).not.toMatch(/url|mime_type/);
    // The legacy image is still rendered — the READ rule — and the dialog is closed.
    expect(document.querySelectorAll('img')).toHaveLength(1);
    expect(screen.queryByTestId('fake-crop-confirm')).toBeNull();
  });

  it('THE READ CONTROL: a legacy blob on a multiple field renders and passes through untouched beside a new id', async () => {
    const { onChange } = renderImage({ name: 'p_gallery', multiple: true }, [LEGACY_IMAGE], true);
    expect((document.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe(LEGACY_IMAGE.url);

    fireEvent.change(fileInput(), { target: { files: [pick('new.png', 'image/png')] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const submitted = onChange.mock.calls[0][0] as unknown[];
    expect(submitted).toHaveLength(2);
    expect(submitted[0]).toBe(LEGACY_IMAGE);
    expect(submitted[1]).toBe(MINTED_ID);
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
