// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_scim_group_member — SCIM group membership junction
 * (`@better-auth/scim` stable `scimGroupMember`).
 *
 * One row per (group, member) pair the IdP pushes. The name survives from
 * rc.1 but the anchoring is the stable rewrite's: the member references the
 * per-connection `sys_scim_user` projection (`scim_user_id`), not the core
 * user table. Columns mirror the installed stable schema, bridged mechanically
 * camelCase → snake_case by `objectql-adapter.ts` (see
 * `better-auth-schema-parity.test.ts`, #3653).
 *
 * @namespace sys
 */
export const SysScimGroupMember = ObjectSchema.create({
  name: 'sys_scim_group_member',
  label: 'SCIM Group Member',
  pluralLabel: 'SCIM Group Members',
  icon: 'users',
  isSystem: true,
  managedBy: 'better-auth',
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth (@better-auth/scim) — see ADR-0071.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'SCIM group membership rows pushed by the IdP (group ↔ provisioned user)',
  titleFormat: '{scim_user_id} in {group_id}',
  highlightFields: ['group_id', 'scim_user_id', 'created_at'],

  listViews: {
    all: {
      type: 'grid',
      name: 'all',
      label: 'All',
      data: { provider: 'object', object: 'sys_scim_group_member' },
      columns: ['group_id', 'scim_user_id', 'connection_id', 'created_at'],
      sort: [{ field: 'created_at', order: 'desc' }],
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

    group_id: Field.lookup('sys_scim_group', {
      label: 'Group',
      required: true,
      group: 'Membership',
    }),

    scim_user_id: Field.lookup('sys_scim_user', {
      label: 'SCIM User',
      required: true,
      group: 'Membership',
    }),

    membership_key: Field.text({
      label: 'Membership Key',
      required: true,
      readonly: true,
      maxLength: 512,
      description: 'Derived membership uniqueness key maintained by @better-auth/scim; do not write directly.',
      group: 'System',
    }),

    created_at: Field.datetime({ label: 'Created At', readonly: true, group: 'System' }),
  },

  indexes: [
    // UNIQUE mirrors @better-auth/scim's own declaration — what makes its
    // concurrent-add recovery work (same shape as sys_team_member).
    { fields: ['membership_key'], unique: true },
    { fields: ['group_id'] },
    { fields: ['scim_user_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
  },
});
