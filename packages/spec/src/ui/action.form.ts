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
        // #19331 — six of this form's nine additions are scalars ActionSchema
        // declares and no control offered, so the Source tab's free-text JSON
        // was the only door. Each `options` list below exists because the raw
        // enum member would read as a word rather than as the contract it names;
        // where the member IS the contract the enum is left to derive.
        { field: 'mode', type: 'select', colSpan: 1, helpText: 'Semantic mode of the action. Read today by the AI human-in-the-loop heuristic only — no renderer branches on it.', options: [
          { label: 'Create', value: 'create' },
          { label: 'Edit', value: 'edit' },
          { label: 'Delete', value: 'delete' },
          { label: 'Custom', value: 'custom' },
        ] },
        { field: 'order', type: 'number', colSpan: 1, helpText: 'Sort order within a location group — lower sorts higher, and the record header takes the first as its primary button. Unset keeps registration order.' },
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
            { field: 'memoryMb', type: 'number', helpText: 'Per-invocation memory cap (MB, max 256)' },
          ],
        },
        {
          field: 'params',
          type: 'repeater',
          helpText: 'User input parameters (show form before executing)',
          // Row-property names (#17508): every authorable row property, `label`
          // equal to the item schema's `.meta({ title })`, so `os i18n extract`
          // emits a catalog key per column and the panel keeps its schema-derived
          // widgets (no `type` here).
          fields: [
            { field: 'name', label: 'Name' },
            { field: 'field', label: 'Field' },
            { field: 'objectOverride', label: 'Object Override' },
            { field: 'label', label: 'Label' },
            { field: 'type', label: 'Type' },
            { field: 'required', label: 'Required' },
            { field: 'options', label: 'Options' },
            { field: 'placeholder', label: 'Placeholder' },
            { field: 'helpText', label: 'Help Text' },
            { field: 'defaultValue', label: 'Default Value' },
            { field: 'multiple', label: 'Multiple' },
            { field: 'accept', label: 'Accepted Types' },
            { field: 'maxSize', label: 'Max Size (bytes)' },
            { field: 'reference', label: 'Reference Object' },
            { field: 'defaultFromRow', label: 'Default From Row' },
            { field: 'carryOver', label: 'Carry Over' },
            { field: 'visible', label: 'Visible When' },
            { field: 'requiresFeature', label: 'Requires Feature' },
          ],
        },
        { field: 'operation', type: 'select', helpText: "Declarative single-record field write: 'update' applies `patch`, merged under the collected `params`, to the current record AS THE CALLER — never system-elevated, so the caller's permissions, the object's hooks and its validations all fire as for a user edit.", options: [
          { label: 'Update the current record', value: 'update' },
        ] },
        { field: 'undoable', type: 'boolean', visibleWhen: "data.operation == 'update'", helpText: 'Offer an Undo affordance after this update succeeds. The undo captures the prior value of every field the action writes — the merged bag, `patch` under the collected `params`. An action with no `operation` declares no write set, so there is nothing to capture.' },
        // `perRecord` carries an uppercase letter and `FormSelectOptionSchema`
        // values are system identifiers (`^[a-z][a-z0-9_.]*$`), so this enum
        // cannot be written as an inline option list — it derives from the
        // served schema and the contract rides the help text.
        { field: 'execution', helpText: "The bulk dispatch contract this action's body is written for: 'perRecord' sends one dispatch per selected row carrying that row's recordId; 'aggregate' sends ONE dispatch for the whole selection, with every id in params._selectedIds. Omitted, the action is dispatched per record." },
        { field: 'confirmText', helpText: 'Confirmation message (e.g., "Are you sure?")' },
        { field: 'successMessage', helpText: 'Success message after completion' },
        { field: 'refreshAfter', helpText: 'Refresh the list/page after action completes' },
        // `new-tab` is hyphenated, so the same system-identifier bound on
        // `FormSelectOptionSchema.value` applies: the enum derives.
        { field: 'openIn', visibleWhen: "data.type == 'url'", helpText: "Where to open a static `target` URL — 'self' navigates in place, 'new-tab' opens a new browser tab. Omitted, an absolute or external URL opens in a new tab and a relative one navigates in place." },
        { field: 'opensInNewTab', type: 'boolean', helpText: "Open the action RESULT in a new tab: the renderer pre-opens the tab synchronously on click (popup-blocker-safe) and navigates it to the handler's redirectUrl. Distinct from `openIn`, which routes a static URL target." },
        { field: 'newTabUrl', label: 'New-tab URL', type: 'text', visibleWhen: "data.opensInNewTab == true", helpText: 'Direct new-tab URL template, with a {recordId} placeholder. Set together with `opensInNewTab` the renderer navigates the pre-opened tab here immediately and posts nothing — so the endpoint must enforce auth itself.' },
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
        // The enum derives: every member IS the public auth feature flag it
        // names, so an inline list would only restate them and could drift from
        // the registry the parse step resolves against.
        { field: 'requiresFeature', helpText: 'Public auth feature flag gating this action. It is lowered into the `visible` predicate at parse time and stripped from the output, so no downstream consumer ever sees the key.' },
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
