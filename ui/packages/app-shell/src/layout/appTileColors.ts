/**
 * The fallback app tile's colours, derived from an app's declared
 * `branding.primaryColor` (objectui#12201). `AppMark` publishes them as CSS
 * custom properties on the tile; see that component for why.
 *
 * @module
 */

import { contrastRatio, hexToHSL } from '@object-ui/core';

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
 * `undefined` when it declares no hex (the neutral tile then applies).
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
