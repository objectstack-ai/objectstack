// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';

// ---------------------------------------------------------------------------
// CLOSED AGAINST UNKNOWN KEYS (#4001 批 15, ADR-0078) — and the door was
// MEASURED before anything was tightened, not assumed. Read this before adding
// a key, and before "finishing" any sibling file by analogy.
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
//      `GestureConfigSchema`) came back unreachable. So "reachable" here is a
//      fact about the graph, not an instrument that says yes to everything.
//      (Those two negative controls were RETIRED at #4988 — the whole no-door
//      interaction family went — so a re-run supplies its own, e.g. an inline
//      `z.object({ a: z.string() })`. The reading above is unaffected.)
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
//   * The token SCALES that used to sit beside them — `typography.fontSize` /
//     `.fontWeight` / `.lineHeight` / `.letterSpacing`, `animation.duration` /
//     `.timing` and `zIndex` — were read with `Object.entries(...)`, emitting
//     `--font-size-<key>`, `--duration-<key>`, `--z-<key>` … for whatever they
//     were handed. That WAS the #4909 open shape at the runtime. It is moot
//     now: all of them were RETIRED at #5021 (see the block below).
//   * And the escape hatch it might otherwise have removed already exists and
//     is declared: `customVars` emits an arbitrary CSS custom property by name.
//     An author who wants `--font-size-huge` writes it there. Openness in the
//     token scales would only add a second, undocumented way to do the same
//     thing — one whose typos are indistinguishable from intent.
//
// ✅ ANSWERED AT #5021 (ADR-0049 enforce-or-remove) — this file's own filed
// question, now closed. The block above used to end "SEPARATE, FILED, NOT
// ANSWERED HERE", because 批 15 correctly refused to decide a LIVENESS question
// inside a STRICTNESS batch: strictness makes a dropped key loud, it cannot
// make a slot live. The measurement it filed on (re-confirmed against objectui
// `main` on 2026-08-04, with `--font-sans` / `--radius` / `--shadow` /
// `--primary` as positive controls in the same run) was that `--font-size-*`,
// `--font-weight-*`, `--line-height-*`, `--letter-spacing-*`, `--z-*`,
// `--duration-*`, `--timing-*`, `--font-heading` and `--font-mono` have ZERO
// first-party consumers, while only the colour variables, `--radius*`,
// `--shadow*` and `--font-sans` are read.
//
// The maintainer's ruling (2026-08-04) is RETIRE, not "add consumers" and not
// "promise them as a public token surface": theme-driven typography is not a
// near-term product capability, so wiring shadcn/Tailwind to read these would
// build a feature nobody asked for, and stamping a stability guarantee onto a
// surface that changes nothing in the platform's own UI is a promise attached
// to an inert slot (the #4583 shape — a precisely validated dead slot is the
// more convincing lie).
//
// ⚠️ The counter-argument that kept these alive through #3494 was answered, not
// ignored: a CSS custom property differs from an ordinary spec key because a
// TENANT'S OWN STYLESHEET can read it once it lands on the document, so
// "zero in-repo consumers" is weaker evidence here than it is elsewhere. That
// is exactly why the prescription is `customVars` rather than a bare deletion.
// `customVars` emits `--<key>: <value>` verbatim, so a tenant who really was
// reading `--z-modal` or `--font-size-lg` from their own CSS reproduces every
// one of these variables BYTE FOR BYTE. Capability lost: none. What is lost is
// a semantic vocabulary that the platform itself never honoured — which is the
// thing ADR-0049 exists to delete.
//
// `colors`, `borderRadius`, `shadows` and `typography.fontFamily.base` have
// live consumers and are UNTOUCHED. objectui's `ThemeEngine` still emits the
// retired groups until its own stop-emitting follow-up lands (filed on the
// objectui queue); that is NOT a correctness dependency in either direction —
// an emitted variable nothing reads is inert, and after this change no author
// can put a value into one, so the emitter has nothing left to emit.
// ---------------------------------------------------------------------------

/**
 * Color Palette Schema
 * Defines brand colors and their variants.
 */
