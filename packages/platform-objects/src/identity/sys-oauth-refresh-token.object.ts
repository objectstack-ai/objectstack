// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_oauth_refresh_token — Issued OAuth/OIDC refresh token
 *
 * Backed by `@better-auth/oauth-provider`'s `oauthRefreshToken` model.
 * Refresh tokens are issued for the `offline_access` scope and are bound
 * to a specific session (`session_id`) and client (`client_id`).
 *
 * Each access-token rotation produces a new refresh-token row; revoked
 * tokens are kept (with `revoked` set) for audit purposes until pruned.
 *
 * @namespace sys
 */
export const SysOauthRefreshToken = ObjectSchema.create({
  name: 'sys_oauth_refresh_token',
  label: 'OAuth Refresh Token',
  pluralLabel: 'OAuth Refresh Tokens',
  icon: 'refresh-cw',
  isSystem: true,
  managedBy: 'better-auth',
  // [ADR-0066 D2/④] Secure-by-default: rows are LIVE long-lived credentials —
  // a refresh token mints new access tokens. Not covered by the wildcard `'*'`
  // grant; admins retain access via the superuser bypass; better-auth reads
  // via its adapter (system context), so OAuth flows are unaffected.
  access: { default: 'private' },
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema,
  // but may add overlay row-level config. Use `no-overlay` if you need to
  // forbid sys_metadata overlays entirely.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'Opaque OAuth refresh tokens (linked to a session)',
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
      description: 'Opaque refresh token value',
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
      required: true,
      description: 'Foreign key to sys_user.id',
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
      description: 'ID of the authorization-code grant this token chain originates from',
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
      description: 'Timestamp at which this refresh token was revoked',
    }),

    rotated_at: Field.datetime({
      label: 'Rotated At',
      required: false,
      description: 'Timestamp at which this token was rotated (superseded by a new row)',
    }),

    rotation_replay_response: Field.textarea({
      label: 'Rotation Replay Response',
      required: false,
      description: 'Cached token response replayed when the old token is re-presented within the reuse interval',
    }),

    rotation_replay_expires_at: Field.datetime({
      label: 'Rotation Replay Expires At',
      required: false,
      description: 'End of the post-rotation reuse interval during which the replay response is served',
    }),

    auth_time: Field.datetime({
      label: 'Auth Time',
      required: false,
      description: 'When the user originally authenticated for this token chain',
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
