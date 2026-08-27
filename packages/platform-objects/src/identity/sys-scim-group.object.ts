// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_scim_group — IdP-pushed SCIM group for one connection
 * (`@better-auth/scim` stable `scimGroup`).
 *
 * One row per group the IdP pushes over SCIM 2.0 `/Groups`. The name survives
 * from rc.1 but the columns are the stable rewrite's: groups are scoped by
 * `connection_id` / `provisioning_domain_id` rather than rc.1's
 * provider/organization pair, and carry the library's derived uniqueness and
 * pagination keys. Columns mirror the installed stable schema, bridged
 * mechanically camelCase → snake_case by `objectql-adapter.ts` (see
 * `better-auth-schema-parity.test.ts`, #3653).
 *
 * Provisioning this table (with `sys_scim_group_member`) is what closes the
 * "IdP pushes groups into tables that do not exist" gap this card documented.
 *
 * @namespace sys
 */
export const SysScimGroup = ObjectSchema.create({
  name: 'sys_scim_group',
  label: 'SCIM Group',
  pluralLabel: 'SCIM Groups',
  icon: 'users',
  isSystem: true,
  managedBy: 'better-auth',
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth (@better-auth/scim) — see ADR-0071.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'IdP-pushed SCIM 2.0 groups, scoped per provisioning connection',
  displayNameField: 'display_name',
  nameField: 'display_name', // [ADR-0079] canonical primary-title pointer
  titleFormat: '{display_name}',
  highlightFields: ['display_name', 'connection_id', 'updated_at'],

  listViews: {
    all: {
      type: 'grid',
      name: 'all',
      label: 'All',
      data: { provider: 'object', object: 'sys_scim_group' },
      columns: ['display_name', 'connection_id', 'external_id', 'updated_at'],
      sort: [{ field: 'display_name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    id: Field.text({ label: 'ID', required: true, readonly: true, group: 'System' }),

    connection_id: Field.text({
      label: 'Connection ID',
      required: true,
      maxLength: 255,
      group: 'Connection',
    }),

    provisioning_domain_id: Field.text({
      label: 'Provisioning Domain',
      required: true,
      maxLength: 255,
      group: 'Connection',
    }),

    revision: Field.number({
      label: 'Revision',
      required: false,
      defaultValue: 0,
      readonly: true,
      description: 'Optimistic-concurrency revision maintained by @better-auth/scim',
      group: 'System',
    }),

    display_name: Field.text({
      label: 'Display Name',
      required: true,
      searchable: true,
      maxLength: 255,
      description: 'SCIM displayName as sent by the IdP',
      group: 'Identity',
    }),

    display_name_key: Field.text({
      label: 'Display Name Key',
      required: true,
      readonly: true,
      maxLength: 512,
      description: 'Derived case-folded displayName uniqueness key maintained by @better-auth/scim; do not write directly.',
      group: 'System',
    }),

    external_id: Field.text({
      label: 'External ID',
      required: false,
      maxLength: 255,
      description: 'IdP-assigned externalId, when the IdP sends one',
      group: 'Identity',
    }),

    external_id_key: Field.text({
      label: 'External ID Key',
      required: false,
      readonly: true,
      maxLength: 512,
      description: 'Derived externalId uniqueness key maintained by @better-auth/scim; do not write directly.',
      group: 'System',
    }),

    order_key: Field.text({
      label: 'Order Key',
      required: true,
      readonly: true,
      maxLength: 512,
      description: 'Derived stable-pagination key maintained by @better-auth/scim; do not write directly.',
      group: 'System',
    }),

    created_at: Field.datetime({ label: 'Created At', readonly: true, group: 'System' }),
    updated_at: Field.datetime({ label: 'Updated At', readonly: true, group: 'System' }),
  },

  indexes: [
    // UNIQUE mirrors @better-auth/scim's own declarations.
    { fields: ['display_name_key'], unique: true },
    // Nullable — repeated NULLs are admitted when the IdP sends no externalId.
    { fields: ['external_id_key'], unique: true },
    { fields: ['order_key'], unique: true },
    { fields: ['connection_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
  },
});
