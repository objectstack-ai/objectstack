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
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'User consent records for OAuth client applications',
  highlightFields: ['client_id', 'user_id', 'scopes'],

  // [ADR-0095 D1, 2026-10-18 note] This object's default row scope: the one policy
  // plugin-security's shipped permission sets spread for it today (the `_self`
  // carve-outs in `default-permission-sets.ts`), moved here verbatim. Layer 0 is inert
  // on this table (no organization column), so Layer 1 silence means this scope, not no
  // filter. The security plugin's row-policy collection applies it when no set the
  // caller holds carries a row policy for the object and operation; the shipped sets
  // still carry it, so their holders read as before. An `extend` contribution cannot set
  // or loosen it (refused at registration).
  defaultRowScope: {
    name: 'sys_oauth_consent_self',
    operation: 'all',
    using: 'user_id == current_user.id',
  },

  fields: {
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
    }),

    client_id: Field.text({
      label: 'Client ID',
      required: true,
      // [commit 3954fb7df] Bound from the referenced column: this is a foreign key to
      // sys_oauth_application.client_id, which declares maxLength: 255 (and
      // upstream @better-auth/oauth-provider's oauthClient.clientId is a
      // unique string — varchar(255) on MySQL). A referencing column takes the
      // referenced column's bound.
      maxLength: 255,
      description: 'The client ID of the OAuth application the user consented to.',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: false,
      description: 'The user who gave this consent.',
    }),

    reference_id: Field.text({
      label: 'Reference ID',
      required: false,
      maxLength: 255,
      description:
        "Organization this consent binds: the consenting user's active organization at consent; empty when none was active",
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

    // [#30918] ObjectStack's own column on this better-auth table: the
    // oauth-provider neither reads nor writes it (plugin-auth's
    // `oauth-provider-schema-parity.test.ts` pins that it is not one of the
    // provider's columns). Its one writer is plugin-auth, server-side, after
    // it has verified an MCP access token minted under this consent
    // (`mcp-client-last-use.ts`), and the value is the start of that hour, so
    // the column moves at most once an hour per consent. Nothing a client
    // sends reaches it: the object is not on the data API, the provider's
    // consent doors do not carry it, and the value is the server's clock.
    // A withdrawn or revoked consent takes its stamp with it.
    last_used_at: Field.datetime({
      label: 'Last Used At',
      required: false,
      readonly: true,
      description:
        'Start of the most recent hour in which the client made a verified MCP call under this consent; empty when none has been recorded',
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
  },
});
