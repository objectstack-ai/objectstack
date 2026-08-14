// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { isRowActive } from './row-active.js';

/**
 * [#8613 / ADR-0049] The ONE predicate three readers share — the core resolver
 * that enforces `active`, the plugin-security loader that judges the same flag
 * on the name-reuse path, and the break-glass guard that SIMULATES a write to
 * it. The reason it is one function is that a guard modelling "deactivated"
 * differently from the resolver would permit exactly the write it exists to
 * refuse.
 *
 * Both directions are pinned deliberately, because both have a real failure
 * mode: reading absent as inactive mass-revokes deployed rows, and reading only
 * `=== false` as inactive misses the shape SQLite actually stores.
 */
describe('[#8613] isRowActive — explicitly deactivated, not explicitly active', () => {
  it('treats the stored spellings of OFF as deactivated', () => {
    for (const off of [false, 0, '0', 'false']) {
      expect(isRowActive({ active: off })).toBe(false);
    }
  });

  it('treats the stored spellings of ON as active', () => {
    for (const on of [true, 1, '1', 'true']) {
      expect(isRowActive({ active: on })).toBe(true);
    }
  });

  it('ABSENT means active — a row predating the column keeps granting', () => {
    expect(isRowActive({})).toBe(true);
    expect(isRowActive({ active: undefined })).toBe(true);
    expect(isRowActive({ active: null })).toBe(true);
  });

  it('an unrecognised value is NOT a deactivation — junk may not revoke', () => {
    // Nothing writes these. Inventing a revocation out of unreadable data is
    // the direction that ends in a lockout nobody ordered.
    expect(isRowActive({ active: 'yes' } as never)).toBe(true);
    expect(isRowActive({ active: {} } as never)).toBe(true);
  });

  it('a missing row is not active — a filter over nothing grants nothing', () => {
    expect(isRowActive(undefined)).toBe(false);
    expect(isRowActive(null)).toBe(false);
  });
});
