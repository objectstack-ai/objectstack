// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineTool } from '@objectstack/spec/ai';

/**
 * create_object — AI Tool Metadata
 *
 * Creates a new data object (table) with schema validation.
 * Validates snake_case naming for object and initial fields,
 * checks for duplicates, and stages the object as a draft.
 *
 * ADR-0033: this never publishes — the object lands in the draft workspace
 * for a human to review and publish. The draft IS the approval gate, which is
 * why no `requiresConfirmation` flag is needed (it was never enforced anyway).
 */
export const createObjectTool = defineTool({
  name: 'create_object',
  label: 'Create Object',
  description:
    'Creates a new data object (table) with the specified name, label, and optional field definitions, staged as a draft for human review. ' +
    'Use this when the user wants to create a new entity, table, or data model. The change is NOT published.',
  category: 'data',
  builtIn: true,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Machine name for the object (snake_case, e.g. project_task)',
      },
      label: {
        type: 'string',
        description: 'Human-readable display name (e.g. Project Task)',
      },
      packageId: {
        type: 'string',
        description: 'Package ID that will own this object (e.g., com.acme.crm). If not provided, uses the active package from conversation context.',
      },
      fields: {
        type: 'array',
        description: 'Initial fields to create with the object',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Field machine name (snake_case)' },
            label: { type: 'string', description: 'Field display name' },
            type: {
              type: 'string',
              description: 'Field data type',
              enum: ['text', 'textarea', 'number', 'boolean', 'date', 'datetime', 'select', 'lookup', 'formula', 'autonumber'],
            },
            required: { type: 'boolean', description: 'Whether the field is required' },
          },
          required: ['name', 'type'],
        },
      },
      enableFeatures: {
        type: 'object',
        description: 'Object capability flags',
        properties: {
          trackHistory: { type: 'boolean' },
          apiEnabled: { type: 'boolean' },
        },
      },
    },
    required: ['name', 'label'],
    additionalProperties: false,
  },
});
