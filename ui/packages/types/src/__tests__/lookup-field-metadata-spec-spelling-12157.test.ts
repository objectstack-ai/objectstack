/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12157 — `LookupFieldMetadata` spells the lookup picker's quick-create
 * switch, columns and page size the way `@objectstack/spec`'s `FieldSchema`
 * does: `allowCreate`, `lookupColumns`, `lookupPageSize`, each typed BY
 * REFERENCE to the spec member.
 *
 * The type used to declare the snake_case `allow_create`, `lookup_columns` and
 * `lookup_page_size`. `LookupField` retired its reads of those three spellings
 * in the same change, so keeping the members would let a typed producer write
 * a key that compiles and does nothing — a declared capability the runtime does
 * not honour. The members follow the readers instead: a snake literal is now an
 * excess-property error, and the camel literal compiles.
 *
 * Type-level pins are checked by this package's `type-check` (its
 * `tsconfig.test.json`); the runtime half reads the installed spec, so the
 * spelling claim is re-derived rather than quoted.
 */
import { describe, it, expect } from 'vitest';
import { FieldSchema, type Field as SpecField } from '@objectstack/spec/data';
import type { LookupFieldMetadata } from '../field-types.js';

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/** Each member is the spec member itself, value type included. */
export type assertionSpecMembersByReference = [
  Expect<Equal<LookupFieldMetadata['allowCreate'], SpecField['allowCreate']>>,
  Expect<Equal<LookupFieldMetadata['lookupColumns'], SpecField['lookupColumns']>>,
  Expect<Equal<LookupFieldMetadata['lookupPageSize'], SpecField['lookupPageSize']>>,
];

/** The snake_case members are gone — one spelling, no second. */
export type assertionSnakeMembersAreGone = Expect<
  Equal<Extract<keyof LookupFieldMetadata, 'allow_create' | 'lookup_columns' | 'lookup_page_size'>, never>
>;

/** The spec spelling compiles on an annotated literal. */
export const _camelLookup: LookupFieldMetadata = {
  type: 'lookup',
  name: 'account',
  reference: 'accounts',
  allowCreate: false,
  lookupColumns: ['name', { field: 'industry', label: 'Industry', width: '160px' }],
  lookupPageSize: 15,
};

export const _snakeAllowCreateIsRefused: LookupFieldMetadata = {
  type: 'lookup',
  name: 'account',
  // @ts-expect-error — objectui#12157: `allow_create` is no longer a member; author `allowCreate`
  allow_create: false,
};

export const _snakeLookupColumnsIsRefused: LookupFieldMetadata = {
  type: 'lookup',
  name: 'account',
  // @ts-expect-error — objectui#12157: `lookup_columns` is no longer a member; author `lookupColumns`
  lookup_columns: ['name'],
};

export const _snakeLookupPageSizeIsRefused: LookupFieldMetadata = {
  type: 'lookup',
  name: 'account',
  // @ts-expect-error — objectui#12157: `lookup_page_size` is no longer a member; author `lookupPageSize`
  lookup_page_size: 15,
};

/** The `unrecognized_keys` issue naming `key`, if the parse refused it by name. */
function refusedByName(res: ReturnType<typeof FieldSchema.safeParse>, key: string): boolean {
  if (res.success) return false;
  return res.error.issues.some(
    (i) => i.code === 'unrecognized_keys' && ((i as { keys?: string[] }).keys ?? []).includes(key),
  );
}

const MINIMAL = { type: 'lookup', name: 'account', reference: 'accounts' };

describe('installed @objectstack/spec — the spelling the type follows (objectui#12157)', () => {
  it('CONTROLS — the minimal lookup def parses, and a nonsense key is refused by name', () => {
    expect(FieldSchema.safeParse(MINIMAL).success).toBe(true);
    expect(refusedByName(FieldSchema.safeParse({ ...MINIMAL, zzz_not_a_real_key: 1 }), 'zzz_not_a_real_key')).toBe(true);
  });

  it.each([
    ['allowCreate', 'allow_create', false],
    ['lookupColumns', 'lookup_columns', ['name']],
    ['lookupPageSize', 'lookup_page_size', 15],
  ] as const)('the spec ACCEPTS `%s` and refuses `%s` by name', (camel, snake, value) => {
    expect(FieldSchema.safeParse({ ...MINIMAL, [camel]: value }).success).toBe(true);
    expect(refusedByName(FieldSchema.safeParse({ ...MINIMAL, [snake]: value }), snake)).toBe(true);
  });

  it('the camel literal above is a spec-valid field def', () => {
    expect(FieldSchema.safeParse(_camelLookup).success).toBe(true);
  });
});
