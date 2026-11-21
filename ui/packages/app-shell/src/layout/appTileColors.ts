/**
 * An app's icon tile, the one rule every surface that draws an app's icon
 * follows (objectstack#36157): `appTileFace` answers it, `AppMark` and the home
 * launcher's tiles draw it.
 *
 * - An app that declares a hex `branding.primaryColor` gets a tile of that
 *   colour (objectui#12201), published as CSS custom properties on the tile
 *   (`appTileStyle`) that the static `BRANDED_TILE_CLASSES` utilities consume.
 * - An app that declares no usable colour gets a solid colour of its own: one
 *   name from the objects' palette (`OBJECT_COLORS` without its neutral
 *   `gray`), picked by the app's `name` (`autoTileColor`), drawn with the
 *   object tile's classes (`OBJECT_COLOR_TILE_CLASS`) and a white glyph. It is
 *   computed for display only: nothing is written back, and the app's primary
 *   controls keep the platform's default colour, since only a declared
 *   `branding` reaches the shell's theme.
 *
 * A declared `branding.logo` is drawn instead of any tile; that choice is the
 * surface's, before it asks for a face.
 *
 * @module
 */

import type { CSSProperties } from 'react';
import { contrastRatio, hexToHSL } from '@object-ui/core';
import { OBJECT_COLOR_TILE_CLASS } from '@object-ui/components';
import { OBJECT_COLORS, type ObjectColor } from '@objectstack/spec/data';

/** The two foregrounds `AppShell` pairs with a brand colour (`--primary-foreground`). */
const ON_BRAND_LIGHT = '#ffffff';
const ON_BRAND_DARK = '#0f172a';

/** The tile colours for one declared brand colour, light and dark. */
export interface AppTileColors {
  bg: string;
  fg: string;
  bgDark: string;
  fgDark: string;
}

/**
 * Derive the tile's colours from an app's declared `branding.primaryColor`, or
 * `undefined` when it declares no hex (the automatic colour then applies).
 *
 * Light theme: the declared colour itself, with whichever of the two brand
 * foregrounds contrasts more with it (WCAG ratio, `@object-ui/core`).
 * Dark theme: the declared hue lifted to the lightness floor `AppShell` gives
 * the active app's `--primary` on dark surfaces (at least 65 %, a very
 * saturated colour eased back), with the near-black foreground it pairs there —
 * so the active app's tile matches its own primary controls in both themes.
 */
export function appTileColors(primaryColor: unknown): AppTileColors | undefined {
  if (typeof primaryColor !== 'string' || !primaryColor.startsWith('#')) return undefined;
  const hsl = hexToHSL(primaryColor);
  const parts = hsl ? /^(\d+) (\d+)% (\d+)%$/.exec(hsl) : null;
  if (!parts) return undefined;
  const [h, s, l] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const onLight = contrastRatio(primaryColor, ON_BRAND_LIGHT) ?? 0;
  const onDark = contrastRatio(primaryColor, ON_BRAND_DARK) ?? 0;
  const darkSaturation = s > 80 ? Math.max(s - 10, 70) : s;
  return {
    bg: `hsl(${h} ${s}% ${l}%)`,
    fg: onLight >= onDark ? ON_BRAND_LIGHT : ON_BRAND_DARK,
    bgDark: `hsl(${h} ${darkSaturation}% ${Math.max(l, 65)}%)`,
    fgDark: ON_BRAND_DARK,
  };
}

/**
 * The tile for a declared `primaryColor`. The utility strings are literals so
 * Tailwind emits them at build time; the author's colour reaches them only as
 * CSS custom properties, so `dark:` stays a real variant the theme controls
 * (AGENTS.md section 2, the author-declared colour carve-out).
 */
export const BRANDED_TILE_CLASSES =
  'bg-[color:var(--os-app-tile-bg)] text-[color:var(--os-app-tile-fg)] ' +
  'dark:bg-[color:var(--os-app-tile-bg-dark)] dark:text-[color:var(--os-app-tile-fg-dark)]';

/** The custom properties `BRANDED_TILE_CLASSES` reads, for a tile's `style`. */
export function appTileStyle(colors: AppTileColors): CSSProperties {
  return {
    '--os-app-tile-bg': colors.bg,
    '--os-app-tile-fg': colors.fg,
    '--os-app-tile-bg-dark': colors.bgDark,
    '--os-app-tile-fg-dark': colors.fgDark,
  } as CSSProperties;
}

/** A palette name an app without a declared colour can be given: every one but `gray`. */
export type AutoTileColor = Exclude<ObjectColor, 'gray'>;

/**
 * The colours `autoTileColor` picks from, in the palette's own order. Its
 * order is part of the rule: reordering it, or adding a name, moves every app
 * that has no declared colour to another one.
 */
export const AUTO_TILE_COLORS: readonly AutoTileColor[] = OBJECT_COLORS.filter(
  (c): c is AutoTileColor => c !== 'gray',
);

/**
 * The palette colour for a key (an app's `name`): djb2 over the key's UTF-16
 * code units, kept to a signed 32-bit integer after every step, its absolute
 * value taken modulo the number of `AUTO_TILE_COLORS`. The same key gets the
 * same colour on every load, for every viewer and in every environment. The
 * algorithm and the colour of a set of names are pinned by
 * `__tests__/AppSwitcher.appIdentity-12201.test.tsx`.
 */
export function autoTileColor(key: string): AutoTileColor {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) + hash + key.charCodeAt(i);
    hash = hash & hash;
  }
  return AUTO_TILE_COLORS[Math.abs(hash) % AUTO_TILE_COLORS.length];
}

/** The app fields a tile reads — the spec's `AppSchema` names. */
export interface AppTileApp {
  name?: string;
  branding?: { primaryColor?: string } | null;
}

/** How a tile is painted: its utilities, and for a declared colour the custom properties they read. */
export type AppTileFace =
  | { kind: 'declared'; className: string; style: CSSProperties }
  | { kind: 'auto'; color: AutoTileColor; className: string }
  | { kind: 'neutral'; className: string };

/** The tile drawn with no app to name (no `name` to pick a colour by): theme tokens only. */
const NEUTRAL_TILE_CLASSES = 'border bg-muted text-muted-foreground';

/**
 * The face of an app's icon tile: its declared hex `primaryColor`, else its
 * automatic palette colour, else (no app, or one without a `name`) the
 * neutral tile.
 */
export function appTileFace(app: AppTileApp | null | undefined): AppTileFace {
  const colors = appTileColors(app?.branding?.primaryColor);
  if (colors) return { kind: 'declared', className: BRANDED_TILE_CLASSES, style: appTileStyle(colors) };
  const name = typeof app?.name === 'string' ? app.name : '';
  if (!name) return { kind: 'neutral', className: NEUTRAL_TILE_CLASSES };
  const color = autoTileColor(name);
  return { kind: 'auto', color, className: `text-white ${OBJECT_COLOR_TILE_CLASS[color]}` };
}
