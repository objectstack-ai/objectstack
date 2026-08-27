// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_scim_user — Provisioned-user projection for one SCIM connection
 * (`@better-auth/scim` stable `scimUser`).
 *
 * The stable line no longer writes IdP-provisioned attributes onto the core
 * `user` table the way rc.1 did — each connection keeps its own projection of
 * the user it provisioned here, linked to the real `sys_user` row through
 * `user_id` (and de-duplicated across connections through `sys_scim_subject`).
 * Columns mirror the installed stable schema, bridged mechanically
 * camelCase → snake_case by `objectql-adapter.ts` (see
 * `better-auth-schema-parity.test.ts`, #3653).
 *
 * The `*_key` / `*_index` columns are derived lookup/uniqueness keys the
 * library owns end to end (`returned: false` upstream) — never authored or
 * interpreted from the ObjectStack side.
 *
 * @namespace sys
 */
export const SysScimUser = ObjectSchema.create({
  name: 'sys_scim_user',
  label: 'SCIM User',
  pluralLabel: 'SCIM Users',
  icon: 'users',
  isSystem: true,
  managedBy: 'better-auth',
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth (@better-auth/scim) — see ADR-0071.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'Per-connection projection of an IdP-provisioned user (SCIM 2.0 /Users)',
  displayNameField: 'user_name',
  nameField: 'user_name', // [ADR-0079] canonical primary-title pointer
  titleFormat: '{user_name}',
  highlightFields: ['user_name', 'display_name', 'primary_email', 'active'],

  listViews: {
    all: {
      type: 'grid',
      name: 'all',
      label: 'All',
      data: { provider: 'object', object: 'sys_scim_user' },
      columns: ['user_name', 'display_name', 'primary_email', 'connection_id', 'active', 'updated_at'],
      sort: [{ field: 'user_name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    id: Field.text({ label: 'ID', required: true, readonly: true, group: 'System' }),

    connection_id: Field.text({
      label: 'Connection ID',
      required: true,
      maxLength: 255,
      description: 'SCIM connection that provisioned this user',
      group: 'Connection',
    }),

    provisioning_domain_id: Field.text({
      label: 'Provisioning Domain',
      required: true,
      maxLength: 255,
      group: 'Connection',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: true,
      description: 'The platform user this projection materialized as',
      group: 'Identity',
    }),

    connection_user_key: Field.text({
      label: 'Connection User Key',
      required: true,
      readonly: true,
      maxLength: 512,
      description: 'Derived (connection, user) uniqueness key maintained by @better-auth/scim; do not write directly.',
      group: 'System',
    }),

    user_name: Field.text({
      label: 'User Name',
      required: true,
      searchable: true,
      maxLength: 255,
      description: 'SCIM userName as sent by the IdP',
      group: 'Identity',
    }),

    user_name_key: Field.text({
      label: 'User Name Key',
      required: true,
      readonly: true,
      maxLength: 512,
      description: 'Derived case-folded userName uniqueness key maintained by @better-auth/scim; do not write directly.',
      group: 'System',
    }),

    primary_email: Field.text({
      label: 'Primary Email',
      required: true,
      searchable: true,
      maxLength: 255,
      group: 'Identity',
    }),

    work_email_value_index: Field.text({
      label: 'Work Email Index',
      required: true,
      readonly: true,
      maxLength: 512,
      description: 'Derived lookup index maintained by @better-auth/scim; do not write directly.',
      group: 'System',
    }),

    email_value_index: Field.text({
      label: 'Email Index',
      required: true,
      readonly: true,
      maxLength: 512,
      description: 'Derived lookup index maintained by @better-auth/scim; do not write directly.',
      group: 'System',
    }),

    display_name: Field.text({
      label: 'Display Name',
      required: true,
      searchable: true,
      maxLength: 255,
      group: 'Identity',
    }),

    formatted_name: Field.text({
      label: 'Formatted Name',
      required: true,
      maxLength: 255,
      group: 'Identity',
    }),

    given_name: Field.text({
      label: 'Given Name',
      required: false,
      maxLength: 255,
      group: 'Identity',
    }),

    family_name: Field.text({
      label: 'Family Name',
      required: false,
      maxLength: 255,
      group: 'Identity',
    }),

    serialized_emails: Field.textarea({
      label: 'Emails (serialized)',
      required: true,
      readonly: true,
      description: 'Canonical serialized SCIM emails list maintained by @better-auth/scim; do not write directly.',
      group: 'System',
    }),

    serialized_attributes: Field.textarea({
      label: 'Attributes (serialized)',
      required: false,
      readonly: true,
      description: 'Canonical serialized SCIM attributes maintained by @better-auth/scim; do not write directly.',
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

    active: Field.boolean({
      label: 'Active',
      required: true,
      description: 'SCIM active flag — false means the IdP deactivated this user',
      group: 'Identity',
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
    { fields: ['connection_user_key'], unique: true },
    { fields: ['user_name_key'], unique: true },
    // Nullable — repeated NULLs are admitted on sqlite / postgres / mysql when
    // the IdP sends no externalId.
    { fields: ['external_id_key'], unique: true },
    { fields: ['order_key'], unique: true },
    { fields: ['connection_id'] },
    { fields: ['user_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // Reads only: all mutations flow through the SCIM 2.0 protocol endpoints.
    apiMethods: ['get', 'list'],
  },
});
