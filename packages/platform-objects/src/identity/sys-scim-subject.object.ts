// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_scim_subject — Per-user SCIM link registry
 * (`@better-auth/scim` stable `scimSubject`).
 *
 * Exactly one row per platform user that any SCIM connection has provisioned.
 * It records which connection's projection currently sources the user's
 * profile (`profile_source_id` → a `sys_scim_user` row) and carries the
 * revision counter the library uses to serialize concurrent provisioning
 * writes across connections. Columns mirror the installed stable schema,
 * bridged mechanically camelCase → snake_case by `objectql-adapter.ts` (see
 * `better-auth-schema-parity.test.ts`, #3653).
 *
 * @namespace sys
 */
export const SysScimSubject = ObjectSchema.create({
  name: 'sys_scim_subject',
  label: 'SCIM Subject',
  pluralLabel: 'SCIM Subjects',
  icon: 'users',
  isSystem: true,
  managedBy: 'better-auth',
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth (@better-auth/scim) — see ADR-0071.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'Per-user SCIM provisioning link — one row per user any SCIM connection provisions',
  titleFormat: '{user_id}',
  highlightFields: ['user_id', 'profile_source_id', 'updated_at'],

  listViews: {
    all: {
      type: 'grid',
      name: 'all',
      label: 'All',
      data: { provider: 'object', object: 'sys_scim_subject' },
      columns: ['user_id', 'profile_source_id', 'revision', 'updated_at'],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    id: Field.text({ label: 'ID', required: true, readonly: true, group: 'System' }),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: true,
      description: 'The platform user this subject row tracks (unique — one row per user)',
      group: 'Identity',
    }),

    profile_source_id: Field.text({
      label: 'Profile Source',
      required: false,
      maxLength: 255,
      description: 'The sys_scim_user projection currently sourcing this user\'s profile',
      group: 'Identity',
    }),

    revision: Field.number({
      label: 'Revision',
      required: true,
      readonly: true,
      description: 'Optimistic-concurrency revision maintained by @better-auth/scim',
      group: 'System',
    }),

    created_at: Field.datetime({ label: 'Created At', readonly: true, group: 'System' }),
    updated_at: Field.datetime({ label: 'Updated At', readonly: true, group: 'System' }),
  },

  indexes: [
    // UNIQUE mirrors @better-auth/scim's own declaration — one row per user.
    { fields: ['user_id'], unique: true },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
  },
});
