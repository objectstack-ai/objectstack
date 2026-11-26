// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37452 — Studio's accent class spells its values literally (so
 * Tailwind's source scan finds the classes); this holds every value it spells
 * equal to the constants the rest of the code reads, in the light and the
 * dark theme.
 */

import { describe, expect, it } from 'vitest';
import { STUDIO_ACCENT, STUDIO_ACCENT_FOREGROUND_HSL, STUDIO_ACCENT_HSL } from './studio-tokens';

/** The declarations the class string makes in one theme: `[--x:a_b]` / `dark:[--x:a_b]`, underscores read as spaces. */
function declarations(dark: boolean): Map<string, string> {
  const out = new Map<string, string>();
  for (const cls of STUDIO_ACCENT.split(/\s+/)) {
    const m = /^(dark:)?\[(--[\w-]+):(.+)\]$/.exec(cls);
    if (m && !!m[1] === dark) out.set(m[2], m[3].replace(/_/g, ' '));
  }
  return out;
}

describe('STUDIO_ACCENT (objectstack#37452)', () => {
  it.each([
    ['light', false],
    ['dark', true],
  ] as const)('%s: the accent tokens are graphite, and the foreground is the accent\'s foreground', (theme, dark) => {
    const decl = declarations(dark);
    for (const token of ['--primary', '--ring', '--sidebar-primary', '--sidebar-ring']) {
      expect(decl.get(token), token).toBe(STUDIO_ACCENT_HSL[theme]);
    }
    expect(decl.get('--primary-foreground')).toBe(STUDIO_ACCENT_FOREGROUND_HSL[theme]);
  });

  it('graphite is a neutral: low saturation in both themes, dark in the light theme and light in the dark one', () => {
    const parse = (hsl: string) => hsl.split(' ').map((part) => Number.parseFloat(part));
    const [, sLight, lLight] = parse(STUDIO_ACCENT_HSL.light);
    const [, sDark, lDark] = parse(STUDIO_ACCENT_HSL.dark);
    expect(sLight).toBeLessThanOrEqual(12);
    expect(sDark).toBeLessThanOrEqual(12);
    expect(lLight).toBeLessThan(40);
    expect(lDark).toBeGreaterThan(70);
  });

  it('re-derives Tailwind\'s colour tokens on the same element, so utilities read the rebound values', () => {
    const decl = declarations(false);
    for (const [color, token] of [
      ['--color-primary', '--primary'],
      ['--color-primary-foreground', '--primary-foreground'],
      ['--color-ring', '--ring'],
      ['--color-sidebar-primary', '--sidebar-primary'],
      ['--color-sidebar-ring', '--sidebar-ring'],
    ]) {
      expect(decl.get(color), color).toBe(`hsl(var(${token}))`);
    }
  });
});
