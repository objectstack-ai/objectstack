// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_scim_identity_tombstone — Deleted-identity tombstones
 * (`@better-auth/scim` stable `scimIdentityTombstone`).
 *
 * When an IdP deletes a provisioned user over SCIM, the library keeps a
 * tombstone of the identity it removed — connection scope, the IdP's
 * externalId and the final serialized profile — so a re-provision of the same
 * external identity is recognized rather than double-created. Columns mirror
 * the installed stable schema, bridged mechanically camelCase → snake_case by
 * `objectql-adapter.ts` (see `better-auth-schema-parity.test.ts`, #3653).
 *
 * @namespace sys
 */
export const SysScimIdentityTombstone = ObjectSchema.create({
  name: 'sys_scim_identity_tombstone',
  label: 'SCIM Identity Tombstone',
  pluralLabel: 'SCIM Identity Tombstones',
  icon: 'users',
  isSystem: true,
  managedBy: 'better-auth',
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth (@better-auth/scim) — see ADR-0071.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'Tombstones of IdP-deleted SCIM identities, kept so a re-provision is recognized',
  displayNameField: 'external_id',
  nameField: 'external_id', // [ADR-0079] canonical primary-title pointer
  titleFormat: '{external_id}',
  highlightFields: ['external_id', 'connection_id', 'deleted_at'],

  listViews: {
    all: {
      type: 'grid',
      name: 'all',
      label: 'All',
      data: { provider: 'object', object: 'sys_scim_identity_tombstone' },
      columns: ['external_id', 'connection_id', 'user_id', 'deleted_at'],
      sort: [{ field: 'deleted_at', order: 'desc' }],
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

    external_id: Field.text({
      label: 'External ID',
      required: true,
      maxLength: 255,
      description: 'The IdP-assigned externalId of the deleted identity',
      group: 'Identity',
    }),

    external_id_key: Field.text({
      label: 'External ID Key',
      required: true,
      readonly: true,
      maxLength: 512,
      description: 'Derived externalId uniqueness key maintained by @better-auth/scim; do not write directly.',
      group: 'System',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: true,
      description: 'The platform user the deleted identity was linked to',
      group: 'Identity',
    }),

    profile: Field.textarea({
      label: 'Final Profile',
      required: true,
      readonly: true,
      description: 'Serialized final SCIM profile at deletion time, maintained by @better-auth/scim',
      group: 'System',
    }),

    deleted_at: Field.datetime({ label: 'Deleted At', required: true, readonly: true, group: 'System' }),
  },

  indexes: [
    // UNIQUE mirrors @better-auth/scim's own declaration.
    { fields: ['external_id_key'], unique: true },
    { fields: ['connection_id'] },
    { fields: ['user_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
  },
});
