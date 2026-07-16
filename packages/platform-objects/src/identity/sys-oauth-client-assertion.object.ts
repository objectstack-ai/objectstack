// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_oauth_client_assertion — Consumed client-assertion JTI
 *
 * Backed by `@better-auth/oauth-provider`'s `oauthClientAssertion` model
 * (better-auth ≥ 1.7). One row per consumed `private_key_jwt` /
 * `client_secret_jwt` assertion `jti` — replay prevention for RFC 7523
 * client authentication. Rows are short-lived; expired ones can be pruned.
 *
 * @namespace sys
 */
export const SysOauthClientAssertion = ObjectSchema.create({
  name: 'sys_oauth_client_assertion',
  label: 'OAuth Client Assertion',
  pluralLabel: 'OAuth Client Assertions',
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
  description: 'Consumed OAuth client-assertion JTIs (RFC 7523 replay prevention)',
  highlightFields: ['expires_at'],

  fields: {
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
    }),

    expires_at: Field.datetime({
      label: 'Expires At',
      required: true,
      description: 'Assertion expiry — rows past this instant are safe to prune',
    }),
  },

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: false,
    apiMethods: [],
    trash: false,
    mru: false,
  },
});
