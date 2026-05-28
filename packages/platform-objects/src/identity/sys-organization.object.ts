// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_organization — System Organization Object
 *
 * Multi-organization support for the ObjectStack platform.
 * Backed by better-auth's organization plugin.
 *
 * @namespace sys
 */
export const SysOrganization = ObjectSchema.create({
  name: 'sys_organization',
  label: 'Organization',
  pluralLabel: 'Organizations',
  icon: 'building-2',
  isSystem: true,
  managedBy: 'better-auth',
  description: 'Organizations for multi-tenant grouping',
  displayNameField: 'name',
  titleFormat: '{name}',
  compactLayout: ['name', 'slug'],

  // Custom actions — generic CRUD is suppressed (better-auth-managed),
  // but admins still need to create new orgs from the Setup app.
  actions: [
    {
      name: 'create_organization',
      label: 'Create Organization',
      icon: 'plus',
      variant: 'primary',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/organization/create',
      successMessage: 'Organization created',
      refreshAfter: true,
      // Hidden when the deployment is provisioned in single-org mode
      // (`OS_MULTI_ORG_ENABLED=false`). `features.multiOrgEnabled` is
      // populated by the console/account shells from `/auth/config`;
      // we default to visible when the flag is undefined so we don't
      // accidentally hide the button while auth config is still loading.
      visible: 'features.multiOrgEnabled != false',
      params: [
        { field: 'name', required: true },
        { field: 'slug', required: true },
        { field: 'logo' },
      ],
    },
    {
      name: 'update_organization',
      label: 'Edit Organization',
      icon: 'pencil',
      mode: 'edit',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/update',
      recordIdParam: 'organizationId',
      // better-auth `organization/update` nests editable fields under `data`.
      bodyShape: { wrap: 'data' },
      successMessage: 'Organization updated',
      refreshAfter: true,
      params: [
        { field: 'name', required: true, defaultFromRow: true },
        { field: 'slug', required: true, defaultFromRow: true },
        { field: 'logo', defaultFromRow: true },
      ],
    },
    {
      name: 'delete_organization',
      label: 'Delete Organization',
      icon: 'trash-2',
      variant: 'danger',
      mode: 'delete',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/delete',
      recordIdParam: 'organizationId',
      confirmText: 'Delete this organization? All members will lose access immediately. This cannot be undone.',
      successMessage: 'Organization deleted',
      refreshAfter: true,
    },
    {
      // Switch the caller's active organization context. Standard
      // better-auth endpoint; no extra params needed (org id ships as
      // the row id). Used from the Setup list and the record header so
      // admins can context-switch without leaving the page.
      name: 'set_active_organization',
      label: 'Set Active',
      icon: 'check-circle-2',
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      target: '/api/v1/auth/organization/set-active',
      recordIdParam: 'organizationId',
      successMessage: 'Active organization switched',
      refreshAfter: true,
    },
    {
      // Current user leaves the org. Distinct from `delete_organization`
      // (admin-only, destroys the org) — `leave` only removes the caller's
      // own membership. Better-auth: `organization/leave { organizationId }`.
      name: 'leave_organization',
      label: 'Leave Organization',
      icon: 'log-out',
      variant: 'danger',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      target: '/api/v1/auth/organization/leave',
      recordIdParam: 'organizationId',
      confirmText: 'Leave this organization? You will lose access to all of its resources.',
      successMessage: 'You have left the organization',
      refreshAfter: true,
    },
    {
      // Rename the organization slug (URL prefix). Backed by the cloud
      // orchestrator at /api/v1/cloud/organizations/{id}/change-slug,
      // which atomically updates sys_organization.slug, rewrites
      // platform_subdomain sys_domain rows under the new slug, soft-
      // retires the old rows with a redirect window, parks the old
      // slug in sys_slug_reservation, and refreshes the registry
      // mirror. See cloud `docs/design/sys-domain.md` §6.
      name: 'change_slug',
      label: 'Change Slug',
      icon: 'edit-3',
      variant: 'secondary',
      mode: 'custom',
      locations: ['record_header'],
      type: 'api',
      target: '/api/v1/cloud/organizations/{id}/change-slug',
      method: 'POST',
      confirmText: 'Renaming the slug rewrites every platform subdomain for this org and parks the old slug for 90 days. Continue?',
      successMessage: 'Organization slug changed',
      refreshAfter: true,
      params: [
        { field: 'slug', required: true, defaultFromRow: true },
      ],
    },
  ],

  listViews: {
    all_orgs: {
      type: 'grid',
      name: 'all_orgs',
      label: 'All',
      data: { provider: 'object', object: 'sys_organization' },
      columns: ['name', 'slug', 'created_at', 'updated_at'],
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

    slug: Field.text({
      label: 'Slug',
      required: false,
      searchable: true,
      maxLength: 255,
      description: 'URL-friendly identifier',
      group: 'Identity',
    }),

    // ── Branding ─────────────────────────────────────────────────
    logo: Field.url({
      label: 'Logo',
      required: false,
      group: 'Branding',
    }),

    // ── Configuration ────────────────────────────────────────────
    metadata: Field.textarea({
      label: 'Metadata',
      required: false,
      description: 'JSON-serialized organization metadata',
      group: 'Configuration',
    }),

    // ── System ───────────────────────────────────────────────────
    id: Field.text({
      label: 'Organization ID',
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
    { fields: ['slug'], unique: true },
    { fields: ['name'] },
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
