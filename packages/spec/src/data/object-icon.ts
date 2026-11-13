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
 * graph, and the leaf does not join the package's published exports.
 */
export const OBJECT_ICON_SCHEMA = z.string().optional().describe('Icon name (Lucide/Material) for UI representation');
