// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineTool } from '@objectstack/spec/ai';

/**
 * list_metadata — AI Tool Metadata (ADR-0033)
 *
 * Type-agnostic enumeration of all items of a metadata type (name + label),
 * backed by the same source as `GET /api/v1/meta/:type`. Use to discover what
 * exists before creating or to find an item to update.
 */
export const listMetadataTool = defineTool({
  name: 'list_metadata',
  label: 'List Metadata',
  description:
    'List all metadata items of a given type (name and label), with an optional name/label substring filter. ' +
    'Use to discover existing views, dashboards, flows, etc. before creating or updating one.',
  category: 'data',
  builtIn: true,
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Metadata type (singular), e.g. "object", "view", "dashboard", "flow", "report", "app".',
      },
      filter: {
        type: 'string',
        description: 'Optional case-insensitive substring to filter items by name or label.',
      },
    },
    required: ['type'],
    additionalProperties: false,
  },
});
