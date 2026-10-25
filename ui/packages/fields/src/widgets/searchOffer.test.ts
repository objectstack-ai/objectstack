/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12966 — `objectResolvesSearch` answers from the spec's
 * `resolveSearchFieldResolution`, over the inputs the engine gives it.
 */

import { describe, it, expect } from 'vitest';
import { objectResolvesSearch } from './searchOffer';

const JUNCTION = {
  book: { type: 'lookup' },
  reader: { type: 'lookup' },
  title: { type: 'formula' },
};

describe('objectResolvesSearch (objectui#12966)', () => {
  it('a junction object (two lookups, a formula title) resolves to no field', () => {
    expect(objectResolvesSearch({ nameField: 'title', fields: JUNCTION })).toBe(false);
  });

  it('CONTROL: a text field makes it searchable', () => {
    expect(objectResolvesSearch({ fields: { ...JUNCTION, note: { type: 'text' } } })).toBe(true);
  });

  it('an enum field makes it searchable', () => {
    expect(objectResolvesSearch({ fields: { ...JUNCTION, status: { type: 'select' } } })).toBe(true);
  });

  it('a declared `searchableFields` naming a stored field counts; one naming the formula does not', () => {
    expect(objectResolvesSearch({ searchableFields: ['book'], fields: JUNCTION })).toBe(true);
    expect(objectResolvesSearch({ searchableFields: ['title'], fields: JUNCTION })).toBe(false);
  });

  it('an `internal: true` text field is left out, as the engine leaves it out', () => {
    expect(objectResolvesSearch({ fields: { ...JUNCTION, digest: { type: 'text', internal: true } } })).toBe(false);
  });

  it('reads the array form of the field map', () => {
    expect(objectResolvesSearch({ fields: [{ name: 'book', type: 'lookup' }] })).toBe(false);
    expect(objectResolvesSearch({ fields: [{ name: 'note', type: 'text' }] })).toBe(true);
  });

  it('an unknown schema is `undefined`, not a verdict', () => {
    expect(objectResolvesSearch(null)).toBeUndefined();
    expect(objectResolvesSearch(undefined)).toBeUndefined();
    expect(objectResolvesSearch({ name: 'x' })).toBeUndefined();
  });
});
