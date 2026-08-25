// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_verification — System Verification Object
 *
 * Email and phone verification token record.
 * Backed by better-auth's `verification` model with ObjectStack field conventions.
 *
 * @namespace sys
 */
export const SysVerification = ObjectSchema.create({
  name: 'sys_verification',
  label: 'Verification',
  pluralLabel: 'Verifications',
  icon: 'shield-check',
  isSystem: true,
  managedBy: 'better-auth',
  // [ADR-0066 D2/④] Secure-by-default: rows are LIVE one-time credentials
  // (email/phone verification + password-reset tokens) — reading one is
  // account takeover. Not covered by the wildcard `'*'` grant; admins retain
  // access via the superuser bypass; better-auth reads via its adapter
  // (system context), so verification flows are unaffected.
  access: { default: 'private' },
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema,
  // but may add overlay row-level config. Use `no-overlay` if you need to
  // forbid sys_metadata overlays entirely.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth — see ADR-0010.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'Email and phone verification tokens',
  titleFormat: 'Verification for {identifier}',
  highlightFields: ['identifier', 'expires_at', 'created_at'],
  
  fields: {
    id: Field.text({
      label: 'Verification ID',
      required: true,
      readonly: true,
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
    
    value: Field.text({
      label: 'Verification Token',
      required: true,
      // [#11374/#11701] Deliberately UNBOUNDED: better-auth's oauth-provider
      // writes OIDC authorization-code payloads here as a JSON blob, so no
      // bound provably admits every value it may write. That is only
      // survivable because the column carries no index — see the `indexes`
      // note below, which is what makes an unbounded TEXT column safe on
      // MySQL.
      description: 'Token or code for verification',
    }),
    
    expires_at: Field.datetime({
      label: 'Expires At',
      required: true,
    }),
    
    identifier: Field.text({
      label: 'Identifier',
      required: true,
      // [#11374] Bound from better-auth 1.7.1's own MySQL schema: the
      // verification model declares `identifier` with `index: true`, and the
      // upstream migration emits an indexed string column as varchar(255)
      // (get-migration.mjs) — every better-auth flow that writes this table,
      // oauth-provider included, already lives inside 255 on upstream MySQL.
      // `value` deliberately declares NO bound: better-auth stores JSON blobs
      // there (see the index comment below), so no defensible bound exists.
      maxLength: 255,
      description: 'Email address or phone number',
    }),
  },
  
  indexes: [
    // [#11701] `value` carries NO index — and must not gain one.
    //
    // Removing the index it used to declare is the maintainer's 2026-08-25
    // ruling, taken on MEASURED liveness rather than on convenience:
    //
    //   • better-auth 1.7.1 keys every verification lookup on `identifier`
    //     (or on `id`, or on `expiresAt` for cleanup) — see
    //     `internal-adapter.mjs`'s `findByIdentifier` / `consumeByIdentifier`;
    //   • upstream declares the field unindexed and unbounded;
    //   • no in-repo query filters `sys_verification` by `value`.
    //
    // ⛔ It could not be indexed here even if a reader wanted it. `value` is
    // UNBOUNDABLE — better-auth's oauth-provider stores OIDC
    // authorization-code payloads in it as a JSON blob, so no defensible
    // `maxLength` exists — so on MySQL the column stays TEXT and ANY index
    // over it is refused (`ER_BLOB_KEY_WITHOUT_LENGTH`), failing the whole
    // object's schema-sync over an index nothing reads. #11627's hash-shadow
    // route cannot rescue it either: a shadow carries a UNIQUE constraint,
    // and an index over a digest accelerates no `WHERE value = ?` the planner
    // can reach. An index that silently does not exist on one dialect is the
    // worst of both worlds; removing it makes the metadata match reality,
    // which is the `declared = enforced` property this family restores.
    //
    // ⛔ A UNIQUE index here would be wrong twice over: those JSON payloads
    // legitimately repeat (they are keyed by user+client+state), and a unique
    // constraint made `/api/v1/auth/oauth2/authorize` fail (`UNIQUE
    // constraint failed: sys_verification.value`) → 503, breaking
    // cloud-as-IdP SSO entirely.
    { fields: ['identifier'], unique: false },
    { fields: ['expires_at'], unique: false },
  ],
  
  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    // #1591 — reads only: writes are refused by the identity write guard
    // (ADR-0092 D2) and owned by better-auth. HTTP answers 405 before the 403.
    apiMethods: ['get'],
  },
});
