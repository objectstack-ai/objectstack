/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectIconTile — an object's icon as a white glyph on a rounded square of the
 * object's palette colour (objectstack#35985). Every place that draws an
 * object's icon draws this, so one object looks the same in the menu, its list
 * and record headers and the chips that point at it.
 *
 * The colour is a NAME from the spec's closed palette (`OBJECT_COLORS`,
 * `ObjectSchema.color`), never a CSS value. Each name maps to a fixed pair of
 * Tailwind utilities, one per theme, chosen so the white glyph keeps at least
 * the 3:1 non-text contrast WCAG 1.4.11 asks for on both. Static class strings,
 * not an inline colour: the palette is the component's, and `ui/AGENTS.md`
 * (Styling) allows an inline colour only for a value the author typed.
 *
 * No colour, or a name the palette does not hold (metadata written by an older
 * or a newer spec), draws the neutral `gray`.
 */

import * as React from 'react';
import { OBJECT_COLORS, type ObjectColor } from '@objectstack/spec/data';
import { LazyIcon } from '../lib/lazy-icon';
import { cn } from '../lib/utils';

/**
 * The square's background per palette name, light theme then `.dark`.
 * White-glyph contrast (light / dark): gray 4.83 / 4.83, blue 5.17 / 3.68,
 * teal 3.74 / 3.74, green 3.30 / 3.30, amber 3.19 / 3.19, orange 3.56 / 3.56,
 * red 4.83 / 3.76, pink 4.60 / 3.53, purple 5.38 / 3.96. The names that keep
 * 3:1 one shade lighter take it in the dark theme, so they do not sink into a
 * dark page; the rest keep their light value. Pinned by
 * `__tests__/object-icon-tile-35985.test.tsx`.
 */
export const OBJECT_COLOR_TILE_CLASS: Readonly<Record<ObjectColor, string>> = {
  gray: 'bg-gray-500 dark:bg-gray-500',
  blue: 'bg-blue-600 dark:bg-blue-500',
  teal: 'bg-teal-600 dark:bg-teal-600',
  green: 'bg-green-600 dark:bg-green-600',
  amber: 'bg-amber-600 dark:bg-amber-600',
  orange: 'bg-orange-600 dark:bg-orange-600',
  red: 'bg-red-600 dark:bg-red-500',
  pink: 'bg-pink-600 dark:bg-pink-500',
  purple: 'bg-purple-600 dark:bg-purple-500',
};

const PALETTE: ReadonlySet<string> = new Set(OBJECT_COLORS);

/** A stored colour narrowed to a palette name; anything else is `gray`. */
export function objectColorOrDefault(color: unknown): ObjectColor {
  return typeof color === 'string' && PALETTE.has(color) ? (color as ObjectColor) : 'gray';
}

/**
 * Square edge, glyph edge and corner per size. The corners are pixel values,
 * not the theme's `rounded-*` steps: those follow `--radius`, which a theme
 * may set large enough to turn the square into a circle. The glyph edge is
 * important (`!`): a host row that sizes every nested `svg` (a command item's
 * `[&_svg]:size-4`, a header's icon slot) would otherwise grow the glyph to
 * the tile's own edge.
 */
/** The four tile sizes: 16, 20, 24 and 32px squares. */
export type ObjectIconTileSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_CLASS: Readonly<Record<ObjectIconTileSize, { tile: string; glyph: string }>> = {
  xs: { tile: 'h-4 w-4 rounded-[4px]', glyph: 'h-2.5! w-2.5!' },
  sm: { tile: 'h-5 w-5 rounded-[5px]', glyph: 'h-3! w-3!' },
  md: { tile: 'h-6 w-6 rounded-[6px]', glyph: 'h-3.5! w-3.5!' },
  lg: { tile: 'h-8 w-8 rounded-[8px]', glyph: 'h-5! w-5!' },
};

export interface ObjectIconTileProps {
  /** Lucide icon name (kebab or Pascal case); none or unknown draws the generic glyph. */
  icon?: string;
  /** Palette name (`ObjectSchema.color`); none or unknown draws `gray`. */
  color?: string;
  /** Default `sm` (20px), the size a navigation row's 16px line icon is replaced with. */
  size?: ObjectIconTileSize;
  className?: string;
  /** Accessible name; omit when the object's label sits beside the tile (the tile is then hidden from assistive tech). */
  title?: string;
  /**
   * The glyph component, when the host already resolved `icon` through its own
   * resolver (the navigation's `resolveIcon`, whose generic glyph differs from
   * `LazyIcon`'s): the tile then draws exactly the glyph the line icon drew.
   * Omitted, the tile resolves `icon` with `LazyIcon`.
   */
  glyph?: React.ElementType;
}

export function ObjectIconTile({ icon, color, size = 'sm', className, title, glyph: Glyph }: ObjectIconTileProps) {
  const name = objectColorOrDefault(color);
  const s = SIZE_CLASS[size] ?? SIZE_CLASS.sm;
  return (
    <span
      data-object-icon-tile={name}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn('inline-flex shrink-0 items-center justify-center text-white', s.tile, OBJECT_COLOR_TILE_CLASS[name], className)}
    >
      {Glyph ? <Glyph className={s.glyph} strokeWidth={2.25} aria-hidden /> : <LazyIcon name={icon} className={s.glyph} strokeWidth={2.25} aria-hidden />}
    </span>
  );
}
