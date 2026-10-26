/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Product-page block Zod Validators
 *
 * The arms for the five product-neutral blocks `@object-ui/app-shell` registers
 * for pages a product composes as metadata (objectui#12197): `hero`, `stat`,
 * `usage-bar`, `checklist` and `tile-grid`
 * (`console/blocks/productBlocks.tsx`). The TypeScript twin is
 * `../product-blocks.ts`.
 *
 * ## Why the arms land with the registrations
 *
 * `AnyComponentSchema` refuses a registered type it has no arm for, with one
 * `invalid_union` issue at `type`, so a page placing the block could not pass
 * `safeValidateSchema` or `objectui validate`. The count of registered types
 * still refused there is ratcheted by
 * `packages/cli/src/__tests__/registered-types-validate-ratchet-10859.test.ts`,
 * which never rises, so each registration and its arm ship together.
 *
 * ## Declared here, measured from the blocks' read points
 *
 * `@objectstack/spec` has no `ComponentPropsMap` row for these blocks, so
 * nothing but the binding and the label shape is read by reference: the
 * members below are the keys each renderer reads, and no other. Every bag is
 * strict, and both content channels are refused by name (objectui#9256's rule
 * for a node that reads neither).
 *
 * ## The API binding, and its holes
 *
 * Each block reads the spec's API binding (`ElementApiDataSourceSchema`, by
 * reference) as its `dataSource`. `SchemaRenderer` binds the value it selects
 * as `data`, so a member the response may supply also accepts a whole-string
 * `${…}` hole ({@link expressionHole}) beside its literal type. A hole is
 * accepted only where it stands for the WHOLE value — `'${data.used}'`, never
 * `'used: ${data.used}'` — because only a whole-string hole evaluates to the
 * typed value (a number, a boolean, a list) rather than to text.
 *
 * ⛔ No `.default()` anywhere in this module — see the "authors no default"
 * note in `index.zod.ts`.
 *
 * @module zod/product-blocks
 * @packageDocumentation
 */

import { z } from 'zod';
import {
  ElementApiDataSourceSchema as SpecElementApiDataSourceSchema,
  I18nLabelSchema as SpecI18nLabelSchema,
} from '@objectstack/spec/ui';
import { BaseSchema, SchemaNodeSchema } from './base.zod.js';
import { stripImportedDefaults } from './imported-defaults.js';
import { retirementTombstone } from './tombstone.zod.js';

/** A whole-string `${…}` hole: the single template the evaluator returns typed. */
const WHOLE_HOLE_RE = /^\$\{[^}]+\}$/;

/**
 * A whole-string `${…}` hole, evaluated against the block's bound `data` —
 * e.g. `'${data.storage.usedMb}'`.
 */
const expressionHole = (what: string) =>
  z
    .string()
    .regex(WHOLE_HOLE_RE, {
      error: () =>
        `A string here must be one whole \`\${…}\` hole that evaluates to ${what}, such as `
        + '`${data.used}`; write the value itself otherwise.',
    })
    .describe(`A whole-string \`\${…}\` hole that evaluates to ${what} against the block's bound \`data\``);

/** A copy string: plain, or an inline translation map resolved in the viewer's language. */
const label = (description: string) => stripImportedDefaults(SpecI18nLabelSchema).describe(description);

/** The API binding every product block reads as `dataSource`. */
const apiBinding = () =>
  stripImportedDefaults(SpecElementApiDataSourceSchema)
    .optional()
    .describe(
      'API binding — `@objectstack/spec` `ElementApiDataSourceSchema`, the API shape of '
      + '`PageComponentSchema.dataSource`, by reference: { provider: \'api\', read: { url }, path? }. '
      + 'The value it selects is `data` in this block\'s `${…}` holes and its `visibleWhen`.',
    );

/** One refusal string for both content channels of a product block. */
const neitherChannel = (type: string, reads: string) =>
  `REFUSED (objectui#12197) — \`${type}\` reads NEITHER content channel: it draws ${reads} from its `
  + '`properties` bag, and `SchemaRenderer` strips both channels out of the props bag it spreads. An authored '
  + 'value would render NOTHING — no render-time error or warning and no element; only the parser tier\'s '
  + '`not-a-container` warning (objectui#9910) noticed it, because the registration declares no `children` input.';

/** `hero` — the page-top card of a product page. Pinned by `../__tests__/product-block-arms-12197.test.ts`. */
export const HeroBlockSchema = BaseSchema.extend({
  type: z.literal('hero'),
  properties: z
    .strictObject({
      title: label('The card\'s heading.'),
      subtitle: label('One line under the heading.').optional(),
      meta: z
        .string()
        .optional()
        .describe('A value drawn in monospace with a copy-to-clipboard button, e.g. a hostname.'),
      status: label('A status chip beside the heading.').optional(),
      statusTone: z
        .enum(['neutral', 'success', 'warning', 'danger'])
        .optional()
        .describe('The status chip\'s colour; `neutral` when omitted.'),
      primary: SchemaNodeSchema.optional().describe('The primary action: an `element:button` or `action:button` node.'),
      secondary: SchemaNodeSchema.optional().describe('The secondary action, drawn after the primary one.'),
    })
    .describe('The `hero` props bag.'),
  dataSource: apiBinding(),
  body: retirementTombstone(neitherChannel('hero', 'its heading, lines and actions')),
  children: retirementTombstone(neitherChannel('hero', 'its heading, lines and actions')),
});

