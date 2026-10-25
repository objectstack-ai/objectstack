/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `hasMultiValueShape` delegates to the spec's own `isMultiValueField` instead
 * of restating its rule (objectui#3017, tightened in objectui#3161 — it used to
 * re-derive the answer from `MULTI_OPTION_TYPES` / `MULTI_CAPABLE_TYPES` while
 * wearing that spec function's NAME). The anchors below are the non-vacuity
 * gate: if the spec vocabulary silently shrank, `normalizeMultiValuePatch`
 * would stop wrapping lone scalars for that type and the column-shape
 * corruption of #2204 would return — fail loudly here instead.
 */

import { describe, it, expect } from 'vitest';
import { hasMultiValueShape, normalizeMultiValuePatch } from './multiValueFields';

describe('hasMultiValueShape (spec-derived, objectui#3017)', () => {
  it('always-multi option types stay covered', () => {
    for (const type of ['multiselect', 'checkboxes', 'tags']) {
      expect(hasMultiValueShape({ type }), `'${type}' no longer always-multi — spec vocabulary moved?`).toBe(true);
    }
  });

  it('multi-capable types stay covered when flagged multiple', () => {
    for (const type of ['select', 'radio', 'lookup', 'user', 'file', 'image']) {
      expect(hasMultiValueShape({ type, multiple: true }), `'${type}' no longer multi-capable — spec vocabulary moved?`).toBe(true);
      expect(hasMultiValueShape({ type }), `'${type}' must stay single-value without the flag`).toBe(false);
    }
  });

  it('stays null-tolerant and conservative for everything else', () => {
    expect(hasMultiValueShape(undefined)).toBe(false);
    expect(hasMultiValueShape(null)).toBe(false);
    expect(hasMultiValueShape({})).toBe(false);
    expect(hasMultiValueShape({ type: 'text', multiple: true })).toBe(false);
  });

  it('normalizeMultiValuePatch still wraps a lone scalar for a spec-classified field', () => {
    const fields = { assignees: { type: 'user', multiple: true } };
    expect(normalizeMultiValuePatch({ assignees: 'u1' }, fields)).toEqual({ assignees: ['u1'] });
    expect(normalizeMultiValuePatch({ assignees: ['u1'] }, fields)).toEqual({ assignees: ['u1'] });
  });
});
