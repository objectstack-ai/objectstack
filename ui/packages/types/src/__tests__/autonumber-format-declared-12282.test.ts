/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12282 — `AutoNumberFieldMetadata` declares `@objectstack/spec`'s
 * `FieldSchema.autonumberFormat` BY REFERENCE, and keeps `format`.
 *
 * The spec declares both keys on an `autonumber` field: `autonumberFormat` is
 * the one it prefers on a new field, and `format` is the older shorthand it
 * still accepts. Until this card a typed literal could carry only the
 * shorthand, so the auto-number docs page could not teach the preferred key.
 *
 *  - The type half is checked by this package's `type-check` through
 *    `tsconfig.test.json`: FRESH annotated literals carrying
 *    `autonumberFormat`, `format`, and both compile, and the member is the
 *    spec's own type rather than a restatement of it.
 *  - The runtime half reads the installed spec, so "the spec accepts each
 *    literal" and "`autonumberFormat` wins when a field carries both" are
 *    re-derived on every run rather than asserted in prose.
 */
import { describe, it, expect } from 'vitest';
import { FieldSchema, resolveAutonumberFormat, type Field as SpecField } from '@objectstack/spec/data';
import type { AutoNumberFieldMetadata } from '../field-types.js';

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// ── The type: the spec's member, by reference; the shorthand kept ───────────

export type assertionAutonumberFormatByReference = [
  Expect<Equal<AutoNumberFieldMetadata['autonumberFormat'], SpecField['autonumberFormat']>>,
  Expect<Equal<AutoNumberFieldMetadata['format'], string | undefined>>,
];

/** The key the spec prefers on a new field. */
export const _autonumberFormat: AutoNumberFieldMetadata = {
  type: 'autonumber',
  name: 'invoice_number',
  autonumberFormat: 'INV-{YYYY}-{0000}',
};

/** The control: the `format` shorthand still compiles. */
export const _format: AutoNumberFieldMetadata = {
  type: 'autonumber',
  name: 'invoice_number',
  format: 'INV-{0000}',
};

/** Both keys on one field, with different patterns so the winner is visible. */
export const _both: AutoNumberFieldMetadata = {
  type: 'autonumber',
  name: 'invoice_number',
  autonumberFormat: 'INV-{YYYY}-{0000}',
  format: 'INV-{0000}',
};

// ── The installed spec: what the type follows ────────────────────────────────

/** The `unrecognized_keys` issue naming `key`, if the parse refused it by name. */
function refusedByName(res: ReturnType<typeof FieldSchema.safeParse>, key: string): boolean {
  if (res.success) return false;
  return res.error.issues.some(
    (i) => i.code === 'unrecognized_keys' && ((i as { keys?: string[] }).keys ?? []).includes(key),
  );
}

describe('installed @objectstack/spec — the auto-number format keys the type declares (objectui#12282)', () => {
  it('CONTROL — the spec refuses a key it does not declare on the same field, by name', () => {
    const res = FieldSchema.safeParse({ ..._autonumberFormat, zzz_not_a_real_key: 'INV-{0000}' });
    expect(refusedByName(res, 'zzz_not_a_real_key')).toBe(true);
  });

  it.each([
    ['autonumberFormat', _autonumberFormat],
    ['format', _format],
    ['both keys', _both],
  ] as const)('the spec accepts the typed literal carrying %s', (_label, field) => {
    expect(FieldSchema.safeParse(field).success).toBe(true);
  });

  it('`autonumberFormat` wins when a field carries both, and `format` is read only without it', () => {
    expect(resolveAutonumberFormat(_both)).toBe(_both.autonumberFormat);
    expect(resolveAutonumberFormat(_format)).toBe(_format.format);
    expect(resolveAutonumberFormat(_autonumberFormat)).toBe(_autonumberFormat.autonumberFormat);
  });
});
