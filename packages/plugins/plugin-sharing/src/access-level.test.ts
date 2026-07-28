// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#3865] The access-level vocabulary after `full` was retired.
 *
 * `full` was declared "Full Access (Transfer, Share, Delete)" but every
 * enforcement site matched `access_level in ('edit','full')`, so it granted
 * exactly what `edit` grants while telling admins otherwise — the
 * declared-but-unenforced trap ADR-0078 bans. These tests pin the three-layer
 * posture that replaced it: authoring rejects, enforcement tolerates, data
 * normalises.
 */

import { describe, it, expect } from 'vitest';
import {
  ACCESS_LEVELS,
  WRITE_ACCESS_LEVELS,
  isKnownAccessLevel,
  normalizeAccessLevel,
  normalizeStoredAccessLevel,
} from './access-level.js';

describe('access-level vocabulary', () => {
  it('offers exactly read and edit for authoring', () => {
    expect([...ACCESS_LEVELS]).toEqual(['read', 'edit']);
  });

  it('keeps the write gate wider than the authorable set', () => {
    // The whole point of the tolerance layer: a row persisted before the boot
    // backfill ran must keep working. If this ever narrows to ['edit'], every
    // un-migrated `full` grant silently loses write access.
    expect([...WRITE_ACCESS_LEVELS]).toEqual(['edit', 'full']);
  });
});

describe('normalizeAccessLevel (authoring path)', () => {
  it('passes the authorable levels through unchanged', () => {
    expect(normalizeAccessLevel('read')).toBe('read');
    expect(normalizeAccessLevel('edit')).toBe('edit');
  });

  it("normalises the retired 'full' to 'edit'", () => {
    // Lossless precisely because `full` was inert — the two already behaved
    // identically, so no principal gains or loses anything.
    expect(normalizeAccessLevel('full')).toBe('edit');
  });

  it('throws VALIDATION_FAILED on an unrecognised level', () => {
    // Coercing an unknown level would recreate the bug in a new spot: a grant
    // that looks issued and that no gate matches.
    expect(() => normalizeAccessLevel('admin')).toThrow(/VALIDATION_FAILED/);
    expect(() => normalizeAccessLevel('owner')).toThrow(/VALIDATION_FAILED/);
    expect(() => normalizeAccessLevel(7)).toThrow(/VALIDATION_FAILED/);
  });

  it('applies the fallback only for a missing value', () => {
    expect(normalizeAccessLevel(undefined, 'read')).toBe('read');
    expect(normalizeAccessLevel(null, 'edit')).toBe('edit');
    expect(normalizeAccessLevel('', 'read')).toBe('read');
    // A PRESENT but invalid value must never fall back — that would swallow
    // the author's mistake.
    expect(() => normalizeAccessLevel('nope', 'read')).toThrow(/VALIDATION_FAILED/);
  });

  it('requires a level when no fallback is supplied', () => {
    expect(() => normalizeAccessLevel(undefined)).toThrow(/VALIDATION_FAILED/);
  });
});

describe('normalizeStoredAccessLevel (read path)', () => {
  it('normalises known levels without throwing', () => {
    expect(normalizeStoredAccessLevel('read')).toBe('read');
    expect(normalizeStoredAccessLevel('edit')).toBe('edit');
    expect(normalizeStoredAccessLevel('full')).toBe('edit');
  });

  it('fails CLOSED to read on unrecognised or missing stored data', () => {
    // Never throws: projecting an existing row must not take down the rule
    // evaluator or an admin list view over one bad byte. Degrades to the
    // NARROWEST level rather than trusting it.
    expect(normalizeStoredAccessLevel('admin')).toBe('read');
    expect(normalizeStoredAccessLevel(undefined)).toBe('read');
    expect(normalizeStoredAccessLevel(null)).toBe('read');
    expect(normalizeStoredAccessLevel({})).toBe('read');
  });
});

describe('isKnownAccessLevel', () => {
  it('accepts authorable and retired-but-stored levels', () => {
    expect(isKnownAccessLevel('read')).toBe(true);
    expect(isKnownAccessLevel('edit')).toBe(true);
    expect(isKnownAccessLevel('full')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isKnownAccessLevel('admin')).toBe(false);
    expect(isKnownAccessLevel(undefined)).toBe(false);
    expect(isKnownAccessLevel(1)).toBe(false);
  });
});
