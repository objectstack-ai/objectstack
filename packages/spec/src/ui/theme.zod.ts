// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';

// ---------------------------------------------------------------------------
// CLOSED AGAINST UNKNOWN KEYS (#4001 批 15, ADR-0078) — and the door was
// MEASURED before anything was tightened, not assumed. Read this before adding
// a key, and before "finishing" any sibling file by analogy.
//
// ⚠️ Nothing above this block may be a JSDoc block: `build-docs.ts`'s
// `getFileDescription()` publishes the module's FIRST doc block as the
// reference page's description, so a doc-comment header here would replace the
// public page's text with an internal note (#3746 trap 1). Hence `//`.
//
// And do not spell that hazard out with the literal two-star opener, either —
// `getFileDescription()` matches it with a bare regex over the raw source, so
// even INSIDE a `//` line it reads as the file's first doc block. The first
// draft of this very warning quoted the token, matched as an empty description,
// and deleted "Color Palette Schema / Defines brand colors and their variants"
// from the published page. The caution about the trap sprang the trap; caught
// by `check:docs`, which is exactly what it is for.
//
// THE DOOR (three measurements, 2026-08-03, each with controls in the run):
//
//   1. CARRIER KEY — `stack.zod.ts` declares `themes: z.array(ThemeSchema)`,
//      and `defineTheme()` (exported from the package root) parses a theme
//      directly. Both are doors an author writes by hand.
//   2. GRAPH — a BFS over this build's in-memory Zod graph from all 24
//      metadata-type roots (`listMetadataTypeSchemaTypes`) plus
//      `ObjectStackSchema` — the closure `build-schemas.ts` uses for the #4650
//      deletion check — reaches EVERY schema in this file (`ThemeSchema` and
//      its sub-blocks `root-graph`, `ColorPaletteSchema` `derived-clone`).
//      Controls in the same run: `PageSchema` / `DashboardSchema` /
//      `ReportSchema` / `WebhookSchema` / `StateMachineSchema` all resolve, and
//      批 13's measured no-door shapes (`TouchTargetConfigSchema`,
//      `GestureConfigSchema`) come back unreachable. So "reachable" here is a
//      fact about the graph, not an instrument that says yes to everything.
//   3. PARSE — `defineStack()` parses `ObjectStackSchema` on every app boot and
//      on every `objectstack build`, so a theme key is judged on the path an
//      author actually runs.
//
// `theme` is deliberately NOT in `BUILTIN_METADATA_TYPE_SCHEMAS`, so the
// runtime metadata REST door does not validate a stored theme row. The gate
// this file provides is therefore the AUTHORING one (`defineStack` /
// `defineTheme`), and this comment does not claim more than that.
//
// WHY EVERY SUB-BLOCK IS `strict` AND NOT `passthrough` — the #4909 question,
// asked per block rather than per file, because the theme engine reads the two
// halves of this file DIFFERENTLY (`@object-ui/core`'s `ThemeEngine.ts`):
//
//   * `colors` / `borderRadius` / `shadows` / `typography.fontFamily` are read
//     through FIXED maps (`COLOR_TO_CSS_MAP`, the radius and shadow maps) or by
//     named property. An undeclared key there is read by nothing, ever.
//   * `typography.fontSize` / `.fontWeight` / `.lineHeight` / `.letterSpacing`,
//     `animation.duration` / `.timing` and `zIndex` are read with
//     `Object.entries(...)`, emitting `--font-size-<key>`, `--duration-<key>`,
//     `--z-<key>` … for whatever they are handed. That IS the #4909 open shape
//     at the runtime — but it is not an author-reachable extension point
//     through this door, because `.strip` already discarded the extra key
//     before the engine ever saw it. Closing the block therefore changes what
//     the author is TOLD, not what the renderer receives.
//   * And the escape hatch it might otherwise have removed already exists and
//     is declared: `customVars` emits an arbitrary CSS custom property by name.
//     An author who wants `--font-size-huge` writes it there. Openness in the
//     token scales would only add a second, undocumented way to do the same
//     thing — one whose typos are indistinguishable from intent.
//
// ⚠️ SEPARATE, FILED, NOT ANSWERED HERE: several of these blocks emit CSS
// variables no first-party consumer reads (`--font-size-*`, `--font-weight-*`,
// `--line-height-*`, `--letter-spacing-*`, `--z-*`, `--duration-*`,
// `--timing-*`, `--font-heading`, `--font-mono` all have ZERO consumers across
// objectui's components and stylesheets; only the colour variables,
// `--radius*`, `--shadow*` and `--font-sans` are consumed). That is an
// ADR-0049 enforce-or-remove question about LIVENESS, and it must not be
// confused with this one: strictness makes a dropped key loud, it cannot make
// a slot live. Filed rather than answered here — a theme variable is also
// readable by a tenant's own CSS, so "no in-repo consumer" is weaker evidence
// for a CSS custom property than it is for a spec key.
// ---------------------------------------------------------------------------

