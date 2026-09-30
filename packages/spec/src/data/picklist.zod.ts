// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One list of select options that several fields on several objects use,
 * instead of an options array copied into each field (Salesforce's Global
 * Value Set, Dataverse's global choice). A field REFERENCES it with
 * `picklist: '<name>'` in place of `options` — `Field.select({ picklist:
 * 'industry' })` — and the two are mutually exclusive at the field's schema
 * door (see `FieldSchema.picklist`).
 *
 * Three shapes live here, one per position the list appears in:
 *
 * - {@link PicklistSchema} — the kind itself: `{ name, label, description?,
 *   options }`, authored in a package (`*.picklist.ts`, or
 *   `defineStack({ picklists })`). `options` is the field option shape
 *   ({@link SelectOptionSchema}), reused verbatim — there is no second option
 *   shape to learn.
 * - {@link PicklistExtensionSchema} — `defineStack({ picklistExtensions })`,
 *   the `objectExtensions` idiom: another package ADDS options to a picklist
 *   it does not own. Additive only — removing or renaming a value stays with
 *   the owning package, so the shape has no key for either.
 * - {@link PicklistServedFieldSchema} — the served form of a picklist-bound
 *   field: what a client reads from the object read exits once the reference
 *   is resolved.
 *
 * Package-owned: the registry entry (`kernel/metadata-plugin.zod.ts`) takes
 * no runtime create and no per-organization overlay. An organization-level
 * overlay that appends values is a later phase with its own admission, and
 * is not declared here.
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { SelectOptionSchema } from './field.zod';

const PICKLIST_HISTORY =
  'Until this shape was closed these would have been dropped silently — the list still '
  + 'registered, minus whatever the key was meant to carry.';

/**
 * The shared option list itself.
 *
 * `name` is the handle a field's `picklist` names, so it follows the
 * machine-name rule every metadata name follows (lowercase snake_case).
 * `options` needs at least one entry: a list with nothing in it offers every
 * field that references it nothing to choose.
 *
 * @example
 * ```ts
 * // src/picklists/industry.picklist.ts
 * export default definePicklist({
 *   name: 'industry',
 *   label: 'Industry',
 *   options: [
 *     { label: 'Technology', value: 'technology' },
 *     { label: 'Finance', value: 'finance' },
 *   ],
 * });
 * ```
 */
export const PicklistSchema = lazySchema(() => strictObject({
  surface: 'this picklist',
  history: PICKLIST_HISTORY,
  aliases: {
    values: 'options', choices: 'options', items: 'options',
    title: 'label', displayName: 'label',
  },
}, {
  name: SnakeCaseIdentifierSchema.describe(
    "Picklist name (lowercase snake_case) — what a field's `picklist` names",
  ),
  label: z.string().describe('Display label of the list itself'),
  description: z.string().optional().describe('What the list enumerates, for authors choosing one'),
  options: z.array(SelectOptionSchema).min(1, {
    message:
      'A picklist needs at least one option — an empty list offers every field that references '
      + 'it nothing to choose. Add `{ label, value }` entries.',
  }).describe(
    'The options every referencing field offers — the field option shape (`label`, `value`, '
    + '`color`, `default`, `description`, `visibleWhen`), reused verbatim',
  ),

  // ADR-0010 runtime protection envelope — stamped by the loader on every
  // registered kind, never authored.
  ...MetadataProtectionFields,
}).describe('A shared option list that select fields reference by name instead of copying options'));

export type Picklist = z.input<typeof PicklistSchema>;
/** Post-parse shape of {@link Picklist} — defaults applied, transforms run (ADR-0122). */
export type PicklistParsed = z.infer<typeof PicklistSchema>;

/**
 * Package-level extension of a picklist another package owns — the
 * `objectExtensions` idiom applied to a list.
 *
 * ADDITIVE ONLY: an extension appends options; it cannot remove, rename or
 * relabel one the owning package declared, and the shape declares no key
 * that could ask to. A value that must go away is the owning package's
 * change to make.
 *
 * @example
 * ```ts
 * defineStack({
 *   picklistExtensions: [{
 *     extend: 'industry',
 *     options: [{ label: 'Healthcare', value: 'healthcare' }],
 *   }],
 * });
 * ```
 */
export const PicklistExtensionSchema = lazySchema(() => strictObject({
  surface: 'this picklist extension',
  history: PICKLIST_HISTORY,
  aliases: {
    picklist: 'extend', target: 'extend', name: 'extend', extends: 'extend',
    values: 'options', choices: 'options', add: 'options',
  },
  guidance: {
    remove:
      'a picklist extension is additive only — it can add options, never remove one. Removing '
      + 'a value is a change to the owning package\'s picklist.',
    label:
      'a picklist extension cannot relabel the list — the label belongs to the owning '
      + 'package\'s picklist. Translate it under `picklists.<name>.label` instead.',
  },
}, {
  extend: SnakeCaseIdentifierSchema.describe('Name of the picklist (owned by another package) to add options to'),
  options: z.array(SelectOptionSchema).min(1, {
    message: 'A picklist extension adds at least one option — an empty `options` adds nothing.',
  }).describe('Options appended to the target picklist (additive only)'),
}).describe("Options added to a picklist owned by another package (additive only — the `objectExtensions` idiom)"));

export type PicklistExtension = z.input<typeof PicklistExtensionSchema>;
/** Post-parse shape of {@link PicklistExtension} — defaults applied, transforms run (ADR-0122). */
export type PicklistExtensionParsed = z.infer<typeof PicklistExtensionSchema>;

/**
 * The SERVED form of a picklist-bound field — the contract the object read
 * exits owe a client.
 *
 * A field authors `picklist: '<name>'` instead of `options`. What a client
 * receives for that field carries both: `options`, RESOLVED — the picklist's
 * options together with the options its `picklistExtensions` add — and
 * `picklist`, still naming the list they came from. Every consumer that reads
 * `field.options` today (renderers, the record validator, filter pickers,
 * import coercion) therefore reads the key it always has, and nothing a
 * client does changes for a picklist-bound field.
 *
 * This is a SERVED shape, never an authoring one: `FieldSchema` refuses
 * `picklist` together with `options`, so a served field sent back through an
 * authoring door is refused with the prescription to drop `options`.
 *
 * Only the two keys this contract adds are declared; every other key of the
 * served field is `FieldSchema`'s and passes through untouched.
 */
export const PicklistServedFieldSchema = lazySchema(() => z.looseObject({
  picklist: SnakeCaseIdentifierSchema.describe('The picklist the field references, as authored'),
  options: z.array(SelectOptionSchema).min(1, {
    message:
      'A served picklist-bound field carries its RESOLVED options — the reference is resolved '
      + 'before the field is served, so an empty or absent `options` means it was not.',
  }).describe("The picklist's options resolved onto the field (with its extensions' options)"),
}).describe('The served form of a picklist-bound field: `options` resolved, `picklist` kept'));

export type PicklistServedField = z.input<typeof PicklistServedFieldSchema>;
/** Post-parse shape of {@link PicklistServedField} — defaults applied, transforms run (ADR-0122). */
export type PicklistServedFieldParsed = z.infer<typeof PicklistServedFieldSchema>;

/**
 * Type-safe factory for a picklist — the default export of a
 * `*.picklist.ts` file. Validates at definition time.
 */
export function definePicklist(config: z.input<typeof PicklistSchema>): PicklistParsed {
  return PicklistSchema.parse(config);
}
