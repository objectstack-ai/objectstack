/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35985 — an object's icon is a white glyph on a rounded square of
 * the object's palette colour. These pins hold the tile to the spec's palette
 * (every name has a colour, nothing else does), the neutral fallback, and the
 * white-glyph contrast each light and dark value was chosen for.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { OBJECT_COLORS } from '@objectstack/spec/data';
import {
  ObjectIconTile,
  NeutralIconTile,
  OBJECT_COLOR_TILE_CLASS,
  NEUTRAL_ICON_TILE_CLASS,
  objectColorOrDefault,
} from '../custom/object-icon-tile';

/** Tailwind v4's default palette, in the sRGB hex its docs publish, for the shades the tile uses. */
const HEX: Record<string, string> = {
  'gray-200': '#e5e7eb', 'gray-500': '#6b7280', 'gray-700': '#374151',
  'blue-500': '#3b82f6', 'blue-600': '#2563eb',
  'teal-600': '#0d9488',
  'green-600': '#16a34a',
  'amber-600': '#d97706',
  'orange-600': '#ea580c',
  'red-500': '#ef4444', 'red-600': '#dc2626',
  'pink-500': '#ec4899', 'pink-600': '#db2777',
  'purple-500': '#a855f7', 'purple-600': '#9333ea',
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('objectstack#35985 — ObjectIconTile', () => {
  it('has exactly one light and one dark background per palette name', () => {
    expect(Object.keys(OBJECT_COLOR_TILE_CLASS).sort()).toEqual([...OBJECT_COLORS].sort());
    for (const name of OBJECT_COLORS) {
      const classes = OBJECT_COLOR_TILE_CLASS[name].split(' ');
      expect(classes.filter((c) => /^bg-/.test(c)), name).toHaveLength(1);
      expect(classes.filter((c) => /^dark:bg-/.test(c)), name).toHaveLength(1);
    }
  });

  it('keeps the white glyph at 3:1 or better (WCAG 1.4.11) in both themes', () => {
    for (const name of OBJECT_COLORS) {
      for (const cls of OBJECT_COLOR_TILE_CLASS[name].split(' ')) {
        const shade = cls.replace(/^(dark:)?bg-/, '');
        expect(HEX[shade], `${name} ${cls}`).toBeDefined();
        expect(contrastWithWhite(HEX[shade]), `${name} ${cls}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('draws a palette name in its colour, and anything else (none, a hex, an unknown name) in gray', () => {
    expect(objectColorOrDefault('orange')).toBe('orange');
    for (const v of [undefined, '', '#ff0000', 'success', 'Orange', 7]) expect(objectColorOrDefault(v)).toBe('gray');

    const { container, rerender } = render(<ObjectIconTile icon="users" color="orange" />);
    const tile = container.querySelector('[data-object-icon-tile]')!;
    expect(tile.getAttribute('data-object-icon-tile')).toBe('orange');
    expect(tile.className).toContain('bg-orange-600');
    expect(tile.className).toContain('text-white');
    expect(tile.querySelector('svg')).not.toBeNull();

    rerender(<ObjectIconTile icon="users" color="#ff0000" />);
    expect(container.querySelector('[data-object-icon-tile]')!.getAttribute('data-object-icon-tile')).toBe('gray');
  });

  it('draws a host-resolved glyph when one is passed, and LazyIcon\'s otherwise', () => {
    const Glyph = (props: { className?: string }) => <svg data-testid="host-glyph" className={props.className} />;
    const { getByTestId, container, rerender } = render(<ObjectIconTile icon="users" glyph={Glyph} />);
    expect(getByTestId('host-glyph').getAttribute('class')).toContain('h-3');
    rerender(<ObjectIconTile />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('lucide-database');
  });

  it('is hidden from assistive tech beside a label, and named when it stands alone', () => {
    const { container, rerender } = render(<ObjectIconTile icon="users" />);
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
    rerender(<ObjectIconTile icon="users" title="Accounts" />);
    expect(container.firstElementChild!.getAttribute('role')).toBe('img');
    expect(container.firstElementChild!.getAttribute('aria-label')).toBe('Accounts');
  });
});

describe('objectstack#36141 — NeutralIconTile', () => {
  it('is a light grey square with a dark grey glyph, one value per theme, at 4.5:1 or better', () => {
    const classes = NEUTRAL_ICON_TILE_CLASS.split(' ');
    const pick = (re: RegExp) => classes.filter((c) => re.test(c)).map((c) => c.replace(/^(dark:)?(bg|text)-/, ''));
    const [bg] = pick(/^bg-/);
    const [fg] = pick(/^text-/);
    const [darkBg] = pick(/^dark:bg-/);
    const [darkFg] = pick(/^dark:text-/);
    expect(classes).toHaveLength(4);
    expect(contrast(HEX[bg], HEX[fg])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(HEX[darkBg], HEX[darkFg])).toBeGreaterThanOrEqual(4.5);
    // Light means lighter than every palette square, so it never reads as a colour of its own.
    expect(luminance(HEX[bg])).toBeGreaterThan(luminance(HEX['gray-500']));
  });

  it('has the object tile\'s edge, glyph and corners at every size, and no palette colour', () => {
    for (const size of ['xs', 'sm', 'md', 'lg'] as const) {
      const a = render(<ObjectIconTile icon="users" size={size} />).container.firstElementChild!;
      const b = render(<NeutralIconTile icon="users" size={size} />).container.firstElementChild!;
      const shape = (el: Element) => el.className.split(' ').filter((c) => /^(h|w|rounded)-/.test(c)).sort();
      expect(shape(b), size).toEqual(shape(a));
      expect(b.querySelector('svg')!.getAttribute('class'), size).toBe(a.querySelector('svg')!.getAttribute('class'));
      expect(b.hasAttribute('data-neutral-icon-tile')).toBe(true);
      expect(b.hasAttribute('data-object-icon-tile')).toBe(false);
      expect(b.className).not.toContain('text-white');
    }
  });

  it('draws a host-resolved glyph, and is hidden beside a label or named alone', () => {
    const Glyph = (props: { className?: string }) => <svg data-testid="host-glyph" className={props.className} />;
    const { getByTestId, container, rerender } = render(<NeutralIconTile glyph={Glyph} />);
    expect(getByTestId('host-glyph')).toBeTruthy();
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
    rerender(<NeutralIconTile icon="chart-column" title="Reports" />);
    expect(container.firstElementChild!.getAttribute('role')).toBe('img');
    expect(container.firstElementChild!.getAttribute('aria-label')).toBe('Reports');
  });
});
