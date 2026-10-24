/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12213 — a field's help text has ONE authoring spelling,
 * `inlineHelpText`, the spec's `FieldSchema.inlineHelpText` by reference.
 *
 * Until this card `BaseFieldMetadata` declared `help`, and four field docs
 * pages taught it, while `@objectstack/spec`'s `FieldSchema` refuses `help` by
 * name and suggests `inlineHelpText`, the key Studio's object field inspector
 * writes and the record form now reads. So a field written the way the docs
 * showed compiled and could not be published.
 *
 * The type-level pins bite under `tsc -p tsconfig.test.json` (this package's
 * `type-check` chain), not under the vitest runtime. The runtime half reads the
 * installed spec's own door, so the TypeScript face and the spec face are shown
 * to agree: what the face accepts the spec accepts, and the spelling the face
 * refuses the spec refuses by name.
 */

import { describe, it, expect } from 'vitest';
import { FieldSchema, type Field as SpecField } from '@objectstack/spec/data';

import type { BaseFieldMetadata, FieldMetadata, TextFieldMetadata } from '../field-types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;

/* ── The declared member, in the spec's own type ──────────────────────────── */

export type _InlineHelpTextMirrorsTheSpec = Expect<Equal<BaseFieldMetadata['inlineHelpText'], SpecField['inlineHelpText']>>;
export type _InlineHelpTextIsNotAny = Expect<Equal<IsAny<BaseFieldMetadata['inlineHelpText']>, false>>;

/** `help` is a member of no field metadata type (keys read per union member). */
type KeysOfEach<T> = T extends unknown ? keyof T : never;
export type _NoHelpOnBase = Expect<Equal<Extract<keyof BaseFieldMetadata, 'help'>, never>>;
export type _NoHelpOnAnyFieldType = Expect<Equal<Extract<KeysOfEach<FieldMetadata>, 'help'>, never>>;
// Control for the line above: the same probe finds a key every member has.
export type _ProbeSeesInlineHelpText = Expect<Equal<Extract<KeysOfEach<FieldMetadata>, 'inlineHelpText'>, 'inlineHelpText'>>;

/* ── The authoring proof: a fresh annotated literal carries `inlineHelpText` ─ */

export const _baseAuthored: BaseFieldMetadata = {
  type: 'text',
  name: 'product_name',
  inlineHelpText: 'Shown on the storefront and in search results.',
};

export const _textAuthored: TextFieldMetadata = {
  type: 'text',
  name: 'product_name',
  label: 'Product Name',
  inlineHelpText: 'Shown on the storefront and in search results.',
  maxLength: 120,
};

// The face stays strict on the value: help text is a string.
export const _inlineHelpTextNumber: BaseFieldMetadata = {
  type: 'text',
  name: 'product_name',
  // @ts-expect-error — objectui#12213 typed `inlineHelpText` as the spec's string; a number is refused
  inlineHelpText: 3,
};

/* ── The retired spelling, refused on a fresh literal ─────────────────────── */

export const _baseHelp: BaseFieldMetadata = {
  type: 'text',
  name: 'product_name',
  // @ts-expect-error — objectui#12213: `help` is removed; the spelling is `inlineHelpText`
  help: 'Shown on the storefront.',
};

export const _textHelp: TextFieldMetadata = {
  type: 'text',
  name: 'product_name',
  // @ts-expect-error — objectui#12213: `help` is removed; the spelling is `inlineHelpText`
  help: 'Shown on the storefront.',
};

/* ── Runtime: the installed spec's door agrees with the face ──────────────── */

describe('objectui#12213 — the spec accepts `inlineHelpText` and refuses `help` by name', () => {
  it('a literal typed by this face parses on FieldSchema, inlineHelpText kept', () => {
    const parsed = FieldSchema.safeParse(_textAuthored);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.inlineHelpText).toBe(_textAuthored.inlineHelpText);
  });

  it('a field carrying `help` is refused, naming `help` alone', () => {
    const parsed = FieldSchema.safeParse({ type: 'text', name: 'product_name', help: 'Shown on the storefront.' });
    expect(parsed.success).toBe(false);
    const unrecognized = (parsed.error?.issues ?? [])
      .filter((issue) => issue.code === 'unrecognized_keys')
      .flatMap((issue) => (issue as { keys?: string[] }).keys ?? []);
    expect(unrecognized).toEqual(['help']);
  });
});
