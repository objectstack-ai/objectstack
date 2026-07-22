// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_two_factor — System Two-Factor Object
 *
 * Two-factor authentication credentials (TOTP, backup codes).
 * Backed by better-auth's two-factor plugin.
 *
 * @namespace sys
 */
export const SysTwoFactor = ObjectSchema.create({
  name: 'sys_two_factor',
  label: 'Two Factor',
  pluralLabel: 'Two Factor Credentials',
  icon: 'smartphone',
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
  description: 'Two-factor authentication credentials',
  titleFormat: 'Two-factor for {user_id}',
  highlightFields: ['user_id', 'created_at'],

  listViews: {
    mine: {
      type: 'grid',
      name: 'mine',
      label: 'My Enrollment',
      data: { provider: 'object', object: 'sys_two_factor' },
      columns: ['created_at', 'updated_at'],
      filter: [{ field: 'user_id', operator: 'equals', value: '{current_user_id}' }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    all_enrollments: {
      type: 'grid',
      name: 'all_enrollments',
      label: 'All',
      data: { provider: 'object', object: 'sys_two_factor' },
      columns: ['user_id', 'created_at', 'updated_at'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
  },

  // Toolbar actions for self-service 2FA enrollment. Better-auth's
  // `/two-factor/enable` returns `{ totpURI, backupCodes }` — the user must
  // scan the URI into an authenticator app and save the backup codes NOW;
  // they are never recoverable afterward. The `resultDialog` field tells
  // the renderer to open a one-shot reveal dialog instead of toasting the
  // success message. Same shape used by `regenerate_backup_codes`.
  actions: [
    {
      name: 'enable_two_factor',
      label: 'Enable 2FA',
      icon: 'shield-check',
      variant: 'primary',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/two-factor/enable',
      requiresFeature: 'twoFactor',
      refreshAfter: true,
      params: [
        { name: 'password', label: 'Current Password', type: 'text', required: true },
      ],
      resultDialog: {
        title: 'Two-factor authentication enabled',
        description: 'Scan the QR code with your authenticator app, then save the backup codes somewhere safe. The backup codes are shown only once.',
        acknowledge: 'I have saved my backup codes',
        fields: [
          { path: 'totpURI', label: 'Authenticator URI', format: 'qrcode' },
          { path: 'backupCodes', label: 'Backup Codes', format: 'code-list' },
        ],
      },
    },
    {
      name: 'disable_two_factor',
      label: 'Disable 2FA',
      icon: 'shield-off',
      variant: 'danger',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/two-factor/disable',
      requiresFeature: 'twoFactor',
      confirmText: 'Disable two-factor authentication on your account?',
      successMessage: '2FA disabled',
      refreshAfter: true,
      params: [
        { name: 'password', label: 'Current Password', type: 'text', required: true },
      ],
    },
    {
      name: 'regenerate_backup_codes',
      label: 'Regenerate Backup Codes',
      icon: 'refresh-cw',
      variant: 'secondary',
      locations: ['list_toolbar', 'list_item'],
      type: 'api',
      target: '/api/v1/auth/two-factor/generate-backup-codes',
      requiresFeature: 'twoFactor',
      confirmText: 'Regenerate backup codes? All previous backup codes will stop working immediately.',
      refreshAfter: true,
      params: [
        { name: 'password', label: 'Current Password', type: 'text', required: true },
      ],
      resultDialog: {
        title: 'New backup codes generated',
        description: 'Previous backup codes are now invalid. Save these new codes somewhere safe — they are shown only once.',
        acknowledge: 'I have saved the new codes',
        fields: [
          { path: 'backupCodes', label: 'Backup Codes', format: 'code-list' },
        ],
      },
    },
  ],

  
  fields: {
    id: Field.text({
      label: 'Two Factor ID',
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
    
    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: true,
    }),
    
    secret: Field.text({
      label: 'Secret',
      required: true,
      description: 'TOTP secret key',
    }),
    
    backup_codes: Field.textarea({
      label: 'Backup Codes',
      required: false,
      description: 'JSON-serialized backup recovery codes',
    }),

    verified: Field.boolean({
      label: 'Verified',
      defaultValue: true,
      description: 'Whether the enrollment was confirmed with a valid TOTP code (managed by better-auth)',
    }),
  },
  
  indexes: [
    { fields: ['user_id'], unique: true },
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
