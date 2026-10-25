/**
 * launcherTile
 *
 * The look of one launcher tile, shared by the console home's apps strip
 * (`HomeAppsStrip`) and the `tile-grid` page block (objectui#12197), so the two
 * draw one tile and cannot drift apart: the 112 px box, the 56 px icon square,
 * and the deterministic icon gradient.
 *
 * Moved here from `HomeAppsStrip.tsx` unchanged, string for string.
 *
 * @module
 */

// iOS-springboard icon tints: a vibrant gradient per app, assigned
// deterministically by name so an app keeps its colour across sessions.
// (Literal class strings so Tailwind's source scan emits them.)
const ICON_GRADIENTS = [
  'from-blue-500 to-indigo-600',
  'from-violet-500 to-purple-600',
  'from-pink-500 to-rose-600',
  'from-amber-400 to-orange-500',
  'from-emerald-500 to-teal-600',
  'from-sky-500 to-cyan-600',
  'from-fuchsia-500 to-pink-600',
  'from-orange-500 to-red-600',
  'from-indigo-500 to-blue-600',
  'from-teal-500 to-green-600',
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The icon gradient for a tile, chosen by a stable key (an app's `name`). */
export function launcherIconGradient(key: string): string {
  return ICON_GRADIENTS[hashStr(key) % ICON_GRADIENTS.length];
}

/** One tile's box: 112 px wide, the 56 px icon above a one-line name. */
export const TILE_CLASSES =
  'group relative flex w-28 flex-col items-center gap-2 rounded-lg px-2 py-3 text-center transition-colors hover:bg-muted active:scale-[0.96]';
/** The 56 px icon square every tile draws, the app's own or a dashed stand-in. */
export const ICON_BOX_CLASSES = 'relative inline-flex size-14 items-center justify-center rounded-[14px]';
