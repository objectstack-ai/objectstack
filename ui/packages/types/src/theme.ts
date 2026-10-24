/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Theme Schema
 *
 * The theme document vocabulary (`Theme`, `ThemeMode`, `ColorPalette`) —
 * owned by this package since objectui#5716. The objectui theme COMPONENT
 * kinds that used to accompany it are all retired (`78cbdb530`,
 * objectui#5647); this module is the theme DOCUMENT only.
 *
 * @module theme
 * @packageDocumentation
 */

// ============================================================================
// Theme Document Vocabulary (formerly `@objectstack/spec/ui`)
// ============================================================================
// `@objectstack/spec` retired its whole theme module: `ui/theme.zod.ts` went
// in objectstack `35ad101bc`, and the objectstack#10856
// ruling had objectui drop the dangling VALUE re-exports (objectui#5710).
// This block is the TYPE half. The maintainer ruling on objectui#5716
// (2026-08-23, option A — localize) makes objectui the owner of the theme
// document types, because the theme SYSTEM stays: `ThemeEngine`
// (`packages/core/src/theme/ThemeEngine.ts`) turns a `Theme` into CSS
// variables, and `ThemeProvider` (`packages/react/src/context/ThemeContext.tsx`)
// applies it.
//
// The declarations below are hand-written from the LAST-PUBLISHED shapes —
// `@objectstack/spec` 17.1.0, the pin the engine was actually built against.
// That release is the blueprint, not a starting point: every key and its
// optionality below is the 17.1.0 `z.input` reading, including the `?: never`
// retirement tombstones. There is deliberately no spec import left in this
// file for the dependency refresh to break.
//
// Under the same ruling's zero-reader rider, four published names did NOT
// make the move and were DELETED from this package's surface: `Typography`,
// `BorderRadius`, `Shadow` (their shapes live on as the inline `typography` /
// `borderRadius` / `shadows` members of `Theme` below) and the deprecated
// `ThemeDefinition` alias of `Theme`. Each had zero in-repo readers — census
// in the objectui#5716 PR body. Re-adding one is a published-API decision,
// not a convenience.
//
// Drift story, stated plainly (objectui#5716). While the installed pin still
// publishes the retired names: `check:spec-symbols` carries ALLOW entries for
// the three names below, and `__tests__/page-nav-misc-spec-parity.test.ts`
// still proves the local `Theme` and the 17.1.0 authoring `Theme` accept each
// other — both turn stale/red on the pin refresh, which is how that refresh
// announces itself here. AFTER the refresh the shapes are documented, not
// pinned upstream — nothing is left upstream to pin against. What stays
// executable forever: `THEME_MODES` (runtime witness of the mode vocabulary)
// and `ThemeEngine`'s `Record<keyof ColorPalette, …>` map, which the compiler
// keeps in lockstep with the palette key set.

/**
 * The theme mode vocabulary, as a runtime tuple.
 *
 * A runtime `as const` tuple rather than a bare union, deliberately — the
 * `SPEC_GESTURE_TYPES` precedent in `./mobile.ts`: the parity pins in
 * `@object-ui/providers` (`theme-mode-spec-parity.test.tsx`,
 * `spec-symbol-batch7.test.ts`) read the mode vocabulary at runtime, and this
 * tuple keeps those pins executable against the vocabulary's owner. A
 * type-only union would have left them nothing to read, which is how a
 * retirement quietly takes working coverage with it.
 */
export const THEME_MODES = ['auto', 'light', 'dark'] as const;

/**
 * Theme display mode. `auto` follows the OS preference.
 *
 * Owned here since the upstream theme retirement (objectui#5716). Note the
 * pre-spec `'system'` spelling is NOT part of this vocabulary — it is
 * `@object-ui/providers`' own legacy alias of `auto`, declared there on
 * `ThemePreference` (objectui#2942).
 */
export type ThemeMode = (typeof THEME_MODES)[number];

/**
 * Color palette of a theme document. `primary` is the only required color.
 *
 * Owned here since the upstream theme retirement (objectui#5716); the key set
 * is the last-published one. `ThemeEngine.generateColorVars()` maps every key
 * onto a Shadcn CSS variable, and its `Record<keyof ColorPalette, …>`
 * `COLOR_TO_CSS_MAP` makes the compiler reject a key added or removed here
 * without the mapping moving with it.
 */
export interface ColorPalette {
  primary: string;
  secondary?: string;
  accent?: string;
  success?: string;
  warning?: string;
  error?: string;
  info?: string;
  background?: string;
  surface?: string;
  text?: string;
  textSecondary?: string;
  border?: string;
  disabled?: string;
  primaryLight?: string;
  primaryDark?: string;
  secondaryLight?: string;
  secondaryDark?: string;
}

/**
 * Complete theme definition — the AUTHORING shape of a theme document: theme
 * JSON as stored, edited, and handed to `ThemeProvider`.
 *
 * Owned here since the upstream theme retirement (objectui#5716). Two
 * provenance notes carried over from the retired module, because both are
 * live contracts rather than history:
 *
 * - **This is the input side, so `mode` is optional.** The retired zod schema
 *   ran `.default('auto')` at parse time, which made `mode` required only in
 *   the PARSED shape; everything in objectui that carries a `Theme` is on the
 *   writing side (the `.default()`/`z.input` rule from objectui#3169), and
 *   re-declaring the parsed side here would have made every stored theme
 *   unrepresentable. The objectui#4167 rc.6 re-pointing settled this binding
 *   on the input side by SIDE, not by name.
 *
 * - **The `?: never` members are retirement tombstones, not accidents.**
 *   `animation` / `zIndex` (and, inside `typography`, the size/weight/
 *   line-height/letter-spacing scales and `fontFamily.heading` / `.mono`)
 *   were retired upstream (objectstack#5021, ADR-0049 emitted-but-read-by-
 *   nobody) — the engine-side dead emission is objectui#3361. `customVars` is
 *   the byte-for-byte replacement: the engine emits `customVars` entries
 *   verbatim as `--<key>: <value>`, so `customVars: { 'font-size-lg':
 *   '1.125rem' }` puts the SAME `--font-size-lg` on the document the retired
 *   scale keys used to. Keeping the keys as `?: never` keeps authoring one a
 *   compile-time rejection instead of a silent strip. The earlier prune of
 *   `spacing` / `breakpoints` / `logo` / `density` / `wcagContrast` / `rtl` /
 *   `touchTarget` / `keyboardNavigation` (objectstack#3494, keys the engine
 *   never consumed) predates the tombstone convention, so those keys are
 *   simply absent.
 */
export interface Theme {
  /** Unique theme name (identifier). */
  name: string;
  /** Human-readable label. */
  label: string;
  /** Optional description. */
  description?: string;
  /** Display mode. Optional when authoring; the system treats absence as `auto`. */
  mode?: ThemeMode;
  /** Color palette — the only required token group. */
  colors: ColorPalette;
  /** Typography. Only `fontFamily.base` is live; the rest are tombstones (see above). */
  typography?: {
    fontFamily?: {
      base?: string;
      /** Retired (objectstack#5021) — author `customVars` instead. */
      heading?: never;
      /** Retired (objectstack#5021) — author `customVars` instead. */
      mono?: never;
    };
    /** Retired (objectstack#5021) — author `customVars` instead. */
    fontSize?: never;
    /** Retired (objectstack#5021) — author `customVars` instead. */
    fontWeight?: never;
    /** Retired (objectstack#5021) — author `customVars` instead. */
    lineHeight?: never;
    /** Retired (objectstack#5021) — author `customVars` instead. */
    letterSpacing?: never;
  };
  /** Rounded-corner scale. */
  borderRadius?: {
    none?: string;
    sm?: string;
    base?: string;
    md?: string;
    lg?: string;
    xl?: string;
    '2xl'?: string;
    full?: string;
  };
  /** Box-shadow scale. */
  shadows?: {
    none?: string;
    sm?: string;
    base?: string;
    md?: string;
    lg?: string;
    xl?: string;
    '2xl'?: string;
    inner?: string;
  };
  /** Retired (objectstack#5021) — author `customVars` instead. */
  animation?: never;
  /** Retired (objectstack#5021) — author `customVars` instead. */
  zIndex?: never;
  /** Escape hatch: entries are emitted verbatim as `--<key>: <value>`. */
  customVars?: Record<string, string>;
  /** Name of a theme to inherit from. */
  extends?: string;
}

// ============================================================================
// ObjectUI Component Schemas (UI rendering)
// ============================================================================

// `ThemeComponentSchema` (`type: 'theme'`) RETIRED in `78cbdb530`, under the
// maintainer ruling of 2026-08-21 (option B, executed upstream by objectstack
// `35ad101bc`; quoted verbatim and untranslated):
//
//   「B:退役授权面 —— 收掉 `themes` 载体键与 schema,`app.branding` 留作唯一颜色面;
//   objectui 引擎代码与单测保留」
//
// It declared a COMPONENT kind — a theme-manager node carrying `themes[]`,
// `activeTheme`, `allowSwitching`, `persistPreference` and `storageKey`. No
// renderer ever implemented `'theme'`: the literal is absent from every
// `ComponentRegistry.register(...)` / `registerLazy(...)` site in
// `packages/*/src`, and from both `PROTOCOL_COMPONENTS` and
// `PALETTE_PLACEHOLDER_BLOCKS` in
// `packages/components/src/renderers/placeholders.tsx` — so it did not even
// resolve to a placeholder. A page declaring one got the registry's "Unknown
// component type" panel (OBJUI-001), never a theme manager. Declared-but-
// unenforced, the ADR-0078 class.
//
// The theme SYSTEM is untouched and is explicitly RETAINED by the same ruling:
// `Theme` above is the authoring theme document (owned here since
// objectui#5716), `ThemeEngine` (`packages/core/src/theme/ThemeEngine.ts`)
// turns it into CSS variables, and `ThemeProvider`
// (`packages/react/src/context/ThemeContext.tsx`) applies it. Retiring the
// dead component kind is not retiring theming.
//
// `ThemeSwitcherSchema` (`type: 'theme-switcher'`) and `ThemePreviewSchema`
// (`type: 'theme-preview'`) — the two sibling component kinds that used to
// follow this note — RETIRED in objectui#5647, by inheritance of the same
// ruling (option B) under the standing same-family default: identical
// evidence, measured with the same sweep and the same positive control.
// Neither literal appears at any `ComponentRegistry.register(...)` /
// `registerLazy(...)` site in `packages/*/src`, in `PROTOCOL_COMPONENTS` /
// `PALETTE_PLACEHOLDER_BLOCKS`, or in any fixture — declared-but-unenforced,
// the same ADR-0078 class as `'theme'` above. Their Zod objects,
// `ThemeUnionSchema` (which after `78cbdb530` held only these two members),
// and the `…SchemaType` inference aliases left `zod/theme.zod.ts` in the same
// change; `AnyComponentSchema` no longer carries a theme member, and the
// refusals are pinned in `__tests__/phase2-schemas.test.ts`.

// `ThemeDefinition` (the deprecated legacy alias of `Theme`) was DELETED here
// under the objectui#5716 zero-reader rider — zero in-repo readers (census in
// that PR). Use `Theme`.
