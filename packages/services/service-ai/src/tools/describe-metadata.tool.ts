// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineTool } from '@objectstack/spec/ai';

/**
 * describe_metadata — AI Tool Metadata (ADR-0033)
 *
 * Type-agnostic read of a single metadata item's full body. Returns the pending
 * draft if one exists, else the published value — so the agent edits against
 * what it (or the user) most recently staged. Use before `update_metadata` to
 * see the current shape.
 */
export const describeMetadataTool = defineTool({
  name: 'describe_metadata',
  label: 'Describe Metadata',
  description:
    'Return the full definition of a metadata item of ANY type (draft-first: shows the pending draft if one exists, else the published value). ' +
    'Use to inspect an item before updating it.',
  category: 'data',
  builtIn: true,
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Metadata type (singular), e.g. "object", "view", "dashboard", "flow".',
      },
      name: {
        type: 'string',
        description: 'Machine name of the item (snake_case).',
      },
    },
    required: ['type', 'name'],
    additionalProperties: false,
  },
});
