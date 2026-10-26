/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { __resolveEventColorForTest as resolveEventColor } from './CalendarView';

describe('resolveEventColor', () => {
  it('returns default palette entry for null / empty input', () => {
    const expected = 'bg-blue-100 text-blue-900 border border-blue-200';
    expect(resolveEventColor(undefined)).toEqual({ className: expected });
    expect(resolveEventColor(null)).toEqual({ className: expected });
    expect(resolveEventColor('')).toEqual({ className: expected });
  });

  it('passes through hex colors via inline style', () => {
    expect(resolveEventColor('#ff0000')).toEqual({ className: 'text-white', inlineColor: '#ff0000' });
    expect(resolveEventColor('#abc')).toEqual({ className: 'text-white', inlineColor: '#abc' });
  });

  it('passes through Tailwind utility strings unchanged', () => {
    expect(resolveEventColor('bg-red-500 text-white')).toEqual({ className: 'bg-red-500 text-white' });
    expect(resolveEventColor('bg-emerald-600')).toEqual({ className: 'bg-emerald-600' });
  });

  it('maps arbitrary category labels deterministically to the palette', () => {
    const email1 = resolveEventColor('email');
    const email2 = resolveEventColor('email');
    const digital = resolveEventColor('digital');
    expect(email1.className).toBe(email2.className);
    // Same input → same color
    expect(email1.className).toMatch(/^bg-/);
    // Distinct inputs are very likely to map to different palette stops
    // (collision rate ~1/8 — but `email` and `digital` are known to differ)
    expect(email1.className).not.toBe(digital.className);
  });

  it('always returns a Tailwind bg-* class for categorical inputs', () => {
    for (const c of ['Email', 'Webinar', 'Trade Show', 'Partner', 'Direct Mail', 'Social', '中文']) {
      const r = resolveEventColor(c);
      expect(r.className.startsWith('bg-')).toBe(true);
      expect(r.inlineColor).toBeUndefined();
    }
  });
});
