// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from './view.zod';

/**
 * Action Metadata Form
 * 
 * Form layout for creating/editing action metadata definitions.
 */
export const actionForm = defineForm({
  schemaId: 'action',
  type: 'simple',
  sections: [
    {
      label: 'Basics',
      description: 'Action identity and presentation.',
      columns: 2,
      fields: [
        { field: 'name', required: true, colSpan: 1, helpText: 'Unique identifier (snake_case)' },
        { field: 'label', required: true, colSpan: 1, helpText: 'Button text shown to users' },
        { field: 'objectName', widget: 'ref:object', colSpan: 1, helpText: 'Object this action belongs to (optional)' },
        { field: 'icon', colSpan: 1, helpText: 'Lucide icon name (e.g., "check", "x-circle")' },
        { field: 'type', required: true, colSpan: 1, helpText: 'What happens when clicked' },
        { field: 'variant', colSpan: 1, helpText: 'Button style (primary=blue, danger=red, ghost=transparent)' },
      ],
    },
    {
      label: 'Behavior',
      description: 'Configure what happens when the action is triggered.',
      fields: [
        { field: 'target', visibleOn: "data.type != 'script'", helpText: 'URL, flow name, or API endpoint to call' },
        { field: 'method', visibleOn: "data.type == 'api'", helpText: 'HTTP method (GET, POST, PUT, DELETE)' },
        { field: 'body', widget: 'code', visibleOn: "data.type == 'script'", helpText: 'JavaScript code to execute' },
        { field: 'params', type: 'repeater', helpText: 'User input parameters (show form before executing)' },
        { field: 'confirmText', helpText: 'Confirmation message (e.g., "Are you sure?")' },
        { field: 'successMessage', helpText: 'Success message after completion' },
        { field: 'refreshAfter', helpText: 'Refresh the list/page after action completes' },
      ],
    },
    {
      label: 'Placement',
      description: 'Where and when the action button appears.',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'locations', type: 'repeater', helpText: 'Where to show this action (toolbar, row menu, etc.)' },
        { field: 'component', helpText: 'How to render (button, icon, menu item)' },
        { field: 'visible', widget: 'textarea', helpText: 'CEL expression: show only when condition is true' },
        { field: 'disabled', widget: 'textarea', helpText: 'CEL expression: disable when condition is true' },
        { field: 'shortcut', helpText: 'Keyboard shortcut (e.g., "Ctrl+S", "Cmd+Enter")' },
      ],
    },
    {
      label: 'Advanced',
      description: 'Bulk operations, AI exposure, and API request shape.',
      collapsible: true,
      collapsed: true,
      columns: 2,
      fields: [
        { field: 'bulkEnabled', colSpan: 1, helpText: 'Allow applying to multiple selected records' },
        { field: 'ai', colSpan: 2, helpText: 'AI exposure (opt-in): set ai.exposed=true and write ai.description (≥40 chars) to make this callable by agents.' },
        { field: 'recordIdParam', visibleOn: "data.type == 'api'", colSpan: 1, helpText: 'Body parameter name for record ID' },
        { field: 'recordIdField', visibleOn: "data.type == 'api' && data.recordIdParam", colSpan: 1, helpText: 'Field to use as record ID (default: "id")' },
        { field: 'bodyShape', visibleOn: "data.type == 'api'", colSpan: 2, helpText: 'Request body structure (flat or nested)' },
      ],
    },
  ],
});
