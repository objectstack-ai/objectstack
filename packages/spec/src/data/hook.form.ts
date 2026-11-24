// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '../ui/view.zod';

/**
 * Form Layout for Hook Metadata Type
 *
 * Hooks intercept the data lifecycle. The body field is a composite
 * (`{ language, source, capabilities?, timeoutMs?, memoryMb? }`) whose
 * `source` renders in a Monaco code editor with language-appropriate
 * syntax highlighting. The hook's refusal catalogue (`refusals`) and its
 * declared texts (`texts`) sit beside it: a js body or a handler may declare
 * them, an expression body may not.
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
        // The catalogue is a record keyed by the code, and an entry has no
        // member that echoes its key — so the row takes the key-only record
        // control, which never writes the key into the entry (#26835). An
        // entry's `reasons` is the same shape one level down (keyed by the
        // reason, each `{ message }`), so it takes the same control; the key
        // rule each level checks is the one its served schema declares.
        {
          field: 'refusals',
          type: 'record',
          widget: 'key-only-record',
          helpText: 'Refusal catalogue, keyed by the SCREAMING_SNAKE code the hook throws (e.g. CLEAN_VERSION_REQUIRED). The caller reads the declared message, translated into their language, with the declared status. For a JavaScript (L2) body or a handler; refused on an expression body',
          fields: [
            { field: 'message', type: 'textarea', required: true, helpText: 'The sentence the user reads when the body throws this code. Plain text, unless the entry declares params: then a {{ name }} hole fills a declared param' },
            { field: 'status', type: 'number', helpText: 'HTTP status of the refusal (400–499). Absent: 400' },
            {
              field: 'reasons',
              type: 'record',
              widget: 'key-only-record',
              helpText: 'Further sentences under this same code, keyed by the snake_case reason the body throws beside the code ({ code, reason }). The wire code and status stay this entry\'s; a reason not declared here is refused. Absent: a thrown reason is not read',
              fields: [
                { field: 'message', type: 'textarea', required: true, helpText: 'The sentence the user reads when the body throws this reason under the code. Its {{ }} holes follow the entry\'s params' },
              ],
            },
            { field: 'params', type: 'tags', helpText: 'Names the sentences may fill (e.g. state): the body throws { code, params: { state } }, and a {{ state }} hole renders it. Absent: the sentences are plain text' },
          ],
        },
        // The declared texts are the same record shape as the refusal
        // catalogue — keyed by the snake_case key the code asks for, an entry
        // `{ message, params? }` with no member that echoes its key — so the
        // row takes the same key-only record control.
        {
          field: 'texts',
          type: 'record',
          widget: 'key-only-record',
          helpText: "Sentences the hook writes into records, keyed by the snake_case key its code asks for with ctx.text (e.g. follow_up_subject). The hook gets the declared message in the organization's language, translated, with the declared message as the fallback. For a JavaScript (L2) body or a handler; refused on an expression body",
          fields: [
            { field: 'message', type: 'textarea', required: true, helpText: 'The sentence the hook writes when its code asks for this key. Plain text, unless the entry declares params: then a {{ name }} hole fills a declared param' },
            { field: 'params', type: 'tags', helpText: 'Names the sentence may fill (e.g. lead): the code asks for ctx.text(key, { lead }), and a {{ lead }} hole renders it. Absent: the sentence is plain text' },
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
        { field: 'timeoutMs', type: 'number', colSpan: 1, helpText: 'Abort the hook after N milliseconds' },
        { field: 'runAs', type: 'select', colSpan: 1, helpText: 'Identity for ctx.api data operations: inherit the triggering write (default), system (elevated), or user (the triggering user)', options: [
          { label: 'Inherit (triggering write)', value: 'inherit' },
          { label: 'System (elevated)', value: 'system' },
          { label: 'User (triggering user)', value: 'user' },
        ] },
        { field: 'condition', type: 'code', language: 'expression', colSpan: 2, helpText: 'CEL predicate — the hook runs only when TRUE' },
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
