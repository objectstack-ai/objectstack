/**
 * launcherTile
 *
 * The look of one launcher tile, shared by the console home's apps strip
 * (`HomeAppsStrip`) and the `tile-grid` page block (objectui#12197), so the two
 * draw one tile and cannot drift apart: the 112 px box, the 56 px icon square,
 * and the solid colour of a tile that declares none (objectstack#36157; the
 * ten-gradient table it replaces is gone).
 *
 * @module
 */

import { OBJECT_COLOR_TILE_CLASS } from '@object-ui/components';
import { autoTileColor } from '../../layout/appTileColors.js';

/**
 * The solid tile colour for a launcher entry with no colour of its own,
 * chosen by a stable key (objectstack#36157): the apps strip passes nothing
 * here (an app's tile is `appTileFace`'s), the `tile-grid` block keys its
 * tiles by their `href` (else label). The same palette and pick as an app
 * without a declared colour, so a block's tile and Home's tile are one look.
 */
export function launcherTileColorClasses(key: string): string {
  return `text-white ${OBJECT_COLOR_TILE_CLASS[autoTileColor(key)]}`;
}

/** One tile's box: 112 px wide, the 56 px icon above a one-line name. */
export const TILE_CLASSES =
  'group relative flex w-28 flex-col items-center gap-2 rounded-lg px-2 py-3 text-center transition-colors hover:bg-muted active:scale-[0.96]';
/** The 56 px icon square every tile draws, the app's own or a dashed stand-in. */
export const ICON_BOX_CLASSES = 'relative inline-flex size-14 items-center justify-center rounded-[14px]';
