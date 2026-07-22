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
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
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
      description: 'Token or code for verification',
    }),
    
    expires_at: Field.datetime({
      label: 'Expires At',
      required: true,
    }),
    
    identifier: Field.text({
      label: 'Identifier',
      required: true,
      description: 'Email address or phone number',
    }),
  },
  
  indexes: [
    // `value` must NOT be unique. better-auth's oauth-provider stores OIDC
    // authorization codes in this table with `value` = a JSON blob keyed by
    // user+client+state, which can legitimately repeat. A UNIQUE constraint
    // makes `/api/v1/auth/oauth2/authorize` fail (`UNIQUE constraint failed:
    // sys_verification.value`) → 503, breaking cloud-as-IdP SSO entirely.
    // better-auth keys verification lookups on `identifier`, not `value`.
    { fields: ['value'], unique: false },
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
