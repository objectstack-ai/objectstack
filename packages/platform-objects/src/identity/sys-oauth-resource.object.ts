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
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
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
      // [#12313] Narrowed 1024 -> 255, and sourced from the PRODUCER. The old
      // 1024 cited nothing: it arrived with the object wholesale (#3080) as
      // generous slack for "a URI", derived from no upstream contract. An
      // uncited bound is the defect here, so a narrowing that landed without a
      // citation would only reproduce it at a smaller number.
      //
      // better-auth 1.7.1 is the sole writer (`managedBy: 'better-auth'`,
      // `protection.lock: 'full'`), and it emits this column as
      // **varchar(255)** on MySQL: `oauthResource.identifier` is declared
      // `{ type: 'string', required: true, unique: true }`, and `getType` in
      // `better-auth/dist/db/get-migration.mjs` takes the `field.unique ->
      // 'varchar(255)'` arm of its mysql string branch. `oauthResource`
      // declares no table-level `indexes`, so the `tableIndexStringLength`
      // argument that precedes that arm is undefined here.
      //
      // Measured, not just read: running that generator against live MySQL
      // 8.0.46 (utf8mb4/InnoDB) and reading `information_schema.COLUMNS` as its
      // own query gives `oauthResource.identifier = varchar(255)`, 1020 octets.
      // So an identifier longer than 255 characters cannot be registered
      // upstream at all, and the discarded (255, 1024] band held nothing the
      // producing contract can emit.
      //
      // Physical consequence, stated rather than left to be discovered: 255 is
      // at or under `SqlDriver.MAX_KEYABLE_VARCHAR_CHARS` (768), so the UNIQUE
      // index below is now carried DIRECTLY on `varchar(255)` and this object
      // LEAVES the #11627/#12198 hash-shadow route it was on at 1024.
      maxLength: 255,
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
  },
});
