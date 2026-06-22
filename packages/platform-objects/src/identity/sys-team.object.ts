// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_team — System Team Object
 *
 * Teams within an organization for fine-grained grouping.
 * Backed by better-auth's organization plugin (teams feature).
 *
 * @namespace sys
 */
export const SysTeam = ObjectSchema.create({
  name: 'sys_team',
  label: 'Team',
  pluralLabel: 'Teams',
  icon: 'users',
  isSystem: true,
  managedBy: 'better-auth',
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema,
  // but may add overlay row-level config. Use `no-overlay` if you need to
  // forbid sys_metadata overlays entirely.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'Teams within organizations for fine-grained grouping',
  displayNameField: 'name',
  titleFormat: '{name}',
  compactLayout: ['name', 'organization_id'],

  // Custom actions calling better-auth's team endpoints. Generic CRUD is
  // suppressed (managedBy: 'better-auth'), so these are the canonical
  // entry points for create/update/delete.
  actions: [
    {
      // Better-auth: `organization/create-team { name, organizationId? }`.
      // organizationId defaults to the caller's active org when omitted.
      name: 'create_team',
      label: 'Create Team',
      icon: 'plus',
      variant: 'primary',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/organization/create-team',
      successMessage: 'Team created',
      refreshAfter: true,
      params: [
        { field: 'name', required: true },
        { name: 'organizationId', field: 'organization_id' },
      ],
    },
    {
      // Better-auth: `organization/update-team { teamId, data: { name } }`.
      // teamId stays flat (top-level); the user-editable params nest under
      // `data` via bodyShape.
      name: 'update_team',
      label: 'Edit Team',
      icon: 'pencil',
      mode: 'edit',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/update-team',
      recordIdParam: 'teamId',
      bodyShape: { wrap: 'data' },
      successMessage: 'Team updated',
      refreshAfter: true,
      params: [
        { field: 'name', required: true, defaultFromRow: true },
      ],
    },
    {
      // Better-auth: `organization/remove-team { teamId, organizationId? }`.
      // organizationId defaults to the caller's active org when omitted.
      name: 'remove_team',
      label: 'Delete Team',
      icon: 'trash-2',
      variant: 'danger',
      mode: 'delete',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/remove-team',
      recordIdParam: 'teamId',
      confirmText: 'Delete this team? Members will lose any team-scoped access. This cannot be undone.',
      successMessage: 'Team deleted',
      refreshAfter: true,
    },
  ],

  listViews: {
    by_org: {
      type: 'grid',
      name: 'by_org',
      label: 'By Organization',
      data: { provider: 'object', object: 'sys_team' },
      columns: ['organization_id', 'name', 'created_at', 'updated_at'],
      sort: [{ field: 'organization_id', order: 'asc' }, { field: 'name', order: 'asc' }],
      grouping: { fields: [{ field: 'organization_id', order: 'asc', collapsed: false }] },
      pagination: { pageSize: 100 },
    },
    all_teams: {
      type: 'grid',
      name: 'all_teams',
      label: 'All',
      data: { provider: 'object', object: 'sys_team' },
      columns: ['name', 'organization_id', 'created_at', 'updated_at'],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    // ── Identity ─────────────────────────────────────────────────
    name: Field.text({
      label: 'Name',
      required: true,
      searchable: true,
      maxLength: 255,
      group: 'Identity',
    }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      // Optional: single-tenant deployments have no organization row (org-scoping
      // is multi-tenant-only, nothing auto-stamps one) — requiring it would make
      // the object uncreatable single-tenant. In multi-tenant, OrgScopingPlugin
      // auto-stamps this from the active tenant and tenant-isolation RLS hides any
      // null-org row (fail-closed). ADR-0057 addendum.
      required: false,
      description: 'Parent organization for this team. Null in single-tenant; auto-stamped in multi-tenant.',
      group: 'Identity',
    }),

    // ── System ───────────────────────────────────────────────────
    id: Field.text({
      label: 'Team ID',
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
    { fields: ['organization_id'] },
    { fields: ['name', 'organization_id'], unique: true },
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
