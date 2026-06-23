// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_capability — Capability definition registry (ADR-0066 D1).
 *
 * Promotes authorization *capabilities* from bare strings to first-class
 * records. A capability is layer 1 of the ADR-0066 three-way separation
 * (capability / assignment / requirement): "what can be done"
 * (`manage_users`, `manage_platform_settings`, `export_data`, …). The
 * platform/packages DEFINE capabilities; admins EXTEND them in Setup.
 *
 * `PermissionSet.systemPermissions[]` (assignment) and a resource's
 * `requiredPermissions[]` (requirement) reference a capability **by name** —
 * so this table is the catalog/definition, NOT the grant. Existing string
 * capabilities are back-compat seeded as rows with the same `name`, so all
 * current references keep resolving (no migration).
 *
 * Named `sys_capability` (not `sys_permission` as the ADR loosely floats) to
 * avoid collision with `sys_permission_set` and to match the "capability"
 * vocabulary used throughout ADR-0066.
 *
 * @namespace sys
 */
export const SysCapability = ObjectSchema.create({
  name: 'sys_capability',
  label: 'Capability',
  pluralLabel: 'Capabilities',
  icon: 'badge-check',
  isSystem: true,
  managedBy: 'config',
  // ADR-0010 §3.7 — RBAC primitive; tenants/admins may add custom rows
  // (created via UI / API) but the schema itself is locked.
  protection: {
    lock: 'no-overlay',
    reason: 'Capability registry schema is platform-defined — see ADR-0066 / ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'Authorization capability definitions (ADR-0066 D1). Referenced by name from permission-set systemPermissions and resource requiredPermissions.',
  displayNameField: 'label',
  titleFormat: '{label}',
  compactLayout: ['label', 'name', 'scope', 'managed_by', 'active'],

  actions: [
    {
      name: 'activate_capability',
      label: 'Activate',
      icon: 'circle-check',
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_capability/{id}',
      bodyExtra: { active: true },
      successMessage: 'Capability activated',
      refreshAfter: true,
    },
    {
      name: 'deactivate_capability',
      label: 'Deactivate',
      icon: 'circle-off',
      variant: 'danger',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_capability/{id}',
      bodyExtra: { active: false },
      confirmText: 'Deactivate this capability? Grants and resource requirements that reference it stop resolving until re-activated.',
      successMessage: 'Capability deactivated',
      refreshAfter: true,
    },
  ],

  listViews: {
    platform: {
      type: 'grid',
      name: 'platform',
      label: 'Platform',
      data: { provider: 'object', object: 'sys_capability' },
      columns: ['label', 'name', 'managed_by', 'active'],
      filter: [{ field: 'scope', operator: 'equals', value: 'platform' }],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    org: {
      type: 'grid',
      name: 'org',
      label: 'Organization',
      data: { provider: 'object', object: 'sys_capability' },
      columns: ['label', 'name', 'managed_by', 'active'],
      filter: [{ field: 'scope', operator: 'equals', value: 'org' }],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    all_capabilities: {
      type: 'grid',
      name: 'all_capabilities',
      label: 'All',
      data: { provider: 'object', object: 'sys_capability' },
      columns: ['label', 'name', 'scope', 'managed_by', 'active'],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    // ── Identity ─────────────────────────────────────────────────
    label: Field.text({
      label: 'Display Name',
      required: true,
      searchable: true,
      maxLength: 255,
      group: 'Identity',
    }),

    name: Field.text({
      label: 'API Name',
      required: true,
      searchable: true,
      maxLength: 100,
      description: 'Unique capability key referenced by systemPermissions / requiredPermissions (e.g. manage_users, setup.access).',
      group: 'Identity',
    }),

    description: Field.textarea({
      label: 'Description',
      required: false,
      group: 'Identity',
    }),

    // ── Classification ───────────────────────────────────────────
    scope: Field.select({
      label: 'Scope',
      required: true,
      defaultValue: 'platform',
      description: 'platform = a platform-wide power; org = scoped to an organization.',
      options: [
        { value: 'platform', label: 'Platform' },
        { value: 'org', label: 'Organization' },
      ],
      group: 'Classification',
    }),

    managed_by: Field.select({
      label: 'Managed By',
      required: true,
      defaultValue: 'admin',
      description: 'platform/package-owned capabilities are shipped and not user-deletable; admin-owned are created in Setup.',
      options: [
        { value: 'platform', label: 'Platform' },
        { value: 'package', label: 'Package' },
        { value: 'admin', label: 'Admin' },
      ],
      group: 'Classification',
    }),

    // ── Status ───────────────────────────────────────────────────
    active: Field.boolean({
      label: 'Active',
      defaultValue: true,
      group: 'Status',
    }),

    // ── System ───────────────────────────────────────────────────
    id: Field.text({
      label: 'Capability ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['name'], unique: true },
    { fields: ['scope'] },
    { fields: ['active'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
    trash: true,
    mru: false,
  },
});
