/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12156 — a `file` / `image` field's size limit has ONE spelling,
 * `maxSize`, the spec's `FieldSchema.maxSize` by reference.
 *
 * Until this card `FileFieldMetadata` and `ImageFieldMetadata` declared
 * `max_size`, and the docs taught it, while the file and image widgets read
 * only `maxSize`: a limit written the way the pages showed was accepted and
 * then did nothing. The same two interfaces declared `max_files`, and the image
 * type `max_width` / `max_height`, which no widget reads in either spelling
 * and `FieldSchema` declares no twin for. Those three are removed, not renamed:
 * minting a camelCase key no contract declares would fossilise it.
 *
 * The type-level pins bite under `tsc -p tsconfig.test.json` (this package's
 * `type-check` chain), not under the vitest runtime. The runtime half reads
 * the installed spec's own door, so the TypeScript face and the spec face are
 * shown to agree: what the face now accepts the spec accepts, and each removed
 * spelling the face refuses the spec refuses by name.
 */

import { describe, it, expect } from 'vitest';
import { FieldSchema, type Field as SpecField } from '@objectstack/spec/data';

import type { FileFieldMetadata, ImageFieldMetadata } from '../field-types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;

/* ── The declared member, in the spec's own type ──────────────────────────── */

export type _FileMaxSizeMirrorsTheSpec = Expect<Equal<FileFieldMetadata['maxSize'], SpecField['maxSize']>>;
export type _ImageMaxSizeMirrorsTheSpec = Expect<Equal<ImageFieldMetadata['maxSize'], SpecField['maxSize']>>;
export type _MaxSizeIsNotAny = Expect<Equal<IsAny<FileFieldMetadata['maxSize'] | ImageFieldMetadata['maxSize']>, false>>;

/** The four retired spellings are not members of either interface. */
type Retired = 'max_size' | 'max_files' | 'max_width' | 'max_height';
export type _NoRetiredFileMember = Expect<Equal<Extract<keyof FileFieldMetadata, Retired>, never>>;
export type _NoRetiredImageMember = Expect<Equal<Extract<keyof ImageFieldMetadata, Retired>, never>>;

/* ── The authoring proof: a fresh annotated literal carries `maxSize` ──────── */

export const _fileAuthored: FileFieldMetadata = {
  type: 'file',
  name: 'attachments',
  label: 'Attachments',
  multiple: true,
  accept: ['application/pdf'],
  maxSize: 10 * 1024 * 1024,
};

export const _imageAuthored: ImageFieldMetadata = {
  type: 'image',
  name: 'product_photos',
  label: 'Product Photos',
  multiple: true,
  accept: ['image/png'],
  maxSize: 5 * 1024 * 1024,
};

// The face stays strict on the value: a string is not a byte count.
export const _fileMaxSizeString: FileFieldMetadata = {
  type: 'file',
  name: 'attachments',
  // @ts-expect-error — objectui#12156 declared `maxSize` as the spec's number; a string is refused
  maxSize: '10MB',
};

/* ── The four retired spellings, each refused on a fresh literal ──────────── */
// One key per literal: TypeScript reports only the first excess property of a
// literal, so two retired keys in one literal would leave the second unproven.

export const _fileMaxSizeSnake: FileFieldMetadata = {
  type: 'file',
  name: 'attachments',
  // @ts-expect-error — objectui#12156: `max_size` is removed; the spelling is `maxSize`
  max_size: 1024,
};

export const _fileMaxFiles: FileFieldMetadata = {
  type: 'file',
  name: 'attachments',
  // @ts-expect-error — objectui#12156: `max_files` is removed; no widget enforces a file count
  max_files: 5,
};

export const _imageMaxSizeSnake: ImageFieldMetadata = {
  type: 'image',
  name: 'product_photos',
  // @ts-expect-error — objectui#12156: `max_size` is removed; the spelling is `maxSize`
  max_size: 1024,
};

export const _imageMaxFiles: ImageFieldMetadata = {
  type: 'image',
  name: 'product_photos',
  // @ts-expect-error — objectui#12156: `max_files` is removed; no widget enforces a file count
  max_files: 8,
};

export const _imageMaxWidth: ImageFieldMetadata = {
  type: 'image',
  name: 'product_photos',
  // @ts-expect-error — objectui#12156: `max_width` is removed; no widget enforces pixel dimensions
  max_width: 4096,
};

export const _imageMaxHeight: ImageFieldMetadata = {
  type: 'image',
  name: 'product_photos',
  // @ts-expect-error — objectui#12156: `max_height` is removed; no widget enforces pixel dimensions
  max_height: 4096,
};

/* ── Runtime: the installed spec's door agrees with the face ──────────────── */

describe('objectui#12156 — the spec accepts `maxSize` and refuses the four retired spellings', () => {
  it.each([
    ['file', _fileAuthored],
    ['image', _imageAuthored],
  ] as const)('a `%s` literal typed by this face parses on FieldSchema, maxSize kept', (_type, literal) => {
    const parsed = FieldSchema.safeParse(literal);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.maxSize).toBe(literal.maxSize);
  });

  const RETIRED: ReadonlyArray<readonly ['file' | 'image', Retired]> = [
    ['file', 'max_size'],
    ['file', 'max_files'],
    ['image', 'max_size'],
    ['image', 'max_files'],
    ['image', 'max_width'],
    ['image', 'max_height'],
  ];

  it.each(RETIRED)('a `%s` field carrying `%s` is refused by name', (type, key) => {
    const parsed = FieldSchema.safeParse({ type, name: 'f', [key]: 1 });
    expect(parsed.success).toBe(false);
    const unrecognized = (parsed.error?.issues ?? [])
      .filter((issue) => issue.code === 'unrecognized_keys')
      .flatMap((issue) => (issue as { keys?: string[] }).keys ?? []);
    expect(unrecognized).toEqual([key]);
  });
});
