/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10637 — `ImageField` named a nameless image with the untranslated
 * literal `'Image'`, so its alt text, its enlarge label and its lightbox never
 * reached the translated `fields.image.imageAlt`.
 *
 * The widget read its images with `readFileValues(value, 'Image')`, and
 * `readFileValue` puts that fallback name on every value that carries no name
 * of its own (a bare `sys_file` id, a `data:` URI). So `img.name` was the
 * truthy English word, and every `img.name || t('fields.image.imageAlt', …)`
 * in the widget stopped at it, on every locale. The image CELL did the same
 * and objectui#10493 retired the literal there; this file pins the widget
 * following the cell: an EMPTY fallback name in, the translated string out.
 *
 * ── What the assertions compare against ───────────────────────────────────
 *   - Every expected string is a PACK VALUE, read from the imported `en` /
 *     `zh` pack and interpolated here, never a hand-typed string. The two
 *     locales are both rendered and must differ, so one literal cannot pass
 *     both legs.
 *   - THE LIT CONTROL: a value that carries its own name keeps it, in the alt,
 *     the enlarge label and the lightbox. The caricature "every image is now
 *     named by the translated string" passes every nameless row and fails it.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
import { UploadProvider, type UploadAdapter } from '@object-ui/providers';
import { ImageField } from './ImageField';
import type { FieldWidgetComponentProps } from './types';

afterEach(() => cleanup());

/**
 * The three members of a locale pack this file reads. The packs are `as const`,
 * so their types are literal and differ per locale: a structural type both
 * satisfy, rather than `typeof en`.
 */
type Pack = { fields: { image: { imageAlt: string; enlarge: string; preview: string } } };

/** The translated alt, read from the pack: `fields.image.imageAlt` with `{{index}}` filled. */
const packAlt = (pack: Pack, index: number) => pack.fields.image.imageAlt.replace('{{index}}', String(index));

/** The translated enlarge label, read from the pack: `fields.image.enlarge` with `{{name}}` filled. */
const packEnlarge = (pack: Pack, name: string) => pack.fields.image.enlarge.replace('{{name}}', name);

/** The card's reproduction value: a bare `sys_file` id, which carries no name. */
const BARE_ID = 'file_a';

/** The other nameless shape: a `data:` URI names nothing since objectui#10493. */
const DATA_URI = 'data:image/png;base64,iVBORw0KGgo=';

/** The literal the widget used to name every nameless image with. */
const LITERAL = 'Image';

function renderField(
  value: unknown,
  language: string,
  { readonly = false, multiple = false }: { readonly?: boolean; multiple?: boolean } = {},
) {
  const field = { name: 'cover', type: 'image', multiple } as unknown as FieldWidgetComponentProps['field'];
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ImageField field={field} value={value} onChange={() => {}} readonly={readonly} />
    </I18nProvider>,
  );
}

const imgsOf = (root: ParentNode) => Array.from(root.querySelectorAll('img'));

/** The read-only thumbnails are buttons that open the lightbox. */
const enlargeButtonsOf = (root: ParentNode) => Array.from(root.querySelectorAll('button[aria-label]'));

