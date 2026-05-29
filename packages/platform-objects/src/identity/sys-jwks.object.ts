// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_jwks — JWKS (JSON Web Key Set) key pair store
 *
 * Backed by better-auth's `jwt` plugin. Each row is a single asymmetric
 * key pair used to sign and verify JWTs (id_tokens, JWT access tokens)
 * issued by this ObjectStack server when it acts as an OAuth/OIDC IdP.
 *
 * The plugin rotates keys automatically — older rows are kept until
 * `expires_at` so existing tokens can still be verified.
 *
 * @namespace sys
 */
export const SysJwks = ObjectSchema.create({
  name: 'sys_jwks',
  label: 'JWKS Key',
  pluralLabel: 'JWKS Keys',
  icon: 'key',
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
  description: 'Asymmetric key pairs used to sign and verify issued JWTs',
  compactLayout: ['id', 'created_at', 'expires_at'],

  fields: {
    id: Field.text({
      label: 'Key ID',
      required: true,
      readonly: true,
      description: 'JWK `kid` value',
    }),

    public_key: Field.textarea({
      label: 'Public Key',
      required: true,
      description: 'JSON-serialized JWK public key',
    }),

    private_key: Field.textarea({
      label: 'Private Key',
      required: true,
      description: 'JSON-serialized JWK private key (encrypted at rest)',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
    }),

    expires_at: Field.datetime({
      label: 'Expires At',
      required: false,
      description: 'When the key may no longer be used to verify tokens',
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
