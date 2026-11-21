// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * `ObjectSchema.icon` — the object's icon name — declared once for the two
 * shapes that carry it: `ObjectSchema` (`./object.zod.ts`) and the AI
 * blueprint object (`BlueprintObjectSchema` and its strict mirror,
 * `../ai/solution-blueprint.zod.ts`), so a blueprint accepts exactly the icon
 * the object accepts.
 *
 * Declared in its own module, outside the `data` barrel, so the blueprint
 * reads this leaf without the object schema joining the AI entry's module
 * graph. `OBJECT_ICON_SCHEMA` and `OBJECT_COLOR_SCHEMA` stay out of the
 * package's published exports; the palette, `OBJECT_COLORS` and its
 * `ObjectColor` type, is re-exported from `@objectstack/spec/data` for the
 * console's tile and picker.
 */
export const OBJECT_ICON_SCHEMA = z.string().optional().describe('Icon name (Lucide/Material) for UI representation');

/**
 * The closed palette an object's `color` is picked from (#35985). Nine hue
 * names, no free colour values: the console draws the object's icon as a white
 * glyph on a rounded square of this colour, with a light-theme and a
 * dark-theme value per name chosen so the white glyph stays legible on both.
 * `gray` is the neutral every object without a `color` is drawn in.
 *
 * Status names (`success`, `danger`, …) are deliberately absent: an object's
 * colour tells objects apart, it does not mean a state.
 */
export const OBJECT_COLORS = ['gray', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'purple'] as const;

/** One name from {@link OBJECT_COLORS}. */
export type ObjectColor = (typeof OBJECT_COLORS)[number];

/**
 * `ObjectSchema.color` — declared once, beside `icon`, for the same two shapes
 * (#35985): the object and the AI blueprint object accept exactly the same
 * palette names.
 */
export const OBJECT_COLOR_SCHEMA = z
  .enum(OBJECT_COLORS)
  .optional()
  .describe(
    `Object colour, one name from the fixed palette (${OBJECT_COLORS.join(', ')}). The console draws the object's icon as a white glyph on a rounded square of this colour, so one object looks the same wherever its icon appears. No free colour values. Omit to draw the neutral \`gray\`.`,
  );