/**
 * Color Palette Schema
 * Defines brand colors and their variants.
 */
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

// Competing vocabulary, MEASURED not guessed: objectui's `COLOR_TO_CSS_MAP`
// renames every one of these on the way out (`surface` → `--card`, `text` →
// `--foreground`, `textSecondary` → `--muted-foreground`, `disabled` →
// `--muted`, `error` → `--destructive`). An author who read the rendered CSS —
// or who knows shadcn — writes the shadcn name back into the palette, which is
// a different WORD for the same intent rather than a typo, so edit distance
// cannot reach it. `aliasProbe` lowercases and strips `-`/`_`, so each entry
// also covers the `muted-foreground` spelling.
const COLOR_ALIASES: Readonly<Record<string, string>> = {
  card: 'surface',
  foreground: 'text',
  mutedForeground: 'textSecondary',
  muted: 'disabled',
  destructive: 'error',
  danger: 'error',
  textPrimary: 'text',
  secondaryText: 'textSecondary',
};

export const ColorPaletteSchema = lazySchema(() => strictObject(
  {
    surface: 'this theme color palette',
    history:
      'Until #4001 an undeclared colour key was dropped at parse and every element kept its default colour — the brand change simply did not happen, and the theme still reported valid.',
    aliases: COLOR_ALIASES,
  },
  {
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
  },
));

/**
 * Typography Settings Schema
 * Font families, sizes, weights, and line heights.
 */
