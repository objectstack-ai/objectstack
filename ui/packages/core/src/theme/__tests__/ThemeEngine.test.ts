/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Theme } from '@object-ui/types';
import {
  hexToHSL,
  toCSSColor,
  generateColorVars,
  generateTypographyVars,
  generateBorderRadiusVars,
  generateShadowVars,
  generateThemeVars,
  mergeThemes,
  resolveThemeInheritance,
  resolveMode,
  contrastRatio,
  meetsContrastLevel,
} from '../ThemeEngine';

// ============================================================================
// Test Fixtures
// ============================================================================

const baseTheme: Theme = {
  name: 'default',
  label: 'Default',
  mode: 'auto',
  colors: {
    primary: '#3B82F6',
    secondary: '#64748B',
    accent: '#F59E0B',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#3B82F6',
    background: '#FFFFFF',
    surface: '#F8FAFC',
    text: '#0F172A',
    textSecondary: '#64748B',
    border: '#E2E8F0',
    disabled: '#94A3B8',
  },
  // Only `fontFamily.base` survives. `fontFamily.heading` / `.mono`, `fontSize`,
  // `fontWeight`, `lineHeight` and `letterSpacing` were retired in
  // @objectstack/spec 17.0.0-rc.3 (objectstack#5021) — the schema rejects them
  // by name now, so a fixture carrying them would be asserting against metadata
  // no author can write. `customVars` below is the declared door they point at.
  typography: {
    fontFamily: {
      base: 'Inter, sans-serif',
    },
  },
  borderRadius: {
    none: '0',
    sm: '0.125rem',
    base: '0.25rem',
    md: '0.375rem',
    lg: '0.5rem',
    xl: '0.75rem',
    '2xl': '1rem',
    full: '9999px',
  },
  shadows: {
    none: 'none',
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    base: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
    xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
    inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
  },
};

// ============================================================================
// hexToHSL
// ============================================================================

describe('hexToHSL', () => {
  it('should convert #000000 to "0 0% 0%"', () => {
    expect(hexToHSL('#000000')).toBe('0 0% 0%');
  });

  it('should convert #FFFFFF to "0 0% 100%"', () => {
    expect(hexToHSL('#FFFFFF')).toBe('0 0% 100%');
  });

  it('should convert #FF0000 to red HSL', () => {
    expect(hexToHSL('#FF0000')).toBe('0 100% 50%');
  });

  it('should convert #3B82F6 (blue)', () => {
    const result = hexToHSL('#3B82F6');
    expect(result).toBeTruthy();
    expect(result).toMatch(/^\d+ \d+% \d+%$/);
  });

  it('should handle shorthand hex #F00', () => {
    expect(hexToHSL('#F00')).toBe('0 100% 50%');
  });

  it('should handle hex without #', () => {
    expect(hexToHSL('FF0000')).toBe('0 100% 50%');
  });

  it('should return null for invalid hex', () => {
    expect(hexToHSL('not-a-color')).toBeNull();
    expect(hexToHSL('#GGHHII')).toBeNull();
    expect(hexToHSL('')).toBeNull();
  });
});

// ============================================================================
// toCSSColor
// ============================================================================

