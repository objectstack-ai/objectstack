// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_oauth_resource — Registered OAuth protected resource (RFC 8707)
 *
 * Backed by `@better-auth/oauth-provider`'s `oauthResource` model
 * (better-auth ≥ 1.7). Each row registers a resource server (audience)
 * that clients may request tokens for via the RFC 8707 `resource`
 * parameter — e.g. the platform's own MCP endpoint. Carries the per-
 * resource token policy (TTLs, signing, allowed scopes, DPoP requirement).
 *
 * @namespace sys
 */
export const SysOauthResource = ObjectSchema.create({
  name: 'sys_oauth_resource',
  label: 'OAuth Resource',
  pluralLabel: 'OAuth Resources',
  icon: 'server',
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
  description: 'Registered OAuth protected resources (RFC 8707 resource indicators)',
  displayNameField: 'name',
  nameField: 'name',
  highlightFields: ['name', 'identifier', 'disabled'],

  fields: {
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
    }),

    identifier: Field.text({
      label: 'Identifier',
      required: true,
      maxLength: 1024,
      description: 'Resource indicator URI presented in the RFC 8707 resource parameter',
    }),

    name: Field.text({
      label: 'Name',
      required: true,
      maxLength: 255,
    }),

    access_token_ttl: Field.number({
      label: 'Access Token TTL',
      required: false,
      description: 'Access-token lifetime in seconds for this resource (overrides the server default)',
    }),

    refresh_token_ttl: Field.number({
      label: 'Refresh Token TTL',
      required: false,
      description: 'Refresh-token lifetime in seconds for this resource (overrides the server default)',
    }),

    signing_algorithm: Field.text({
      label: 'Signing Algorithm',
      required: false,
      maxLength: 32,
      description: 'JWS algorithm used to sign access tokens for this resource',
    }),

    signing_key_id: Field.text({
      label: 'Signing Key ID',
      required: false,
      maxLength: 255,
      description: 'Key id (kid) used to sign access tokens for this resource',
    }),

    allowed_scopes: Field.textarea({
      label: 'Allowed Scopes',
      required: false,
      description: 'JSON-serialized list of scopes clients may request for this resource',
    }),

    custom_claims: Field.textarea({
      label: 'Custom Claims',
      required: false,
      description: 'JSON object of extra claims stamped on access tokens for this resource',
    }),

    dpop_bound_access_tokens_required: Field.boolean({
      label: 'DPoP Required',
      required: false,
      defaultValue: false,
      description: 'Require access tokens for this resource to be DPoP-bound (RFC 9449)',
    }),

    disabled: Field.boolean({
      label: 'Disabled',
      required: false,
      defaultValue: false,
    }),

    policy_version: Field.number({
      label: 'Policy Version',
      required: false,
      defaultValue: 1,
      description: 'Monotonic version of the resource token policy',
    }),

    metadata: Field.textarea({
      label: 'Metadata',
      required: false,
      description: 'JSON object of additional resource metadata',
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
    { fields: ['identifier'], unique: true },
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
