/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useCallback } from 'react';
import type { RowColorConfig } from '@object-ui/types';

/**
 * The row tint each colour NAME resolves to: one light and one dark value of
 * the `--os-row-tint` custom property, every class a complete literal.
 *
 * ## Why a custom property and not a bare `bg-*` class (objectui#12375)
 *
 * The tint has two painters. The `<tr>` paints it through
 * `ROW_TINT_SURFACE` below; the row's STICKY cells (selection checkbox, row
 * number, frozen columns, the right-pinned actions column) paint their own
 * opaque `bg-background`, because they sit over content scrolling beneath
 * them, and a `bg-*` class on the row never reaches them. Those cells layer
 * `--os-row-tint` over that opaque fill as a background IMAGE
 * (`data-table.tsx`'s `STICKY_ROW_TINT`, `ObjectGrid`'s right-pinned cell
 * classes), so a sticky cell shows exactly the colour the row shows, and
 * stays opaque in both themes.
 *
 * ## The two values
 *
 * - Light: the `-100` shade the grid always painted, opaque.
 * - Dark: the dark surface shade the badge palette uses (`BADGE_COLOR_MAP` in
 *   `@object-ui/fields`): `-950` at 40%, and `-800` at 50% for the neutral
 *   greys, whose `-950` sits on the dark background itself. The expression is
 *   the one Tailwind compiles `bg-red-950/40` to.
 *
 * Neither value sets a text colour: a tint is a surface, and the row keeps the
 * theme's foreground. The light-only `bg-*-100` this replaces put the dark
 * theme's light text on a light fill.
 *
 * Tailwind v4 builds only from scanned source text (see `headerColor.ts` in
 * `@object-ui/plugin-detail`, objectui#6178), so each entry is spelled out in
 * full: never assemble a class from the colour name.
 */
const COLOR_TO_CLASS: Record<string, string> = {
  red:
    '[--os-row-tint:var(--color-red-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-red-950)_40%,transparent)]',
  green:
    '[--os-row-tint:var(--color-green-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-green-950)_40%,transparent)]',
  blue:
    '[--os-row-tint:var(--color-blue-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-blue-950)_40%,transparent)]',
  yellow:
    '[--os-row-tint:var(--color-yellow-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-yellow-950)_40%,transparent)]',
  orange:
    '[--os-row-tint:var(--color-orange-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-orange-950)_40%,transparent)]',
  purple:
    '[--os-row-tint:var(--color-purple-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-purple-950)_40%,transparent)]',
  pink:
    '[--os-row-tint:var(--color-pink-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-pink-950)_40%,transparent)]',
  gray:
    '[--os-row-tint:var(--color-gray-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-gray-800)_50%,transparent)]',
  grey:
    '[--os-row-tint:var(--color-gray-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-gray-800)_50%,transparent)]',
  indigo:
    '[--os-row-tint:var(--color-indigo-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-indigo-950)_40%,transparent)]',
  teal:
    '[--os-row-tint:var(--color-teal-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-teal-950)_40%,transparent)]',
  cyan:
    '[--os-row-tint:var(--color-cyan-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-cyan-950)_40%,transparent)]',
  amber:
    '[--os-row-tint:var(--color-amber-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-amber-950)_40%,transparent)]',
  lime:
    '[--os-row-tint:var(--color-lime-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-lime-950)_40%,transparent)]',
  emerald:
    '[--os-row-tint:var(--color-emerald-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-emerald-950)_40%,transparent)]',
  rose:
    '[--os-row-tint:var(--color-rose-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-rose-950)_40%,transparent)]',
  sky:
    '[--os-row-tint:var(--color-sky-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-sky-950)_40%,transparent)]',
  violet:
    '[--os-row-tint:var(--color-violet-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-violet-950)_40%,transparent)]',
  fuchsia:
    '[--os-row-tint:var(--color-fuchsia-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-fuchsia-950)_40%,transparent)]',
  slate:
    '[--os-row-tint:var(--color-slate-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-slate-800)_50%,transparent)]',
  zinc:
    '[--os-row-tint:var(--color-zinc-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-zinc-800)_50%,transparent)]',
  stone:
    '[--os-row-tint:var(--color-stone-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-stone-800)_50%,transparent)]',
  neutral:
    '[--os-row-tint:var(--color-neutral-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-neutral-800)_50%,transparent)]',
};

/**
 * Paints the row with whatever `--os-row-tint` resolves to in the current
 * theme. Joined to every named entry above.
 */
const ROW_TINT_SURFACE = 'bg-[color:var(--os-row-tint)]';

/**
 * Maps a CSS color string to a Tailwind background class.
 * Falls back to undefined for unrecognised values (dynamic CSS colors
 * that cannot be represented as static Tailwind classes).
 */
function colorToClass(color: string): string | undefined {
  // Direct Tailwind class (e.g. "bg-red-200")
  if (color.startsWith('bg-')) return color;

  const lower = color.toLowerCase().trim();
  // `hasOwnProperty` rather than a bare index (objectui#6295, the quiet half):
  // this object literal inherits `constructor`, `toString` and friends, so an
  // authored colour value naming one of them used to hand the inherited member
  // back as the row's className. That never threw — it reached React as a class
  // attribute. (`Object.hasOwn` is ES2022; this workspace compiles against the
  // ES2020 lib.)
  return Object.prototype.hasOwnProperty.call(COLOR_TO_CLASS, lower)
    ? `${ROW_TINT_SURFACE} ${COLOR_TO_CLASS[lower]}`
    : undefined;
}

/**
 * Hook that returns a row-className resolver based on RowColorConfig.
 *
 * @param config  - RowColorConfig from the grid schema (optional)
 * @returns a function `(row) => className | undefined`
 */
export function useRowColor(config: RowColorConfig | undefined) {
  return useCallback(
    (row: Record<string, any>): string | undefined => {
      if (!config?.field || !config.colors) return undefined;

      const value = String(row[config.field] ?? '');
      // The same guard one call out, and this read is reached with RECORD DATA
      // (objectui#6295, the loud half): the authored map inherits
      // `Object.prototype`, so a record whose colour field holds `constructor` /
      // `toString` / `valueOf` / `hasOwnProperty` resolved to an inherited
      // FUNCTION. `if (!color)` below passes it (functions are truthy) and
      // `colorToClass` then called `.startsWith` on it — a TypeError thrown
      // inside the row-className resolver during render, crashing the grid on
      // data rather than on metadata.
      const color = Object.prototype.hasOwnProperty.call(config.colors, value)
        ? config.colors[value]
        : undefined;
      if (!color) return undefined;

      return colorToClass(color);
    },
    [config?.field, config?.colors],
  );
}
