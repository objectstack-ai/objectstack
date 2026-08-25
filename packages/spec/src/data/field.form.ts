// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '../ui/view.zod';

/**
 * Field Metadata Form
 * 
 * Form layout for creating/editing field metadata definitions.
 */
export const fieldForm = defineForm({
  schemaId: 'field',
  type: 'simple',
  sections: [
    {
      name: 'basics',
      label: 'Basics',
      description: 'Core field identity and constraints.',
      columns: 2,
      fields: [
        { field: 'name', required: true, immutable: true, colSpan: 1, helpText: 'Unique identifier (snake_case, immutable after creation)' },
        { field: 'label', required: true, colSpan: 1, helpText: 'Display name for users' },
        { field: 'type', required: true, colSpan: 1, helpText: 'Data type of this field' },
        { field: 'group', colSpan: 1, helpText: 'Group name for form layout' },
        { field: 'description', widget: 'textarea', colSpan: 2, helpText: 'Help text shown to users' },
        { field: 'required', colSpan: 1, helpText: 'User must provide a value' },
        { field: 'unique', colSpan: 1, helpText: 'No two records can have the same value' },
        { field: 'multiple', colSpan: 1, helpText: 'Allow multiple values (for select/lookup)' },
      ],
    },
    {
      name: 'configuration',
      label: 'Configuration',
      description: 'Field-type specific settings (visible blocks depend on the chosen type).',
      fields: [
        { field: 'defaultValue', helpText: 'Default value for new records' },
        { field: 'placeholder', helpText: 'Hint text shown inside the empty input (disappears once a value is entered); use inlineHelpText for always-visible help' },
        // Text field options
        { field: 'minLength', visibleWhen: "data.type == 'text' || data.type == 'textarea' || data.type == 'email'", helpText: 'Minimum character length' },
        // #11566 — `maxLength` is shown for exactly the ten bounded-string
        // types the schema accepts it on and the write-time validator enforces
        // it for (BOUNDED_STRING_FIELD_TYPES; maintainer ruling 2026-08-24).
        // This list used to be a third opinion (3 types here, 9 in
        // object.form, 10 at the validator); it converged to the validator's.
        { field: 'maxLength', visibleWhen: "data.type in ['text','textarea','email','url','phone','password','markdown','html','richtext','code']", helpText: 'Maximum character length' },
        // Number field options
        { field: 'min', visibleWhen: "data.type == 'number' || data.type == 'currency'", helpText: 'Minimum value' },
        { field: 'max', visibleWhen: "data.type == 'number' || data.type == 'currency'", helpText: 'Maximum value' },
        { field: 'precision', visibleWhen: "data.type == 'currency' || data.type == 'number'", helpText: 'Decimal places (e.g., 2 for $10.50)' },
        { field: 'scale', visibleWhen: "data.type == 'number'", helpText: 'Number of decimal digits' },
        // Select field options
        { field: 'options', type: 'repeater', visibleWhen: "data.type == 'select' || data.type == 'multiselect'", helpText: 'Available options (label/value pairs)' },
        // Reference field options
        { field: 'reference', widget: 'ref:object', visibleWhen: "data.type == 'lookup' || data.type == 'master_detail'", helpText: 'Referenced object name' },
        // Two declarations of one key, with disjoint `visibleWhen` (#11410) —
        // the same split `object.form.ts` carries, and for the same reason:
        // #9689 made `set_null` on a `master_detail` a parse-time rejection, so
        // one shared control offered a choice publish refuses.
        //
        // This file reached that defect by the OTHER route. It declares no
        // `options`, which is not a narrower offer but the renderer's DERIVED
        // source: with no inline list the metadata-admin form falls through to
        // the JSON Schema `enum` — `['set_null','cascade','restrict']`, which
        // additionally advertises `default: 'set_null'`. A Zod enum has no
        // per-type narrowing to give, so `master_detail` can only be served by
        // an EXPLICIT list; omitting one re-offers the refused value.
        //
        // `lookup` keeps deriving from that enum, untouched: all three outcomes
        // are legal there, and leaving the source alone keeps its labels and
        // their translation exactly as they are today. The two branches are
        // mutually exclusive, so no author ever sees both spellings at once.
        //
        // `helpText` is identical on both — they share one i18n key
        // (`metadataForms.field.fields.deleteBehavior`), so divergent text would
        // collide silently.
        { field: 'deleteBehavior', visibleWhen: "data.type == 'lookup'", helpText: 'What happens when referenced record is deleted' },
        { field: 'deleteBehavior', type: 'select', visibleWhen: "data.type == 'master_detail'", helpText: 'What happens when referenced record is deleted', options: [
          { label: 'Cascade (delete children)', value: 'cascade' },
          { label: 'Restrict (block the delete)', value: 'restrict' },
        ] },
      ],
    },
    {
      name: 'formula',
      label: 'Formula & Computed',
      description: 'Calculated values and roll-up summaries.',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'expression', widget: 'textarea', helpText: 'CEL expression to calculate this field (makes it read-only)' },
        {
          field: 'summaryOperations',
          type: 'composite',
          visibleWhen: "data.type == 'summary'",
          helpText: 'Roll-up summary configuration (for parent-child relationships)',
          // Declare the composite's inner shape so the protocol-driven form
          // renders structured sub-fields (not a raw JSON blob). Mirrors the
          // `summaryOperations` Zod schema in field.zod.ts; `filter` is bound to
          // the FilterCondition widget so only matching child rows aggregate.
          fields: [
            { field: 'object', widget: 'ref:object', required: true, helpText: 'Child object to aggregate' },
            {
              field: 'function',
              type: 'select',
              required: true,
              options: [
                { label: 'Count', value: 'count' },
                { label: 'Sum', value: 'sum' },
                { label: 'Min', value: 'min' },
                { label: 'Max', value: 'max' },
                { label: 'Average', value: 'avg' },
              ],
              helpText: 'Aggregation function',
            },
            { field: 'field', required: true, helpText: 'Child field to aggregate (ignored for count)' },
            { field: 'relationshipField', helpText: 'Child FK back to this parent (auto-detected when omitted)' },
            { field: 'filter', widget: 'filter-condition', helpText: 'Only child rows matching this predicate are aggregated (e.g. status == received)' },
          ],
        },
      ],
    },
    {
      name: 'advanced',
      label: 'Advanced',
      description: 'Database, UI, audit, and security settings.',
      collapsible: true,
      collapsed: true,
      columns: 2,
      fields: [
        // Database & Performance
        { field: 'externalId', colSpan: 1, helpText: 'Mark as external ID for upsert operations' },
        // UI & Visibility
        { field: 'readonly', colSpan: 1, helpText: 'Field is read-only in forms' },
        { field: 'hidden', colSpan: 1, helpText: 'Hide field from default UI views' },
        { field: 'searchable', colSpan: 1, helpText: 'Include in global search results' },
        { field: 'sortable', colSpan: 1, helpText: 'Allow sorting lists by this field' },
        // Partial masking (#8993): a preset name or a {keepHead, keepTail} JSON
        // object; the runtime FieldMasker enforces it on read AND export.
        { field: 'maskingRule', colSpan: 2, helpText: "Partial masking: preset ('phone', 'id_card', 'bank_account', 'email', 'name') or {\"keepHead\": n, \"keepTail\": m}. Masked for callers not holding this field's requiredPermissions" },
      ],
    },
  ],
});
