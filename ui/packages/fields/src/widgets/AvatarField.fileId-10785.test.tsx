/**
 * An avatar pick is submitted as the `sys_file` id the upload adapter
 * surfaced, or refused by name — never as a `data:` URL (objectui#10785).
 *
 * ## The defect
 *
 * `avatar` is a member of the file-reference family (`FILE_REFERENCE_TYPES`):
 * its stored value has been the bare `sys_file` id since spec `17.0.0`
 * (`FileReferenceIdValueSchema`). `AvatarField` read the picked file with
 * `FileReader.readAsDataURL` and handed the resulting `data:` URL to
 * `onChange`, so the whole image went into the record row as a string the
 * stored contract refuses (`invalid_type` on every deployment whose
 * `adr-0104-file-references` flag is recorded, warn-first on the rest). It
 * never went through `useUpload()`, and never minted an id.
 *
 * ## What is pinned, through the REAL widget
 *
 * The shipping `AvatarField`, under a real `UploadProvider` whose adapter is a
 * spy — the objectui#7699 shape `FileField` and `ImageField` are pinned in:
 *
 *   - the adapter returns a `fileId`  → that id, and only that id, reaches
 *     `onChange`; the preview then shows the adapter's own URL for it;
 *   - the adapter returns none        → the translated refusal is in the DOM,
 *     `onChange` is never called, and nothing handed over carries a `data:`
 *     or `blob:` URL;
 *   - no provider is mounted          → the object-URL default `useUpload()`
 *     falls open to is invoked and refused with the SAME row `FileField`
 *     renders for the same pick.
 *
 * ⛔ "onChange was not called" alone would pass on a widget that never
 * uploads, so each refusal arm also asserts the transport WAS invoked once:
 * the refusal sits after the upload, not instead of it.
 *
 * ## The read controls
 *
 * ADR-0104's dual-read window is a READ rule: a legacy `data:` URL and an
 * http(s) URL already on a record still render as themselves, and a bare id
 * renders from the storage endpoint — `readFileValue` is the reader, the same
 * one the file and image widgets use. Each is read in both the editable and
 * the readonly face.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { UploadProvider, type UploadAdapter, type UploadResult } from '@object-ui/providers';
import type { FieldMetadata } from '@object-ui/types';
import { AvatarField } from './AvatarField';
import { FileField } from './FileField';

const AVATAR: FieldMetadata = { name: 'photo', type: 'avatar', label: 'Photo' };

/** uuid/nanoid-shaped, so the platform's `isFileIdToken` accepts it. */
const MINTED_ID = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';

/**
 * The refusal's ruled NAME ("did not complete") for the named pick — the rest
 * of the sentence is translatable copy nobody parses, as in the objectui#7699
 * pins.
 */
const refusalFor = (name: string) =>
  new RegExp(`^Upload of "${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" did not complete`);

function pick(name = 'me.png'): File {
  return new File(['x'], name, { type: 'image/png' });
}

/**
 * A spy adapter. `withId` decides whether the result carries `meta.fileId`;
 * the rest of the result, URL included, is the same either way — so the
 * refusal arm measures the absence of the id and nothing else.
 */
function spyAdapter(withId: boolean) {
  const upload = vi.fn(async (f: File | Blob): Promise<UploadResult> => {
    const name = (f as File).name;
    return {
      url: `https://cdn.example/${name}`,
      name,
      size: f.size,
      mimeType: f.type,
      ...(withId ? { meta: { fileId: MINTED_ID } } : {}),
    };
  });
  const adapter: UploadAdapter = { name: 'spy', upload };
  return { adapter, upload };
}

/** Every argument `onChange` ever received, serialised. */
function everythingHandedOver(onChange: ReturnType<typeof vi.fn>): string {
  return JSON.stringify(onChange.mock.calls);
}

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

/** The `src` the avatar image was drawn with, or null when none was drawn. */
function avatarSrc(): string | null {
  return document.querySelector('img')?.getAttribute('src') ?? null;
}

/**
 * Reports every image as loaded, so Radix's `AvatarImage` renders its `img`
 * (happy-dom never loads one) — the same stand-in `userCell.readGate-10535`
 * uses.
 */
class LoadedImage {
  complete = true;
  naturalWidth = 1;
  src = '';
  crossOrigin: string | null = null;
  referrerPolicy = '';
  addEventListener(): void {}
  removeEventListener(): void {}
}

let realImage: typeof window.Image;

