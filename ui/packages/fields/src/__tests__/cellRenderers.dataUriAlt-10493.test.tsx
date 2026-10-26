/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10493 — an image, avatar or signature cell holding a `data:` URI
 * named its `<img>` with the base64 payload.
 *
 * `readFileValue` took the text after a URL's last `/` as the file's name, so
 * `data:image/png;base64,…` was named `png;base64,…` — and the image cell uses
 * a value's name as its alt ahead of the translated `fields.image.imageAlt`.
 * `SignatureField` stores `canvas.toDataURL('image/png')`, so every real
 * signature is a data URI and its cell's alt was kilobytes of base64.
 *
 * The fix has two halves, and this file needs both:
 *   1. a `data:` URI carries no file name, so `readFileValue` answers the
 *      caller's fallback for it (`file-value.test.ts` pins that row);
 *   2. the image cell reads its images with an EMPTY fallback, so a value with
 *      no name of its own reaches the translated alt. Before this card it
 *      read them with the literal `'Image'`, so a nameless value was named
 *      `Image` on every locale and the translated string was unreachable.
 *
 * ── What the assertions compare against ───────────────────────────────────
 *   - The expected alt is the PACK VALUE, read from the imported locale pack
 *     and interpolated here, never a hand-typed English string. Two locales
 *     are rendered, and the two readings must differ: a literal cannot pass
 *     both legs, so this is the half a hard-coded alt cannot fake.
 *   - The stored value is never touched: every drawn `<img>` keeps the value
 *     byte-for-byte as its `src`.
 *   - THE LIT CONTROL: a value that DOES carry a name (an `https` URL's last
 *     segment) is still named by it. The caricature "every cell alt is now the
 *     translated string" passes every data-URI row and fails this one.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
import { getCellRenderer, resolveCellRendererType, type CellRendererProps } from '../index';

afterEach(() => cleanup());

/** The card's reproduction value: a PNG data URI, as `SignatureField` stores one. */
const DATA_URI = 'data:image/png;base64,iVBORw0KGgo=';

/** The lit control: a URL whose last segment is a real file name. */
const HTTPS_URL = 'https://cdn.example.com/a/photo.png';

/** The three cell types that draw through the image renderer. */
const IMAGE_CELLS = ['image', 'avatar', 'signature'] as const;

/**
 * The two members of a locale pack this file reads. The packs are `as const`,
 * so their types are literal and differ per locale: a structural type both
 * satisfy, rather than `typeof en`.
 */
type Pack = { fields: { image: { imageAlt: string; preview: string } } };

const LOCALES: ReadonlyArray<readonly [language: string, pack: Pack]> = [
  ['en', en],
  ['zh', zh],
];

/** The translated alt, read from the pack itself: `fields.image.imageAlt` with `{{index}}` filled. */
const packAlt = (pack: Pack, index: number) => pack.fields.image.imageAlt.replace('{{index}}', String(index));

/** Resolve and render exactly the way a consumer builds a read-mode cell. */
function renderCell(type: string, value: unknown, language: string) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  const field = { type, name: type } as unknown as CellRendererProps['field'];
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <Renderer value={value} field={field} />
    </I18nProvider>,
  );
}

const imgsOf = (root: ParentNode) => Array.from(root.querySelectorAll('img'));

describe('objectui#10493 — a `data:` URI names no image, so the cell alt is the translated string', () => {
  it('THE PREMISE — the two locale packs spell the alt differently', () => {
    // Every locale leg below is only as strong as this: two equal pack values
    // would let one literal satisfy both.
    expect(packAlt(zh, 1), 'zh and en must differ, or the locale legs prove nothing').not.toBe(
      packAlt(en, 1),
    );
  });

  for (const type of IMAGE_CELLS) {
    for (const [language, pack] of LOCALES) {
      it(`THE DEFECT — \`${type}\` holding a data-URI string: the alt is the ${language} pack's, not base64`, () => {
        const { container } = renderCell(type, DATA_URI, language);
        const imgs = imgsOf(container);
        expect(imgs, `${type}: a data URI still draws one image`).toHaveLength(1);
        const alt = imgs[0].getAttribute('alt') ?? '';
        expect(alt, `${type}: the alt must not carry the payload`).not.toContain('base64');
        expect(alt, `${type}: the alt is the translated fields.image.imageAlt`).toBe(packAlt(pack, 1));
        expect(imgs[0].getAttribute('src'), `${type}: the stored value is drawn unchanged`).toBe(DATA_URI);
      });
    }

    it(`THE DEFECT — \`${type}\` holding { url: data-URI }: the same translated alt`, () => {
      const { container } = renderCell(type, { url: DATA_URI }, 'zh');
      const [img] = imgsOf(container);
      expect(img?.getAttribute('alt'), `${type}: an object value's data URL names nothing either`).toBe(
        packAlt(zh, 1),
      );
      expect(img?.getAttribute('src')).toBe(DATA_URI);
    });

    it(`THE LIT CONTROL — \`${type}\` holding an https URL is still named by its last segment`, () => {
      const { container } = renderCell(type, HTTPS_URL, 'zh');
      const [img] = imgsOf(container);
      expect(img?.getAttribute('alt'), `${type}: a value that carries a name keeps it`).toBe('photo.png');
    });
  }

  it('an explicit name on a data-URI object still wins over the translated alt', () => {
    const { container } = renderCell('image', { url: DATA_URI, name: 'signature.png' }, 'zh');
    expect(imgsOf(container)[0]?.getAttribute('alt')).toBe('signature.png');
  });

  it('a bare `sys_file` id carries no name either, so it reads the translated alt too', () => {
    // Same arm as the data URI: before this card the cell named it with the
    // untranslated literal `Image` on every locale.
    const { container } = renderCell('image', 'file_a', 'zh');
    const [img] = imgsOf(container);
    expect(img?.getAttribute('src')).toBe('/api/v1/storage/files/file_a');
    expect(img?.getAttribute('alt')).toBe(packAlt(zh, 1));
  });

  it('several data URIs are numbered by position through the same translated string', () => {
    const { container } = renderCell('image', [DATA_URI, DATA_URI], 'zh');
    expect(imgsOf(container).map((img) => img.getAttribute('alt'))).toEqual([
      packAlt(zh, 1),
      packAlt(zh, 2),
    ]);
  });

  it('the lightbox a data-URI thumbnail opens is named by the translated strings, not base64', () => {
    const { container } = renderCell('signature', DATA_URI, 'zh');
    fireEvent.click(imgsOf(container)[0]);
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog, 'clicking the thumbnail opens the lightbox').not.toBeNull();
    const [img] = imgsOf(dialog as HTMLElement);
    expect(img?.getAttribute('alt')).toBe(packAlt(zh, 1));
    expect(dialog?.textContent ?? '', 'the dialog title names no payload').not.toContain('base64');
    expect(dialog?.textContent ?? '').toContain(zh.fields.image.preview);
  });
});
