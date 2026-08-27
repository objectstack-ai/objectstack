// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_scim_projection_grant — Role/entitlement grants projected from SCIM
 * (`@better-auth/scim` stable `scimProjectionGrant`).
 *
 * The stable line's generalization of rc.1's `scimGroupRole` +
 * `scimGroupRoleGrant` pair: one row per (source, role, user) grant a SCIM
 * push projected onto a platform user, where the source can be a group, an
 * entitlement, or a direct attribute (`source_kind` / `source_id` /
 * `source_value`). Columns mirror the installed stable schema, bridged
 * mechanically camelCase → snake_case by `objectql-adapter.ts` (see
 * `better-auth-schema-parity.test.ts`, #3653).
 *
 * @namespace sys
 */
export const SysScimProjectionGrant = ObjectSchema.create({
  name: 'sys_scim_projection_grant',
  label: 'SCIM Projection Grant',
  pluralLabel: 'SCIM Projection Grants',
  icon: 'users',
  isSystem: true,
  managedBy: 'better-auth',
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth (@better-auth/scim) — see ADR-0071.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'Role/entitlement grants projected onto platform users by SCIM provisioning',
  titleFormat: '{role} → {user_id}',
  highlightFields: ['role', 'source_kind', 'user_id', 'connection_id'],

  listViews: {
    all: {
      type: 'grid',
      name: 'all',
      label: 'All',
      data: { provider: 'object', object: 'sys_scim_projection_grant' },
      columns: ['role', 'source_kind', 'source_id', 'user_id', 'connection_id', 'updated_at'],
      sort: [{ field: 'updated_at', order: 'desc' }],
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

    scim_user_id: Field.lookup('sys_scim_user', {
      label: 'SCIM User',
      required: true,
      description: 'The per-connection user projection this grant belongs to',
      group: 'Identity',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: true,
      description: 'The platform user the grant is projected onto',
      group: 'Identity',
    }),

    source_kind: Field.text({
      label: 'Source Kind',
      required: true,
      maxLength: 64,
      description: 'What projected the grant (e.g. group, entitlement, attribute)',
      group: 'Grant',
    }),

    source_id: Field.text({
      label: 'Source ID',
      required: true,
      maxLength: 255,
      description: 'Identifier of the projecting source (e.g. the SCIM group id)',
      group: 'Grant',
    }),

    source_value: Field.text({
      label: 'Source Value',
      required: false,
      maxLength: 512,
      description: 'Source attribute value, when the source kind carries one',
      group: 'Grant',
    }),

    role: Field.text({
      label: 'Role',
      required: true,
      maxLength: 255,
      description: 'The role/entitlement projected onto the user',
      group: 'Grant',
    }),

    grant_key: Field.text({
      label: 'Grant Key',
      required: true,
      readonly: true,
      maxLength: 512,
      description: 'Derived grant uniqueness key maintained by @better-auth/scim; do not write directly.',
      group: 'System',
    }),

    created_at: Field.datetime({ label: 'Created At', readonly: true, group: 'System' }),
    updated_at: Field.datetime({ label: 'Updated At', readonly: true, group: 'System' }),
  },

  indexes: [
    // UNIQUE mirrors @better-auth/scim's own declaration.
    { fields: ['grant_key'], unique: true },
    { fields: ['scim_user_id'] },
    { fields: ['user_id'] },
    { fields: ['connection_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
  },
});