beforeEach(() => {
  realImage = window.Image;
  window.Image = LoadedImage as unknown as typeof window.Image;
});

afterEach(() => {
  cleanup();
  window.Image = realImage;
  vi.restoreAllMocks();
  // The no-provider arm stubs `URL`; undone here, not inline, so a failing
  // assertion cannot leak the stub into the next test.
  vi.unstubAllGlobals();
});

describe('AvatarField submits the sys_file id or refuses (objectui#10785)', () => {
  it('a fileId ⇒ the id string, and only it, reaches onChange; the preview shows the upload', async () => {
    const { adapter, upload } = spyAdapter(true);
    const onChange = vi.fn();
    const { rerender } = render(
      <UploadProvider adapter={adapter}>
        <AvatarField field={AVATAR} value="" onChange={onChange} />
      </UploadProvider>,
    );

    fireEvent.change(fileInput(), { target: { files: [pick('me.png')] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    // The value first: on a widget that reads the pick itself, the failure
    // message quotes what it handed over.
    expect(onChange.mock.calls[0][0]).toBe(MINTED_ID);
    expect(upload).toHaveBeenCalledTimes(1);

    // The host stores the id and hands it back: the bare id carries no URL of
    // its own, so the preview is the upload's own view, keyed by that id.
    rerender(
      <UploadProvider adapter={adapter}>
        <AvatarField field={AVATAR} value={MINTED_ID} onChange={onChange} />
      </UploadProvider>,
    );
    expect(avatarSrc()).toBe('https://cdn.example/me.png');
  });

  it('no fileId ⇒ a named refusal is shown, onChange never fires, and no data: URL is built', async () => {
    const { adapter, upload } = spyAdapter(false);
    const onChange = vi.fn();
    render(
      <UploadProvider adapter={adapter}>
        <AvatarField field={AVATAR} value="" onChange={onChange} />
      </UploadProvider>,
    );

    fireEvent.change(fileInput(), { target: { files: [pick('me.png')] } });

    await screen.findByText(refusalFor('me.png'));
    // The refusal sits AFTER the transport: the adapter ran and reported success.
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(everythingHandedOver(onChange)).not.toMatch(/data:|blob:/);
    // The widget leaves its uploading state, so the user can retry.
    expect(screen.getByRole('button', { name: /avatar/i }).hasAttribute('disabled')).toBe(false);
  });

  it('no provider mounted: the object-URL default is invoked and refused with the row FileField gives', async () => {
    const createObjectURL = vi.fn(() => 'blob:probe/1');
    // happy-dom does not implement it; the default adapter calls it unconditionally.
    vi.stubGlobal('URL', Object.assign(Object.create(URL), URL, { createObjectURL }));

    const onChange = vi.fn();
    render(<AvatarField field={AVATAR} value="" onChange={onChange} />);
    fireEvent.change(fileInput(), { target: { files: [pick('me.png')] } });
    const avatarRow = (await screen.findByText(refusalFor('me.png'))).textContent;
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(everythingHandedOver(onChange)).not.toMatch(/data:|blob:/);
    cleanup();

    // The same pick through FileField, no provider either: the same sentence.
    const fileOnChange = vi.fn();
    render(<FileField field={{ name: 'attachment', type: 'file' }} value={undefined} onChange={fileOnChange} />);
    fireEvent.change(fileInput(), { target: { files: [pick('me.png')] } });
    const fileRow = (await screen.findByText(refusalFor('me.png'))).textContent;
    expect(fileOnChange).not.toHaveBeenCalled();
    expect(avatarRow).toBe(fileRow);
  });
});

describe.each([
  ['editable', false],
  ['readonly', true],
])('AvatarField reads every stored form — %s (objectui#10785)', (_face, readonly) => {
  function renderValue(value: string) {
    render(
      <AvatarField field={AVATAR} value={value} onChange={vi.fn()} readonly={readonly} />,
    );
  }

  it('a legacy data: URL renders as itself', () => {
    const legacy = 'data:image/png;base64,iVBORw0KGgo=';
    renderValue(legacy);
    expect(avatarSrc()).toBe(legacy);
  });

  it('a legacy http(s) URL renders as itself', () => {
    renderValue('https://cdn.example/legacy.png');
    expect(avatarSrc()).toBe('https://cdn.example/legacy.png');
  });

  it('a bare sys_file id renders from the storage endpoint', () => {
    renderValue(MINTED_ID);
    expect(avatarSrc()).toBe(`/api/v1/storage/files/${MINTED_ID}`);
  });
});
