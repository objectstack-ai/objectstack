/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record chrome's picture resolves a value as this package does
 * (objectui#11383).
 *
 * `page:header` (in `@object-ui/components`) draws the record's picture from
 * the field the object names in its `imageField`. It cannot import
 * `readFileValues` from here, because this package depends on that one, so it
 * carries a private copy of the URL rule (`recordPictureUrl`, beside the
 * `page:header` renderer). This pin is what keeps the two together: over every
 * read form the header admits, the `src` the header draws must be the URL the
 * image cell draws for the same value, which is the first view
 * `readFileValues` answers with a `url` (`ImageCellRenderer` filters its views
 * the same way). Where neither resolves a URL, neither may draw.
 *
 * One divergence is deliberate and asserted as one: an object with an id and
 * no `url`. `readFileValue` resolves it to the download path, while the header
 * draws nothing, because the spec's read form for an `image` / `avatar` field
 * (`FileValueSchema`) requires `url`. If either side moves on it, the
 * divergence case goes red and says which way.
 *
 * Rendered through the real `SchemaRenderer` and registry. Radix's
 * `AvatarImage` draws its `img` only once the image has loaded, and happy-dom
 * never loads one, so `LoadedImage` stands in for `window.Image` (the same
 * stand-in `AvatarField.fileId-10785` uses).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ActionProvider, RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Registers every `@object-ui/components` renderer, `page:header` included, at
// module scope rather than in a hook (objectui#3010).
import '@object-ui/components';
import { readFileValues } from './file-value';

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
});

const ACCOUNT = {
  name: 'crm_account',
  label: 'Account',
  nameField: 'name',
  imageField: 'logo',
  fields: {
    name: { type: 'text', label: 'Name' },
    logo: { type: 'image', label: 'Logo' },
  },
};

/** The `src` `page:header`'s record chrome draws for `logo: value`, or null. */
function headerPictureSrc(value: unknown): string | null {
  const record: Record<string, unknown> = { id: 'rec-1', name: 'Acme' };
  if (value !== undefined) record.logo = value;
  const { container, unmount } = render(
    <ActionProvider>
      <RecordContextProvider
        objectName="crm_account"
        recordId="rec-1"
        data={record}
        objectSchema={ACCOUNT}
      >
        <SchemaRenderer schema={{ type: 'page:header' } as never} />
      </RecordContextProvider>
    </ActionProvider>,
  );
  const header = container.querySelector('header');
  // The record chip really rendered, so a null `src` means "drew nothing",
  // not "drew no header".
  expect(header?.querySelector('h1')?.textContent).toBe('Acme');
  const src = header?.querySelector('img')?.getAttribute('src') ?? null;
  unmount();
  return src;
}

/** The URL this package draws for `value`: the first view with a `url`. */
function fieldsUrl(value: unknown): string | null {
  return readFileValues(value, '').find((view) => view.url)?.url ?? null;
}

const EXPANDED = {
  id: 'f_acme',
  name: 'acme.png',
  size: 2048,
  mimeType: 'image/png',
  url: 'https://cdn.example.com/acme.png',
};

/** Every read form the header admits, each expected to DRAW. */
const DRAWN: ReadonlyArray<{ name: string; value: unknown }> = [
  { name: 'an expanded `{ url }` value', value: EXPANDED },
  { name: 'a legacy blob that carries `url`', value: { file_id: 'f_old', original_name: 'old.png', mime_type: 'image/png', url: '/legacy/old.png' } },
  { name: 'a bare `sys_file` id', value: 'f_abc123' },
  { name: 'an absolute URL string', value: 'https://cdn.example.com/logo.svg' },
  { name: 'a relative URL string', value: '/assets/acme.svg' },
  { name: 'a `data:` URI', value: 'data:image/png;base64,iVBORw0KGgo=' },
  { name: 'a list led by an expanded value', value: [EXPANDED, 'f_second'] },
  { name: 'a list led by a bare id', value: ['f_first', EXPANDED] },
  { name: 'a list led by a URL string', value: ['https://cdn.example.com/first.png', 'f_second'] },
  { name: 'a list whose first drawable entry follows empties', value: [null, '', {}, { name: 'no-url.png' }, EXPANDED] },
  { name: 'a list whose first drawable entry is a bare id after empties', value: ['', 'f_after'] },
];

/** The empties: neither side resolves a URL, so neither may draw. */
const EMPTY: ReadonlyArray<{ name: string; value: unknown }> = [
  { name: 'absent from the row', value: undefined },
  { name: 'null', value: null },
  { name: 'an empty string', value: '' },
  { name: 'an empty object', value: {} },
  { name: 'an object with neither `url` nor id', value: { name: 'acme.png' } },
  { name: 'an empty list', value: [] },
  { name: 'a list of empties', value: [null, '', {}] },
];

describe('page:header record picture resolves as `readFileValues` does (objectui#11383)', () => {
  for (const { name, value } of DRAWN) {
    it(`draws the URL the image cell draws — ${name}`, () => {
      const expected = fieldsUrl(value);
      expect(expected, 'this package resolves a URL for this form').not.toBeNull();
      expect(headerPictureSrc(value)).toBe(expected);
    });
  }

  for (const { name, value } of EMPTY) {
    it(`neither side draws — ${name}`, () => {
      expect(fieldsUrl(value)).toBeNull();
      expect(headerPictureSrc(value)).toBeNull();
    });
  }

  it('DIVERGENCE, deliberate — an id-only object: `readFileValue` resolves it, the header draws nothing', () => {
    for (const value of [{ id: 'f_idonly' }, { file_id: 'f_idonly', name: 'acme.png' }]) {
      expect(fieldsUrl(value)).toBe('/api/v1/storage/files/f_idonly');
      expect(headerPictureSrc(value)).toBeNull();
    }
  });
});
