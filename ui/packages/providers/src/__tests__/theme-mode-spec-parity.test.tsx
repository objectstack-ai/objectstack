/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Theme mode ↔ vocabulary parity + behavior (#2942).
 *
 * The vocabulary's OS-following mode is `auto`; this provider branched on its
 * pre-spec `system` spelling only, so `mode: 'auto'` fell into
 * `classList.add('auto')` — a class no Tailwind variant matches. The page
 * locked to the light theme, the OS preference was ignored, and nothing
 * errored.
 *
 * The vocabulary read here came from the spec's `ThemeModeSchema` until the
 * spec retired its theme module (objectstack#10485) and the objectui#5716
 * ruling moved ownership to `@object-ui/types` — `THEME_MODES` is the owner's
 * runtime witness, kept as a tuple precisely so this parity coverage stays
 * executable (the `SPEC_GESTURE_TYPES` precedent).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { THEME_MODES } from '@object-ui/types';
import { ThemeProvider } from '../ThemeProvider';

function mockMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: prefersDark,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  });
}

describe('ThemeProvider covers the theme-mode vocabulary', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    window.localStorage?.clear?.();
    mockMatchMedia(true);
  });

  it('reads a non-empty mode tuple from the owner', () => {
    expect(Array.isArray(THEME_MODES) && THEME_MODES.length > 0, 'could not read THEME_MODES').toBe(true);
  });

  it('every declared mode resolves to a real light/dark class — never a dead literal', () => {
    for (const mode of THEME_MODES) {
      document.documentElement.className = '';
      const { unmount } = render(
        <ThemeProvider defaultTheme={mode as never} storageKey={`t-${mode}`}>
          <div />
        </ThemeProvider>,
      );
      const classes = [...document.documentElement.classList];
      expect(
        classes.some((c) => c === 'light' || c === 'dark'),
        `mode '${mode}' must resolve to light/dark, got [${classes.join(', ')}]`,
      ).toBe(true);
      expect(classes, `mode '${mode}' leaked a dead class`).not.toContain(mode === 'auto' ? 'auto' : '__never__');
      unmount();
    }
  });

  it("'auto' follows the OS preference (dark here)", () => {
    render(
      <ThemeProvider defaultTheme={'auto' as never} storageKey="t-auto-dark">
        <div />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it("legacy 'system' keeps following the OS preference", () => {
    render(
      <ThemeProvider defaultTheme="system" storageKey="t-system">
        <div />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
