// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '../ui/view.zod';

/**
 * PermissionSet — canonical FormView layout.
 *
 * Used for both `permission` (additive permission grant bundles) and
 * `profile` (the base permission set assigned to every user). The only
 * flags are minimal (ADR-0090 D2 removed the Profile concept)
 * so admins can see and toggle it explicitly.
 *
 * The object/field permission maps are intentionally kept as JSON for
 * now — they're typically managed via the dedicated permission matrix
 * UI on a record-by-record basis, not free-form editing.
 */
export const permissionForm = defineForm({
  schemaId: 'permission',
  type: 'simple',
  sections: [
    {
      label: 'Identity',
      description:
        'Permission Sets stack on top of a Profile to grant additional access. Profiles are the base set assigned 1:1 to each user.',
      columns: 2,
      fields: [
        { field: 'name', required: true, colSpan: 1, helpText: 'Machine name (snake_case)' },
        { field: 'label', colSpan: 1, helpText: 'Display label for admins' },
      ],
    },
    {
      label: 'System Permissions',
      description: 'High-level capabilities not tied to a specific object — e.g. manage_users, view_audit_logs.',
      columns: 1,
      fields: [
        { field: 'systemPermissions', type: 'tags', helpText: 'List of system capability keys' },
      ],
    },
    {
      label: 'Object & Field Permissions',
      description: 'Per-object CRUD + per-field FLS. Edit via the matrix editor or paste JSON here.',
      columns: 1,
      fields: [
        { field: 'objects', widget: 'json', helpText: '{ "account": { allowRead: true, allowEdit: true, ... } }' },
        { field: 'fields', widget: 'json', helpText: '{ "account.amount": { readable: true, editable: false } }' },
      ],
    },
    {
      label: 'Tab & Row-Level Security',
      description: 'Tab visibility and RLS policies.',
      columns: 1,
      fields: [
        { field: 'tabPermissions', widget: 'json', helpText: '{ "app_crm": "visible", "app_admin": "hidden" }' },
        { field: 'rowLevelSecurity', widget: 'json', helpText: 'Array of RLS policies (see rls.zod.ts)' },
      ],
    },
  ],
});
