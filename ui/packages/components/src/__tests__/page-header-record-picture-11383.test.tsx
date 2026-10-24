/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record chrome draws the record's picture beside the title, from the
 * field the object names in its object-level `imageField` (objectui#11383,
 * the renderer half of objectstack#21182, ruling A on hotcrm#1199).
 *
 * Pinned through the real `SchemaRenderer` and registry, on the record-chip
 * layout `page:header` draws inside a `RecordContext`:
 *
 *  - with `imageField`, the picture renders from the served row's value, in
 *    each read form the spec gives an `image` / `avatar` field: the expanded
 *    `{ url, … }`, a bare `sys_file` id, a URL string, and a `multiple` list;
 *  - without `imageField`, the header is the header it was. A row carrying
 *    `logo`, `avatar` or `image` draws nothing, because the declaration is the
 *    only channel and no field is read by a conventional name;
 *  - an empty value draws nothing, and neither does a field the reader may not
 *    see (it arrives absent from the row). Each is compared byte for byte with
 *    the undeclared header, so "nothing" cannot hide an empty wrapper;
 *  - `recordChrome: false` keeps the bare header, picture or not.
 *
 * Radix's `AvatarImage` draws its `img` only once the image has loaded, and
 * happy-dom never loads one, so `LoadedImage` stands in for `window.Image`
 * here (the stand-in `AvatarField.fileId-10785` and `userCell.readGate-10535`
 * in `@object-ui/fields` use). The one case that needs the real behaviour
 * restores it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ActionProvider, RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Registers every renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';

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
});

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  logo: { type: 'image', label: 'Logo' },
};

/** An account that names `logo` as its picture, the hotcrm#1199 shape. */
const DECLARED = {
  name: 'crm_account',
  label: 'Account',
  nameField: 'name',
  imageField: 'logo',
  fields: FIELDS,
};

/** The same object with no `imageField`: the header as it was. */
const UNDECLARED = {
  name: 'crm_account',
  label: 'Account',
  nameField: 'name',
  fields: FIELDS,
};

function renderHeader(
  objectSchema: Record<string, unknown>,
  record: Record<string, unknown>,
  node: Record<string, unknown> = { type: 'page:header' },
) {
  const utils = render(
    <ActionProvider>
      <RecordContextProvider
        objectName="crm_account"
        recordId="rec-1"
        data={{ id: 'rec-1', name: 'Acme', ...record }}
        objectSchema={objectSchema}
      >
        <SchemaRenderer schema={node as never} />
      </RecordContextProvider>
    </ActionProvider>,
  );
  const header = utils.container.querySelector('header');
  expect(header, 'the page:header root').not.toBeNull();
  // The header is really there, so "no picture" cannot pass on a header that
  // drew nothing at all.
  expect(header!.querySelector('h1')?.textContent).toBe('Acme');
  return { ...utils, header: header as HTMLElement };
}

/** The `src` of the record's picture, or null when none was drawn. */
function pictureSrc(header: HTMLElement): string | null {
  return header.querySelector('img')?.getAttribute('src') ?? null;
}

/**
 * The header's markup with React's generated ids blanked: two mounts number
 * `useId` differently, and those ids are the only bytes allowed to differ
 * between two headers that should be the same.
 */
const ID_ATTRS = ['id', 'aria-controls', 'aria-labelledby', 'aria-describedby', 'for'];
function markupOf(header: HTMLElement): string {
  const copy = header.cloneNode(true) as HTMLElement;
  for (const el of [copy, ...Array.from(copy.querySelectorAll('*'))]) {
    for (const name of ID_ATTRS) if (el.hasAttribute(name)) el.setAttribute(name, 'ID');
  }
  return copy.outerHTML;
}

/** The undeclared header for the same row, the control for "unchanged". */
function undeclaredMarkup(record: Record<string, unknown>, node?: Record<string, unknown>): string {
  const { header, unmount } = renderHeader(UNDECLARED, record, node);
  const markup = markupOf(header);
  unmount();
  return markup;
}

