// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '../ui/view.zod';

/**
 * Form Layout for Hook Metadata Type
 *
 * Hooks intercept the data lifecycle. The body field is a composite
 * (`{ language, source, capabilities?, timeoutMs?, memoryMb? }`) whose
 * `source` renders in a Monaco code editor with language-appropriate
 * syntax highlighting.
 */
export const hookForm = defineForm({
  schemaId: 'hook',
  type: 'simple',
  sections: [
    {
      label: 'Identity',
      description: 'What this hook is and when it fires.',
      columns: 2,
      fields: [
        { field: 'name', type: 'text', required: true, immutable: true, colSpan: 1, helpText: 'snake_case identifier (immutable after creation)' },
        { field: 'label', type: 'text', colSpan: 1 },
        { field: 'description', type: 'textarea', colSpan: 2 },
        { field: 'object', type: 'text', required: true, colSpan: 1, helpText: 'Target object name (or "*" for global)' },
        { field: 'events', type: 'tags', required: true, colSpan: 1, helpText: 'Lifecycle events (e.g. beforeInsert, afterUpdate)' },
        { field: 'priority', type: 'number', colSpan: 1, helpText: 'Lower numbers run first' },
      ],
    },
    {
      label: 'Body',
      description: 'Inline expression or sandboxed JavaScript executed when the hook fires.',
      fields: [
        {
          field: 'body',
          type: 'composite',
          helpText: 'Either an L1 expression or an L2 sandboxed JS body',
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
      ],
    },
    {
      label: 'Legacy handler',
      description: 'Function name reference — deprecated in favour of body.',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'handler', type: 'text', helpText: 'Handler function name (deprecated — prefer `body`)' },
      ],
    },
    {
      label: 'Execution',
      collapsible: true,
      collapsed: true,
      columns: 2,
      fields: [
        { field: 'async', type: 'boolean', colSpan: 1, helpText: 'Run in background, do not block the transaction' },
        { field: 'onError', type: 'select', colSpan: 1, options: [
          { label: 'Abort', value: 'abort' },
          { label: 'Log', value: 'log' },
        ] },
        { field: 'timeout', type: 'number', colSpan: 1, helpText: 'Abort the hook after N milliseconds' },
        { field: 'condition', type: 'code', language: 'javascript', colSpan: 2, helpText: 'Optional formula — skip the hook when this evaluates to false' },
        {
          field: 'retryPolicy',
          type: 'composite',
          colSpan: 2,
          helpText: 'Retry on failure — most useful for async hooks',
          fields: [
            { field: 'maxRetries', type: 'number', helpText: 'Maximum retry attempts' },
            { field: 'backoffMs', type: 'number', helpText: 'Delay between retries (ms)' },
          ],
        },
      ],
    },
  ],
});
