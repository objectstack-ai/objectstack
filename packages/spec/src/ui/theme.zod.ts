// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { TouchTargetConfigSchema } from './touch.zod';
import { FocusManagementSchema } from './keyboard.zod';

/**
 * Color Palette Schema
 * Defines brand colors and their variants.
 */
import { lazySchema } from '../shared/lazy-schema';
export const ColorPaletteSchema = lazySchema(() => z.object({
  primary: z.string().describe('Primary brand color (hex, rgb, or hsl)'),
  secondary: z.string().optional().describe('Secondary brand color'),
  accent: z.string().optional().describe('Accent color for highlights'),
  success: z.string().optional().describe('Success state color (default: green)'),
  warning: z.string().optional().describe('Warning state color (default: yellow)'),
  error: z.string().optional().describe('Error state color (default: red)'),
  info: z.string().optional().describe('Info state color (default: blue)'),
  
  // Neutral colors
  background: z.string().optional().describe('Background color'),
  surface: z.string().optional().describe('Surface/card background color'),
  text: z.string().optional().describe('Primary text color'),
  textSecondary: z.string().optional().describe('Secondary text color'),
  border: z.string().optional().describe('Border color'),
  disabled: z.string().optional().describe('Disabled state color'),
  
  // Color variants (shades)
  primaryLight: z.string().optional().describe('Lighter shade of primary'),
  primaryDark: z.string().optional().describe('Darker shade of primary'),
  secondaryLight: z.string().optional().describe('Lighter shade of secondary'),
  secondaryDark: z.string().optional().describe('Darker shade of secondary'),
}));

/**
 * Typography Settings Schema
 * Font families, sizes, weights, and line heights.
 */
export const TypographySchema = lazySchema(() => z.object({
  fontFamily: z.object({
    base: z.string().optional().describe('Base font family (default: system fonts)'),
    heading: z.string().optional().describe('Heading font family'),
    mono: z.string().optional().describe('Monospace font family for code'),
  }).optional(),
  
  fontSize: z.object({
    xs: z.string().optional().describe('Extra small font size (e.g., 0.75rem)'),
    sm: z.string().optional().describe('Small font size (e.g., 0.875rem)'),
    base: z.string().optional().describe('Base font size (e.g., 1rem)'),
    lg: z.string().optional().describe('Large font size (e.g., 1.125rem)'),
    xl: z.string().optional().describe('Extra large font size (e.g., 1.25rem)'),
    '2xl': z.string().optional().describe('2X large font size (e.g., 1.5rem)'),
    '3xl': z.string().optional().describe('3X large font size (e.g., 1.875rem)'),
    '4xl': z.string().optional().describe('4X large font size (e.g., 2.25rem)'),
  }).optional(),
  
  fontWeight: z.object({
    light: z.number().optional().describe('Light weight (default: 300)'),
    normal: z.number().optional().describe('Normal weight (default: 400)'),
    medium: z.number().optional().describe('Medium weight (default: 500)'),
    semibold: z.number().optional().describe('Semibold weight (default: 600)'),
    bold: z.number().optional().describe('Bold weight (default: 700)'),
  }).optional(),
  
  lineHeight: z.object({
    tight: z.string().optional().describe('Tight line height (e.g., 1.25)'),
    normal: z.string().optional().describe('Normal line height (e.g., 1.5)'),
    relaxed: z.string().optional().describe('Relaxed line height (e.g., 1.75)'),
    loose: z.string().optional().describe('Loose line height (e.g., 2)'),
  }).optional(),
  
  letterSpacing: z.object({
    tighter: z.string().optional().describe('Tighter letter spacing (e.g., -0.05em)'),
    tight: z.string().optional().describe('Tight letter spacing (e.g., -0.025em)'),
    normal: z.string().optional().describe('Normal letter spacing (e.g., 0)'),
    wide: z.string().optional().describe('Wide letter spacing (e.g., 0.025em)'),
    wider: z.string().optional().describe('Wider letter spacing (e.g., 0.05em)'),
  }).optional(),
}));

/**
 * Spacing Units Schema
 * Defines spacing scale for margins, padding, gaps.
 */
export const SpacingSchema = lazySchema(() => z.object({
  '0': z.string().optional().describe('0 spacing (0)'),
  '1': z.string().optional().describe('Spacing unit 1 (e.g., 0.25rem)'),
  '2': z.string().optional().describe('Spacing unit 2 (e.g., 0.5rem)'),
  '3': z.string().optional().describe('Spacing unit 3 (e.g., 0.75rem)'),
  '4': z.string().optional().describe('Spacing unit 4 (e.g., 1rem)'),
  '5': z.string().optional().describe('Spacing unit 5 (e.g., 1.25rem)'),
  '6': z.string().optional().describe('Spacing unit 6 (e.g., 1.5rem)'),
  '8': z.string().optional().describe('Spacing unit 8 (e.g., 2rem)'),
  '10': z.string().optional().describe('Spacing unit 10 (e.g., 2.5rem)'),
  '12': z.string().optional().describe('Spacing unit 12 (e.g., 3rem)'),
  '16': z.string().optional().describe('Spacing unit 16 (e.g., 4rem)'),
  '20': z.string().optional().describe('Spacing unit 20 (e.g., 5rem)'),
  '24': z.string().optional().describe('Spacing unit 24 (e.g., 6rem)'),
}));

