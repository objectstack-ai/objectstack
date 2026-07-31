// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The import-coercion vocabulary's own discipline (#4173).
 *
 * Both consumers — the server's `/import` coercion and objectui's Import
 * Wizard preview — compare after `trim().toLowerCase()`, so a token that is
 * not already lower-case and trimmed could never match and would be dead
 * weight that READS as an accepted spelling. And a token in both boolean sets
 * would make a cell simultaneously truthy and falsy, with the winner decided
 * by check order at each consumer.
 */

import { describe, it, expect } from 'vitest';

import {
  IMPORT_BOOLEAN_TRUE_TOKENS,
  IMPORT_BOOLEAN_FALSE_TOKENS,
  IMPORT_REFERENCE_TYPES,
} from './import-coercion';
import { REFERENCE_VALUE_TYPES } from './field-value.zod';

describe('import boolean tokens (#4173)', () => {
  it('both sets are non-empty and disjoint', () => {
    expect(IMPORT_BOOLEAN_TRUE_TOKENS.size).toBeGreaterThan(0);
    expect(IMPORT_BOOLEAN_FALSE_TOKENS.size).toBeGreaterThan(0);
    for (const t of IMPORT_BOOLEAN_TRUE_TOKENS) {
      expect(IMPORT_BOOLEAN_FALSE_TOKENS.has(t), `'${t}' is in both sets`).toBe(false);
    }
  });

  it('every token is already lower-case and trimmed', () => {
    for (const t of [...IMPORT_BOOLEAN_TRUE_TOKENS, ...IMPORT_BOOLEAN_FALSE_TOKENS]) {
      expect(t, `token '${t}' must be pre-normalized`).toBe(t.trim().toLowerCase());
      expect(t.length).toBeGreaterThan(0);
    }
  });

  it('keeps the spreadsheet-reality entries', () => {
    // The Chinese and check-mark tokens are the reason this table exists at
    // all — real spreadsheets carry them. Losing one is a silent behaviour
    // change at BOTH consumers, so pin them by name.
    for (const t of ['是', '对', '✓', '√']) expect(IMPORT_BOOLEAN_TRUE_TOKENS.has(t), t).toBe(true);
    for (const t of ['否', '错', '✗', '×']) expect(IMPORT_BOOLEAN_FALSE_TOKENS.has(t), t).toBe(true);
  });
});

describe('import reference types (#4173)', () => {
  it('is the reference value types plus the legacy generic spelling, exactly', () => {
    expect([...IMPORT_REFERENCE_TYPES].sort()).toEqual(
      [...REFERENCE_VALUE_TYPES, 'reference'].sort(),
    );
  });
});
