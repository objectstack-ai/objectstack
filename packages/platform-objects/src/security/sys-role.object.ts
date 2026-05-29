// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_role — System Role Object
 *
 * RBAC role definition for the ObjectStack platform.
 * Roles group permissions and are assigned to users or members.
 *
 * @namespace sys
 */
export const SysRole = ObjectSchema.create({
  name: 'sys_role',
  label: 'Role',
  pluralLabel: 'Roles',
  icon: 'shield',
  isSystem: true,
  managedBy: 'config',
  // ADR-0010 §3.7 — RBAC primitive; tenants may add custom rows
  // (created via UI / API) but the schema itself is locked.
  protection: {
    lock: 'no-overlay',
    reason: 'RBAC schema is platform-defined — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'Role definitions for RBAC access control',
  displayNameField: 'label',
  titleFormat: '{label}',
  compactLayout: ['label', 'name', 'active', 'is_default'],

  // Custom actions — system roles drive RBAC and are edited rarely but
  // require the four high-frequency sysadmin affordances every IdP
  // (Salesforce, ServiceNow, Okta) ships: activate/deactivate (lifecycle
  // without losing assignments), mark default (auto-assign to new users),
  // and clone (template for new roles). All operations hit the generic
  // data CRUD endpoint exposed by `apiEnabled` — no custom server route
  // required because `managedBy: 'config'` allows direct mutation.
  actions: [
    {
      name: 'activate_role',
      label: 'Activate Role',
      icon: 'circle-check',
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_role/{id}',
      bodyExtra: { active: true },
      successMessage: 'Role activated',
      refreshAfter: true,
    },
    {
      name: 'deactivate_role',
      label: 'Deactivate Role',
      icon: 'circle-off',
      variant: 'danger',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_role/{id}',
      bodyExtra: { active: false },
      confirmText: 'Deactivate this role? Users with the role keep their assignment but the role stops granting permissions until re-activated.',
      successMessage: 'Role deactivated',
      refreshAfter: true,
    },
    {
      name: 'set_default_role',
      label: 'Set as Default',
      icon: 'star',
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_role/{id}',
      bodyExtra: { is_default: true },
      confirmText: 'Make this the default role for new users? Existing users are unaffected.',
      successMessage: 'Default role updated',
      refreshAfter: true,
    },
    {
      // Clone — POST a new sys_role row pre-filled from the source. The
      // dialog asks only for the new API name / label so the operator
      // can rename atomically; permissions JSON is copied wholesale via
      // defaultFromRow.
      name: 'clone_role',
      label: 'Clone Role',
      icon: 'copy',
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/data/sys_role',
      bodyExtra: { is_default: false, active: true },
      successMessage: 'Role cloned',
      refreshAfter: true,
      params: [
        { name: 'label', label: 'New Display Name', type: 'text', required: true },
        { name: 'name', label: 'New API Name', type: 'text', required: true, helpText: 'Unique snake_case machine name' },
        { field: 'description', defaultFromRow: true },
        { field: 'permissions', defaultFromRow: true },
      ],
    },
  ],

  listViews: {
    active: {
      type: 'grid',
      name: 'active',
      label: 'Active',
      data: { provider: 'object', object: 'sys_role' },
      columns: ['label', 'name', 'is_default', 'updated_at'],
      filter: [{ field: 'active', operator: 'equals', value: true }],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    default_roles: {
      type: 'grid',
      name: 'default_roles',
      label: 'Default',
      data: { provider: 'object', object: 'sys_role' },
      columns: ['label', 'name', 'description', 'active'],
      filter: [{ field: 'is_default', operator: 'equals', value: true }],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    custom: {
      type: 'grid',
      name: 'custom',
      label: 'Custom',
      data: { provider: 'object', object: 'sys_role' },
      columns: ['label', 'name', 'active', 'updated_at'],
      filter: [{ field: 'is_default', operator: 'equals', value: false }],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    all_roles: {
      type: 'grid',
      name: 'all_roles',
      label: 'All',
      data: { provider: 'object', object: 'sys_role' },
      columns: ['label', 'name', 'active', 'is_default', 'updated_at'],
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
      description: 'Unique machine name for the role (e.g. admin, editor, viewer)',
      group: 'Identity',
    }),

    description: Field.textarea({
      label: 'Description',
      required: false,
      group: 'Identity',
    }),

    // ── Configuration ────────────────────────────────────────────
    permissions: Field.textarea({
      label: 'Permissions',
      required: false,
      description: 'JSON-serialized array of permission strings',
      group: 'Configuration',
    }),

    // ── Status ───────────────────────────────────────────────────
    active: Field.boolean({
      label: 'Active',
      defaultValue: true,
      group: 'Status',
    }),

    is_default: Field.boolean({
      label: 'Default Role',
      defaultValue: false,
      description: 'Automatically assigned to new users',
      group: 'Status',
    }),

    // ── System ───────────────────────────────────────────────────
    id: Field.text({
      label: 'Role ID',
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