import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
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
 * Base font family. The size / weight / line-height / letter-spacing scales
 * were retired at #5021 and are `retiredKey()` tombstones below.
 *
 * ⚠️ WHY `retiredKey()` AND NOT A `guidance` ENTRY, on a shape that is already
 * `.strict()`. The two routes are not interchangeable here and the build is
 * what settles it. `guidance` is consulted for `unrecognized_keys`, which
 * requires the key to be ABSENT from the shape — and a key absent from the
 * shape is absent from `authorable-surface.json`, which is a ratcheted
 * baseline. Deleting a live line from it fails `gen:schema`'s #4650 deletion
 * check (`the entry at <base> was LIVE (never tombstoned)`), and rightly: the
 * ratchet cannot see that THIS parent happens to be strict, and the class of
 * mistake it guards — a key deleted from a non-strict shape, silently stripped
 * forever after — is indistinguishable at the file level.
 *
 * A tombstone satisfies both: the key stays in the walked shape (so the
 * baseline gains a `[RETIRED]` marker instead of losing a line), and it is
 * strictly LOUDER than the strict shell, because it carries its own
 * prescription instead of a generic unknown-key message. `strictObject` already
 * anticipates the combination — its `acceptsNothing()` helper exists precisely
 * to keep a tombstoned key out of the "did you mean" candidates.
 *
 * Every prescription points at `customVars`, and that is a byte-for-byte
 * replacement rather than a consolation prize: the engine emits `customVars` as
 * `--<key>: <value>` verbatim, so `customVars: { 'font-size-lg': '1.125rem' }`
 * puts the SAME `--font-size-lg` on the document this block used to. What the
 * author loses is a semantic vocabulary the platform never honoured; what they
 * keep is every variable they were actually shipping.
 */
