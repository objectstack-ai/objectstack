/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Disclosure Component Zod Validators
 * 
 * Zod validation schemas for collapsible/disclosure components.
 * Following @objectstack/spec UI specification format.
 * 
 * @module zod/disclosure
 * @packageDocumentation
 */

import { z } from 'zod';
import { handlerKeyRefusal, retirementTombstone } from './tombstone.zod.js';
import { BaseSchema, SchemaNodeSchema } from './base.zod.js';

/**
 * Accordion Item Schema
 */
export const AccordionItemSchema = z.object({
  value: z.string().describe('Unique accordion item identifier'),
  title: z.string().describe('Accordion item title'),
  content: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).describe('Accordion item content'),
  disabled: z.boolean().optional().describe('Whether item is disabled'),
});

/**
 * Accordion Schema - Accordion component
 */
export const AccordionSchema = BaseSchema.extend({
  type: z.literal('accordion'),
  items: z.array(AccordionItemSchema).describe('Accordion items'),
  accordionType: z.enum(['single', 'multiple']).optional().describe('Accordion type'),
  collapsible: z.boolean().optional().describe('Whether items can be collapsed'),
  defaultValue: z.union([z.string(), z.array(z.string())]).optional().describe('Default open item(s)'),
  value: z.union([z.string(), z.array(z.string())]).optional().describe('Controlled open item(s)'),
  onValueChange: handlerKeyRefusal('onValueChange', 'runtime-slot', 'Value change handler'),
  variant: z.enum(['default', 'bordered', 'separated']).optional().describe('Accordion variant'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `accordion` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker over one program per workspace package plus the apps and examples, on a '
    + 'BUILT tree, no renderer read consumes `body` or `children` for this node, and `SchemaRenderer` '
    + 'strips both out of the props bag it spreads. An authored value therefore rendered NOTHING — no '
    + 'render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `accordionType`, `collapsible`, `items`. '
    + '`ui:accordion` is the measured SOLE owner of the bare `accordion` key (`page:accordion` passes `skipFallback: true`); '
    + 're-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `accordion` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker over one program per workspace package plus the apps and examples, on a '
    + 'BUILT tree, no renderer read consumes `body` or `children` for this node, and `SchemaRenderer` '
    + 'strips both out of the props bag it spreads. An authored value therefore rendered NOTHING — no '
    + 'render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `accordionType`, `collapsible`, `items`. '
    + '`ui:accordion` is the measured SOLE owner of the bare `accordion` key (`page:accordion` passes `skipFallback: true`); '
    + 're-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
});

/**
 * Collapsible Schema - Collapsible component
 */
export const CollapsibleSchema = BaseSchema.extend({
  type: z.literal('collapsible'),
  trigger: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).describe('Trigger content'),
  content: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).describe('Collapsible content'),
  defaultOpen: z.boolean().optional().describe('Default open state'),
  // objectui#8236, ADR-0049 — the guidance string is the maintainer's ruling
  // text VERBATIM (2026-09-17 「9593 A,其他同意」); ⛔ do not paraphrase it and
  // ⛔ do not "correct" it to 「author `defaultOpen` instead」, which the ruling
  // measured and refused as a non-equivalent (`defaultOpen` seeds the initial
  // state, it does not give the author control).
  open: retirementTombstone(
    '`open` is not authorable in SDUI: controlled state needs a handler the schema cannot carry '
    + '(objectui#6124); use `defaultOpen` for the initial state',
  ),
  onOpenChange: handlerKeyRefusal('onOpenChange', 'runtime-slot', 'Open change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `collapsible` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `content`, `defaultOpen`, `trigger`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `collapsible` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `content`, `defaultOpen`, `trigger`.',
  ),
});

/**
 * Toggle Group Item Schema
 */
export const ToggleGroupItemSchema = z.object({
  value: z.string().describe('Item value'),
  label: z.string().describe('Item label'),
  disabled: z.boolean().optional().describe('Whether item is disabled'),
});

/**
 * Toggle Group Schema - Toggle group component
 */
export const ToggleGroupSchema = BaseSchema.extend({
  type: z.literal('toggle-group'),
  selectionType: z.enum(['single', 'multiple']).optional().describe('Selection type'),
  variant: z.enum(['default', 'outline']).optional().describe('Toggle group variant'),
  size: z.enum(['default', 'sm', 'lg']).optional().describe('Toggle group size'),
  items: z.array(ToggleGroupItemSchema).optional().describe('Toggle group items'),
  defaultValue: z.union([z.string(), z.array(z.string())]).optional().describe('Default value(s)'),
  value: z.union([z.string(), z.array(z.string())]).optional().describe('Controlled value(s)'),
  onValueChange: handlerKeyRefusal('onValueChange', 'runtime-slot', 'Value change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `toggle-group` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `items`, `selectionType`, `size`, `value`, `variant`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `toggle-group` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `items`, `selectionType`, `size`, `value`, `variant`.',
  ),
});

/**
 * Disclosure Schema Union - All disclosure component schemas
 */
const DisclosureSchemaInferred = z.discriminatedUnion('type', [
  AccordionSchema,
  CollapsibleSchema,
  ToggleGroupSchema,
]);

/**
 * The TYPE of {@link DisclosureSchema}, NAMED so declaration emit prints it by
 * reference (objectui#11573): see "Why every category union's TYPE is named"
 * on `AnyComponentSchema` (`index.zod.ts`). It adds no member.
 */
export interface DisclosureZodType extends DisclosureSchemaInferredType {
  options: DisclosureSchemaInferredType['options'];
}
type DisclosureSchemaInferredType = typeof DisclosureSchemaInferred;

/** The union above, typed by its named {@link DisclosureZodType}. */
export const DisclosureSchema: DisclosureZodType = DisclosureSchemaInferred;
