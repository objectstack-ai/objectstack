// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PLATFORM_ADMIN_SETTINGS_GATE } from './platform-admin-action-gate.js';

/**
 * sys_scim_connection_credential — ObjectStack-owned bearer credentials for
 * SCIM provisioning connections (#3653, ADR-0134).
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
 * commit 4d25d22d4): a row here is one bearer credential FOR a connection, not the
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
    reason: 'ObjectStack-owned SCIM credential store — see ADR-0134.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'Bearer credentials (one-way digests) that authenticate SCIM provisioning connections',
  displayNameField: 'connection_id',
  nameField: 'connection_id', // [ADR-0079] canonical primary-title pointer
  highlightFields: ['connection_id', 'label', 'active', 'expires_at'],

  // Mint and revoke from the console. Both forward to plugin-auth's two
  // platform-admin mounts (`scim-connection-admin.ts`), the credential
  // lifecycle's only door: the data API stays list-only (`apiMethods` below),
  // so neither action writes a row itself. The mounts run the shared
  // platform-admin gate (ADR-0068 D2) and answer everyone else 403, so each
  // action is offered only on the rung that door admits
  // (`current_user.isPlatformAdmin == true`, ADR-0068 D4) and declares the
  // door's gate where both action doors read it (`requiredPermissions`). ⛔ Who
  // may mint or revoke is the door's decision: these declarations narrow who is
  // OFFERED the button to who the door already admits, and never widen it.
  actions: [
    // The mint answers the plaintext bearer ONCE (`Cache-Control: no-store`;
    // only its keyed one-way digest is stored), so it is revealed in a
    // `resultDialog` the admin must close, as `sys_api_key.create_api_key` and
    // `sys_oauth_application.create_oauth_application` reveal theirs — a toast
    // would lose it. `two-factor-one-shot-reveal.test.ts` holds every action on
    // this route to that reveal.
    //
    // The params are named for the body keys the mount reads (`connectionId`,
    // `label`, `provisioningDomainId`, `organizationId`, `expiresAt`), not for
    // the row's columns: the mount is keyed by the connection id, and the row is
    // what it writes.
    //
    // ADR-0011 identity-actions note, bucket H: it mints a credential, so it
    // declares no `ai` block. An agent that could run it would hold a live
    // SCIM bearer in its context; exposing it needs a maintainer ruling that
    // names this action.
    {
      name: 'mint_scim_credential',
      label: 'Mint Credential',
      icon: 'plus-circle',
      variant: 'primary',
      mode: 'create',
      locations: ['list_toolbar'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/auth/admin/scim/mint-credential',
      // The door's platform-admin gate, declared where both action doors read it.
      requiredPermissions: [...PLATFORM_ADMIN_SETTINGS_GATE],
      visible: 'current_user.isPlatformAdmin == true',
      description: 'Mint a bearer credential for a SCIM connection. Give it to the identity provider as the SCIM token; it is shown once.',
      refreshAfter: true,
      params: [
        {
          name: 'connectionId',
          label: 'Connection ID',
          type: 'text',
          required: true,
          helpText: 'The SCIM connection this credential authenticates, e.g. "okta-prod". At most 246 characters. To rotate, mint a second credential for the same connection, move the identity provider to it, then revoke the old one.',
        },
        { name: 'label', label: 'Label', type: 'text', required: false, helpText: 'Optional. A name for this credential, e.g. "rotation 2026-Q3".' },
        {
          name: 'organizationId',
          label: 'Organization',
          type: 'lookup',
          reference: 'sys_organization',
          required: false,
          helpText: 'Optional. The organization that owns the connection. Leave empty for the Default Organization.',
        },
        {
          name: 'provisioningDomainId',
          label: 'Provisioning Domain',
          type: 'text',
          required: false,
          helpText: 'Optional. The boundary that receives the provisioned users and groups. Leave empty to use the connection ID.',
        },
        {
          name: 'expiresAt',
          label: 'Expires At',
          type: 'datetime',
          required: false,
          helpText: 'Optional. After this time the credential is refused. Leave empty for a credential that does not expire.',
        },
      ],
      resultDialog: {
        title: 'SCIM credential minted',
        description: 'Copy the token now — it is shown only once and cannot be recovered. Paste it into the identity provider as the SCIM bearer token. If it leaks, revoke it and mint a new one.',
        acknowledge: 'I have saved the token',
        fields: [
          { path: 'token', label: 'Token', format: 'secret' },
          { path: 'connectionId', label: 'Connection ID', format: 'text' },
          { path: 'expiresAt', label: 'Expires At', format: 'text' },
        ],
      },
    },
    // The mount answers 404 for an unknown credential and 409 for one already
    // revoked; the console shows that answer as the action's error. There is no
    // restore: a revoked bearer stays refused, and its row stays as the audit
    // trail's anchor.
    {
      name: 'revoke_scim_credential',
      label: 'Revoke Credential',
      icon: 'shield-off',
      variant: 'danger',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/auth/admin/scim/revoke-credential',
      recordIdParam: 'credentialId',
      // The door's platform-admin gate, declared where both action doors read it.
      requiredPermissions: [...PLATFORM_ADMIN_SETTINGS_GATE],
      // Offered on an active credential only. `active` is in the list view's
      // columns, and `has()` keeps the predicate from faulting on a row that
      // does not carry it (the sparse action face).
      visible: 'current_user.isPlatformAdmin == true && has(record.active) && record.active == true',
      confirmText: 'Revoke this SCIM credential? The identity provider using it is refused from its next request on. This cannot be undone: to restore provisioning, mint a new credential.',
      successMessage: 'SCIM credential revoked',
      refreshAfter: true,
      // ADR-0011 identity-actions note, bucket C: exposed, and the
      // confirmation is never relaxed. Revoking hands out no credential and
      // widens no access: it switches one bearer off, as
      // `sys_api_key.revoke_api_key` and `sys_session.revoke_session` do, and
      // its reach is that one connection. It cannot be undone, so the agent
      // asks first.
      ai: {
        exposed: true,
        description:
          'Revoke a SCIM connection credential (the record): the identity provider using it is refused from its next request on, so provisioning through it stops. It cannot be undone; a new credential has to be minted. Platform administrators only. Ask the human to confirm before calling.',
        requiresConfirmation: true,
      },
    },
  ],

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

    // [#21197] `internal: true` — the list view already leaves this column out
    // (above); the declaration is what keeps it off the generic data path and
    // out of the compliance ledger's CRUD mirror. The verifier only FILTERS by
    // it (`scim-connection-service.ts`), so it needs no readback.
    token_digest: Field.text({
      label: 'Token Digest',
      required: true,
      readonly: true,
      internal: true,
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
    { fields: ['token_digest'], unique: 'global' },
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
