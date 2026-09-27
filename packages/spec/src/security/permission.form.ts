// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '../ui/view.zod';

/**
 * PermissionSet — canonical FormView layout.
 *
 * Serves the `permission` metadata kind, and only that one. There is no
 * Profile concept: ADR-0090 D2 removed it (`isProfile` deleted, not
 * deprecated), leaving permission sets as the only capability container —
 * union-merged and purely additive. So `METADATA_FORM_REGISTRY` has no
 * `profile` key, `MetadataTypeSchema` admits no `profile` kind, and
 * `PermissionSetSchema` answers an authored `isProfile` or `profiles` with a
 * retirement tombstone rather than a silent strip.
 *
 * The form surfaces no flag: `isDefault` (ADR-0090 D5) is the schema's only
 * boolean and it records a boot-time binding hint, not a grant.
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
        'Permission sets are the only capability container: a user gets the union of every set they hold, so sets only ever add access. Positions distribute sets to people.',
      columns: 2,
      fields: [
        { field: 'name', required: true, colSpan: 1, helpText: 'Machine name (snake_case)' },
        { field: 'label', colSpan: 1, helpText: 'Display label for admins' },
        // #19331 — four declared keys had no control, so the only door to any of
        // them was the Source tab's free-text JSON. `description` is persisted on
        // sys_permission_set and shown in Setup; the other three are the ADR-0086
        // D3 provenance pair plus the ADR-0090 D5 baseline flag.
        { field: 'description', type: 'textarea', colSpan: 2, helpText: 'Human-readable description shown in Setup (persisted as sys_permission_set.description).' },
        { field: 'isDefault', type: 'boolean', colSpan: 1, helpText: 'App baseline for the everyone position (ADR-0090 D5): an app-level set is auto-bound at boot; a package-level set becomes an install-time suggestion an admin confirms. Default false.' },
        { field: 'managedBy', type: 'select', colSpan: 1, helpText: 'Record provenance (ADR-0086 D3): who owns this set across upgrades.', options: [
          { label: 'Package (upgrade-owned metadata)', value: 'package' },
          { label: 'Platform (environment config)', value: 'platform' },
          { label: 'User (environment config)', value: 'user' },
        ] },
        { field: 'packageId', type: 'text', colSpan: 2, helpText: 'Owning package id for a package-shipped set (ADR-0086 D3). Leave empty for an environment-authored set.' },
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
