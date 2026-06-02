// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineTool } from '@objectstack/spec/ai';

/**
 * create_metadata — AI Tool Metadata (ADR-0033)
 *
 * Type-agnostic creation of ANY metadata item (object, view, dashboard, flow,
 * …). The new item is staged as a **draft** — it never goes live until a human
 * reviews and publishes. The payload is validated against the type's canonical
 * Zod schema (ADR-0005); invalid output is rejected with a fixable error.
 *
 * For new data objects + their fields the dedicated `create_object` /
 * `add_field` tools offer a friendlier shape, but they ultimately stage the
 * same way.
 */
export const createMetadataTool = defineTool({
  name: 'create_metadata',
  label: 'Create Metadata',
  description:
    'Create a new metadata item of ANY type (view, dashboard, flow, report, app, object, …) and stage it as a draft for human review. ' +
    'Use for non-object types, or any type, when no dedicated tool fits. The change is NOT published — a human must publish it.',
  category: 'data',
  builtIn: true,
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Metadata type (singular), e.g. "object", "view", "dashboard", "flow", "report", "app".',
      },
      name: {
        type: 'string',
        description: 'Machine name for the item (snake_case, e.g. account_kanban).',
      },
      definition: {
        type: 'object',
        description:
          'The full metadata definition body for this type, conforming to the type\'s schema. The "name" field is set automatically from the name argument.',
      },
      packageId: {
        type: 'string',
        description: 'Package ID that will own this item. If omitted, uses the active package from conversation context.',
      },
    },
    required: ['type', 'name', 'definition'],
    additionalProperties: false,
  },
});
