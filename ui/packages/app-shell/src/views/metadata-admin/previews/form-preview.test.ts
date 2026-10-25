// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  INLINE_FORM_TYPES,
  OVERLAY_FORM_TYPES,
  isOverlayFormType,
  toInlineFormType,
} from './form-preview';
import { BLOCK_CONFIG } from './block-config';

describe('form-preview — overlay/inline classifier', () => {
  it('isOverlayFormType flags only drawer/modal', () => {
    expect(isOverlayFormType('drawer')).toBe(true);
    expect(isOverlayFormType('modal')).toBe(true);
    for (const t of ['simple', 'tabbed', 'wizard', 'split']) {
      expect(isOverlayFormType(t)).toBe(false);
    }
    expect(isOverlayFormType(undefined)).toBe(false);
    expect(isOverlayFormType(42)).toBe(false);
  });

  it('toInlineFormType collapses overlay types to simple, passes inline through', () => {
    expect(toInlineFormType('drawer')).toBe('simple');
    expect(toInlineFormType('modal')).toBe('simple');
    expect(toInlineFormType('wizard')).toBe('wizard');
    expect(toInlineFormType('tabbed')).toBe('tabbed');
    expect(toInlineFormType('split')).toBe('split');
    expect(toInlineFormType('simple')).toBe('simple');
    expect(toInlineFormType(undefined)).toBe('simple');
    expect(toInlineFormType('nonsense')).toBe('simple');
  });

  it('inline and overlay sets never overlap', () => {
    for (const t of OVERLAY_FORM_TYPES) expect(INLINE_FORM_TYPES.has(t)).toBe(false);
  });

  // Drift guard: every form type offered by the page inspector must be
  // classified as exactly one of inline/overlay. Adding a new formType option
  // to block-config without classifying it here turns this test red.
  it('every inspector form-type option is classified exactly once', () => {
    const field = (BLOCK_CONFIG['object-form'] || []).find((f) => f.name === 'formType') as
      | { options?: Array<{ value: string }> }
      | undefined;
    const values = (field?.options ?? []).map((o) => o.value);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      const inline = INLINE_FORM_TYPES.has(v);
      const overlay = OVERLAY_FORM_TYPES.has(v);
      expect(inline !== overlay).toBe(true); // exactly one, never both/neither
    }
  });
});
