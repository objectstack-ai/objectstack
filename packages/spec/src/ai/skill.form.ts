// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '../ui/view.zod';

/**
 * Skill Metadata Form
 * 
 * Form layout for creating/editing AI skill metadata definitions.
 */
export const skillForm = defineForm({
  schemaId: 'skill',
  type: 'simple',
  sections: [
    {
      label: 'Basics',
      description: 'Skill identity and human-readable description.',
      columns: 2,
      fields: [
        { field: 'name', required: true, colSpan: 1, helpText: 'Unique identifier (snake_case)' },
        { field: 'label', required: true, colSpan: 1, helpText: 'Display name (e.g., "Case Management")' },
        { field: 'description', widget: 'textarea', colSpan: 2, helpText: 'What this skill does' },
        { field: 'active', colSpan: 1, helpText: 'Enable/disable this skill' },
      ],
    },
    {
      label: 'AI Instructions',
      description: 'How the agent should reason with this skill.',
      fields: [
        { field: 'instructions', widget: 'textarea', helpText: 'Instructions for AI — tell it how to use these tools together' },
        { field: 'tools', widget: 'string-tags', required: true, helpText: 'Tool names (supports wildcard: action_*)' },
      ],
    },
    {
      label: 'Triggers',
      description: 'When this skill should activate.',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'triggerPhrases', widget: 'string-tags', helpText: 'Natural language phrases that activate this skill' },
        { field: 'triggerConditions', type: 'repeater', helpText: 'Programmatic conditions (e.g., objectName == "case")' },
      ],
    },
  ],
});