describe('toCSSColor', () => {
  it('should convert hex to HSL', () => {
    expect(toCSSColor('#FF0000')).toBe('0 100% 50%');
  });

  it('should pass through rgb() values', () => {
    expect(toCSSColor('rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)');
  });

  it('should pass through hsl() values', () => {
    expect(toCSSColor('hsl(0, 100%, 50%)')).toBe('hsl(0, 100%, 50%)');
  });

  it('should pass through oklch() values', () => {
    expect(toCSSColor('oklch(0.7 0.15 30)')).toBe('oklch(0.7 0.15 30)');
  });
});

// ============================================================================
// generateColorVars
// ============================================================================

describe('generateColorVars', () => {
  it('should generate --primary from colors.primary', () => {
    const vars = generateColorVars({ primary: '#3B82F6' });
    expect(vars['--primary']).toBeTruthy();
  });

  it('should map error → --destructive', () => {
    const vars = generateColorVars({ primary: '#000', error: '#EF4444' });
    expect(vars['--destructive']).toBeTruthy();
  });

  it('should map surface → --card', () => {
    const vars = generateColorVars({ primary: '#000', surface: '#F8FAFC' });
    expect(vars['--card']).toBeTruthy();
  });

  it('should map text → --foreground', () => {
    const vars = generateColorVars({ primary: '#000', text: '#0F172A' });
    expect(vars['--foreground']).toBeTruthy();
  });

  it('should map textSecondary → --muted-foreground', () => {
    const vars = generateColorVars({ primary: '#000', textSecondary: '#64748B' });
    expect(vars['--muted-foreground']).toBeTruthy();
  });

  it('should skip undefined color fields', () => {
    const vars = generateColorVars({ primary: '#000' });
    expect(Object.keys(vars)).toHaveLength(1);
  });

  it('should generate all vars for a complete palette', () => {
    const vars = generateColorVars(baseTheme.colors);
    expect(Object.keys(vars).length).toBeGreaterThanOrEqual(10);
  });
});

// ============================================================================
// generateTypographyVars
// ============================================================================

describe('generateTypographyVars', () => {
  it('should generate --font-sans from fontFamily.base', () => {
    const vars = generateTypographyVars({ fontFamily: { base: 'Inter' } });
    expect(vars['--font-sans']).toBe('Inter');
  });

  it('should handle complete typography config', () => {
    const vars = generateTypographyVars(baseTheme.typography!);
    expect(vars).toEqual({ '--font-sans': 'Inter, sans-serif' });
  });

  // NEGATIVE CONTROL for objectstack#5021 / objectui#3361. The six retired
  // typography groups must not be emitted even when a stale theme still carries
  // them — an author cannot write them any more, and an engine that kept
  // emitting them would be serving a contract the platform has withdrawn. Fed
  // through a cast because the type no longer admits these keys at all, which
  // is the point: this asserts the RUNTIME behaviour behind the type.
  it('emits nothing for the retired typography groups (objectstack#5021)', () => {
    const stale = {
      fontFamily: { base: 'Inter', heading: 'Georgia', mono: 'Fira Code' },
      fontSize: { xs: '0.75rem', base: '1rem' },
      fontWeight: { bold: 700 },
      lineHeight: { tight: '1.25' },
      letterSpacing: { wide: '0.025em' },
    } as unknown as NonNullable<Theme['typography']>;
    const vars = generateTypographyVars(stale);

    // Positive control in the same run: the surviving key still emits, so an
    // accidental gutting of this function cannot pass as a clean retirement.
    expect(vars['--font-sans']).toBe('Inter');
    expect(vars).toEqual({ '--font-sans': 'Inter' });
  });
});

// ============================================================================
// generateBorderRadiusVars
// ============================================================================

describe('generateBorderRadiusVars', () => {
  it('should map base → --radius', () => {
    const vars = generateBorderRadiusVars({ base: '0.25rem' });
    expect(vars['--radius']).toBe('0.25rem');
  });

  it('should map all radius keys', () => {
    const vars = generateBorderRadiusVars(baseTheme.borderRadius!);
    expect(vars['--radius-none']).toBe('0');
    expect(vars['--radius-sm']).toBe('0.125rem');
    expect(vars['--radius']).toBe('0.25rem');
    expect(vars['--radius-lg']).toBe('0.5rem');
    expect(vars['--radius-full']).toBe('9999px');
  });

  it('should skip undefined radius values', () => {
    const vars = generateBorderRadiusVars({ lg: '0.5rem' });
    expect(Object.keys(vars)).toHaveLength(1);
  });
});

// ============================================================================
// generateShadowVars
// ============================================================================

describe('generateShadowVars', () => {
  it('should map base → --shadow', () => {
    const vars = generateShadowVars({ base: '0 1px 3px 0 rgb(0 0 0 / 0.1)' });
    expect(vars['--shadow']).toBe('0 1px 3px 0 rgb(0 0 0 / 0.1)');
  });

  it('should map all shadow keys', () => {
    const vars = generateShadowVars(baseTheme.shadows!);
    expect(vars['--shadow-none']).toBe('none');
    expect(vars['--shadow-inner']).toBeTruthy();
    expect(vars['--shadow-lg']).toBeTruthy();
  });
});

// ============================================================================
// generateThemeVars (integration)
// ============================================================================

describe('generateThemeVars', () => {
  it('should generate vars from a minimal theme', () => {
    const minimal: Theme = {
      name: 'minimal',
      label: 'Minimal',
      colors: { primary: '#3B82F6' },
    };
    const vars = generateThemeVars(minimal);
    expect(vars['--primary']).toBeTruthy();
    expect(Object.keys(vars).length).toBe(1);
  });

  it('should generate vars from a complete theme', () => {
    const vars = generateThemeVars(baseTheme);
    // Colors + Typography(fontFamily.base) + BorderRadius + Shadows.
    // Animation and ZIndex are gone with objectstack#5021 — see the RETIRED
    // THEME BLOCKS note in ThemeEngine.ts.
    expect(Object.keys(vars).length).toBeGreaterThan(20);
  });

  // NEGATIVE CONTROL for objectstack#5021 / objectui#3361: a stale theme that
  // still carries `animation` / `zIndex` must contribute NO variable. Before
  // the retirement these produced `--duration-*`, `--timing-*` and `--z-*`.
  it('emits no --duration-*, --timing-* or --z-* for a stale theme', () => {
    const stale = {
      name: 'stale',
      label: 'Stale',
      colors: { primary: '#000' },
      animation: {
        duration: { fast: '150ms' },
        timing: { ease: 'linear' },
      },
      zIndex: { base: 0, modal: 1400 },
    } as unknown as Theme;
    const vars = generateThemeVars(stale);

    const retired = Object.keys(vars).filter(
      (k) => k.startsWith('--duration-') || k.startsWith('--timing-') || k.startsWith('--z-'),
    );
    expect(retired).toEqual([]);

    // Positive control in the same run: the live half still emits, so this
    // cannot pass merely because nothing was generated at all.
    expect(vars['--primary']).toBeTruthy();
  });

  // The retirement's own prescription: `customVars` is the declared door for a
  // `--z-modal` or a `--duration-fast` now, and it still works.
  it('customVars carries what the retired blocks used to (the prescribed door)', () => {
    const theme = {
      name: 'via_custom_vars',
      label: 'Via customVars',
      colors: { primary: '#000' },
      customVars: { 'z-modal': '1400', '--duration-fast': '150ms' },
    } as Theme;
    const vars = generateThemeVars(theme);
    expect(vars['--z-modal']).toBe('1400');
    expect(vars['--duration-fast']).toBe('150ms');
  });

  it('should include customVars with -- prefix', () => {
    const theme: Theme = {
      name: 'custom',
      label: 'Custom',
      colors: { primary: '#000' },
      customVars: {
        '--sidebar-width': '280px',
        'header-height': '64px',
      },
    };
    const vars = generateThemeVars(theme);
    expect(vars['--sidebar-width']).toBe('280px');
    expect(vars['--header-height']).toBe('64px');
  });
});

// ============================================================================
// mergeThemes
// ============================================================================

describe('mergeThemes', () => {
  const parent: Theme = {
    name: 'parent',
    label: 'Parent',
    colors: { primary: '#000', secondary: '#111' },
    typography: {
      fontFamily: { base: 'Arial' },
    },
    borderRadius: { sm: '2px', lg: '8px' },
  };

  it('should override top-level scalar fields', () => {
    const merged = mergeThemes(parent, { label: 'Child', description: 'A child theme' } as Partial<Theme>);
    expect(merged.label).toBe('Child');
    expect(merged.description).toBe('A child theme');
    expect(merged.name).toBe('parent');
  });

  it('should deep-merge colors', () => {
    const merged = mergeThemes(parent, {
      colors: { primary: '#FFF', accent: '#F00' },
    } as Partial<Theme>);
    expect(merged.colors.primary).toBe('#FFF');
    expect(merged.colors.secondary).toBe('#111'); // from parent
    expect(merged.colors.accent).toBe('#F00'); // from child
  });

  // `fontFamily.heading` was the child override here until objectstack#5021
  // retired it; `base` is the surviving key, so the deep-merge is exercised
  // through an override of it instead of through a key no author can write.
  it('should deep-merge typography.fontFamily', () => {
    const merged = mergeThemes(parent, {
      typography: {
        fontFamily: { base: 'Georgia' },
      },
    } as Partial<Theme>);
    expect(merged.typography?.fontFamily?.base).toBe('Georgia'); // from child
  });

  it('should preserve the parent fontFamily when the child omits typography', () => {
    const merged = mergeThemes(parent, { colors: { primary: '#FFF' } } as Partial<Theme>);
    expect(merged.typography?.fontFamily?.base).toBe('Arial');
  });

  // `should deep-merge typography.fontSize` REMOVED with the `fontSize` group
  // (objectstack#5021). `mergeThemes` no longer has a `fontSize` limb to merge.

  it('should deep-merge borderRadius', () => {
    const merged = mergeThemes(parent, {
      borderRadius: { sm: '4px', xl: '16px' },
    } as Partial<Theme>);
    expect(merged.borderRadius?.sm).toBe('4px'); // overridden
    expect(merged.borderRadius?.lg).toBe('8px'); // from parent
    expect(merged.borderRadius?.xl).toBe('16px'); // new
  });

  // `should deep-merge zIndex` REMOVED with the `zIndex` block
  // (objectstack#5021). `mergeThemes` no longer carries a `zIndex` limb, and a
  // theme that still declares one is rejected by the schema before it could
  // reach a merge. `customVars` merges in its place and is covered below.
  it('should deep-merge customVars — the door the retired blocks point at', () => {
    const withVars = { ...parent, customVars: { 'z-base': '0', 'z-modal': '1400' } } as Theme;
    const merged = mergeThemes(withVars, {
      customVars: { 'z-tooltip': '9999', 'z-modal': '1500' },
    } as Partial<Theme>);
    expect(merged.customVars?.['z-base']).toBe('0'); // from parent
    expect(merged.customVars?.['z-modal']).toBe('1500'); // overridden
    expect(merged.customVars?.['z-tooltip']).toBe('9999'); // from child
  });

  it('should preserve parent when child has no field', () => {
    const merged = mergeThemes(parent, { colors: { primary: '#FFF' } } as Partial<Theme>);
    expect(merged.borderRadius).toEqual(parent.borderRadius);
    expect(merged.typography).toBeDefined();
  });
});

// ============================================================================
// resolveThemeInheritance
// ============================================================================

describe('resolveThemeInheritance', () => {
  it('should return the theme as-is when no extends', () => {
    const theme: Theme = { name: 'solo', label: 'Solo', colors: { primary: '#000' } };
    const registry = new Map([['solo', theme]]);
    expect(resolveThemeInheritance(theme, registry)).toBe(theme);
  });

  it('should merge parent when extends is set', () => {
    const parent: Theme = {
      name: 'parent',
      label: 'Parent',
      colors: { primary: '#000', secondary: '#111' },
      borderRadius: { lg: '8px' },
    };
    const child: Theme = {
      name: 'child',
      label: 'Child',
      colors: { primary: '#FFF' },
      extends: 'parent',
    };
    const registry = new Map([['parent', parent], ['child', child]]);
    const resolved = resolveThemeInheritance(child, registry);
    expect(resolved.colors.primary).toBe('#FFF');
    expect(resolved.colors.secondary).toBe('#111');
    expect(resolved.borderRadius?.lg).toBe('8px');
  });

  it('should resolve multi-level inheritance', () => {
    const grandparent: Theme = {
      name: 'gp',
      label: 'Grandparent',
      colors: { primary: '#000', accent: '#AAA' },
    };
    const parent: Theme = {
      name: 'parent',
      label: 'Parent',
      colors: { primary: '#111' },
      extends: 'gp',
    };
    const child: Theme = {
      name: 'child',
      label: 'Child',
      colors: { primary: '#FFF' },
      extends: 'parent',
    };
    const registry = new Map([
      ['gp', grandparent],
      ['parent', parent],
      ['child', child],
    ]);
    const resolved = resolveThemeInheritance(child, registry);
    expect(resolved.colors.primary).toBe('#FFF'); // child
    expect(resolved.colors.accent).toBe('#AAA'); // grandparent
  });

  it('should handle missing parent gracefully', () => {
    const child: Theme = {
      name: 'orphan',
      label: 'Orphan',
      colors: { primary: '#000' },
      extends: 'nonexistent',
    };
    const registry = new Map([['orphan', child]]);
    const resolved = resolveThemeInheritance(child, registry);
    expect(resolved.name).toBe('orphan');
    expect(resolved.colors.primary).toBe('#000');
  });

  it('should detect and break circular inheritance', () => {
    const a: Theme = { name: 'a', label: 'A', colors: { primary: '#000' }, extends: 'b' };
    const b: Theme = { name: 'b', label: 'B', colors: { primary: '#111' }, extends: 'a' };
    const registry = new Map([['a', a], ['b', b]]);
    // Should not infinite loop
    const resolved = resolveThemeInheritance(a, registry);
    expect(resolved.name).toBeDefined();
  });
});

// ============================================================================
// resolveMode
// ============================================================================

describe('resolveMode', () => {
  it('should return "light" for mode="light"', () => {
    expect(resolveMode('light')).toBe('light');
  });

  it('should return "dark" for mode="dark"', () => {
    expect(resolveMode('dark')).toBe('dark');
  });

  it('should resolve "auto" using systemDark=true', () => {
    expect(resolveMode('auto', true)).toBe('dark');
  });

  it('should resolve "auto" using systemDark=false', () => {
    expect(resolveMode('auto', false)).toBe('light');
  });

  it('should default to "light" when mode is undefined', () => {
    expect(resolveMode(undefined, false)).toBe('light');
  });

  it('should use matchMedia when systemDark is not provided', () => {
    // Mock matchMedia
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
    }));
    expect(resolveMode('auto')).toBe('dark');
    window.matchMedia = original;
  });

  it('should fallback to "light" when no matchMedia', () => {
    const original = window.matchMedia;
    // @ts-expect-error testing fallback
    window.matchMedia = undefined;
    expect(resolveMode('auto')).toBe('light');
    window.matchMedia = original;
  });
});

