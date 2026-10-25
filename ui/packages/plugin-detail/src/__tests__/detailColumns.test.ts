/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#2578 "多列显示" — the DETAIL view must reach the same column
 * density as the entry FORM. Before this, `inferDetailColumns` hard-capped at
 * 2 and the section column count was derived per-section, so a field-heavy
 * record showed 2 columns in detail but 4 in the form. These tests pin the
 * aligned behavior.
 */

import { describe, it, expect } from 'vitest';
import { inferDetailColumns } from '../autoLayout';
import { getResponsiveSpanClass } from '../DetailSection';
import { deriveFieldGroupDetailSections } from '../synth/buildDefaultPageSchema';

describe('inferDetailColumns — density scale aligned with the form (#2578)', () => {
  it('scales 1 → 2 → 3 → 4 by field count (no longer capped at 2)', () => {
    expect(inferDetailColumns(1)).toBe(1);
    expect(inferDetailColumns(3)).toBe(1);
    expect(inferDetailColumns(4)).toBe(2);
    expect(inferDetailColumns(8)).toBe(2);
    expect(inferDetailColumns(9)).toBe(3);
    expect(inferDetailColumns(15)).toBe(3);
    expect(inferDetailColumns(16)).toBe(4);
    expect(inferDetailColumns(57)).toBe(4);
  });

  it('clamps to a single column on a narrow container', () => {
    expect(inferDetailColumns(20, 480)).toBe(1);
    expect(inferDetailColumns(20, 800)).toBe(4);
  });
});

describe('getResponsiveSpanClass — spans track the breakpoint ladder up to 4', () => {
  it('never spans more cells than exist at each breakpoint', () => {
    expect(getResponsiveSpanClass(1, 4)).toBe('');
    expect(getResponsiveSpanClass(2, 4)).toBe('md:col-span-2');
    expect(getResponsiveSpanClass(3, 4)).toBe('md:col-span-2 lg:col-span-3');
    expect(getResponsiveSpanClass(4, 4)).toBe('md:col-span-2 lg:col-span-3 xl:col-span-4');
  });

  it('caps at the 3-column ladder for 3-column sections', () => {
    expect(getResponsiveSpanClass(4, 3)).toBe('md:col-span-2 lg:col-span-3');
    expect(getResponsiveSpanClass(2, 3)).toBe('md:col-span-2');
  });
});

describe('deriveFieldGroupDetailSections — one object-wide column count on every section (#2578)', () => {
  const heavyDef = {
    name: 'lead',
    fieldGroups: [
      { key: 'basic', label: 'Basic' },
      { key: 'plan', label: 'Plan' },
    ],
    fields: Object.fromEntries(
      // 3 in basic, 15 in plan → 18 total → 4 columns
      [
        ...Array.from({ length: 3 }, (_, i) => [`b${i}`, { type: 'text', group: 'basic' }]),
        ...Array.from({ length: 15 }, (_, i) => [`p${i}`, { type: 'text', group: 'plan' }]),
      ],
    ),
  };

  it('stamps columns derived from the TOTAL field count on every section (matches the form)', () => {
    const sections = deriveFieldGroupDetailSections(heavyDef as any);
    expect(sections).not.toBeNull();
    // 18 total fields → 4 columns, applied uniformly — the 3-field Basic group
    // and the 15-field Plan group both get 4 (not per-section 2 / 3).
    for (const s of sections!) {
      expect(s.columns).toBe(4);
    }
  });

  it('returns null for an object without fieldGroups', () => {
    expect(deriveFieldGroupDetailSections({ name: 'x', fields: {} } as any)).toBeNull();
  });
});
