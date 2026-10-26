/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Theme Engine
 *
 * Converts a spec-aligned Theme JSON into CSS custom properties
 * that can be injected into the DOM. Also handles theme inheritance
 * (extends), media-query-aware mode resolution, and token merging.
 *
 * @module theme
 * @packageDocumentation
 */

import type { Theme, ColorPalette, ThemeMode } from '@object-ui/types';

// ============================================================================
// Color Utilities
// ============================================================================

/**
 * Convert a hex color (#RRGGBB or #RGB) to an HSL string "H S% L%".
 * Returns null if the input is not a valid hex color.
 */
export function hexToHSL(hex: string): string | null {
  // Expand shorthand (#RGB → #RRGGBB)
  let clean = hex.replace(/^#/, '');
  if (clean.length === 3) {
    clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
  }
  const match = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(clean);
  if (!match) return null;

  const r = parseInt(match[1], 16) / 255;
  const g = parseInt(match[2], 16) / 255;
  const b = parseInt(match[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Detect if a color string is a hex value.
 */
function isHex(color: string): boolean {
  return /^#([a-f\d]{3}|[a-f\d]{6})$/i.test(color);
}

/**
 * Convert a color to a CSS-ready value.
 * - Hex colors → HSL format for Shadcn CSS variable compatibility
 * - Non-hex colors → passed through as-is (rgb, hsl, oklch, etc.)
 */
export function toCSSColor(color: string): string {
  if (isHex(color)) {
    return hexToHSL(color) ?? color;
  }
  return color;
}

// ============================================================================
// Theme → CSS Variable Mapping
// ============================================================================

/**
 * Mapping from spec ColorPalette keys → Shadcn CSS variable names.
 *
 * The spec uses semantic names (primary, secondary, error, text, surface, etc.)
 * while Shadcn uses its own naming (--primary, --secondary, --destructive, etc.)
 * This maps the spec keys to the closest Shadcn equivalent.
 */
const COLOR_TO_CSS_MAP: Record<keyof ColorPalette, string | string[]> = {
  primary: '--primary',
  secondary: '--secondary',
  accent: '--accent',
  success: '--success',
  warning: '--warning',
  error: '--destructive',
  info: '--info',
  background: '--background',
  surface: '--card',
  text: '--foreground',
  textSecondary: '--muted-foreground',
  border: '--border',
  disabled: '--muted',
  primaryLight: '--primary-light',
  primaryDark: '--primary-dark',
  secondaryLight: '--secondary-light',
  secondaryDark: '--secondary-dark',
};

/**
 * Generate CSS custom properties from a Theme's color palette.
 */
export function generateColorVars(colors: ColorPalette): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const [key, cssVar] of Object.entries(COLOR_TO_CSS_MAP)) {
    const value = colors[key as keyof ColorPalette];
    if (value) {
      const cssValue = toCSSColor(value);
      if (Array.isArray(cssVar)) {
        for (const v of cssVar) {
          vars[v] = cssValue;
        }
      } else {
        vars[cssVar] = cssValue;
      }
    }
  }

  return vars;
}

/**
 * Generate CSS custom properties from a Theme's typography config.
 */
// ----------------------------------------------------------------------------
// RETIRED THEME BLOCKS — @objectstack/spec 17.0.0-rc.3 (objectstack#5021 option
// 2, PR objectstack#5289), objectui#3361.
//
// `theme.animation`, `theme.zIndex` and five typography groups
// (`fontSize` / `fontWeight` / `lineHeight` / `letterSpacing`, plus
// `fontFamily.heading` / `fontFamily.mono`) became TOMBSTONES: the schema now
// rejects them by name and their prescription points at `theme.customVars`, the
// declared — and since objectstack-ai/objectstack#5021 the only — door for a custom property. A
// `--z-modal` or a `--duration-fast` is authored there now, emitted verbatim as
// `--<key>: <value>`.
//
// The emission code below them was therefore structurally dead: no author can
// produce the input that would reach it. It is removed rather than left behind
// a cast, because the tombstoned keys type as `never` and any cast that made
// them compile would fossilize a shape the contract has withdrawn (AGENTS.md
// #0.1). LIVE emission — `colors`, `borderRadius`, `shadows`,
// `typography.fontFamily.base` (→ `--font-sans`) and `customVars` — is
// untouched, byte for byte.
// ----------------------------------------------------------------------------

export function generateTypographyVars(typography: NonNullable<Theme['typography']>): Record<string, string> {
  const vars: Record<string, string> = {};

  // `fontFamily.base` is the only surviving typography input — see the RETIRED
  // THEME BLOCKS note above for where the other five groups went.
  if (typography.fontFamily?.base) {
    vars['--font-sans'] = typography.fontFamily.base;
  }

  return vars;
}

/**
 * Generate CSS custom properties from a Theme's border radius config.
 */
export function generateBorderRadiusVars(borderRadius: NonNullable<Theme['borderRadius']>): Record<string, string> {
  const vars: Record<string, string> = {};
  const map: Record<string, string> = {
    none: '--radius-none',
    sm: '--radius-sm',
    base: '--radius',
    md: '--radius-md',
    lg: '--radius-lg',
    xl: '--radius-xl',
    '2xl': '--radius-2xl',
    full: '--radius-full',
  };

  for (const [key, cssVar] of Object.entries(map)) {
    const value = borderRadius[key as keyof typeof borderRadius];
    if (value) vars[cssVar] = value;
  }

  return vars;
}

/**
 * Generate CSS custom properties from a Theme's shadow config.
 */
export function generateShadowVars(shadows: NonNullable<Theme['shadows']>): Record<string, string> {
  const vars: Record<string, string> = {};
  const map: Record<string, string> = {
    none: '--shadow-none',
    sm: '--shadow-sm',
    base: '--shadow',
    md: '--shadow-md',
    lg: '--shadow-lg',
    xl: '--shadow-xl',
    '2xl': '--shadow-2xl',
    inner: '--shadow-inner',
  };

  for (const [key, cssVar] of Object.entries(map)) {
    const value = shadows[key as keyof typeof shadows];
    if (value) vars[cssVar] = value;
  }

  return vars;
}

/**
 * Generate ALL CSS custom properties from a complete Theme.
 * This is the main entry point for theme → CSS conversion.
 */
export function generateThemeVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};

  // Colors (always present — colors.primary is required)
  Object.assign(vars, generateColorVars(theme.colors));

  // Typography
  if (theme.typography) {
    Object.assign(vars, generateTypographyVars(theme.typography));
  }

  // Border Radius
  if (theme.borderRadius) {
    Object.assign(vars, generateBorderRadiusVars(theme.borderRadius));
  }

  // Shadows
  if (theme.shadows) {
    Object.assign(vars, generateShadowVars(theme.shadows));
  }

  // Custom CSS variables (passthrough)
  if (theme.customVars) {
    for (const [key, value] of Object.entries(theme.customVars)) {
      // Ensure CSS variable prefix
      const varName = key.startsWith('--') ? key : `--${key}`;
      vars[varName] = value;
    }
  }

  return vars;
}

