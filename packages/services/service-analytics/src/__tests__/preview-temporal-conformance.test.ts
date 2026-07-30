// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal conformance for the draft-preview evaluator (ADR-0053 D-A3).
 *
 * The cases come from `@objectstack/spec/data` so this backend, the three
 * drivers and `formula`'s write-side `check` evaluator are all held to one
 * standard — see `temporal-conformance.ts` for the four divergences that
 * standard exists to prevent.
 *
 * This surface has its own reason to care: a Live Canvas dashboard charts REAL
 * numbers from DRAFTED seed data, and publish materialises the same seed. If
 * the preview and the driver disagree about a window, the numbers jump across
 * the publish boundary — the continuity the preview exists to provide.
 *
 * Type-blind, like `formula`: it evaluates a bare row with no schema, so both
 * the `datetime` and `date` cases run against the raw string values.
 */

import { describe, it, expect } from 'vitest';
import { TEMPORAL_CASES, TEMPORAL_ROWS } from '@objectstack/spec/data';
import { matchesWhere } from '../preview-evaluator.js';

describe('preview-evaluator — temporal conformance', () => {
  for (const c of TEMPORAL_CASES) {
    it(c.name, () => {
      const got = TEMPORAL_ROWS.filter((r) => matchesWhere(r as any, c.filter as any)).map((r) => r.id);
      expect(got, c.note).toEqual(c.expected);
    });
  }
});