/**
 * Border Radius Schema
 * Rounded corners configuration.
 */
export const BorderRadiusSchema = lazySchema(() => z.object({
  none: z.string().optional().describe('No border radius (0)'),
  sm: z.string().optional().describe('Small border radius (e.g., 0.125rem)'),
  base: z.string().optional().describe('Base border radius (e.g., 0.25rem)'),
  md: z.string().optional().describe('Medium border radius (e.g., 0.375rem)'),
  lg: z.string().optional().describe('Large border radius (e.g., 0.5rem)'),
  xl: z.string().optional().describe('Extra large border radius (e.g., 0.75rem)'),
  '2xl': z.string().optional().describe('2X large border radius (e.g., 1rem)'),
  full: z.string().optional().describe('Full border radius (50%)'),
}));

/**
 * Shadow Schema
 * Box shadow effects.
 */
export const ShadowSchema = lazySchema(() => z.object({
  none: z.string().optional().describe('No shadow'),
  sm: z.string().optional().describe('Small shadow'),
  base: z.string().optional().describe('Base shadow'),
  md: z.string().optional().describe('Medium shadow'),
  lg: z.string().optional().describe('Large shadow'),
  xl: z.string().optional().describe('Extra large shadow'),
  '2xl': z.string().optional().describe('2X large shadow'),
  inner: z.string().optional().describe('Inner shadow (inset)'),
}));

/**
 * Breakpoints Schema
 * Responsive design breakpoints.
 */
export const BreakpointsSchema = lazySchema(() => z.object({
  xs: z.string().optional().describe('Extra small breakpoint (e.g., 480px)'),
  sm: z.string().optional().describe('Small breakpoint (e.g., 640px)'),
  md: z.string().optional().describe('Medium breakpoint (e.g., 768px)'),
  lg: z.string().optional().describe('Large breakpoint (e.g., 1024px)'),
  xl: z.string().optional().describe('Extra large breakpoint (e.g., 1280px)'),
  '2xl': z.string().optional().describe('2X large breakpoint (e.g., 1536px)'),
}));

/**
 * Animation Schema
 * Animation timing and duration settings.
 */
export const AnimationSchema = lazySchema(() => z.object({
  duration: z.object({
    fast: z.string().optional().describe('Fast animation (e.g., 150ms)'),
    base: z.string().optional().describe('Base animation (e.g., 300ms)'),
    slow: z.string().optional().describe('Slow animation (e.g., 500ms)'),
  }).optional(),
  
  timing: z.object({
    linear: z.string().optional().describe('Linear timing function'),
    ease: z.string().optional().describe('Ease timing function'),
    ease_in: z.string().optional().describe('Ease-in timing function'),
    ease_out: z.string().optional().describe('Ease-out timing function'),
    ease_in_out: z.string().optional().describe('Ease-in-out timing function'),
  }).optional(),
}));

/**
 * Z-Index Scale Schema
 * Layering and stacking order.
 */
export const ZIndexSchema = lazySchema(() => z.object({
  base: z.number().optional().describe('Base z-index (e.g., 0)'),
  dropdown: z.number().optional().describe('Dropdown z-index (e.g., 1000)'),
  sticky: z.number().optional().describe('Sticky z-index (e.g., 1020)'),
  fixed: z.number().optional().describe('Fixed z-index (e.g., 1030)'),
  modalBackdrop: z.number().optional().describe('Modal backdrop z-index (e.g., 1040)'),
  modal: z.number().optional().describe('Modal z-index (e.g., 1050)'),
  popover: z.number().optional().describe('Popover z-index (e.g., 1060)'),
  tooltip: z.number().optional().describe('Tooltip z-index (e.g., 1070)'),
}));

/**
 * Theme Mode Schema
 */
export const ThemeModeSchema = lazySchema(() => z.enum(['light', 'dark', 'auto']));

/** @deprecated Use ThemeModeSchema instead */
export const ThemeMode = ThemeModeSchema;

/**
 * Density Mode Schema
 * Controls spacing and sizing for different use cases.
 */
export const DensityModeSchema = lazySchema(() => z.enum(['compact', 'regular', 'spacious']));

