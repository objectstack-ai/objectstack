// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '../ui/view.zod';

/**
 * Tool Metadata Form
 *
 * Form layout for creating/editing AI tool metadata definitions.
 *
 * The former "Declarative metadata (not enforced)" section is gone with the
 * keys it declared: `category`, `permissions`, `active` and `builtIn` were
 * removed from ToolSchema (#3896 close-out, after `requiresConfirmation` set
 * the precedent in #3715). A form input for a rejected key would author
 * parse errors; a form input for an unenforced gate is the UI half of false
 * compliance — the same "advertising the failure mode" objectui#2962 removed
 * from the sharing-criteria builder.
 */
export const toolForm = defineForm({
  schemaId: 'tool',
  type: 'simple',
  sections: [
    {
      label: 'Basics',
      description: 'Tool identity and AI-facing description.',
      columns: 2,
      fields: [
        { field: 'name', required: true, colSpan: 1, helpText: 'Unique identifier (snake_case)' },
        { field: 'label', required: true, colSpan: 1, helpText: 'Display name for Studio UI' },
        { field: 'description', required: true, widget: 'textarea', colSpan: 2, helpText: 'Tell AI when to use this tool — be specific!' },
        { field: 'objectName', widget: 'ref:object', colSpan: 1, helpText: 'Related object (if this tool operates on a specific object)' },
      ],
    },
    {
      label: 'Schemas',
      description: 'Inputs the tool accepts and the shape of its output.',
      fields: [
        { field: 'parameters', type: 'composite', required: true, helpText: 'Input parameters — define properties like: {name: {type: "string", description: "..."}}' },
        { field: 'outputSchema', type: 'composite', helpText: 'Output schema for validation (optional)' },
      ],
    },
  ],
});
