// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_permission_set — System Permission Set Object
 *
 * Named groupings of fine-grained permissions.
 * Permission sets can be assigned to roles or directly to users
 * for granular access control.
 *
 * @namespace sys
 */
export const SysPermissionSet = ObjectSchema.create({
  name: 'sys_permission_set',
  label: 'Permission Set',
  pluralLabel: 'Permission Sets',
  icon: 'lock',
  isSystem: true,
  managedBy: 'config',
  // ADR-0010 §3.7 — RBAC primitive; tenants may add custom rows
  // (created via UI / API) but the schema itself is locked.
  protection: {
    lock: 'no-overlay',
    reason: 'RBAC schema is platform-defined — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'Named permission groupings for fine-grained access control',
  displayNameField: 'label',
  titleFormat: '{label}',
  compactLayout: ['label', 'name', 'active'],

  // Custom actions — permission sets are templates assigned to roles or
  // users (via sys_role_permission_set / sys_user_permission_set). The
  // sysadmin operations that don't live on the parent-detail tabs are
  // lifecycle (activate/deactivate without losing assignments) and
  // clone (build a new permset by tweaking an existing one). Both hit
  // the generic data CRUD endpoint — managedBy: 'config' permits it.
  actions: [
    {
      name: 'activate_permission_set',
      label: 'Activate',
      icon: 'circle-check',
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_permission_set/{id}',
      bodyExtra: { active: true },
      successMessage: 'Permission set activated',
      refreshAfter: true,
    },
    {
      name: 'deactivate_permission_set',
      label: 'Deactivate',
      icon: 'circle-off',
      variant: 'danger',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_permission_set/{id}',
      bodyExtra: { active: false },
      confirmText: 'Deactivate this permission set? Existing assignments stay in place but stop granting access until re-activated.',
      successMessage: 'Permission set deactivated',
      refreshAfter: true,
    },
    {
      name: 'clone_permission_set',
      label: 'Clone',
      icon: 'copy',
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/data/sys_permission_set',
      bodyExtra: { active: true },
      successMessage: 'Permission set cloned',
      refreshAfter: true,
      params: [
        { name: 'label', label: 'New Display Name', type: 'text', required: true },
        { name: 'name', label: 'New API Name', type: 'text', required: true, helpText: 'Unique snake_case machine name' },
        { field: 'description', defaultFromRow: true },
        { field: 'object_permissions', defaultFromRow: true },
        { field: 'field_permissions', defaultFromRow: true },
      ],
    },
  ],

  listViews: {
    active: {
      type: 'grid',
      name: 'active',
      label: 'Active',
      data: { provider: 'object', object: 'sys_permission_set' },
      columns: ['label', 'name', 'description', 'updated_at'],
      filter: [{ field: 'active', operator: 'equals', value: true }],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    inactive: {
      type: 'grid',
      name: 'inactive',
      label: 'Inactive',
      data: { provider: 'object', object: 'sys_permission_set' },
      columns: ['label', 'name', 'updated_at'],
      filter: [{ field: 'active', operator: 'equals', value: false }],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    all_permsets: {
      type: 'grid',
      name: 'all_permsets',
      label: 'All',
      data: { provider: 'object', object: 'sys_permission_set' },
      columns: ['label', 'name', 'active', 'updated_at'],
      sort: [{ field: 'label', order: 'asc' }],
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
      description: 'Unique machine name for the permission set',
      group: 'Identity',
    }),

    description: Field.textarea({
      label: 'Description',
      required: false,
      group: 'Identity',
    }),

    // ── Permissions ──────────────────────────────────────────────
    object_permissions: Field.textarea({
      label: 'Object Permissions',
      required: false,
      description: 'JSON-serialized object-level CRUD permissions',
      group: 'Permissions',
    }),

    field_permissions: Field.textarea({
      label: 'Field Permissions',
      required: false,
      description: 'JSON-serialized field-level read/write permissions',
      group: 'Permissions',
    }),

    system_permissions: Field.textarea({
      label: 'System Permissions',
      required: false,
      description: 'JSON-serialized array of system capability names (e.g. ["setup.access","studio.access","manage_users"])',
      group: 'Permissions',
    }),

    row_level_security: Field.textarea({
      label: 'Row-Level Security',
      required: false,
      description: 'JSON-serialized array of row-level security policies (USING/CHECK clauses)',
      group: 'Permissions',
    }),

    tab_permissions: Field.textarea({
      label: 'Tab Permissions',
      required: false,
      description: 'JSON-serialized map of app tab visibility (visible | hidden | default_on | default_off)',
      group: 'Permissions',
    }),

    // ── Status ───────────────────────────────────────────────────
    active: Field.boolean({
      label: 'Active',
      defaultValue: true,
      group: 'Status',
    }),

    // ── System ───────────────────────────────────────────────────
    id: Field.text({
      label: 'Permission Set ID',
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
    { fields: ['active'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
    trash: true,
    mru: true,
  },
});