export const TypographySchema = lazySchema(() => strictObject(
  {
    surface: 'this theme typography block',
    history:
      'Until #4001 an undeclared typography key was dropped at parse and the type scale silently stayed at the defaults.',
    // ⚠️ The `sizes`/`size`, `weights`/`weight`, `tracking`/`spacing` and
    // `leading` aliases were DELETED at #5021, not re-pointed. They named
    // Tailwind's utility words for scales this block no longer declares, so
    // keeping them would answer an author with "did you mean `fontSize`?" and
    // then reject `fontSize` — walking them out of one rejection into a second
    // one, which is the ledger's finding 7 (this campaign signposting the way
    // into the failure mode it exists to kill). A key that no longer exists
    // gets no suggestion at all; the four canonical spellings still get their
    // full prescription through `guidance` below.
    aliases: {
      fonts: 'fontFamily', font: 'fontFamily', family: 'fontFamily', fontFamilies: 'fontFamily',
    },
  },
  {
    fontFamily: strictObject(
      {
        surface: 'this theme font-family block',
        history:
          'Until #4001 an undeclared font-family key was dropped at parse and the element kept the system font stack.',
        // MEASURED: the engine emits `base` as `--font-sans` (the only one of
        // the three that any objectui stylesheet ever read — which is why it is
        // the only one of the three that survived #5021), so the rendered
        // variable name and the authorable key name disagree; `sans` is what an
        // author reading the output writes back, four edits away from `base`.
        //
        // `headings`/`display` → `heading` and `monospace`/`code` → `mono` were
        // DELETED at #5021 with their targets, for the finding-7 reason spelled
        // out on the parent block.
        aliases: { sans: 'base', body: 'base', default: 'base' },
      },
      {
        base: z.string().optional().describe('Base font family (default: system fonts)'),

        heading: retiredKey(
          '`theme.typography.fontFamily.heading` was removed in @objectstack/spec 17.0.0 (#5021, ADR-0049 D2) — it emitted `--font-heading`, which no objectui component or stylesheet reads, so headings always rendered in the base font stack. `base` is the ONE font-family key with a live consumer (it emits `--font-sans`) and is unchanged. Delete the key; if your own CSS reads the variable, declare it under `customVars` (`{ "font-heading": "Georgia, serif" }` emits exactly the same `--font-heading`). '
            + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
        ),
        mono: retiredKey(
          '`theme.typography.fontFamily.mono` was removed in @objectstack/spec 17.0.0 (#5021, ADR-0049 D2) — it emitted `--font-mono`, which no objectui component or stylesheet reads, so code always rendered in the browser default monospace. `base` is the ONE font-family key with a live consumer (it emits `--font-sans`) and is unchanged. Delete the key; if your own CSS reads the variable, declare it under `customVars` (`{ "font-mono": "ui-monospace, monospace" }` emits exactly the same `--font-mono`). '
            + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
        ),
      },
    ).optional(),

    fontSize: retiredKey(
      '`theme.typography.fontSize` was removed in @objectstack/spec 17.0.0 (#5021, ADR-0049 D2) — the engine emitted `--font-size-xs` … `--font-size-4xl` faithfully and NO first-party component or stylesheet has ever read one, so a declared type scale was real CSS that styled nothing. Delete the key; if your own CSS reads those variables, declare them under `customVars` (`{ "font-size-lg": "1.125rem" }` emits exactly the same `--font-size-lg`). '
        + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
    ),
    fontWeight: retiredKey(
      '`theme.typography.fontWeight` was removed in @objectstack/spec 17.0.0 (#5021, ADR-0049 D2) — the engine emitted `--font-weight-*` and nothing read it, so text rendered at the inherited weight whatever you declared. Delete the key; if your own CSS reads those variables, declare them under `customVars` (`{ "font-weight-semibold": "600" }` emits exactly the same `--font-weight-semibold`). '
        + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
    ),
    lineHeight: retiredKey(
      '`theme.typography.lineHeight` was removed in @objectstack/spec 17.0.0 (#5021, ADR-0049 D2) — the engine emitted `--line-height-*` and nothing read it, so every block kept its inherited leading. Delete the key; if your own CSS reads those variables, declare them under `customVars` (`{ "line-height-relaxed": "1.75" }` emits exactly the same `--line-height-relaxed`). '
        + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
    ),
    letterSpacing: retiredKey(
      '`theme.typography.letterSpacing` was removed in @objectstack/spec 17.0.0 (#5021, ADR-0049 D2) — the engine emitted `--letter-spacing-*` and nothing read it, so tracking never moved. Delete the key; if your own CSS reads those variables, declare them under `customVars` (`{ "letter-spacing-wide": "0.025em" }` emits exactly the same `--letter-spacing-wide`). '
        + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
    ),
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
 * Theme Mode Schema
 */
export const ThemeModeSchema = lazySchema(() => z.enum(['light', 'dark', 'auto']));

/** @deprecated Use ThemeModeSchema instead */
export const ThemeMode = ThemeModeSchema;

// Tombstones for the eight props #3494 removed, plus the two blocks #5021
// retired. Each carries its OWN sentence: `guidance` prints one bullet per
// rejected key verbatim, so a shared string prints the same paragraph N times
// (批 10's `join`/`joinGateway` lesson).
//
// Two of them are deliberately worded NOT to hand the author a replacement
// slot. `touchTarget` and `keyboardNavigation` read like they should point at
// `ui/touch.zod.ts` / `ui/keyboard.zod.ts` — but 批 13 measured both of those
// vocabularies as having no carrier key at all, so prescribing them would walk
// an author out of a loud rejection and into a silent one. That is the ledger's
// finding 7, and this campaign has now signposted its own failure mode twice;
// it does not get to do it a third time. **#4988 settled it the other way**:
// both modules were RETIRED outright (ADR-0049), so the slot these two
// prescriptions declined to name no longer exists at all — the refusal was
// right, and it must stay a refusal rather than becoming a dangling pointer.
//
// The #5021 pair is the OPPOSITE case and it is worth keeping the distinction
// visible: `animation` and `zIndex` DO get a replacement slot, because
// `customVars` is measured live (the engine emits every entry verbatim) rather
// than merely plausible. That is the whole difference between a prescription
// and a signpost into a second rejection.
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
 * The two theme-level keys #5021 retired.
 *
 * These are `retiredKey()` tombstones rather than `guidance` entries — unlike
 * the eight above, which predate the `authorable-surface.json` ratchet and are
 * long gone from it. See the note on `TypographySchema` for why a strict shell
 * does not make the tombstone redundant.
 */
const THEME_ANIMATION_RETIRED =
  '`theme.animation` was removed in @objectstack/spec 17.0.0 (#5021, ADR-0049 D2) — unlike the #3494 props above, the engine DID emit `--duration-*` and `--timing-*`, faithfully and for years; what never existed was a reader. No first-party component or stylesheet has ever consumed one, so every transition ran at the renderer default whatever you declared. Delete the key; if your own CSS reads those variables, declare them under `customVars` (`{ "duration-fast": "150ms", "timing-ease_in": "cubic-bezier(0.4, 0, 1, 1)" }` emits exactly the same properties). '
    + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.';

const THEME_ZINDEX_RETIRED =
  '`theme.zIndex` was removed in @objectstack/spec 17.0.0 (#5021, ADR-0049 D2) — the engine emitted `--z-base` … `--z-tooltip` and nothing read one, so an overlay you "lifted" still stacked by document order. Delete the key; if your own CSS reads those variables, declare them under `customVars` (`{ "z-modal": "1050" }` emits exactly the same `--z-modal`). '
    + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.';

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
 *
 * #5021 removed `animation` and `zIndex` (and, inside `typography`, the
 * `fontSize` / `fontWeight` / `lineHeight` / `letterSpacing` scales and
 * `fontFamily.heading` / `.mono`). #3494's criterion could not reach these:
 * it was "the engine never emits it", and the engine emitted every one of
 * these. The criterion that reaches them is ADR-0049's — emitted, but read by
 * nobody. `colors`, `borderRadius`, `shadows` and `fontFamily.base` have live
 * consumers and stay.
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
      // `animations`/`motion`/`transitions` → `animation` and
      // `layers`/`stacking` → `zIndex` were DELETED at #5021 rather than
      // re-pointed at `customVars`: an alias renames one key to another, and
      // this is not a rename — a scale object would have to become a flat
      // string map with the CSS variable names spelled out and the numbers
      // stringified. Suggesting the retired key would hand the author a second
      // rejection (finding 7); suggesting `customVars` would imply the value
      // transfers unchanged, which it does not. The prescription in `guidance`
      // states the shape change; the D2 conversion DELETES the key and emits a
      // notice rather than auto-populating `customVars`, because a rewrite
      // would silently reconstitute ~25 variables nothing reads as
      // live-looking config — the retirement would be invisible in exactly the
      // way ADR-0049 objects to.
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

    /** @deprecated REMOVED at #5021 — see {@link THEME_ANIMATION_RETIRED}. */
    animation: retiredKey(THEME_ANIMATION_RETIRED),

    /** @deprecated REMOVED at #5021 — see {@link THEME_ZINDEX_RETIRED}. */
    zIndex: retiredKey(THEME_ZINDEX_RETIRED),

    // `AnimationSchema` and `ZIndexSchema` were DELETED outright rather than
    // left standing beside these tombstones: an exported value schema with no
    // consumer reads as a capability to whoever finds it (#3950), and each had
    // exactly one consumer — the key now tombstoned above. Their own
    // `authorable-surface` lines leave with the def, which is the #4650
    // deletion check's third proof (whole def no longer emitted) and is
    // adjudicated by the json-schema.manifest.json ratchet (#2978) instead.

    /**
     * Custom CSS variables.
     *
     * The declared door for any custom property, and — since #5021 — the ONLY
     * one. Each entry is emitted verbatim as `--<key>: <value>`, so this is
     * where a `--z-modal` or a `--font-size-lg` goes now.
     */
    customVars: z.record(z.string(), z.string()).optional().describe('Custom CSS variables (key-value pairs)'),

    /** Extends another theme */
    extends: z.string().optional().describe('Base theme to extend from'),
  },
));

export type Theme = z.input<typeof ThemeSchema>;
/** Post-parse shape of {@link Theme} — defaults applied, transforms run (ADR-0122). */
export type ThemeParsed = z.infer<typeof ThemeSchema>;

/**
 * Type-safe factory for a UI theme. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Theme` literal.
 */
export function defineTheme(config: z.input<typeof ThemeSchema>): ThemeParsed {
  return ThemeSchema.parse(config);
}
export type ColorPalette = z.input<typeof ColorPaletteSchema>;
export type Typography = z.input<typeof TypographySchema>;
export type BorderRadius = z.input<typeof BorderRadiusSchema>;
export type Shadow = z.input<typeof ShadowSchema>;
// `Animation` and `ZIndex` were exported here until #5021, alongside the two
// schemas they were inferred from.
export type ThemeMode = z.input<typeof ThemeModeSchema>;
