// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_scim_provider — Registered SCIM 2.0 connection (@better-auth/scim)
 *
 * Backed by `@better-auth/scim`'s `scimProvider` model. Each row is a SCIM
 * connection: a bearer token an external IdP (Okta / Entra / OneLogin) uses to
 * **auto-provision / deprovision** THIS environment's users. The environment is
 * the SCIM **Service Provider** (the receiver); the IdP is the SCIM **client**
 * (the sender). This is the paid Identity lifecycle (ADR-0071) — the mechanism
 * is OPEN (here, framework `plugin-auth`); enablement is entitlement-gated by
 * the cloud / EE license.
 *
 * `scim_token` holds the connection's bearer credential. With the plugin's
 * `storeSCIMToken: 'hashed'` (the default this env wires) it stores only a
 * HASH — the plaintext is returned exactly once at `/scim/generate-token`. Even
 * so, treat this object as sensitive: it is read-only over the generic data API
 * and the token is excluded from list views.
 *
 * All mutations route through @better-auth/scim's endpoints under
 * `/api/v1/auth/scim/*` (generate-token / delete-provider-connection) and the
 * SCIM 2.0 protocol under `/api/v1/auth/scim/v2/*`; the generic data layer is
 * read-only (see `enable.apiMethods`).
 *
 * @namespace sys
 */
export const SysScimProvider = ObjectSchema.create({
  name: 'sys_scim_provider',
  label: 'SCIM Provider',
  pluralLabel: 'SCIM Providers',
  icon: 'users',
  isSystem: true,
  managedBy: 'better-auth',
  // [ADR-0066 D3/④] Admin-only identity config carrying a live credential
  // (`scim_token` — the bearer external IdPs authenticate provisioning calls
  // with). Object-level capability gate, mirroring the sibling
  // `sys_sso_provider`: ordinary members are denied entirely (without it, the
  // `member_default` wildcard `'*': allowRead` would expose SCIM connections
  // to every authenticated user). better-auth's own endpoints read via a
  // system context, so SCIM provisioning is unaffected.
  requiredPermissions: ['manage_platform_settings'],
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth (@better-auth/scim) — see ADR-0071.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'SCIM 2.0 connections (bearer tokens) external IdPs use to provision/deprovision this environment\'s users',
  displayNameField: 'provider_id',
  nameField: 'provider_id', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{provider_id}',
  highlightFields: ['provider_id', 'organization_id'],

  listViews: {
    all: {
      type: 'grid',
      name: 'all',
      label: 'All',
      data: { provider: 'object', object: 'sys_scim_provider' },
      // scim_token is intentionally excluded — never surface the credential.
      columns: ['provider_id', 'organization_id', 'created_at'],
      sort: [{ field: 'provider_id', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    id: Field.text({ label: 'ID', required: true, readonly: true, group: 'System' }),

    provider_id: Field.text({
      label: 'Provider ID',
      required: true,
      searchable: true,
      maxLength: 255,
      description: 'Stable SCIM provider identifier (e.g. "okta-scim")',
      group: 'Identity',
    }),

    scim_token: Field.text({
      label: 'SCIM Token (hash)',
      required: false,
      readonly: true,
      maxLength: 1024,
      description: 'Hashed bearer credential for this SCIM connection — the plaintext is shown once at generate-token. Sensitive; do not expose.',
      group: 'Secret',
    }),

    organization_id: Field.text({
      label: 'Organization',
      required: false,
      maxLength: 255,
      description: 'Organization scope of this token (org-scoped tokens restrict provisioning to that org)',
      group: 'System',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'Owned By',
      required: false,
      description: 'User who generated this token (when provider-ownership is enabled)',
      group: 'System',
    }),

    created_at: Field.datetime({ label: 'Created At', defaultValue: 'NOW()', readonly: true, group: 'System' }),
    updated_at: Field.datetime({ label: 'Updated At', defaultValue: 'NOW()', readonly: true, group: 'System' }),
  },

  indexes: [
    { fields: ['provider_id'], unique: true },
    { fields: ['organization_id'] },
    { fields: ['user_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // Mutations + token issuance go through @better-auth/scim's endpoints
    // under /api/v1/auth/scim/*; the generic data layer is read-only so the
    // credential cannot be written/bypassed through it.
    apiMethods: ['list'],
  },
});