describe('objectui#10637 — ImageField names a nameless image with the translated fields.image.imageAlt', () => {
  it('THE PREMISE — the zh and en packs spell the alt differently, and zh never says Image', () => {
    // Every locale leg below is only as strong as this: equal pack values
    // would let one literal satisfy both, and a zh value holding the English
    // word would let the literal pass the `not.toContain` checks.
    expect(packAlt(zh, 1)).not.toBe(packAlt(en, 1));
    expect(packAlt(zh, 1)).not.toContain(LITERAL);
    expect(packEnlarge(zh, packAlt(zh, 1))).not.toContain(LITERAL);
  });

  it('THE DEFECT — zh, read-only, a bare id: the alt and the enlarge label are the zh pack strings', () => {
    const { container } = renderField(BARE_ID, 'zh', { readonly: true });
    const [img] = imgsOf(container);
    expect(img?.getAttribute('src'), 'a bare id still draws from its download endpoint').toBe(
      '/api/v1/storage/files/file_a',
    );
    expect(img?.getAttribute('alt'), 'the alt is the translated fields.image.imageAlt').toBe(packAlt(zh, 1));
    const [button] = enlargeButtonsOf(container);
    expect(button?.getAttribute('aria-label'), 'the enlarge label embeds the translated alt').toBe(
      packEnlarge(zh, packAlt(zh, 1)),
    );
    expect(img?.getAttribute('alt')).not.toContain(LITERAL);
    expect(button?.getAttribute('aria-label')).not.toContain(LITERAL);
  });

  it('THE DEFECT — zh, the lightbox a bare-id thumbnail opens is named by the zh pack strings', () => {
    const { container } = renderField(BARE_ID, 'zh', { readonly: true });
    fireEvent.click(enlargeButtonsOf(container)[0]);
    const dialog = screen.getByRole('dialog', { name: zh.fields.image.preview });
    const [img] = imgsOf(dialog);
    expect(img?.getAttribute('alt'), 'the lightbox image takes the same translated alt').toBe(packAlt(zh, 1));
    expect(dialog.textContent ?? '', 'the dialog names no untranslated literal').not.toContain(LITERAL);
  });

  it('THE DEFECT — zh, edit mode, a bare id: the thumbnail alt is the zh pack string', () => {
    const { container } = renderField(BARE_ID, 'zh');
    const [img] = imgsOf(container);
    expect(img?.getAttribute('alt')).toBe(packAlt(zh, 1));
  });

  it('THE DEFECT — zh, a data-URI value reads the same translated alt', () => {
    const { container } = renderField(DATA_URI, 'zh', { readonly: true });
    const [img] = imgsOf(container);
    expect(img?.getAttribute('src'), 'the stored value is drawn unchanged').toBe(DATA_URI);
    expect(img?.getAttribute('alt')).toBe(packAlt(zh, 1));
    expect(enlargeButtonsOf(container)[0]?.getAttribute('aria-label')).toBe(packEnlarge(zh, packAlt(zh, 1)));
  });

  it('THE DEFECT — zh, several nameless images are numbered by position, in both modes and in the lightbox', () => {
    const value = [BARE_ID, 'file_b'];
    const readonlyView = renderField(value, 'zh', { readonly: true, multiple: true });
    expect(imgsOf(readonlyView.container).map((img) => img.getAttribute('alt'))).toEqual([
      packAlt(zh, 1),
      packAlt(zh, 2),
    ]);
    expect(enlargeButtonsOf(readonlyView.container).map((b) => b.getAttribute('aria-label'))).toEqual([
      packEnlarge(zh, packAlt(zh, 1)),
      packEnlarge(zh, packAlt(zh, 2)),
    ]);
    fireEvent.click(enlargeButtonsOf(readonlyView.container)[1]);
    const dialog = screen.getByRole('dialog', { name: zh.fields.image.preview });
    expect(imgsOf(dialog)[0]?.getAttribute('alt')).toBe(packAlt(zh, 2));
    cleanup();

    const editView = renderField(value, 'zh', { multiple: true });
    expect(imgsOf(editView.container).map((img) => img.getAttribute('alt'))).toEqual([
      packAlt(zh, 1),
      packAlt(zh, 2),
    ]);
  });

  it('THE en LEG — en, read-only, a bare id: the alt and the enlarge label are the en pack strings', () => {
    const { container } = renderField(BARE_ID, 'en', { readonly: true });
    const [img] = imgsOf(container);
    expect(img?.getAttribute('alt')).toBe(packAlt(en, 1));
    expect(enlargeButtonsOf(container)[0]?.getAttribute('aria-label')).toBe(packEnlarge(en, packAlt(en, 1)));
  });

  it('THE LIT CONTROL — a value with its own name keeps it in the alt, the enlarge label and the lightbox', () => {
    const value = { id: BARE_ID, name: 'cover.png', url: 'https://cdn.example/cover.png', mimeType: 'image/png' };
    const { container } = renderField(value, 'zh', { readonly: true });
    const [img] = imgsOf(container);
    expect(img?.getAttribute('alt')).toBe('cover.png');
    const [button] = enlargeButtonsOf(container);
    expect(button?.getAttribute('aria-label')).toBe(packEnlarge(zh, 'cover.png'));
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'cover.png' });
    expect(imgsOf(dialog)[0]?.getAttribute('alt')).toBe('cover.png');
  });

  it('THE LIT CONTROL — an https URL is still named by its last segment', () => {
    const { container } = renderField('https://cdn.example.com/a/photo.png', 'zh', { readonly: true });
    expect(imgsOf(container)[0]?.getAttribute('alt')).toBe('photo.png');
  });

  it('THE LIT CONTROL — a just-uploaded image stored as a bare id keeps its upload name', async () => {
    // The upload is submitted as a bare id, which carries no name; the widget's
    // recent-upload views fill the name back in by id. The empty fallback name
    // must not reach past them.
    const adapter: UploadAdapter = {
      name: 'reference',
      upload: async (f: File | Blob) => ({
        url: 'https://cdn.example/uploaded.png',
        name: (f as File).name,
        size: f.size,
        mimeType: 'image/png',
        meta: { fileId: 'file_new' },
      }),
    };
    const submitted: unknown[] = [];
    function Harness() {
      const [value, setValue] = React.useState<unknown>(null);
      const field = { name: 'cover', type: 'image' } as unknown as FieldWidgetComponentProps['field'];
      return (
        <ImageField
          field={field}
          value={value}
          onChange={(next: unknown) => {
            submitted.push(next);
            setValue(next);
          }}
        />
      );
    }
    const { container } = render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <UploadProvider adapter={adapter}>
          <Harness />
        </UploadProvider>
      </I18nProvider>,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'cover.png', { type: 'image/png' })] } });
    await waitFor(() => expect(submitted).toEqual(['file_new']));
    const [img] = imgsOf(container);
    expect(img?.getAttribute('src')).toBe('https://cdn.example/uploaded.png');
    expect(img?.getAttribute('alt')).toBe('cover.png');
  });
});