export const TypographySchema = lazySchema(() => strictObject(
  {
    surface: 'this theme typography block',
    history:
      'Until #4001 an undeclared typography key was dropped at parse and the type scale silently stayed at the defaults.',
    // `tracking` / `leading` are Tailwind's utility names for the two scales
    // this block spells `letterSpacing` / `lineHeight`, and the block's own
    // `.describe()` values are Tailwind's numbers — so an author arriving from
    // the utility side writes the utility name.
    aliases: {
      fonts: 'fontFamily', font: 'fontFamily', family: 'fontFamily', fontFamilies: 'fontFamily',
      sizes: 'fontSize', size: 'fontSize',
      weights: 'fontWeight', weight: 'fontWeight',
      tracking: 'letterSpacing', spacing: 'letterSpacing',
      leading: 'lineHeight',
    },
  },
  {
    fontFamily: strictObject(
      {
        surface: 'this theme font-family block',
        history:
          'Until #4001 an undeclared font-family key was dropped at parse and the element kept the system font stack.',
        // MEASURED: the engine emits `base` as `--font-sans` (the only one of
        // the three any objectui stylesheet reads), so the rendered variable
        // name and the authorable key name disagree — `sans` is what an author
        // reading the output writes back, four edits away from `base`.
        aliases: { sans: 'base', body: 'base', default: 'base', headings: 'heading', display: 'heading', monospace: 'mono', code: 'mono' },
      },
      {
        base: z.string().optional().describe('Base font family (default: system fonts)'),
        heading: z.string().optional().describe('Heading font family'),
        mono: z.string().optional().describe('Monospace font family for code'),
      },
    ).optional(),

    fontSize: strictObject(
      {
        surface: 'this theme font-size scale',
        history:
          'Until #4001 an undeclared size stop was dropped at parse — the scale reported valid and the text rendered at the default size.',
        // MEASURED same-file inconsistency: `borderRadius` and `shadows` below
        // both declare `md`; this scale jumps `sm` → `base` → `lg`. An author
        // who has just written `borderRadius: { md }` writes `fontSize: { md }`
        // next, and got nothing.
        aliases: { md: 'base', medium: 'base', normal: 'base', default: 'base', small: 'sm', large: 'lg' },
      },
      {
        xs: z.string().optional().describe('Extra small font size (e.g., 0.75rem)'),
        sm: z.string().optional().describe('Small font size (e.g., 0.875rem)'),
        base: z.string().optional().describe('Base font size (e.g., 1rem)'),
        lg: z.string().optional().describe('Large font size (e.g., 1.125rem)'),
        xl: z.string().optional().describe('Extra large font size (e.g., 1.25rem)'),
        '2xl': z.string().optional().describe('2X large font size (e.g., 1.5rem)'),
        '3xl': z.string().optional().describe('3X large font size (e.g., 1.875rem)'),
        '4xl': z.string().optional().describe('4X large font size (e.g., 2.25rem)'),
      },
    ).optional(),

    fontWeight: strictObject(
      {
        surface: 'this theme font-weight scale',
        history:
          'Until #4001 an undeclared weight stop was dropped at parse and the text rendered at the inherited weight.',
        // The mirror of the `fontSize` entry above: three sibling scales in
        // this file name their middle stop `base`, this one names it `normal`.
        aliases: { base: 'normal', regular: 'normal', default: 'normal', extrabold: 'bold', black: 'bold', heavy: 'bold', thin: 'light' },
      },
      {
        light: z.number().optional().describe('Light weight (default: 300)'),
        normal: z.number().optional().describe('Normal weight (default: 400)'),
        medium: z.number().optional().describe('Medium weight (default: 500)'),
        semibold: z.number().optional().describe('Semibold weight (default: 600)'),
        bold: z.number().optional().describe('Bold weight (default: 700)'),
      },
    ).optional(),

    lineHeight: strictObject(
      {
        surface: 'this theme line-height scale',
        history:
          'Until #4001 an undeclared line-height stop was dropped at parse and the block kept the inherited leading.',
        // `snug` is a real Tailwind `leading-*` stop this scale does not have.
        aliases: { base: 'normal', default: 'normal', snug: 'tight' },
      },
      {
        tight: z.string().optional().describe('Tight line height (e.g., 1.25)'),
        normal: z.string().optional().describe('Normal line height (e.g., 1.5)'),
        relaxed: z.string().optional().describe('Relaxed line height (e.g., 1.75)'),
        loose: z.string().optional().describe('Loose line height (e.g., 2)'),
      },
    ).optional(),

    letterSpacing: strictObject(
      {
        surface: 'this theme letter-spacing scale',
        history:
          'Until #4001 an undeclared tracking stop was dropped at parse and the text kept its default letter spacing.',
        // `widest` / `tightest` are real Tailwind `tracking-*` stops absent here.
        aliases: { base: 'normal', default: 'normal', widest: 'wider', tightest: 'tighter' },
      },
      {
        tighter: z.string().optional().describe('Tighter letter spacing (e.g., -0.05em)'),
        tight: z.string().optional().describe('Tight letter spacing (e.g., -0.025em)'),
        normal: z.string().optional().describe('Normal letter spacing (e.g., 0)'),
        wide: z.string().optional().describe('Wide letter spacing (e.g., 0.025em)'),
        wider: z.string().optional().describe('Wider letter spacing (e.g., 0.05em)'),
      },
    ).optional(),
  },
));

