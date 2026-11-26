// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '../ui/view.zod';
import { AI_CONTEXT_BODY_FIELD_TYPES, AI_CONTEXT_MAX_FIELDS, AI_CONTEXT_MAX_RELATED, AI_CONTEXT_MAX_RELATED_FIELDS } from './ai-context.zod';

/**
 * Context Pack (`ai_context`) Metadata Form — ADR-0160 D1, clause 2 (runtime
 * authoring).
 *
 * The form Studio's generic metadata editor lays a context pack out with: the
 * root object, its fields, the child lists and their columns, the body field.
 * Every field picker is scoped by the pack's own root:
 *
 * - `fields` is the generic `field-multi` block with `dependsOn: 'object'`
 *   (the `page.form.ts` precedent): it offers the root object's fields.
 * - `related` is the `related-list-entries` block (the `object.form.ts`
 *   precedent). Under a pack its entries are `{ object, field?, fields? }`,
 *   so the block offers the relationships that point at the root and, for
 *   each entry, that child object's fields as its columns.
 * - `body.field` is a single field picker over the root object's fields.
 *
 * The form judges nothing. A name the stack does not define, a related entry
 * with no link to the root, or a body that is not long text is reported when
 * the pack is saved (`validateAiContext` on the runtime publish door) and by
 * `os validate`; the bounds are refused by `AiContextSchema` at parse.
 */
export const aiContextForm = defineForm({
  schemaId: 'ai_context',
  type: 'simple',
  sections: [
    {
      name: 'basics',
      label: 'Basics',
      description: 'The pack\'s identity and the object whose records it reads.',
      columns: 2,
      fields: [
        { field: 'name', required: true, immutable: true, colSpan: 1, helpText: 'Unique identifier (snake_case). A skill\'s context key and the get_record_context tool name the pack by it.' },
        { field: 'label', required: true, colSpan: 1, helpText: 'Display name, the header of the tool answer. A pack has no description: write its purpose here.' },
        { field: 'object', label: 'Root object', widget: 'ref:object', required: true, colSpan: 2, helpText: 'The root object: the pack reads one record of it.' },
      ],
    },
    {
      name: 'material',
      label: 'Material',
      description: 'What of the record is handed to the model. Each picker offers the fields of the root object, or of the related list\'s own object.',
      fields: [
        { field: 'fields', widget: 'field-multi', dependsOn: 'object', helpText: `The root object's fields handed to the model, in order (at most ${AI_CONTEXT_MAX_FIELDS}). A lookup among them is answered with the name of the record it points at.` },
        { field: 'related', label: 'Related lists', widget: 'related-list-entries', dependsOn: 'object', helpText: `Child lists that point at the record, one level deep (at most ${AI_CONTEXT_MAX_RELATED}). Each list names its child object, the reference field that points at the root, and the columns read for each row (at most ${AI_CONTEXT_MAX_RELATED_FIELDS}); with no columns a row is read by its name.` },
        {
          field: 'body',
          type: 'composite',
          helpText: 'The one long-text field read as the record\'s body.',
          fields: [
            { field: 'field', label: 'Body field', widget: 'field-ref', dependsOn: 'object', helpText: `A long-text field of the root object (${AI_CONTEXT_BODY_FIELD_TYPES.join(', ')}). Any other field is reported when the pack is saved, and the pack then carries no body.` },
          ],
        },
      ],
    },
  ],
});
