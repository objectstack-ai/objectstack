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
        // Text field options
        { field: 'minLength', visibleOn: "data.type == 'text' || data.type == 'textarea' || data.type == 'email'", helpText: 'Minimum character length' },
        { field: 'maxLength', visibleOn: "data.type == 'text' || data.type == 'textarea' || data.type == 'email'", helpText: 'Maximum character length' },
        // Number field options
        { field: 'min', visibleOn: "data.type == 'number' || data.type == 'currency'", helpText: 'Minimum value' },
        { field: 'max', visibleOn: "data.type == 'number' || data.type == 'currency'", helpText: 'Maximum value' },
        { field: 'precision', visibleOn: "data.type == 'currency' || data.type == 'number'", helpText: 'Decimal places (e.g., 2 for $10.50)' },
        { field: 'scale', visibleOn: "data.type == 'number'", helpText: 'Number of decimal digits' },
        // Select field options
        { field: 'options', type: 'repeater', visibleOn: "data.type == 'select' || data.type == 'multiselect'", helpText: 'Available options (label/value pairs)' },
        // Reference field options
        { field: 'reference', widget: 'ref:object', visibleOn: "data.type == 'lookup' || data.type == 'master_detail'", helpText: 'Referenced object name' },
        { field: 'referenceFilters', widget: 'string-tags', visibleOn: "data.type == 'lookup' || data.type == 'master_detail'", helpText: 'Filter expressions (e.g., "active = true")' },
        { field: 'deleteBehavior', visibleOn: "data.type == 'lookup' || data.type == 'master_detail'", helpText: 'What happens when referenced record is deleted' },
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
        { field: 'summaryOperations', type: 'composite', helpText: 'Roll-up summary configuration (for parent-child relationships)' },
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
        { field: 'columnName', colSpan: 2, helpText: 'Physical column name in database (defaults to field name)' },
        { field: 'index', colSpan: 1, helpText: 'Create database index for faster queries' },
        { field: 'externalId', colSpan: 1, helpText: 'Mark as external ID for upsert operations' },
        // UI & Visibility
        { field: 'readonly', colSpan: 1, helpText: 'Field is read-only in forms' },
        { field: 'hidden', colSpan: 1, helpText: 'Hide field from default UI views' },
        { field: 'searchable', colSpan: 1, helpText: 'Include in global search results' },
        { field: 'sortable', colSpan: 1, helpText: 'Allow sorting lists by this field' },
      ],
    },
  ],
});
