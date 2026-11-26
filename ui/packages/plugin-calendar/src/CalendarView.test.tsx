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

  // objectstack#36882 (option A): an event is coloured if and only if a
  // colour was declared for it; no colour is derived from a value.
  it('paints the default event colour for a category label no option colours', () => {
    const expected = 'bg-blue-100 text-blue-900 border border-blue-200';
    for (const c of ['email', 'digital', 'Email', 'Webinar', 'Trade Show', 'Partner', 'Direct Mail', 'Social', '中文', 'open', 'won', 'critical']) {
      expect(resolveEventColor(c)).toEqual({ className: expected });
    }
  });

  it('paints a declared palette family with that family tint', () => {
    expect(resolveEventColor('green')).toEqual({ className: 'bg-green-100 text-green-900 border border-green-200' });
    expect(resolveEventColor('red')).toEqual({ className: 'bg-red-100 text-red-900 border border-red-200' });
    expect(resolveEventColor('blue')).toEqual({ className: 'bg-blue-100 text-blue-900 border border-blue-200' });
  });

  it('an inherited object key is not a palette family', () => {
    expect(resolveEventColor('constructor')).toEqual({ className: 'bg-blue-100 text-blue-900 border border-blue-200' });
  });
});
