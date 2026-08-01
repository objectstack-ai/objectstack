// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { percentScaleOf } from './percent-scale';

describe('percentScaleOf', () => {
  it('reads a bare percent field as fraction-stored (0–1)', () => {
    // No `max` → the edit widget divides typed input by 100, so 1 means 100%.
    expect(percentScaleOf({ type: 'percent' })).toBe('fraction');
    expect(percentScaleOf({ type: 'percent', max: 1 })).toBe('fraction');
  });

  it('reads `max` above 1 as whole-percent storage (0–100)', () => {
    // `min: 0, max: 100` is the declaration the edit widget keys off to store
    // the typed number unscaled — so 1 means 1%, not 100%.
    expect(percentScaleOf({ type: 'percent', max: 100 })).toBe('whole');
  });

  it('has no opinion about a non-percent field', () => {
    // A plain number carries no percent semantics even when an author formats
    // it with a "%" — annotating it would override their format string.
    expect(percentScaleOf({ type: 'number', max: 100 })).toBeUndefined();
    expect(percentScaleOf({ type: 'currency' })).toBeUndefined();
    expect(percentScaleOf(undefined)).toBeUndefined();
    expect(percentScaleOf({})).toBeUndefined();
  });
});
