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