/** @deprecated Use DensityModeSchema instead */
export const DensityMode = DensityModeSchema;

/**
 * WCAG Contrast Level Schema
 * Web Content Accessibility Guidelines color contrast requirements.
 */
export const WcagContrastLevelSchema = lazySchema(() => z.enum(['AA', 'AAA']));

/** @deprecated Use WcagContrastLevelSchema instead */
export const WcagContrastLevel = WcagContrastLevelSchema;

/**
 * Theme Configuration Schema
 * Complete theme definition for brand customization.
 */
export const ThemeSchema = lazySchema(() => z.object({
  name: SnakeCaseIdentifierSchema.describe('Unique theme identifier (snake_case)'),
  label: z.string().describe('Human-readable theme name'),
  description: z.string().optional().describe('Theme description'),
  
  /** Theme mode */
  mode: ThemeModeSchema.default('light').describe('Theme mode (light, dark, or auto)'),
  
  /** Color system */
  colors: ColorPaletteSchema.describe('Color palette configuration'),
  
  /** Typography */
  typography: TypographySchema.optional().describe('Typography settings'),
  
  /** Spacing */
  spacing: SpacingSchema.optional().describe('Spacing scale. [EXPERIMENTAL — not enforced] generateThemeVars does not emit spacing tokens yet (liveness audit #1878/#1893).'),
  
  /** Border radius */
  borderRadius: BorderRadiusSchema.optional().describe('Border radius scale'),
  
  /** Shadows */
  shadows: ShadowSchema.optional().describe('Box shadow effects'),
  
  /** Breakpoints */
  breakpoints: BreakpointsSchema.optional().describe('Responsive breakpoints. [EXPERIMENTAL — not enforced] generateThemeVars does not emit breakpoint tokens yet (liveness audit #1878/#1893).'),
  
  /** Animation */
  animation: AnimationSchema.optional().describe('Animation settings'),
  
  /** Z-Index */
  zIndex: ZIndexSchema.optional().describe('Z-index scale for layering'),
  
  /** Custom CSS variables */
  customVars: z.record(z.string(), z.string()).optional().describe('Custom CSS variables (key-value pairs)'),
  
  /** Logo */
  logo: z.object({
    light: z.string().optional().describe('Logo URL for light mode'),
    dark: z.string().optional().describe('Logo URL for dark mode'),
    favicon: z.string().optional().describe('Favicon URL'),
  }).optional().describe('Logo assets'),
  
  /** Extends another theme */
  extends: z.string().optional().describe('Base theme to extend from'),

  /** Display density mode */
  density: DensityModeSchema.optional().describe('Display density: compact, regular, or spacious. [EXPERIMENTAL — not enforced] The theme engine does not consume theme-level density yet; view-level densityMode is a separate live setting (liveness audit #1878/#1893).'),

  /** WCAG contrast level requirement */
  wcagContrast: WcagContrastLevelSchema.optional().describe('WCAG color contrast level (AA or AAA)'),

  /** Right-to-left language support */
  rtl: z.boolean().optional().describe('Enable right-to-left layout direction. [EXPERIMENTAL — not enforced] No renderer reads theme.rtl yet (liveness audit #1878/#1893).'),

  /** Touch target accessibility configuration */
  touchTarget: TouchTargetConfigSchema.optional().describe('Touch target sizing defaults. [EXPERIMENTAL — not enforced] No renderer consumes touchTarget yet (liveness audit #1878/#1893).'),

  /** Keyboard navigation and focus management */
  keyboardNavigation: FocusManagementSchema.optional().describe('Keyboard focus management settings'),
}));

export type Theme = z.infer<typeof ThemeSchema>;
/** Authoring input for {@link Theme} — defaulted fields are optional. */
export type ThemeInput = z.input<typeof ThemeSchema>;

/**
 * Type-safe factory for a UI theme. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Theme` literal.
 */
export function defineTheme(config: z.input<typeof ThemeSchema>): Theme {
  return ThemeSchema.parse(config);
}
export type ColorPalette = z.infer<typeof ColorPaletteSchema>;
export type Typography = z.infer<typeof TypographySchema>;
export type Spacing = z.infer<typeof SpacingSchema>;
export type BorderRadius = z.infer<typeof BorderRadiusSchema>;
export type Shadow = z.infer<typeof ShadowSchema>;
export type Breakpoints = z.infer<typeof BreakpointsSchema>;
export type Animation = z.infer<typeof AnimationSchema>;
export type ZIndex = z.infer<typeof ZIndexSchema>;
export type ThemeMode = z.infer<typeof ThemeModeSchema>;
export type DensityMode = z.infer<typeof DensityModeSchema>;
export type WcagContrastLevel = z.infer<typeof WcagContrastLevelSchema>;