// ============================================================================
// Theme Inheritance
// ============================================================================

/**
 * Deep-merge two Theme objects. The `child` overrides the `parent`.
 * Only defined properties in child override; undefined falls back to parent.
 */
export function mergeThemes(parent: Theme, child: Partial<Theme>): Theme {
  return {
    ...parent,
    ...child,
    // Deep-merge colors
    colors: {
      ...parent.colors,
      ...(child.colors ?? {}),
    },
    // Deep-merge typography
    typography: child.typography || parent.typography
      ? {
          ...parent.typography,
          ...child.typography,
          fontFamily: {
            ...parent.typography?.fontFamily,
            ...child.typography?.fontFamily,
          },
        }
      : undefined,
    // Deep-merge border radius
    borderRadius: child.borderRadius || parent.borderRadius
      ? { ...parent.borderRadius, ...child.borderRadius }
      : undefined,
    // Deep-merge shadows
    shadows: child.shadows || parent.shadows
      ? { ...parent.shadows, ...child.shadows }
      : undefined,
    // Deep-merge customVars
    customVars: child.customVars || parent.customVars
      ? { ...parent.customVars, ...child.customVars }
      : undefined,
  };
}

/**
 * Resolve theme inheritance from a registry of themes.
 * If a theme has `extends`, the parent is looked up and merged recursively.
 *
 * @param theme - The theme to resolve
 * @param registry - Map of theme name → Theme
 * @param visited - Set of already-visited names (cycle detection)
 * @returns The fully resolved theme
 */
