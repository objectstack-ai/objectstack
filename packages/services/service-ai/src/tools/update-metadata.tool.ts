// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineTool } from '@objectstack/spec/ai';

/**
 * update_metadata — AI Tool Metadata (ADR-0033)
 *
 * Type-agnostic update of ANY existing metadata item. Applies an RFC 7386 JSON
 * Merge Patch to the item's current draft (or, if none, the published value)
 * and re-stages the result as a **draft** — read-modify-write of the single
 * draft, never a fork. A `null` value in the patch deletes that key. The merged
 * body is validated against the type's Zod schema before it enters the draft.
 * The change is NOT published — a human reviews the diff and publishes.
 */
export const updateMetadataTool = defineTool({
  name: 'update_metadata',
  label: 'Update Metadata',
  description:
    'Apply a partial change (JSON merge patch) to an existing metadata item of ANY type and stage it as a draft for human review. ' +
    'Set a key to null to remove it. The change is NOT published — a human must publish it. Use describe_metadata first to see the current body.',
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
        description: 'Machine name of the existing item (snake_case).',
      },
      patch: {
        type: 'object',
        description:
          'Partial change to merge into the item. Only the keys you include are changed; nested objects merge recursively; a null value deletes that key. Example: { "label": "New Label", "fields": { "old_field": null } }.',
      },
      packageId: {
        type: 'string',
        description: 'Package ID owning this item. If omitted, uses the active package from conversation context.',
      },
    },
    required: ['type', 'name', 'patch'],
    additionalProperties: false,
  },
});
