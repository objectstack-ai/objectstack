/**
 * Explicit-hex badge colour math (objectui#5141): one author-declared hex in,
 * the soft-pill and dot palette out. The rendering half (the static Tailwind
 * utility strings, `getBadgeHexAppearance`, `getDotHexAppearance`) and the
 * block's rationale live in `index.tsx`, the only reader.
 *
 * Not re-exported from the package entry: `getBadgeHexAppearance` and
 * `getDotHexAppearance` are the public faces of this palette.
 */

/** WCAG AA floor for badge label text against its own pill surface. */
const BADGE_TEXT_CONTRAST = 4.5;

/**
 * Visibility floor for the `appearance: 'dot'` marker. A dot carries no text,
 * so the AA *text* ratio does not apply; this is the measured floor of the
 * -500 shades `DOT_COLOR_MAP` (in `index.tsx`) ships today (yellow-500
 * `#eab308` is the weakest at 1.92:1 on white). Pinning it here means an author-declared dot is never
 * less visible than the palette dot it replaces.
 */
const DOT_CONTRAST_FLOOR = 1.9;

interface Rgb { r: number; g: number; b: number }

/** Surfaces a dot sits on — used only to keep the dot itself visible. */
const LIGHT_SURFACE: Rgb = { r: 255, g: 255, b: 255 };
const DARK_SURFACE: Rgb = { r: 10, g: 10, b: 10 };

const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function parseHexColor(hex: string): Rgb | undefined {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return undefined;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = (((gn - bn) / d) % 6 + 6) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let p: [number, number, number];
  if (hue < 60) p = [c, x, 0];
  else if (hue < 120) p = [x, c, 0];
  else if (hue < 180) p = [0, c, x];
  else if (hue < 240) p = [0, x, c];
  else if (hue < 300) p = [x, 0, c];
  else p = [c, 0, x];
  return {
    r: Math.round((p[0] + m) * 255),
    g: Math.round((p[1] + m) * 255),
    b: Math.round((p[2] + m) * 255),
  };
}

const rgbToHex = ({ r, g, b }: Rgb): string =>
  '#' + [r, g, b].map((v) => clampNum(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

/** WCAG relative luminance of an sRGB color. */
function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colors (1..21). */
function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Walk the declared hue for the lightness *closest to the declared one* that
 * still clears `target` against `surface`.
 *
 * Choosing the closest passing lightness rather than simply maximizing
 * contrast is what keeps the author's colour recognizable — maximizing would
 * collapse every badge label to black or white and re-lose the declaration we
 * are here to preserve. Only when the hue cannot reach the target at any
 * lightness (a very low-chroma declaration against a mid surface) do we fall
 * back to black or white, whichever is further from the surface: legibility
 * outranks fidelity.
 */
function readableOnSurface(
  h: number,
  s: number,
  declaredL: number,
  surface: Rgb,
  target: number,
): Rgb {
  let best: Rgb | undefined;
  let bestDistance = Infinity;
  for (let step = 0; step <= 100; step++) {
    const lightness = step / 100;
    const candidate = hslToRgb(h, s, lightness);
    if (contrastRatio(candidate, surface) < target) continue;
    const distance = Math.abs(lightness - declaredL);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  if (best) return best;
  const black: Rgb = { r: 0, g: 0, b: 0 };
  const white: Rgb = { r: 255, g: 255, b: 255 };
  return contrastRatio(black, surface) >= contrastRatio(white, surface) ? black : white;
}

/** The six pill colors plus the two dot colors derived from one declared hex. */
export interface HexBadgePalette {
  bg: string;
  fg: string;
  border: string;
  bgDark: string;
  fgDark: string;
  borderDark: string;
  dot: string;
  dotDark: string;
}

/**
 * Derive a full soft-pill palette from an author-declared hex.
 *
 * The declared LIGHTNESS is what separates two same-hue tiers (`#2ecc71` is
 * l=0.49, `#1e8449` is l=0.32 — their hues differ by 0.1°), so it has to
 * survive into the *surface*. A fixed pale tint — the obvious reading of
 * "compute a soft pill from the hex" — does not carry it: measured, that
 * leaves the reported pair ΔE 2.3 apart in Lab, at the ~2.3 just-noticeable
 * threshold, which would close this issue on paper while the user still cannot
 * tell the two badges apart. Letting the tint depth track the declared
 * lightness puts them ΔE 8.0 apart instead.
 */
export function deriveHexBadgePalette(color: string): HexBadgePalette | undefined {
  const rgb = parseHexColor(color);
  if (!rgb) return undefined;
  const { h, s, l } = rgbToHsl(rgb);
  // Keep a usable chroma at both ends: a fully desaturated declaration stays
  // neutral instead of being pushed into a hue it never declared, and a neon
  // one is reined in so the pill never fights the row it sits in.
  const sat = clampNum(s, 0.18, 0.92);

  // Light theme: pale for light declarations (the -50 look we ship today),
  // deepening as the declared colour darkens.
  const bgLightness = 0.95 - 0.32 * (1 - l);
  const bg = hslToRgb(h, sat * (0.55 + 0.25 * (1 - l)), bgLightness);
  const border = hslToRgb(h, sat * 0.62, clampNum(bgLightness - 0.14, 0, 1));
  const fg = readableOnSurface(h, sat, l, bg, BADGE_TEXT_CONTRAST);

  // Dark theme: the same idea mirrored — a dark surface whose depth tracks the
  // declared lightness, with the label lifted until it clears AA against it.
  const bgDarkLightness = 0.10 + 0.30 * l;
  const bgDark = hslToRgb(h, sat * 0.6, bgDarkLightness);
  const borderDark = hslToRgb(h, sat * 0.55, clampNum(bgDarkLightness + 0.12, 0, 1));
  const fgDark = readableOnSurface(h, sat, l, bgDark, BADGE_TEXT_CONTRAST);

  return {
    bg: rgbToHex(bg),
    fg: rgbToHex(fg),
    border: rgbToHex(border),
    bgDark: rgbToHex(bgDark),
    fgDark: rgbToHex(fgDark),
    borderDark: rgbToHex(borderDark),
    dot: rgbToHex(readableOnSurface(h, sat, l, LIGHT_SURFACE, DOT_CONTRAST_FLOOR)),
    dotDark: rgbToHex(readableOnSurface(h, sat, l, DARK_SURFACE, DOT_CONTRAST_FLOOR)),
  };
}
