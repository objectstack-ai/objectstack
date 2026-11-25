// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Context pack (`ai_context`) — ADR-0160 D1
 *
 * A context pack says which material of ONE record is handed to a model: the
 * root object's fields, the child lists that point at the record, and the one
 * long-text field read as the record's body. It is its own metadata kind, it
 * names its root object itself, and the object knows nothing of it (ADR-0160
 * D2): several packs may root on one object, and removing a pack changes no
 * object, no permission and no other pack.
 *
 * A pack grants nothing and locks nothing. Its one reader is the render
 * service behind the `get_record_context` tool
 * (`@objectstack/service-record-context`), which reads every part of it AS
 * THE CALLER: a field, a list or a row the caller cannot read is never
 * carried (ADR-0160 D3).
 *
 * ## Bounds, refused at parse
 *
 * A pack over a bound is refused when it is authored, so nothing is cut at
 * call time. The bounds stand against the record tools' per-call caps:
 *
 * - `related` holds at most {@link AI_CONTEXT_MAX_RELATED} lists — the most
 *   child lists one `get_record` call reads;
 * - `fields` holds at most {@link AI_CONTEXT_MAX_FIELDS} names, and every
 *   lookup among them is expanded as `query_records`' `expand` expands one, in
 *   ONE read of the root: the record tools cap a caller's `expand` at 3 names
 *   because the caller types them, while a pack's lookups are fixed by its
 *   author and bounded here;
 * - each `related[].fields` holds at most {@link AI_CONTEXT_MAX_RELATED_FIELDS}
 *   columns, its lookups expanded in the one read of that list.
 *
 * The rows of a list are capped by the render service, not by the pack: the
 * cap is a service constant, stated in the answer when it cuts.
 */

import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { ROUTER_ADDRESSABLE_NAME_MESSAGE, ROUTER_ADDRESSABLE_NAME_PATTERN } from '../kernel/address-grammar';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { UNIQUE_SCALAR_ITEMS } from '../shared/refinement-projection';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';

/** The most root fields one pack lists. */
export const AI_CONTEXT_MAX_FIELDS = 30;

/** The most child lists one pack reads — `get_record`'s own cap on `related`. */
export const AI_CONTEXT_MAX_RELATED = 3;

/** The most columns one child list of a pack reads. */
export const AI_CONTEXT_MAX_RELATED_FIELDS = 10;

/**
 * The field types a pack's `body` may name: the long-text types, the ones a
 * record's prose is written in.
 */
export const AI_CONTEXT_BODY_FIELD_TYPES = ['textarea', 'markdown', 'html', 'richtext'] as const;

const BORN_CLOSED = 'Declared closed from its first day: an unrecognized key is refused, never dropped.';

/** A field name on an object: lowercase snake_case. */
const FieldNameSchema = SnakeCaseIdentifierSchema;

/** A list of field names with no name twice. */
function distinctFieldNames(max: number, what: string) {
  return z
    .array(FieldNameSchema)
    .min(1)
    .max(max, { message: `${what} lists at most ${max} fields` })
    // Published as `uniqueItems: true` (the closed `unique-items` arm).
    .refine(UNIQUE_SCALAR_ITEMS, { message: `${what} names a field twice` });
}

/**
 * One child list of a pack: the records of `object` whose reference field
 * points at the pack's root record. One level, child lists only — the shape of
 * `get_record`'s `related`.
 */
export const AiContextRelatedSchema = lazySchema(() => strictObject(
  {
    surface: 'a context pack `related` entry',
    history: BORN_CLOSED,
    aliases: { objectName: 'object', link: 'field', linkField: 'field', columns: 'fields' },
  },
  {
    object: SnakeCaseIdentifierSchema.describe(
      'A child object with a reference field (lookup, master-detail, user or tree) that points at the pack\'s root object',
    ),
    field: FieldNameSchema.optional().describe(
      'The child\'s reference field that points at the root. Required when the child has several such fields; with '
      + 'one, it may be omitted. Resolved once, on the published definition',
    ),
    fields: distinctFieldNames(AI_CONTEXT_MAX_RELATED_FIELDS, 'A related list').optional().describe(
      `The columns read for each row, in order (at most ${AI_CONTEXT_MAX_RELATED_FIELDS}). A lookup among them is `
      + 'answered with the name of the record it points at. Omit to read the row\'s name only',
    ),
  },
));

/** The one long-text field read as the record's body. */
export const AiContextBodySchema = lazySchema(() => strictObject(
  {
    surface: 'a context pack `body`',
    history: BORN_CLOSED,
    aliases: { name: 'field', fieldName: 'field' },
  },
  {
    field: FieldNameSchema.describe(
      `A long-text field of the root object (${AI_CONTEXT_BODY_FIELD_TYPES.join(', ')}). A body past the render `
      + 'service\'s bound is carried as an outline of its headings, each section read by its anchor',
    ),
  },
));

/**
 * A context pack — the material of one record handed to a model
 * (ADR-0160 D1).
 *
 * @example
 * ```yaml
 * name: policy_document
 * label: Policy document
 * object: policy
 * fields: [title, category, status, effective_date, owner]
 * related:
 *   - object: policy_revision
 *     field: policy
 *     fields: [version, published_at]
 * body:
 *   field: content
 * ```
 */
export const AiContextSchema = lazySchema(() => strictObject(
  {
    surface: 'this context pack',
    history: BORN_CLOSED,
    aliases: {
      objectName: 'object',
      root: 'object',
      columns: 'fields',
      children: 'related',
      relatedLists: 'related',
      content: 'body',
    },
    guidance: {
      description:
        'A context pack has no `description` in v1 (ADR-0160 D1): write the purpose in `label`.',
      filter:
        'A context pack reads one record by id; it takes no filter. A related list reads every child row the caller '
        + 'may read, up to the render service\'s row cap.',
    },
  },
  {
    name: z.string().regex(ROUTER_ADDRESSABLE_NAME_PATTERN, { message: ROUTER_ADDRESSABLE_NAME_MESSAGE }).describe(
      'Pack machine name (snake_case) — what `get_record_context`\'s `context` argument and a skill\'s `context` key name',
    ),
    label: z.string().min(1).describe('Pack display name — the header of the tool answer'),
    object: SnakeCaseIdentifierSchema.describe('The root object: a pack reads one record of it'),
    fields: distinctFieldNames(AI_CONTEXT_MAX_FIELDS, 'A context pack').optional().describe(
      `The root object's fields handed to the model, in order (at most ${AI_CONTEXT_MAX_FIELDS}). A lookup among `
      + 'them is answered with the name of the record it points at',
    ),
    related: z
      .array(AiContextRelatedSchema)
      .min(1)
      .max(AI_CONTEXT_MAX_RELATED, { message: `A context pack reads at most ${AI_CONTEXT_MAX_RELATED} related lists` })
      .refine(
        (entries) => new Set(entries.map((e) => `${e.object}\u0000${e.field ?? ''}`)).size === entries.length,
        { message: 'A context pack names the same related list twice' },
      )
      .optional()
      .describe(`Child lists that point at the record (at most ${AI_CONTEXT_MAX_RELATED}), one level deep`),
    body: AiContextBodySchema.optional().describe('The one long-text field read as the record\'s body'),
    ...MetadataProtectionFields,
  },
));

export type AiContext = z.input<typeof AiContextSchema>;
export type AiContextRelated = z.input<typeof AiContextRelatedSchema>;
export type AiContextBody = z.input<typeof AiContextBodySchema>;
