// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '../ui/view.zod';

/**
 * Form Layout for Object Metadata Type
 */
export const objectForm = defineForm({
  schemaId: 'object',
  type: 'simple',
  sections: [
    {
      name: 'basics',
      label: 'Basics',
      description: 'Identity, labels, and taxonomy.',
      columns: 2,
      fields: [
        { field: 'name', type: 'text', required: true, immutable: true, colSpan: 1, helpText: 'snake_case unique identifier (immutable after creation)' },
        { field: 'label', type: 'text', colSpan: 1, helpText: 'Singular display name (e.g. "Account")' },
        { field: 'pluralLabel', type: 'text', colSpan: 1, helpText: 'Plural display name (e.g. "Accounts")' },
        { field: 'icon', type: 'text', colSpan: 1, helpText: 'Lucide icon name (e.g. "building", "users")' },
        { field: 'description', type: 'textarea', colSpan: 2, helpText: 'Developer documentation' },
        { field: 'isSystem', type: 'boolean', colSpan: 1, helpText: 'System object (protected from deletion; defaults sharing to public)' },
      ],
    },
    {
      name: 'fields',
      label: 'Fields',
      description: 'Define the data model — each entry becomes a column in the database table.',
      fields: [
        {
          field: 'fields',
          type: 'record',
          required: true,
          helpText: 'Add the columns this object will store',
          keyField: {
            field: 'name',
            label: 'Name',
            placeholder: 'snake_case_identifier',
            helpText: 'snake_case machine name (used as column name and API key)',
            regex: '^[a-z_][a-z0-9_]*$',
            immutable: true,
          },
          fields: [
            { field: 'label', type: 'text', helpText: 'Display label' },
            {
              field: 'type',
              type: 'select',
              required: true,
              helpText: 'Field type',
              options: [
                { label: 'Text', value: 'text' },
                { label: 'Textarea', value: 'textarea' },
                { label: 'Email', value: 'email' },
                { label: 'URL', value: 'url' },
                { label: 'Phone', value: 'phone' },
                { label: 'Password', value: 'password' },
                { label: 'Markdown', value: 'markdown' },
                { label: 'HTML', value: 'html' },
                { label: 'Rich Text', value: 'richtext' },
                { label: 'Number', value: 'number' },
                { label: 'Currency', value: 'currency' },
                { label: 'Percent', value: 'percent' },
                { label: 'Date', value: 'date' },
                { label: 'Date & Time', value: 'datetime' },
                { label: 'Time', value: 'time' },
                { label: 'Boolean', value: 'boolean' },
                { label: 'Toggle', value: 'toggle' },
                { label: 'Select', value: 'select' },
                { label: 'Multiselect', value: 'multiselect' },
                { label: 'Radio', value: 'radio' },
                { label: 'Checkboxes', value: 'checkboxes' },
                { label: 'Lookup (reference)', value: 'lookup' },
                { label: 'Master–Detail', value: 'master_detail' },
                { label: 'Tree', value: 'tree' },
                { label: 'Image', value: 'image' },
                { label: 'File', value: 'file' },
                { label: 'Avatar', value: 'avatar' },
                { label: 'Video', value: 'video' },
                { label: 'Audio', value: 'audio' },
                { label: 'Formula (computed)', value: 'formula' },
                { label: 'Summary (rollup)', value: 'summary' },
                { label: 'Autonumber', value: 'autonumber' },
                { label: 'Composite (embedded)', value: 'composite' },
                { label: 'Repeater (embedded array)', value: 'repeater' },
                { label: 'Record (keyed map)', value: 'record' },
                { label: 'Location (GPS)', value: 'location' },
                { label: 'Address', value: 'address' },
                { label: 'Code', value: 'code' },
                { label: 'JSON', value: 'json' },
                { label: 'Color', value: 'color' },
                { label: 'Rating', value: 'rating' },
                { label: 'Slider', value: 'slider' },
                { label: 'Signature', value: 'signature' },
                { label: 'QR / Barcode', value: 'qrcode' },
                { label: 'Progress', value: 'progress' },
                { label: 'Tags', value: 'tags' },
                { label: 'Vector embedding', value: 'vector' },
              ],
            },
            { field: 'description', type: 'textarea', helpText: 'Developer documentation for this column' },
            { field: 'required', type: 'boolean', helpText: 'Must be set on every record' },
            { field: 'unique', type: 'boolean', helpText: 'Disallow duplicate values' },
            // `indexed` removed: a field-level index flag built no index and was
            // pruned from FieldSchema in the 16.x line (#2377, ADR-0049).
            // Declare the index in the object's `indexes[]` instead.
            { field: 'readonly', type: 'boolean', helpText: 'Visible but never user-editable' },
            // `immutable` removed: never a FieldSchema key. The mechanism is the
            // `readonlyWhen` predicate below.
            { field: 'hidden', type: 'boolean', helpText: 'Hidden from default UI' },
            // `maskingRule` declared 2026-08-16 (#8993, ruled Option A): partial
            // masking enforced by plugin-security's FieldMasker on read + export.
            { field: 'maskingRule', type: 'text', helpText: "Partial masking: preset ('phone', 'id_card', 'bank_account', 'email', 'name') or {\"keepHead\": n, \"keepTail\": m}. Masked unless the caller holds this field's requiredPermissions" },
            { field: 'searchable', type: 'boolean', helpText: 'Include in full-text search' },
            { field: 'sortable', type: 'boolean', helpText: 'Allow sorting on this column' },
            // `filterable` removed: never a FieldSchema key (only `sortable` and
            // `searchable` exist); every declared column is filterable.
            { field: 'defaultValue', type: 'text', helpText: 'Default value for new records (JSON literal)' },
            // `placeholder` removed: never a FieldSchema key. Author hint text
            // through `inlineHelpText` / `description`.

            // Text constraints
            { field: 'maxLength', type: 'number', helpText: 'Max characters', visibleWhen: "data.type in ['text','textarea','email','url','phone','password','markdown','html','richtext']" },
            { field: 'minLength', type: 'number', helpText: 'Min characters', visibleWhen: "data.type in ['text','textarea','email','url','phone','password','markdown','html','richtext']" },

            // Numeric constraints
            { field: 'min', type: 'number', helpText: 'Minimum value', visibleWhen: "data.type in ['number','currency','percent','rating','slider','progress']" },
            { field: 'max', type: 'number', helpText: 'Maximum value', visibleWhen: "data.type in ['number','currency','percent','rating','slider','progress']" },
            { field: 'precision', type: 'number', helpText: 'Total digits', visibleWhen: "data.type in ['number','currency','percent']" },
            { field: 'scale', type: 'number', helpText: 'Decimal places', visibleWhen: "data.type in ['number','currency','percent']" },

            // Selection options
            {
              field: 'options',
              type: 'repeater',
              helpText: 'Available choices',
              visibleWhen: "data.type in ['select','multiselect','radio','checkboxes']",
              fields: [
                { field: 'label', type: 'text', required: true },
                { field: 'value', type: 'text', required: true },
                { field: 'color', type: 'color' },
                { field: 'icon', type: 'text', helpText: 'Lucide icon name' },
                { field: 'description', type: 'text' },
              ],
            },

            // Relational
            { field: 'reference', type: 'text', helpText: 'Target object name', visibleWhen: "data.type in ['lookup','master_detail','tree']" },
            // `lookupFilters`, not `referenceFilter`: an array of
            // {field, operator, value} rules, not a CEL string.
            { field: 'lookupFilters', widget: 'json', helpText: 'Filter rules applied to the picker ({field, operator, value})', visibleWhen: "data.type in ['lookup','master_detail']" },
            // `deleteBehavior`, not a `cascadeDelete` boolean: the schema models
            // three outcomes, and only one of them is "cascade".
            { field: 'deleteBehavior', type: 'select', helpText: 'What happens when the referenced record is deleted', visibleWhen: "data.type in ['lookup','master_detail']", options: [
              { label: 'Set null', value: 'set_null' },
              { label: 'Cascade (delete children)', value: 'cascade' },
              { label: 'Restrict (block the delete)', value: 'restrict' },
            ] },
            { field: 'multiple', type: 'boolean', helpText: 'Allow selecting multiple records', visibleWhen: "data.type in ['lookup']" },

            // Formula / summary
            // `expression`, not `formula` — the key is named for what it holds,
            // not for the field type that uses it.
            { field: 'expression', type: 'code', language: 'expression', helpText: 'CEL formula expression', visibleWhen: "data.type == 'formula'" },
            { field: 'returnType', type: 'select', helpText: 'Result type for formulas', visibleWhen: "data.type == 'formula'", options: [
              { label: 'Text', value: 'text' }, { label: 'Number', value: 'number' }, { label: 'Boolean', value: 'boolean' },
              { label: 'Date', value: 'date' }, { label: 'Datetime', value: 'datetime' }, { label: 'Currency', value: 'currency' },
            ] },
            // A roll-up is ONE key — `summaryOperations` {object, field, function}.
            // The flat `summaryType` / `summaryField` pair named neither of them
            // and also lost `object`, so a roll-up authored here saved nothing.
            {
              field: 'summaryOperations',
              type: 'composite',
              helpText: 'Roll-up: which child object, which field, which aggregation',
              visibleWhen: "data.type == 'summary'",
              fields: [
                { field: 'object', type: 'text', required: true, helpText: 'Source child object name' },
                { field: 'field', type: 'text', required: true, helpText: 'Field on the child object to aggregate (ignored for count)' },
                { field: 'function', type: 'select', required: true, helpText: 'Aggregation function', options: [
                  { label: 'Count', value: 'count' }, { label: 'Sum', value: 'sum' }, { label: 'Avg', value: 'avg' },
                  { label: 'Min', value: 'min' }, { label: 'Max', value: 'max' },
                ] },
              ],
            },

            // Autonumber — `autonumberFormat`, not `displayFormat`. There is no
            // `startingNumber`: the counter resets per rendered prefix, which the
            // format string itself determines (e.g. AD{YYYYMMDD}{0000} resets daily).
            { field: 'autonumberFormat', type: 'text', helpText: 'e.g. "INV-{0000}"; date tokens {YYYY}/{MM}/{DD} and {field_name} interpolation supported', visibleWhen: "data.type == 'autonumber'" },

            // Code language
            { field: 'language', type: 'text', helpText: 'Editor language (e.g. sql, javascript)', visibleWhen: "data.type == 'code'" },

            // Governance. `validation` / `errorMessage` are not FieldSchema keys —
            // a record-level predicate is a `validation` metadata item on the
            // object, which carries its own message. `audit` / `pii` / `encrypted`
            // named the `auditTrail` / `dataQuality` / `encryptionConfig` family
            // pruned in 2026-06 as dead in both layers (see the FieldSchema
            // tombstone); at-rest protection is `type: 'secret'`, not a flag.
            { field: 'trackHistory', type: 'boolean', helpText: 'Summarize this field on the record activity timeline' },
            { field: 'visibleWhen', type: 'code', language: 'expression', helpText: 'CEL predicate — field is shown only when TRUE' },
            { field: 'readonlyWhen', type: 'code', language: 'expression', helpText: 'CEL predicate — field is read-only when TRUE (enforced server-side)' },
            { field: 'requiredWhen', type: 'code', language: 'expression', helpText: 'CEL predicate — field is required when TRUE (enforced server-side)' },
          ],
        },
      ],
    },
    {
      name: 'capabilities',
      label: 'Capabilities',
      description: 'System features and API exposure.',
      collapsible: true,
      collapsed: true,
      fields: [
        {
          // The key is `enable` (ObjectCapabilities). This block named
          // `capabilities` — a key ObjectSchema has never declared — so every
          // toggle below was stripped on save and the section did nothing.
          field: 'enable',
          type: 'composite',
          helpText: 'Enable/disable system features',
          fields: [
            { field: 'trackHistory', type: 'boolean' },
            { field: 'searchable', type: 'boolean' },
            { field: 'apiEnabled', type: 'boolean' },
            { field: 'files', type: 'boolean' },
            { field: 'feeds', type: 'boolean' },
            { field: 'activities', type: 'boolean' },
            { field: 'clone', type: 'boolean' },
          ],
        },
      ],
    },
    {
      name: 'advanced',
      label: 'Advanced',
      description: 'State machines, actions, and storage.',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'datasource', type: 'text', helpText: 'Target datasource ID (default: "default")' },
        {
          field: 'lifecycle',
          type: 'composite',
          helpText:
            'Data lifecycle contract (ADR-0057): how long rows live and how space is reclaimed. Leave empty for permanent record semantics. Non-record classes require at least one bounding policy (retention, TTL, or rotation).',
          fields: [
            {
              field: 'class',
              type: 'select',
              helpText: 'Persistence contract for the rows of this object',
              options: [
                { label: 'Record (business truth — permanent)', value: 'record' },
                { label: 'Audit (compliance ledger — retain → archive → delete)', value: 'audit' },
                { label: 'Telemetry (high-frequency log — short retention)', value: 'telemetry' },
                { label: 'Transient (ephemeral state — TTL expiry)', value: 'transient' },
                { label: 'Event (bus messages — very short TTL)', value: 'event' },
              ],
            },
            {
              field: 'retention',
              type: 'composite',
              helpText: 'Age-based retention window',
              fields: [
                { field: 'maxAge', type: 'text', helpText: 'Rows older than this (by created_at) are reaped. Duration literal: h/d/w/y, e.g. "30d"' },
              ],
            },
            {
              field: 'ttl',
              type: 'composite',
              helpText: 'Per-row TTL expiry',
              fields: [
                { field: 'field', type: 'text', helpText: 'Timestamp field the TTL is measured from (e.g. expires_at)' },
                { field: 'expireAfter', type: 'text', helpText: 'Rows expire this long after the field, e.g. "1d"' },
              ],
            },
            {
              field: 'storage',
              type: 'composite',
              helpText: 'Physical rotation for high-frequency telemetry (SQLite: O(1) shard DROP)',
              fields: [
                {
                  field: 'strategy',
                  type: 'select',
                  helpText: 'Storage strategy',
                  options: [{ label: 'Rotation (time-shard + drop oldest)', value: 'rotation' }],
                },
                { field: 'shards', type: 'number', min: 2, helpText: 'Shards retained; total window = shards × unit' },
                {
                  field: 'unit',
                  type: 'select',
                  helpText: 'Time width of one shard',
                  options: [
                    { label: 'Day', value: 'day' },
                    { label: 'Week', value: 'week' },
                    { label: 'Month', value: 'month' },
                  ],
                },
              ],
            },
            {
              field: 'archive',
              type: 'composite',
              helpText: 'Cold-store hand-off (audit class). Rows are never hot-deleted before the archive copy succeeded.',
              fields: [
                { field: 'after', type: 'text', helpText: 'Archive rows older than this — must equal retention.maxAge' },
                { field: 'to', type: 'text', helpText: 'Target datasource name for cold storage' },
                { field: 'keep', type: 'text', helpText: 'How long the archive keeps rows (empty = forever), e.g. "7y"' },
              ],
            },
            { field: 'reclaim', type: 'boolean', helpText: 'Reclaim driver space after sweeps (default on for non-record classes)' },
          ],
        },
      ],
    },
  ],
});