/**
 * Border Radius Schema
 * Rounded corners configuration.
 */
export const BorderRadiusSchema = lazySchema(() => strictObject(
  {
    surface: 'this theme border-radius scale',
    history:
      'Until #4001 an undeclared radius stop was dropped at parse and the corners rendered at the default radius.',
    // MEASURED: `base` is emitted as the BARE `--radius`, which is the one
    // radius variable objectui's stylesheets actually read — so `radius` is
    // what an author copying from the rendered CSS writes.
    aliases: { radius: 'base', default: 'base', normal: 'base', pill: 'full', round: 'full', rounded: 'full' },
  },
  {
    none: z.string().optional().describe('No border radius (0)'),
    sm: z.string().optional().describe('Small border radius (e.g., 0.125rem)'),
    base: z.string().optional().describe('Base border radius (e.g., 0.25rem)'),
    md: z.string().optional().describe('Medium border radius (e.g., 0.375rem)'),
    lg: z.string().optional().describe('Large border radius (e.g., 0.5rem)'),
    xl: z.string().optional().describe('Extra large border radius (e.g., 0.75rem)'),
    '2xl': z.string().optional().describe('2X large border radius (e.g., 1rem)'),
    full: z.string().optional().describe('Full border radius (50%)'),
  },
));

/**
 * Shadow Schema
 * Box shadow effects.
 */
export const ShadowSchema = lazySchema(() => strictObject(
  {
    surface: 'this theme shadow scale',
    history:
      'Until #4001 an undeclared shadow stop was dropped at parse and the surface rendered flat.',
    // `inset` is CSS's own word for what this scale calls `inner` — and the
    // key's own `.describe()` says so ("Inner shadow (inset)").
    aliases: { inset: 'inner', default: 'base', normal: 'base' },
  },
  {
    none: z.string().optional().describe('No shadow'),
    sm: z.string().optional().describe('Small shadow'),
    base: z.string().optional().describe('Base shadow'),
    md: z.string().optional().describe('Medium shadow'),
    lg: z.string().optional().describe('Large shadow'),
    xl: z.string().optional().describe('Extra large shadow'),
    '2xl': z.string().optional().describe('2X large shadow'),
    inner: z.string().optional().describe('Inner shadow (inset)'),
  },
));

/**
 * Animation Schema
 * Animation timing and duration settings.
 */
export const AnimationSchema = lazySchema(() => strictObject(
  {
    surface: 'this theme animation block',
    history:
      'Until #4001 an undeclared animation key was dropped at parse and the transition ran at the renderer default.',
    aliases: {
      durations: 'duration', transition: 'duration', transitions: 'duration',
      easing: 'timing', easings: 'timing', timingFunction: 'timing', timingFunctions: 'timing',
    },
  },
  {
    duration: strictObject(
      {
        surface: 'this theme animation-duration scale',
        history:
          'Until #4001 an undeclared duration stop was dropped at parse and the transition ran at the renderer default.',
        aliases: { normal: 'base', medium: 'base', default: 'base', quick: 'fast' },
      },
      {
        fast: z.string().optional().describe('Fast animation (e.g., 150ms)'),
        base: z.string().optional().describe('Base animation (e.g., 300ms)'),
        slow: z.string().optional().describe('Slow animation (e.g., 500ms)'),
      },
    ).optional(),

    timing: strictObject(
      {
        surface: 'this theme animation-timing block',
        history:
          'Until #4001 an undeclared easing key was dropped at parse and the transition fell back to the renderer default curve.',
        // This block is the file's one snake_case vocabulary — against
        // AGENTS.md Prime Directive #3 (TS config keys are camelCase) and
        // against every sibling key in this file. So `easeIn` is not a typo, it
        // is an author following the repo's own naming rule, and it must land
        // on `ease_in` rather than on whatever the distance fallback picks.
        aliases: { easeIn: 'ease_in', easeOut: 'ease_out', easeInOut: 'ease_in_out', default: 'ease' },
      },
      {
        linear: z.string().optional().describe('Linear timing function'),
        ease: z.string().optional().describe('Ease timing function'),
        ease_in: z.string().optional().describe('Ease-in timing function'),
        ease_out: z.string().optional().describe('Ease-out timing function'),
        ease_in_out: z.string().optional().describe('Ease-in-out timing function'),
      },
    ).optional(),
  },
));

