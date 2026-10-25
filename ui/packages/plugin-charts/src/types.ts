/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * TypeScript type definitions for @object-ui/plugin-charts
 *
 * These types can be imported by applications using this plugin
 * to get full TypeScript support for chart schemas.
 */

/**
 * Bar Chart component schema.
 * Renders a bar chart using Recharts library.
 *
 * ⚠️ RE-EXPORTED, not declared here. The authority is
 * `BarChartSchema` in `@object-ui/types` (`packages/types/src/data-display.ts`),
 * which is also where the zod mirror `AnyComponentSchema` validates against
 * lives — so the type an author reads and the schema that accepts their
 * document cannot drift apart.
 *
 * Why that direction and not the other (objectui#6273, the 2026-08-25 family
 * ruling objectui#6172 / 甲-A1): `@object-ui/types` is the lower layer and
 * cannot import from a plugin without creating a cycle, so of the two possible
 * authorities only this one is legal.
 *
 * The two declarations were measured structurally before this re-point rather
 * than assumed equivalent — same heritage (`BaseSchema`), same six members,
 * same per-member types and optionality, mutually assignable in both
 * directions — so nothing about the published shape changes here. The import
 * path `@object-ui/plugin-charts` keeps working exactly as before.
 *
 * @example
 * ```typescript
 * import type { BarChartSchema } from '@object-ui/plugin-charts';
 *
 * const chartSchema: BarChartSchema = {
 *   type: 'bar-chart',
 *   data: [
 *     { name: 'Jan', value: 400 },
 *     { name: 'Feb', value: 300 }
 *   ],
 *   dataKey: 'value',
 *   xAxisKey: 'name'
 * }
 * ```
 */
export type { BarChartSchema } from '@object-ui/types';