/** `stat` — one labelled figure. */
export const StatBlockSchema = BaseSchema.extend({
  type: z.literal('stat'),
  properties: z
    .strictObject({
      label: label('What the figure counts.'),
      value: z
        .union([z.number(), z.string()])
        .describe('The figure: a number, formatted in the viewer\'s locale, or text drawn as written (a `${…}` hole included).'),
      hint: label('One muted line under the figure.').optional(),
    })
    .describe('The `stat` props bag.'),
  dataSource: apiBinding(),
  body: retirementTombstone(neitherChannel('stat', 'its label, figure and hint')),
  children: retirementTombstone(neitherChannel('stat', 'its label, figure and hint')),
});

/** `usage-bar` — how much of a limit is used, as a bar. */
export const UsageBarBlockSchema = BaseSchema.extend({
  type: z.literal('usage-bar'),
  properties: z
    .strictObject({
      label: label('What is being used.'),
      used: z.union([z.number(), expressionHole('a number')]).describe('How much is used.'),
      limit: z
        .union([z.number(), expressionHole('a number')])
        .optional()
        .describe('The limit. Absent or 0 means unlimited: the block draws the amount used and no bar.'),
      unit: label('The unit drawn after each amount, e.g. `MB`.').optional(),
    })
    .describe('The `usage-bar` props bag.'),
  dataSource: apiBinding(),
  body: retirementTombstone(neitherChannel('usage-bar', 'its label, amounts and bar')),
  children: retirementTombstone(neitherChannel('usage-bar', 'its label, amounts and bar')),
});

/** One `checklist` item. */
export const ChecklistBlockItemSchema = z.strictObject({
  label: label('The step.'),
  done: z.union([z.boolean(), expressionHole('a boolean')]).describe('Whether the step is done.'),
  action: SchemaNodeSchema.optional().describe('An action drawn beside an open step: an `element:button` or `action:button` node.'),
});

/** `checklist` — steps that tick as they are done. */
export const ChecklistBlockSchema = BaseSchema.extend({
  type: z.literal('checklist'),
  properties: z
    .strictObject({
      items: z.array(ChecklistBlockItemSchema).min(1).describe('The steps, in order.'),
      collapsedWhenDone: z
        .boolean()
        .optional()
        .describe('Draw nothing once every step is done; `false` when omitted.'),
    })
    .describe('The `checklist` props bag.'),
  dataSource: apiBinding(),
  body: retirementTombstone(neitherChannel('checklist', 'its steps')),
  children: retirementTombstone(neitherChannel('checklist', 'its steps')),
});

/** One `tile-grid` tile. */
export const TileGridBlockItemSchema = z.strictObject({
  label: label('The tile\'s name.'),
  href: z.string().min(1).describe('Where the tile leads: a console route, or an absolute URL.'),
  icon: z.string().optional().describe('A Lucide icon name; a generic app icon when omitted.'),
  caption: label('One muted line under the name.').optional(),
});

/** `tile-grid`'s trailing "add" tile. */
export const TileGridBlockAddTileSchema = z.strictObject({
  label: label('The add tile\'s name.'),
  href: z.string().min(1).describe('Where the add tile leads.'),
});

/** `tile-grid` — the console home's launcher tiles, as a block. */
export const TileGridBlockSchema = BaseSchema.extend({
  type: z.literal('tile-grid'),
  properties: z
    .strictObject({
      items: z
        .union([z.array(TileGridBlockItemSchema), expressionHole('a list of tiles')])
        .describe('The tiles, or a hole naming a list of them in the bound `data`.'),
      addTile: TileGridBlockAddTileSchema.optional().describe('A dashed "add" tile after the others.'),
    })
    .describe('The `tile-grid` props bag.'),
  dataSource: apiBinding(),
  body: retirementTombstone(neitherChannel('tile-grid', 'its tiles')),
  children: retirementTombstone(neitherChannel('tile-grid', 'its tiles')),
});

/**
 * Union of the product-block arms — the category member `AnyComponentSchema`
 * lists (objectui#12197).
 */
const ProductBlockComponentSchemaInferred = z.discriminatedUnion('type', [
  HeroBlockSchema,
  StatBlockSchema,
  UsageBarBlockSchema,
  ChecklistBlockSchema,
  TileGridBlockSchema,
]);

/**
 * The TYPE of {@link ProductBlockComponentSchema}, NAMED so declaration emit
 * prints it by reference (objectui#11573): see "Why every category union's
 * TYPE is named" on `AnyComponentSchema` (`index.zod.ts`). It adds no member.
 */
export interface ProductBlockComponentZodType extends ProductBlockComponentSchemaInferredType {
  options: ProductBlockComponentSchemaInferredType['options'];
}
type ProductBlockComponentSchemaInferredType = typeof ProductBlockComponentSchemaInferred;

/** The union above, typed by its named {@link ProductBlockComponentZodType}. */
export const ProductBlockComponentSchema: ProductBlockComponentZodType = ProductBlockComponentSchemaInferred;
