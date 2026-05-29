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
  compactLayout: ['identifier', 'expires_at', 'created_at'],
  
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
    { fields: ['value'], unique: true },
    { fields: ['identifier'], unique: false },
    { fields: ['expires_at'], unique: false },
  ],
  
  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'create', 'delete'],
    trash: false,
    mru: false,
  },
});