// ============================================================================
// WCAG Contrast Checking (v2.0.7)
// ============================================================================

describe('contrastRatio', () => {
  it('should return 21 for black and white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('should return 1 for identical colors', () => {
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 1);
  });

  it('should return null for invalid hex', () => {
    expect(contrastRatio('invalid', '#000000')).toBeNull();
    expect(contrastRatio('#000000', 'xyz')).toBeNull();
  });

  it('should handle shorthand hex (#RGB)', () => {
    const ratio = contrastRatio('#000', '#fff');
    expect(ratio).toBeCloseTo(21, 0);
  });

  it('should be order-independent', () => {
    const ratio1 = contrastRatio('#000000', '#336699');
    const ratio2 = contrastRatio('#336699', '#000000');
    expect(ratio1).toBe(ratio2);
  });
});

describe('meetsContrastLevel', () => {
  it('should pass AA for black on white (normal text)', () => {
    expect(meetsContrastLevel('#000000', '#ffffff', 'AA')).toBe(true);
  });

  it('should pass AAA for black on white (normal text)', () => {
    expect(meetsContrastLevel('#000000', '#ffffff', 'AAA')).toBe(true);
  });

  it('should fail AA for similar grays', () => {
    // #777 on #999 gives ~1.6:1 ratio
    expect(meetsContrastLevel('#777777', '#999999', 'AA')).toBe(false);
  });

  it('should use lower threshold for large text (AA)', () => {
    // #767676 on white gives ~4.54:1 (passes AA normal, passes AA large)
    expect(meetsContrastLevel('#767676', '#ffffff', 'AA', false)).toBe(true);
    expect(meetsContrastLevel('#767676', '#ffffff', 'AA', true)).toBe(true);
  });

  it('should use lower threshold for large text (AAA)', () => {
    // Black on white: 21:1 — passes both
    expect(meetsContrastLevel('#000000', '#ffffff', 'AAA', true)).toBe(true);
  });

  it('should return false for invalid colors', () => {
    expect(meetsContrastLevel('invalid', '#ffffff', 'AA')).toBe(false);
  });
});
