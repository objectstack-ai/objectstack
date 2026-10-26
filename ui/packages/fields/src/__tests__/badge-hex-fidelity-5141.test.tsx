/**
 * Regression for objectstack-ai/objectui#5141: an author's explicit `options[].color`
 * hex was quantized to one of nine palette families before it reached the badge, so
 * two same-hue tiers the author declared as distinct — `#2ecc71` ("in progress") and
 * `#1e8449` ("completed") — rendered BYTE-IDENTICAL (`bg-green-50 text-green-700
 * border-green-200` for both) and end users could not tell the two states apart.
 * `plugin-gantt` had already settled the same class of conflict the other way
 * ("explicit colorField value (hex or semantic name) — metadata wins").
 *
 * The pins below are deliberately about MEASURED properties, not colour identity:
 *
 *   1. Two distinct declarations must be PERCEPTIBLY distinct, not merely unequal.
 *      Any naive "compute a pale pill from the hex" would satisfy `!==` while still
 *      leaving the reported pair under the just-noticeable difference — closing the
 *      issue on paper with the bug intact. So the bar is a CIE76 ΔE threshold.
 *   2. The label must stay readable against the surface actually rendered, in BOTH
 *      themes, including for declarations that are unreadable as declared. Honoring
 *      author metadata must not turn legibility loose across every list view.
 *   3. Non-hex declarations (family names, the semantic value map, the hash
 *      fallback) must be untouched.
 *
 * The colour math here is written out independently of the implementation on
 * purpose: a contrast pin that reuses the code under test would agree with that
 * code by construction and prove nothing.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import {
  SelectCellRenderer,
  getBadgeColorClasses,
  getBadgeHexAppearance,
  getDotHexAppearance,
  getSemanticColorName,
  deriveHexBadgePalette,
} from '../index';

/* ---------------------------------------------------------------- colour math */

interface Rgb { r: number; g: number; b: number }

function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

const linear = (v: number): number => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const luminance = ({ r, g, b }: Rgb): number =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