describe('page:header record chrome draws the record picture from `imageField` (objectui#11383)', () => {
  it('draws the expanded `{ url }` value beside the title, before the H1', () => {
    const { header } = renderHeader(DECLARED, {
      logo: { id: 'f1', name: 'acme.png', mimeType: 'image/png', url: 'https://cdn.example.com/acme.png' },
    });
    expect(pictureSrc(header)).toBe('https://cdn.example.com/acme.png');
    const picture = header.querySelector('[data-record-picture]');
    expect(picture, 'the picture wrapper').not.toBeNull();
    // Beside the title: in the same title row, ahead of the H1.
    const h1 = header.querySelector('h1')!;
    expect(picture!.parentElement!.parentElement).toBe(h1.parentElement);
    expect(picture!.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Decorative: the H1 beside it already names the record.
    expect(header.querySelector('img')!.getAttribute('alt')).toBe('');
    expect(picture!.closest('[aria-hidden]')).not.toBeNull();
  });

  it('draws a bare `sys_file` id from the stable download path', () => {
    const { header } = renderHeader(DECLARED, { logo: 'f_abc123' });
    expect(pictureSrc(header)).toBe('/api/v1/storage/files/f_abc123');
  });

  it('draws a URL string as it is', () => {
    const { header } = renderHeader(DECLARED, { logo: '/assets/acme.svg' });
    expect(pictureSrc(header)).toBe('/assets/acme.svg');
  });

  it('draws the first drawable entry of a `multiple` list', () => {
    const { header } = renderHeader(DECLARED, {
      logo: ['', { name: 'no-url.png' }, { url: 'https://cdn.example.com/second.png' }, 'f_third'],
    });
    expect(pictureSrc(header)).toBe('https://cdn.example.com/second.png');
    expect(header.querySelectorAll('img')).toHaveLength(1);
  });

  it('draws an `image` field whole in a rounded square and an `avatar` field round', () => {
    const image = renderHeader(DECLARED, { logo: 'https://cdn.example.com/acme.png' });
    const imagePicture = image.header.querySelector('[data-record-picture]')!;
    expect(imagePicture.className).toContain('rounded-md');
    expect(image.header.querySelector('img')!.className).toContain('object-contain');
    image.unmount();

    const avatar = renderHeader(
      { ...DECLARED, fields: { ...FIELDS, logo: { type: 'avatar', label: 'Photo' } } },
      { logo: 'https://cdn.example.com/ada.jpg' },
    );
    const avatarPicture = avatar.header.querySelector('[data-record-picture]')!;
    expect(avatarPicture.className).toContain('rounded-full');
    expect(avatar.header.querySelector('img')!.className).toContain('object-cover');
  });

  it('without `imageField`, a row carrying logo / avatar / image keys draws nothing', () => {
    const record = {
      logo: 'https://cdn.example.com/logo.png',
      avatar: 'https://cdn.example.com/avatar.png',
      image: 'https://cdn.example.com/image.png',
    };
    const { header } = renderHeader(UNDECLARED, record);
    expect(pictureSrc(header)).toBeNull();
    expect(header.querySelector('[data-record-picture]')).toBeNull();
  });

  const EMPTY: ReadonlyArray<{ name: string; record: Record<string, unknown> }> = [
    { name: 'absent from the row (a field the reader may not see)', record: {} },
    { name: 'null', record: { logo: null } },
    { name: 'an empty string', record: { logo: '' } },
    { name: 'an empty list', record: { logo: [] } },
    { name: 'an object with no `url`', record: { logo: { name: 'acme.png' } } },
  ];

  for (const { name, record } of EMPTY) {
    it(`nothing is drawn when the value is ${name}`, () => {
      const control = undeclaredMarkup(record);
      const { header } = renderHeader(DECLARED, record);
      expect(pictureSrc(header)).toBeNull();
      expect(markupOf(header)).toBe(control);
    });
  }

  it('a picture that has not loaded draws no image (no broken-image icon)', () => {
    window.Image = realImage;
    const { header } = renderHeader(DECLARED, { logo: 'https://cdn.example.com/never-loads.png' });
    expect(header.querySelector('[data-record-picture]')).not.toBeNull();
    expect(pictureSrc(header)).toBeNull();
  });

  it('`recordChrome: false` keeps the bare header, picture or not', () => {
    const record = { logo: 'https://cdn.example.com/acme.png' };
    const node = { type: 'page:header', properties: { title: 'Acme', recordChrome: false } };
    const control = undeclaredMarkup(record, node);
    const { header } = renderHeader(DECLARED, record, node);
    expect(pictureSrc(header)).toBeNull();
    expect(markupOf(header)).toBe(control);
  });
});
