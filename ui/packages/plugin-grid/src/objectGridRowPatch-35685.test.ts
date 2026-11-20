/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** `mergeSavedRow` (objectstack#35685): the row a list cell's save leaves on screen. */
import { describe, it, expect } from 'vitest';
import { mergeSavedRow } from './objectGridRowPatch';

describe('mergeSavedRow (objectstack#35685)', () => {
  const row = {
    id: 'd1',
    name: 'alpha',
    owner: { _id: 'u1', name: 'Ada' },
    tags: [{ id: 't1', name: 'Hot' }],
    updated_at: 'v1',
  };

  it('draws the edit, then what the server answered for every key the row carries', () => {
    const merged = mergeSavedRow(row, { name: 'alpha one' }, { id: 'd1', name: 'ALPHA ONE', updated_at: 'v2', internal: 'x' });
    expect(merged.name).toBe('ALPHA ONE');
    expect(merged.updated_at).toBe('v2');
    // A key the row never read stays out.
    expect('internal' in merged).toBe(false);
  });

  it('keeps an expanded record the answer names by its id, and takes a different one', () => {
    expect(mergeSavedRow(row, {}, { owner: 'u1' }).owner).toEqual({ _id: 'u1', name: 'Ada' });
    expect(mergeSavedRow(row, {}, { owner: 'u2' }).owner).toBe('u2');
    expect(mergeSavedRow(row, {}, { tags: ['t1'] }).tags).toEqual([{ id: 't1', name: 'Hot' }]);
    expect(mergeSavedRow(row, {}, { tags: ['t2'] }).tags).toEqual(['t2']);
  });

  it('an answer that is not a record leaves the edit as sent', () => {
    expect(mergeSavedRow(row, { name: 'b' }, undefined)).toEqual({ ...row, name: 'b' });
    expect(mergeSavedRow(row, { name: 'b' }, [1, 2])).toEqual({ ...row, name: 'b' });
  });
});