function contrast(a: string, b: string): number {
  const la = luminance(parseHex(a));
  const lb = luminance(parseHex(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** sRGB -> CIE L*a*b* (D65), for a perceptual distance between two rendered pills. */
function lab(hex: string): [number, number, number] {
  const { r, g, b } = parseHex(hex);
  const R = linear(r), G = linear(g), B = linear(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** CIE76 colour difference. ~2.3 is the just-noticeable difference. */
function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * "Two badges a user can actually tell apart at a glance." ΔE 2.3 is one JND;
 * this asks for comfortably more than one, so an implementation that merely
 * un-breaks byte-identity cannot pass.
 */
const PERCEPTIBLE = 5.0;

/** WCAG AA for normal text. */
const AA = 4.5;

/**
 * Measured floor of the -500 dot shades shipped today: yellow-500 `#eab308`
 * sits at 1.92:1 on white, the weakest of the nine. A declared dot must never
 * be LESS visible than the palette dot it replaces.
 */
const DOT_FLOOR = 1.9;

const REPORTED_LIGHT = '#2ecc71'; // "in progress" — green
const REPORTED_DARK = '#1e8449'; // "completed"   — deep green
const REPORTED_DARKER = '#145A32'; // the reporter's re-test, pressed darker still

/* ------------------------------------------------------------------- helpers */

function styleOf(el: HTMLElement, prop: string): string {
  return el.style.getPropertyValue(prop).trim();
}

function renderSelect(color: string, appearance?: 'badge' | 'dot') {
  const field = {
    type: 'select',
    ...(appearance ? { appearance } : {}),
    options: [{ label: 'State', value: 'state', color }],
  } as any;
  const { container } = render(<SelectCellRenderer value="state" field={field} />);
  return container;
}

describe('objectui#5141 — declared option hex reaches the badge intact', () => {
  it('the reported pair no longer renders identically, and is perceptibly distinct', () => {
    const a = deriveHexBadgePalette(REPORTED_LIGHT)!;
    const b = deriveHexBadgePalette(REPORTED_DARK)!;

    // The literal defect: byte-identical output for two distinct declarations.
    expect(a.bg).not.toBe(b.bg);
    expect(a.fg).not.toBe(b.fg);
    expect(a.border).not.toBe(b.border);

    // ...and distinct ENOUGH to be seen, which mere inequality does not imply.
    expect(deltaE(a.bg, b.bg)).toBeGreaterThanOrEqual(PERCEPTIBLE);
    expect(deltaE(a.bgDark, b.bgDark)).toBeGreaterThanOrEqual(PERCEPTIBLE);

    // The reporter's harder re-test: pressing the second colour darker still
    // has to keep moving the rendered pill, in both themes.
    const c = deriveHexBadgePalette(REPORTED_DARKER)!;
    expect(deltaE(b.bg, c.bg)).toBeGreaterThanOrEqual(PERCEPTIBLE);
    expect(deltaE(b.bgDark, c.bgDark)).toBeGreaterThanOrEqual(PERCEPTIBLE);
  });

  it('renders the declared hex through the DOM, not a palette family class', () => {
    const container = renderSelect(REPORTED_DARK);
    const badge = screen.getByTitle('State');
    const palette = deriveHexBadgePalette(REPORTED_DARK)!;

    expect(styleOf(badge, '--os-badge-bg')).toBe(palette.bg);
    expect(styleOf(badge, '--os-badge-fg')).toBe(palette.fg);
    expect(styleOf(badge, '--os-badge-border')).toBe(palette.border);

    // The quantized family classes must be gone for this path.
    expect(badge.className).not.toMatch(/bg-green-50|text-green-700|border-green-200/);
    expect(container.innerHTML).toContain('--os-badge-bg');
  });

  it('two declared greens produce different DOM, which is the user-visible bug', () => {
    const first = renderSelect(REPORTED_LIGHT).innerHTML;
    const second = renderSelect(REPORTED_DARK).innerHTML;
    expect(first).not.toBe(second);
  });

  it('keeps the pill under the design system: light/dark stay `dark:` variants', () => {
    // The colours are carried by custom properties precisely so the utilities
    // themselves remain static and theme-aware. A hard-coded inline background
    // would render the same in dark mode, which is the cost this avoids.
    const appearance = getBadgeHexAppearance(REPORTED_DARK)!;
    expect(appearance.className).toContain('dark:bg-[color:var(--os-badge-bg-dark)]');
    expect(appearance.className).toContain('dark:text-[color:var(--os-badge-fg-dark)]');
    expect(appearance.className).toContain('dark:border-[color:var(--os-badge-border-dark)]');
    // No raw colour baked into the class string.
    expect(appearance.className).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe('objectui#5141 — contrast is pinned, not just colour identity', () => {
  // Includes declarations that are unreadable as declared: pure white, pure
  // black, neon yellow, a near-white cream, and a fully desaturated grey.
  const declarations = [
    REPORTED_LIGHT, REPORTED_DARK, REPORTED_DARKER,
    '#ffffff', '#000000', '#ffff00', '#fffbe6', '#7f7f7f', '#0a0a0a',
    '#ef4444', '#3b82f6', '#a855f7', '#eab308', '#00ffff', '#ff00ff',
    '#abcdef', '#123456', '#f5f5f4', '#27ae60', '#16a085',
  ];

  it.each(declarations)('%s: label clears WCAG AA in both themes', (hex) => {
    const p = deriveHexBadgePalette(hex)!;
    expect(p).toBeDefined();
    expect(contrast(p.fg, p.bg)).toBeGreaterThanOrEqual(AA);
    expect(contrast(p.fgDark, p.bgDark)).toBeGreaterThanOrEqual(AA);
  });

  it.each(declarations)('%s: dot stays at least as visible as the palette dot', (hex) => {
    const p = deriveHexBadgePalette(hex)!;
    expect(contrast(p.dot, '#ffffff')).toBeGreaterThanOrEqual(DOT_FLOOR);
    expect(contrast(p.dotDark, '#0a0a0a')).toBeGreaterThanOrEqual(DOT_FLOOR);
  });

  it('a declaration that is unreadable as-declared is corrected, not rendered as-is', () => {
    // Pure yellow as a label on its own pale pill would be illegible; the
    // foreground must move off the declared value to clear AA.
    const p = deriveHexBadgePalette('#ffff00')!;
    expect(p.fg.toLowerCase()).not.toBe('#ffff00');
    expect(contrast(p.fg, p.bg)).toBeGreaterThanOrEqual(AA);
  });
});

describe('objectui#5141 — appearance: dot honours the declaration too', () => {
  it('paints the declared hex rather than a per-family -500 shade', () => {
    const container = renderSelect(REPORTED_DARK, 'dot');
    const dot = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    const palette = deriveHexBadgePalette(REPORTED_DARK)!;

    expect(dot).toBeTruthy();
    expect(styleOf(dot, '--os-dot-bg')).toBe(palette.dot);
    expect(styleOf(dot, '--os-dot-bg-dark')).toBe(palette.dotDark);
    expect(dot.className).not.toContain('bg-green-500');
  });

  it('two declared greens give two different dots', () => {
    const a = deriveHexBadgePalette(REPORTED_LIGHT)!;
    const b = deriveHexBadgePalette(REPORTED_DARKER)!;
    expect(a.dot).not.toBe(b.dot);
    expect(deltaE(a.dot, b.dot)).toBeGreaterThanOrEqual(PERCEPTIBLE);
  });
});

describe('objectui#5141 — every non-hex path is untouched', () => {
  it('family names still resolve to their exact palette classes', () => {
    expect(getBadgeColorClasses('green')).toBe(
      'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900/60',
    );
    expect(getBadgeColorClasses('red')).toBe(
      'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/60',
    );
  });

  it('the semantic value map still wins when no colour is declared', () => {
    // '完成' maps to green in SEMANTIC_COLOR_MAP.
    expect(getBadgeColorClasses(undefined, '完成')).toContain('bg-green-50');
    expect(getBadgeColorClasses(undefined, '已取消')).toContain('bg-red-50');
  });

  it('the deterministic hash fallback is still deterministic', () => {
    const first = getBadgeColorClasses(undefined, 'some_unmapped_value');
    const second = getBadgeColorClasses(undefined, 'some_unmapped_value');
    expect(first).toBe(second);
    expect(first).toMatch(/^bg-/);
  });

  it('an empty value still renders the muted pill', () => {
    expect(getBadgeColorClasses(undefined, '')).toBe(
      'bg-muted text-muted-foreground border-border',
    );
  });

  it('non-hex declarations get no hex appearance at all', () => {
    expect(getBadgeHexAppearance('green')).toBeUndefined();
    expect(getBadgeHexAppearance(undefined)).toBeUndefined();
    expect(getBadgeHexAppearance('rgb(1,2,3)')).toBeUndefined();
    expect(getDotHexAppearance('green')).toBeUndefined();
    // A '#'-prefixed value that is not a valid hex must not fabricate a palette.
    expect(getBadgeHexAppearance('#nothex')).toBeUndefined();
    expect(deriveHexBadgePalette('#nothex')).toBeUndefined();
  });

  it('the family quantizer itself is unchanged, so the Gantt path still resolves', () => {
    // plugin-gantt reads semantic NAMES, not pill classes; both reported greens
    // legitimately remain 'green' there. That path was never the defect.
    expect(getSemanticColorName(REPORTED_LIGHT)).toBe('green');
    expect(getSemanticColorName(REPORTED_DARK)).toBe('green');
    expect(getSemanticColorName('#ef4444')).toBe('red');
    expect(getSemanticColorName('#3b82f6')).toBe('blue');
    expect(getSemanticColorName('#808080')).toBe('gray');
  });

  it('a field with no declared colour renders exactly the family classes', () => {
    const field = { type: 'select', options: [{ label: 'Open', value: 'open' }] } as any;
    render(<SelectCellRenderer value="open" field={field} />);
    const badge = screen.getByTitle('Open');
    expect(badge.getAttribute('style')).toBeFalsy();
    expect(badge.className).toMatch(/bg-\w+-50/);
  });
});
