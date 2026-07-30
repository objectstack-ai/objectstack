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
        { field: 'target', visibleWhen: "data.type != 'script'", helpText: 'URL, flow name, or API endpoint to call' },
        { field: 'method', visibleWhen: "data.type == 'api'", helpText: 'HTTP method (GET, POST, PUT, DELETE)' },
        {
          field: 'body',
          type: 'composite',
          visibleWhen: "data.type == 'script'",
          helpText: 'Either an L1 expression or an L2 sandboxed JS body',
          // Mirrors hook.form.ts: `body` is a discriminated union
          // (HookBodySchema) on `language`, not a bare string. A flat
          // `widget: 'code'` fed the whole object to the editor and rendered
          // "[object Object]". Render the union as language + source (+ the
          // L2-only capability/timeout knobs).
          fields: [
            { field: 'language', type: 'select', required: true, helpText: 'expression = pure formula; js = sandboxed JavaScript', options: [
              { label: 'Expression (L1)', value: 'expression' },
              { label: 'JavaScript (L2 sandboxed)', value: 'js' },
            ] },
            { field: 'source', type: 'code', language: 'javascript', required: true, helpText: 'Function body source — no top-level imports' },
            { field: 'capabilities', type: 'tags', helpText: 'Allowed ctx APIs (api.read, api.write, crypto.uuid, log, …)' },
            { field: 'timeoutMs', type: 'number', helpText: 'Per-invocation timeout (ms)' },
          ],
        },
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
        // `shortcut` input removed with the key (#3896 close-out) — a form
        // input for an unenforced capability is the UI half of false compliance.
      ],
    },
    {
      label: 'Advanced',
      description: 'AI exposure and API request shape.',
      collapsible: true,
      collapsed: true,
      columns: 2,
      fields: [
        // `bulkEnabled` input removed with the key (#3896 close-out): the
        // multi-select toolbar reads the list view's bulkActions, never this.
        { field: 'ai', colSpan: 2, helpText: 'AI exposure (opt-in): set ai.exposed=true and write ai.description (≥40 chars) to make this callable by agents.' },
        { field: 'recordIdParam', visibleWhen: "data.type == 'api'", colSpan: 1, helpText: 'Body parameter name for record ID' },
        { field: 'recordIdField', visibleWhen: "data.type == 'api' && data.recordIdParam", colSpan: 1, helpText: 'Field to use as record ID (default: "id")' },
        { field: 'bodyShape', visibleWhen: "data.type == 'api'", colSpan: 2, helpText: 'Request body structure (flat or nested)' },
      ],
    },
  ],
});
