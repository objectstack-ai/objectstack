// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineTool } from '@objectstack/spec/ai';

/**
 * delete_field — AI Tool Metadata
 *
 * Removes a field (column) from an existing data object. This is a destructive
 * operation, but ADR-0033 stages it as a draft — the field is only actually
 * dropped when a human reviews and publishes (which re-runs the destructive
 * data-loss check). The draft IS the approval gate.
 */
export const deleteFieldTool = defineTool({
  name: 'delete_field',
  label: 'Delete Field',
  description:
    'Removes a field (column) from an existing data object, staged as a draft for human review. This is a destructive operation; it is NOT published until a human publishes the draft. ' +
    'Use this when the user explicitly wants to remove an attribute or column from a table.',
  category: 'data',
  builtIn: true,
  parameters: {
    type: 'object',
    properties: {
      packageId: {
        type: 'string',
        description: 'Package ID that owns the target object (e.g., com.acme.crm). If not provided, uses the active package from conversation context.',
      },
      objectName: {
        type: 'string',
        description: 'Target object machine name (snake_case)',
      },
      fieldName: {
        type: 'string',
        description: 'Field machine name to delete (snake_case)',
      },
    },
    required: ['objectName', 'fieldName'],
    additionalProperties: false,
  },
});