export function resolveThemeInheritance(
  theme: Theme,
  registry: Map<string, Theme>,
  visited: Set<string> = new Set(),
): Theme {
  if (!theme.extends) return theme;

  // Cycle detection
  if (visited.has(theme.name)) return theme;
  visited.add(theme.name);

  const parent = registry.get(theme.extends);
  if (!parent) return theme;

  // Recursively resolve parent first
  const resolvedParent = resolveThemeInheritance(parent, registry, visited);

  return mergeThemes(resolvedParent, theme);
}

// ============================================================================
// Mode Resolution
// ============================================================================

/**
 * Resolve the effective mode from a ThemeMode value.
 * 'auto' checks the system preference (prefers-color-scheme).
 *
 * @param mode - The declared mode
 * @param systemDark - Whether the system prefers dark mode (for SSR or testing)
 * @returns 'light' or 'dark'
 */
export function resolveMode(
  mode: ThemeMode = 'auto',
  systemDark?: boolean,
): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;

  // 'auto' — check system preference
  if (systemDark !== undefined) return systemDark ? 'dark' : 'light';

  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  return 'light'; // fallback
}

// ============================================================================
// WCAG Contrast Checking (v2.0.7)
// ============================================================================

/**
 * Parse a hex color string to RGB values [0-255].
 */
function hexToRGB(hex: string): [number, number, number] | null {
  let clean = hex.replace(/^#/, '');
  if (clean.length === 3) {
    clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
  }
  const match = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(clean);
  if (!match) return null;
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

/**
 * Calculate relative luminance per WCAG 2.1 spec.
 * @see https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate the WCAG 2.1 contrast ratio between two hex colors.
 * Returns a value between 1 and 21.
 *
 * @param hex1 - First color in hex format (#RGB or #RRGGBB)
 * @param hex2 - Second color in hex format (#RGB or #RRGGBB)
 * @returns Contrast ratio (1-21), or null if colors are invalid
 */
export function contrastRatio(hex1: string, hex2: string): number | null {
  const rgb1 = hexToRGB(hex1);
  const rgb2 = hexToRGB(hex2);
  if (!rgb1 || !rgb2) return null;

  const l1 = relativeLuminance(...rgb1);
  const l2 = relativeLuminance(...rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if two colors meet the specified WCAG contrast level.
 *
 * WCAG levels:
 * - AA: 4.5:1 for normal text, 3:1 for large text
 * - AAA: 7:1 for normal text, 4.5:1 for large text
 *
 * @param hex1 - First color in hex format
 * @param hex2 - Second color in hex format
 * @param level - WCAG level: 'AA' or 'AAA'
 * @param isLargeText - Whether the text is large (18pt+ or 14pt+ bold)
 * @returns true if the color pair meets the required contrast level
 */
export function meetsContrastLevel(
  hex1: string,
  hex2: string,
  level: 'AA' | 'AAA' = 'AA',
  isLargeText = false,
): boolean {
  const ratio = contrastRatio(hex1, hex2);
  if (ratio === null) return false;

  if (level === 'AAA') {
    return isLargeText ? ratio >= 4.5 : ratio >= 7;
  }
  // AA
  return isLargeText ? ratio >= 3 : ratio >= 4.5;
}
