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
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema,
  // but may add overlay row-level config. Use `no-overlay` if you need to
  // forbid sys_metadata overlays entirely.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'Opaque OAuth access tokens issued to client applications',
  compactLayout: ['client_id', 'user_id', 'expires_at'],

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
  },

  indexes: [
    { fields: ['token'], unique: true },
    { fields: ['client_id'] },
    { fields: ['session_id'] },
    { fields: ['user_id'] },
    { fields: ['refresh_id'] },
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
