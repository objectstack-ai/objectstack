// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_scim_connection_credential — ObjectStack-owned bearer credentials for
 * SCIM provisioning connections (#3653, ADR-0071).
 *
 * Stable `@better-auth/scim` stores NO credential of its own: the rc.1
 * `/scim/generate-token` endpoint and `scimProvider.scim_token` column are
 * gone, and none of the stable models declares a token/secret column
 * (measured — see `credential-at-rest-posture.test.ts`). Instead the plugin is
 * mounted with an application-owned `authentication.verifyBearerToken`, so
 * ObjectStack owns the whole credential lifecycle — mint, store, verify —
 * outright. This table is that store; the service half lives in
 * `plugin-auth/src/scim-connection-service.ts`.
 *
 * Deliberately NOT a resurrection of `sys_scim_provider` (which retires under
 * #11757): a row here is one bearer credential FOR a connection, not the
 * connection itself. Several rows may authenticate the same `connection_id`
 * (staged rotation); the connection's durable lifecycle state lives in
 * `sys_scim_connection_binding`, written by the library.
 *
 * Credential-at-rest posture (pinned by `credential-at-rest-posture.test.ts`,
 * never relax it): `token_digest` holds an HMAC-SHA-256 (base64url, unpadded)
 * of the bearer, keyed by the deployment's auth secret — one-way, never
 * cleartext, and stronger than the unsalted SHA-256 the rc.1 line stored. The
 * plaintext bearer is returned exactly once at mint time and is not
 * recoverable from this row.
 *
 * @namespace sys
 */
export const SysScimConnectionCredential = ObjectSchema.create({
  name: 'sys_scim_connection_credential',
  label: 'SCIM Connection Credential',
  pluralLabel: 'SCIM Connection Credentials',
  icon: 'users',
  isSystem: true,
  // ObjectStack owns this lifecycle end to end — plugin-auth's SCIM connection
  // service is the only writer; no user CRUD, no better-auth involvement.
  managedBy: 'engine-owned',
  // [ADR-0066 D3/④] Admin-only identity config carrying a live credential
  // digest — same object-level capability AND-gate as `sys_sso_provider` /
  // `sys_scim_provider`: ordinary members are denied entirely, regardless of
  // how permissive their CRUD grants are.
  requiredPermissions: ['manage_platform_settings'],
  // ADR-0010 §3.7 — platform-managed identity table; tenants may not edit schema.
  protection: {
    lock: 'full',
    reason: 'ObjectStack-owned SCIM credential store (#3653) — see ADR-0071.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'Bearer credentials (one-way digests) that authenticate SCIM provisioning connections',
  displayNameField: 'connection_id',
  nameField: 'connection_id', // [ADR-0079] canonical primary-title pointer
  titleFormat: '{connection_id}',
  highlightFields: ['connection_id', 'label', 'active', 'expires_at'],

  listViews: {
    all: {
      type: 'grid',
      name: 'all',
      label: 'All',
      data: { provider: 'object', object: 'sys_scim_connection_credential' },
      // token_digest is intentionally excluded — never surface the credential
      // column, even though it is one-way.
      columns: ['connection_id', 'label', 'organization_id', 'active', 'expires_at', 'created_at'],
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
      description: 'The SCIM connection this credential authenticates (e.g. "okta-prod"); scopes every resource the IdP provisions with it',
      group: 'Connection',
    }),

    provisioning_domain_id: Field.text({
      label: 'Provisioning Domain',
      required: false,
      maxLength: 255,
      description: 'Application-owned boundary receiving provisioned resources; defaults to the connection id when absent',
      group: 'Connection',
    }),

    organization_id: Field.text({
      label: 'Organization',
      required: false,
      maxLength: 255,
      description: 'Organization scope of this connection, when provisioning is org-scoped',
      group: 'Connection',
    }),

    label: Field.text({
      label: 'Label',
      required: false,
      maxLength: 255,
      description: 'Operator-facing name for this credential (e.g. "rotation 2026-Q3")',
      group: 'Identity',
    }),

    token_digest: Field.text({
      label: 'Token Digest',
      required: true,
      readonly: true,
      maxLength: 255,
      description: 'HMAC-SHA-256 (base64url) of the bearer, keyed by the deployment auth secret — one-way; the plaintext is shown once at mint and never stored.',
      group: 'Secret',
    }),

    active: Field.boolean({
      label: 'Active',
      required: true,
      defaultValue: true,
      description: 'Revocation switch — an inactive credential is refused at verification',
      group: 'Lifecycle',
    }),

    expires_at: Field.datetime({
      label: 'Expires At',
      required: false,
      description: 'Optional hard expiry for staged credential rotation; an expired credential is refused',
      group: 'Lifecycle',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'Minted By',
      required: false,
      description: 'User who minted this credential',
      group: 'System',
    }),

    created_at: Field.datetime({ label: 'Created At', defaultValue: 'NOW()', readonly: true, group: 'System' }),
    updated_at: Field.datetime({ label: 'Updated At', defaultValue: 'NOW()', readonly: true, group: 'System' }),
  },

  indexes: [
    // The digest is the verification lookup key — deterministic keyed HMAC, so
    // an indexed equality probe answers "which credential is this bearer".
    { fields: ['token_digest'], unique: true },
    { fields: ['connection_id'] },
    { fields: ['organization_id'] },
    { fields: ['user_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // Mint / revoke go through plugin-auth's SCIM connection service; the
    // generic data layer is read-only so the credential row cannot be written
    // or bypassed through it.
    apiMethods: ['list'],
  },
});
