// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_oauth_consent — Recorded user consent for an OAuth client + scopes
 *
 * Backed by `@better-auth/oauth-provider`'s `oauthConsent` model. When a
 * user consents to a client requesting a particular set of scopes, the
 * decision is persisted here so future authorization requests for the same
 * client+scopes can skip the consent screen.
 *
 * The presence of a row implies consent was given for the listed scopes —
 * the previous boolean `consent_given` flag was removed in the migration
 * from `better-auth/plugins/oidc-provider` to `@better-auth/oauth-provider`.
 *
 * @namespace sys
 */
export const SysOauthConsent = ObjectSchema.create({
  name: 'sys_oauth_consent',
  label: 'OAuth Consent',
  pluralLabel: 'OAuth Consents',
  icon: 'shield-check',
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
  description: 'User consent records for OAuth client applications',
  highlightFields: ['client_id', 'user_id', 'scopes'],

  fields: {
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
    }),

    client_id: Field.text({
      label: 'Client ID',
      required: true,
      description: 'Foreign key to sys_oauth_application.client_id',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: false,
      description: 'Foreign key to sys_user.id',
    }),

    reference_id: Field.text({
      label: 'Reference ID',
      required: false,
      maxLength: 255,
      description: 'Caller-supplied correlation identifier',
    }),

    resources: Field.textarea({
      label: 'Resources',
      required: false,
      description: 'JSON-serialized list of RFC 8707 resource indicators the consent covers',
    }),

    requested_user_info_claims: Field.textarea({
      label: 'Requested UserInfo Claims',
      required: false,
      description: 'JSON-serialized list of OIDC claims the user consented to expose',
    }),

    scopes: Field.textarea({
      label: 'Scopes',
      required: true,
      description: 'JSON-serialized list of scopes the user consented to',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
    }),
  },

  indexes: [
    { fields: ['client_id'] },
    { fields: ['user_id'] },
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
