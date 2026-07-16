// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_oauth_access_token — Issued OAuth/OIDC opaque access token
 *
 * Backed by `@better-auth/oauth-provider`'s `oauthAccessToken` model. One
 * row per opaque access token issuance. Tokens are short-lived; expired
 * rows can be safely pruned.
 *
 * Refresh tokens have been split into a sibling table — see
 * {@link SysOauthRefreshToken}. The optional `refresh_id` column links an
 * access token back to the refresh-token row that minted it.
 *
 * @namespace sys
 */
export const SysOauthAccessToken = ObjectSchema.create({
  name: 'sys_oauth_access_token',
  label: 'OAuth Access Token',
  pluralLabel: 'OAuth Access Tokens',
  icon: 'ticket',
  isSystem: true,
  managedBy: 'better-auth',
  // [ADR-0066 D2/④] Secure-by-default: rows are LIVE bearer credentials —
  // reading one is session hijack. Not covered by the wildcard `'*'` grant;
  // admins retain access via the superuser bypass; better-auth reads via its
  // adapter (system context), so OAuth flows are unaffected.
  access: { default: 'private' },
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema,
  // but may add overlay row-level config. Use `no-overlay` if you need to
  // forbid sys_metadata overlays entirely.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'Opaque OAuth access tokens issued to client applications',
  highlightFields: ['client_id', 'user_id', 'expires_at'],

  fields: {
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
    }),

    token: Field.text({
      label: 'Token',
      required: true,
      maxLength: 1024,
      description: 'Opaque access token value',
    }),

    client_id: Field.text({
      label: 'Client ID',
      required: true,
      description: 'Foreign key to sys_oauth_application.client_id',
    }),

    session_id: Field.lookup('sys_session', {
      label: 'Session',
      required: false,
      description: 'Foreign key to sys_session.id',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: false,
      description: 'Foreign key to sys_user.id',
    }),

    refresh_id: Field.lookup('sys_oauth_refresh_token', {
      label: 'Refresh Token',
      required: false,
      description: 'Foreign key to sys_oauth_refresh_token.id',
    }),

    reference_id: Field.text({
      label: 'Reference ID',
      required: false,
      maxLength: 255,
      description: 'Caller-supplied correlation identifier',
    }),

    authorization_code_id: Field.text({
      label: 'Authorization Code ID',
      required: false,
      maxLength: 255,
      description: 'ID of the authorization-code grant this token originates from',
    }),

    resources: Field.textarea({
      label: 'Resources',
      required: false,
      description: 'JSON-serialized list of RFC 8707 resource indicators bound to this token',
    }),

    requested_user_info_claims: Field.textarea({
      label: 'Requested UserInfo Claims',
      required: false,
      description: 'JSON-serialized list of OIDC claims requested for the userinfo endpoint',
    }),

    scopes: Field.textarea({
      label: 'Scopes',
      required: true,
      description: 'JSON-serialized list of scopes granted to this token',
    }),

    expires_at: Field.datetime({
      label: 'Expires At',
      required: true,
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
    }),

    revoked: Field.datetime({
      label: 'Revoked At',
      required: false,
      description: 'Timestamp at which this access token was revoked',
    }),

    confirmation: Field.textarea({
      label: 'Confirmation',
      required: false,
      description: 'JSON RFC 7800 cnf claim (e.g. DPoP key thumbprint) binding this token to a key',
    }),
  },

  indexes: [
    { fields: ['token'], unique: true },
    { fields: ['client_id'] },
    { fields: ['session_id'] },
    { fields: ['user_id'] },
    { fields: ['refresh_id'] },
    { fields: ['authorization_code_id'] },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: false,
    apiMethods: [],
    trash: false,
    mru: false,
  },
});
