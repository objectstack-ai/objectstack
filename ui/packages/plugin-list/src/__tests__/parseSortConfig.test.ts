/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * parseSortConfig — spec/renderer shape-mismatch audit (objectui#2578
 * follow-up). @objectstack/spec ListViewSchema.sort is
 * `string | Array<{field, order}>`; the bare-string TOP-LEVEL form used to
 * crash ListView with "schema.sort.map is not a function".
 */

import { describe, it, expect } from 'vitest';
import { parseSortConfig } from '../ListView';

describe('parseSortConfig', () => {
  it('parses the spec bare-string top-level form ("field desc")', () => {
    expect(parseSortConfig('signed_on desc')).toMatchObject([
      { field: 'signed_on', order: 'desc' },
    ]);
    expect(parseSortConfig('name')).toMatchObject([{ field: 'name', order: 'asc' }]);
  });

  it('parses object arrays and legacy string entries, defaulting order to asc', () => {
    expect(
      parseSortConfig([{ field: 'amount', order: 'desc' }, { field: 'name' }, 'created_at desc']),
    ).toMatchObject([
      { field: 'amount', order: 'desc' },
      { field: 'name', order: 'asc' },
      { field: 'created_at', order: 'desc' },
    ]);
  });

  it('returns [] for nullish, empty, and malformed input instead of throwing', () => {
    expect(parseSortConfig(undefined)).toEqual([]);
    expect(parseSortConfig(null)).toEqual([]);
    expect(parseSortConfig([])).toEqual([]);
    expect(parseSortConfig('')).toEqual([]);
    expect(parseSortConfig([{ order: 'desc' }, 42, null])).toEqual([]);
  });
});
