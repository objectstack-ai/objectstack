/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** `resolveAffordanceGrant`, the grant half of a verdict (objectstack#35684). */
import { describe, it, expect } from 'vitest';
import { resolveAffordance, resolveAffordanceGrant } from '../affordanceGrants';

const principal = (mayUpdate: boolean) => ({
  can: (_object: string, grant: string) => grant !== 'update' || mayUpdate,
  // The server's API allows no update on this object.
  getObjectApiOperations: () => ['read'],
});

describe('resolveAffordanceGrant (objectstack#35684)', () => {
  it('answers the grant alone, where the verdict also reads what the object allows', () => {
    const source = { objectName: 'orders', perms: principal(true) };
    expect(resolveAffordance('listInlineEdit', source).allowed).toBe(false);
    expect(resolveAffordanceGrant('listInlineEdit', source)).toBe(true);
    expect(resolveAffordanceGrant('listInlineEdit', { objectName: 'orders', perms: principal(false) })).toBe(false);
  });

  it('reads open with no object or no principal, as the verdict does', () => {
    expect(resolveAffordanceGrant('listInlineEdit', { perms: principal(false) })).toBe(true);
    expect(resolveAffordanceGrant('listInlineEdit', { objectName: 'orders' })).toBe(true);
  });
});
