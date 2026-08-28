// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_scim_connection_binding — Durable lifecycle state for one SCIM connection
 * (`@better-auth/scim` stable `scimConnectionBinding`).
 *
 * One row per provisioning connection the plugin has seen. The library creates
 * the row the first time a connection provisions and drives the decommission
 * state machine (`active` → `reconciling` → `complete`) through it when a
 * connection is retired. Columns mirror the installed stable schema, bridged
 * mechanically camelCase → snake_case by `objectql-adapter.ts` (see
 * `better-auth-schema-parity.test.ts`, #3653).
 *
 * This is NOT a credential store — `connection_key` is a uniqueness key the
 * library derives, not a secret. The bearer credentials that authenticate a
 * connection live in `sys_scim_connection_credential`, which ObjectStack owns
 * outright (stable `@better-auth/scim` stores no credential at all).
 *
 * @namespace sys
 */
export const SysScimConnectionBinding = ObjectSchema.create({
  name: 'sys_scim_connection_binding',
  label: 'SCIM Connection Binding',
  pluralLabel: 'SCIM Connection Bindings',
  icon: 'users',
  isSystem: true,
  managedBy: 'better-auth',
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth (@better-auth/scim) — see ADR-0071.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'Lifecycle state for a SCIM provisioning connection, including its decommission state machine',
  displayNameField: 'connection_id',
  nameField: 'connection_id', // [ADR-0079] canonical primary-title pointer
  titleFormat: '{connection_id}',
  highlightFields: ['connection_id', 'provisioning_domain_id', 'decommission_status'],

  listViews: {
    all: {
      type: 'grid',
      name: 'all',
      label: 'All',
      data: { provider: 'object', object: 'sys_scim_connection_binding' },
      columns: ['connection_id', 'provisioning_domain_id', 'decommission_status', 'created_at'],
      sort: [{ field: 'connection_id', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    id: Field.text({ label: 'ID', required: true, readonly: true, group: 'System' }),

    connection_id: Field.text({
      label: 'Connection ID',
      required: true,
      searchable: true,
      maxLength: 255,
      description: 'Immutable SCIM connection identifier that scopes every provisioned resource',
      group: 'Connection',
    }),

    // Derived uniqueness key, declared `required: true, unique: true,
    // returned: false` upstream — same class as `sys_team_member.membership_key`:
    // owned end to end by the library, never authored from the ObjectStack side.
    connection_key: Field.text({
      label: 'Connection Key',
      required: true,
      readonly: true,
      maxLength: 512,
      description: 'Derived connection uniqueness key maintained by @better-auth/scim; do not write directly.',
      group: 'System',
    }),

    provisioning_domain_id: Field.text({
      label: 'Provisioning Domain',
      required: true,
      maxLength: 255,
      description: 'Application-owned boundary that receives provisioned resources (defaults to the connection id)',
      group: 'Connection',
    }),

    decommission_status: Field.text({
      label: 'Decommission Status',
      required: true,
      defaultValue: 'active',
      maxLength: 32,
      description: 'Connection lifecycle state: active | reconciling | complete',
      group: 'Decommission',
    }),

    decommissioned_at: Field.datetime({
      label: 'Decommissioned At',
      required: false,
      readonly: true,
      group: 'Decommission',
    }),

    decommission_cursor_user_id: Field.text({
      label: 'Decommission Cursor User',
      required: false,
      readonly: true,
      maxLength: 255,
      description: 'Resumable reconciliation cursor maintained by the library',
      group: 'Decommission',
    }),

    decommission_reconciled_user_count: Field.number({
      label: 'Reconciled Users',
      required: false,
      defaultValue: 0,
      readonly: true,
      group: 'Decommission',
    }),

    decommission_batch_count: Field.number({
      label: 'Decommission Batches',
      required: false,
      defaultValue: 0,
      readonly: true,
      group: 'Decommission',
    }),

    decommission_revision: Field.number({
      label: 'Decommission Revision',
      required: false,
      defaultValue: 0,
      readonly: true,
      description: 'Optimistic-concurrency revision for the decommission state machine',
      group: 'Decommission',
    }),

    decommission_completed_at: Field.datetime({
      label: 'Decommission Completed At',
      required: false,
      readonly: true,
      group: 'Decommission',
    }),

    decommission_lease_id: Field.text({
      label: 'Decommission Lease',
      required: false,
      readonly: true,
      maxLength: 255,
      description: 'Single-worker reconciliation lease maintained by the library',
      group: 'Decommission',
    }),

    decommission_lease_expires_at: Field.datetime({
      label: 'Decommission Lease Expires At',
      required: false,
      readonly: true,
      group: 'Decommission',
    }),

    created_at: Field.datetime({ label: 'Created At', readonly: true, group: 'System' }),
  },

  indexes: [
    // UNIQUE mirrors @better-auth/scim's own declaration on connectionKey.
    { fields: ['connection_key'], unique: true },
    { fields: ['connection_id'] },
    { fields: ['provisioning_domain_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // Reads only: all mutations flow through @better-auth/scim's endpoints
    // under /api/v1/auth/scim/v2/*; the generic data layer never writes.
    apiMethods: ['get', 'list'],
  },
});