/**
 * Z-Index Scale Schema
 * Layering and stacking order.
 */
export const ZIndexSchema = lazySchema(() => strictObject(
  {
    surface: 'this theme z-index scale',
    history:
      'Until #4001 an undeclared layer was dropped at parse — the overlay it was meant to lift kept the default stacking order and rendered behind its own backdrop.',
    // `modalBackdrop` is camelCase, so the distance fallback is systematically
    // weak on it (#4990: the helper lowercases the input but not the
    // candidates, spending one edit per capital). These land explicitly.
    aliases: { backdrop: 'modalBackdrop', overlay: 'modalBackdrop', dialog: 'modal', menu: 'dropdown', default: 'base' },
  },
  {
    base: z.number().optional().describe('Base z-index (e.g., 0)'),
    dropdown: z.number().optional().describe('Dropdown z-index (e.g., 1000)'),
    sticky: z.number().optional().describe('Sticky z-index (e.g., 1020)'),
    fixed: z.number().optional().describe('Fixed z-index (e.g., 1030)'),
    modalBackdrop: z.number().optional().describe('Modal backdrop z-index (e.g., 1040)'),
    modal: z.number().optional().describe('Modal z-index (e.g., 1050)'),
    popover: z.number().optional().describe('Popover z-index (e.g., 1060)'),
    tooltip: z.number().optional().describe('Tooltip z-index (e.g., 1070)'),
  },
));

/**
 * Theme Mode Schema
 */
export const ThemeModeSchema = lazySchema(() => z.enum(['light', 'dark', 'auto']));

/** @deprecated Use ThemeModeSchema instead */
export const ThemeMode = ThemeModeSchema;

// Tombstones for the eight props #3494 removed. Each carries its OWN sentence:
// `guidance` prints one bullet per rejected key verbatim, so a shared string
// prints the same paragraph N times (批 10's `join`/`joinGateway` lesson).
//
// Two of them are deliberately worded NOT to hand the author a replacement
// slot. `touchTarget` and `keyboardNavigation` read like they should point at
// `ui/touch.zod.ts` / `ui/keyboard.zod.ts` — but 批 13 measured both of those
// vocabularies as having no carrier key at all (#4988), so prescribing them
// would walk an author out of a loud rejection and into a silent one. That is
// the ledger's finding 7, and this campaign has now signposted its own failure
// mode twice; it does not get to do it a third time.
const THEME_RETIRED_KEY_GUIDANCE: Readonly<Record<string, string>> = {
  spacing:
    '`spacing` was removed in #3494 — the theme engine (objectui `generateThemeVars`) never emitted a spacing variable, so authoring it was a silent no-op. Emit your own scale through `customVars` (e.g. `{ "space-4": "1rem" }`).',
  breakpoints:
    '`breakpoints` was removed in #3494 — breakpoints are not theme-scoped. Author responsive behaviour per component (`page.components[].responsive`), where the protocol owns the breakpoint names.',
  logo:
    '`logo` was removed in #3494 — brand imagery is app-scoped, not theme-scoped: set `branding.logo` on the app (`ui/app.zod.ts`).',
  density:
    '`density` was removed in #3494 — no renderer read it. Express compact/comfortable spacing as your own tokens under `customVars`.',
  wcagContrast:
    '`wcagContrast` was removed in #3494 — it declared a check nothing ran. Contrast is measured against the palette you author (`contrastRatio` / `meetsContrastLevel` in the theme engine), never enabled by a flag.',
  rtl:
    '`rtl` was removed in #3494 — text direction follows the document and locale, not the theme.',
  touchTarget:
    '`touchTarget` was removed in #3494 — the theme engine never emitted a touch-target variable, so it changed nothing. If you need a token for it, declare one under `customVars`.',
  keyboardNavigation:
    '`keyboardNavigation` was removed in #3494 — keyboard behaviour is not a CSS variable and was never emitted; no theme key can switch it on or off.',
};

