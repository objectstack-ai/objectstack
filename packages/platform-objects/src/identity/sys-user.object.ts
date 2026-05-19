// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_user — System User Object
 *
 * Canonical user identity record for the ObjectStack platform.
 * Backed by better-auth's `user` model with ObjectStack field conventions.
 *
 * Field order drives default list/form layout: identity first, then profile,
 * then system-managed audit fields (hidden from create/edit forms).
 *
 * @namespace sys
 */
export const SysUser = ObjectSchema.create({
  name: 'sys_user',
  label: 'User',
  pluralLabel: 'Users',
  icon: 'user',
  isSystem: true,
  managedBy: 'better-auth',
  description: 'User accounts for authentication',
  displayNameField: 'name',
  titleFormat: '{name}',
  compactLayout: ['name', 'email', 'email_verified'],

  // Custom actions — generic CRUD is suppressed because user accounts are
  // managed by better-auth, but we still need first-class affordances for
  // common operations. Each action delegates to a Console-side named script
  // registered on the ActionRunner (see objectui `AppContent.tsx`). Adding
  // new affordances (reset password, revoke session, …) is now a pure
  // schema + script-registration change — no per-view code.
  actions: [
    {
      name: 'invite_user',
      label: 'Invite User',
      icon: 'user-plus',
      variant: 'primary',
      locations: ['list_toolbar'],
      type: 'script',
      target: 'invite_user',
      description: 'Send an invitation email to add a new user to the active organization. Handled by the better-auth invite-member flow.',
    },
  ],

  listViews: {
    all_users: {
      type: 'grid',
      name: 'all_users',
      label: 'All Users',
      data: { provider: 'object', object: 'sys_user' },
      columns: ['name', 'email', 'email_verified', 'two_factor_enabled', 'created_at'],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    unverified: {
      type: 'grid',
      name: 'unverified',
      label: 'Unverified',
      data: { provider: 'object', object: 'sys_user' },
      columns: ['name', 'email', 'created_at'],
      filter: [{ field: 'email_verified', operator: 'equals', value: false }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    two_factor: {
      type: 'grid',
      name: 'two_factor',
      label: '2FA Enabled',
      data: { provider: 'object', object: 'sys_user' },
      columns: ['name', 'email', 'two_factor_enabled', 'updated_at'],
      filter: [{ field: 'two_factor_enabled', operator: 'equals', value: true }],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    // ── Identity (primary business fields) ───────────────────────
    name: Field.text({
      label: 'Name',
      required: true,
      searchable: true,
      maxLength: 255,
      group: 'Identity',
    }),

    email: Field.email({
      label: 'Email',
      required: true,
      searchable: true,
      group: 'Identity',
    }),

    email_verified: Field.boolean({
      label: 'Email Verified',
      defaultValue: false,
      group: 'Identity',
    }),

    two_factor_enabled: Field.boolean({
      label: 'Two-Factor Enabled',
      defaultValue: false,
      group: 'Identity',
      description: 'Whether two-factor authentication is enabled for this user. Maintained by the better-auth `twoFactor` plugin.',
    }),

    // ── Profile ──────────────────────────────────────────────────
    image: Field.url({
      label: 'Profile Image',
      required: false,
      group: 'Profile',
    }),

    // ── System (auto-managed, hidden from create/edit forms) ─────
    id: Field.text({
      label: 'User ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['email'], unique: true },
    { fields: ['created_at'], unique: false },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
    trash: true,
    mru: true,
  },

  validations: [
    {
      name: 'email_unique',
      type: 'unique',
      severity: 'error',
      message: 'Email must be unique',
      fields: ['email'],
      caseSensitive: false,
    },
  ],
});