/**
 * Theme Configuration Schema
 * Complete theme definition for brand customization.
 *
 * #3494: the aspirational props `spacing`, `breakpoints`, `logo`, `density`,
 * `wcagContrast`, `rtl`, `touchTarget` and `keyboardNavigation` were removed —
 * the theme engine (objectui generateThemeVars) never consumed them, so
 * authoring them was a silent no-op (liveness audit #1878/#1893). Since #4001
 * writing one is a loud rejection carrying its replacement, instead of a silent
 * strip that made the removal indistinguishable from the bug it fixed.
 */
export const ThemeSchema = lazySchema(() => strictObject(
  {
    surface: 'this theme',
    history:
      'Until #4001 an undeclared theme key was dropped at parse and the theme loaded looking complete — which is exactly how the eight props #3494 removed went on being authored after they stopped existing.',
    aliases: {
      palette: 'colors', colours: 'colors', colorPalette: 'colors', color: 'colors',
      fonts: 'typography', font: 'typography', type: 'typography',
      radius: 'borderRadius', borderRadii: 'borderRadius', radii: 'borderRadius',
      shadow: 'shadows', boxShadow: 'shadows', elevation: 'shadows',
      animations: 'animation', motion: 'animation', transitions: 'animation',
      layers: 'zIndex', stacking: 'zIndex',
      cssVars: 'customVars', variables: 'customVars', vars: 'customVars', customProperties: 'customVars', tokens: 'customVars',
      extend: 'extends', parent: 'extends', inherits: 'extends', basedOn: 'extends',
      title: 'label', displayName: 'label',
      id: 'name', key: 'name',
      darkMode: 'mode', colorScheme: 'mode', scheme: 'mode',
    },
    guidance: THEME_RETIRED_KEY_GUIDANCE,
  },
  {
    name: SnakeCaseIdentifierSchema.describe('Unique theme identifier (snake_case)'),
    label: z.string().describe('Human-readable theme name'),
    description: z.string().optional().describe('Theme description'),

    /** Theme mode */
    mode: ThemeModeSchema.default('light').describe('Theme mode (light, dark, or auto)'),

    /** Color system */
    colors: ColorPaletteSchema.describe('Color palette configuration'),

    /** Typography */
    typography: TypographySchema.optional().describe('Typography settings'),

    /** Border radius */
    borderRadius: BorderRadiusSchema.optional().describe('Border radius scale'),

    /** Shadows */
    shadows: ShadowSchema.optional().describe('Box shadow effects'),

    /** Animation */
    animation: AnimationSchema.optional().describe('Animation settings'),

    /** Z-Index */
    zIndex: ZIndexSchema.optional().describe('Z-index scale for layering'),

    /** Custom CSS variables */
    customVars: z.record(z.string(), z.string()).optional().describe('Custom CSS variables (key-value pairs)'),

    /** Extends another theme */
    extends: z.string().optional().describe('Base theme to extend from'),
  },
));

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
export type BorderRadius = z.infer<typeof BorderRadiusSchema>;
export type Shadow = z.infer<typeof ShadowSchema>;
export type Animation = z.infer<typeof AnimationSchema>;
export type ZIndex = z.infer<typeof ZIndexSchema>;
export type ThemeMode = z.infer<typeof ThemeModeSchema>;
