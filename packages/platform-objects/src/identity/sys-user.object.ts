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
  // ADR-0010 §3.7 — identity table is managed by better-auth; schema must not drift.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
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
      type: 'api',
      target: '/api/v1/auth/organization/invite-member',
      successMessage: 'Invitation sent',
      refreshAfter: true,
      params: [
        { field: 'email', required: true },
        { field: 'role', objectOverride: 'sys_member', required: true },
      ],
    },

    // ── Platform admin operations (require better-auth `admin` plugin) ─
    //
    // These actions hit /api/v1/auth/admin/* endpoints that are only
    // wired when `auth.plugins.admin` is enabled. When the plugin is
    // disabled the actions still render (schema is static) but server
    // returns 404. UI surfaces them under the row menu so platform
    // admins can manage accounts without dropping to SQL or
    // a custom Setup wizard.
    {
      name: 'ban_user',
      label: 'Ban User',
      icon: 'ban',
      variant: 'danger',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/admin/ban-user',
      recordIdParam: 'userId',
      successMessage: 'User banned',
      refreshAfter: true,
      confirmText: 'Ban this user? They will be signed out and unable to sign in until unbanned.',
      params: [
        { name: 'banReason', label: 'Ban Reason', type: 'text', required: false },
      ],
    },
    {
      name: 'unban_user',
      label: 'Unban User',
      icon: 'check-circle-2',
      variant: 'secondary',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/admin/unban-user',
      recordIdParam: 'userId',
      successMessage: 'User unbanned',
      refreshAfter: true,
    },
    {
      name: 'set_user_password',
      label: 'Set Password',
      icon: 'key-round',
      variant: 'secondary',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/admin/set-user-password',
      recordIdParam: 'userId',
      successMessage: 'Password updated',
      refreshAfter: false,
      params: [
        { name: 'newPassword', label: 'New Password', type: 'text', required: true },
      ],
    },
    {
      name: 'set_user_role',
      label: 'Set Platform Role',
      icon: 'shield-check',
      variant: 'secondary',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/admin/set-role',
      recordIdParam: 'userId',
      successMessage: 'Role updated',
      refreshAfter: true,
      params: [
        { name: 'role', label: 'Platform Role', type: 'text', required: true },
      ],
    },
    {
      name: 'impersonate_user',
      label: 'Impersonate User',
      icon: 'user-cog',
      variant: 'secondary',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/admin/impersonate-user',
      recordIdParam: 'userId',
      successMessage: 'Now impersonating user',
      refreshAfter: true,
      confirmText: 'Start an impersonation session for this user? Use only for legitimate support cases — actions will be logged.',
    },

    // ── Self-service actions (the row owner only) ─────────────────────
    //
    // These four actions are the "account settings" surfaces the standalone
    // Account SPA used to own (`/account/profile`, `/account/security`).
    // They are visible only when the current row is the signed-in user —
    // i.e. opened from the user's own detail page or a "My Account" view —
    // via the `visible` CEL predicate. Admin equivalents (set_user_password
    // for any account) are above and stay separate.
    {
      name: 'update_my_profile',
      label: 'Update Profile',
      icon: 'user-pen',
      variant: 'primary',
      mode: 'edit',
      locations: ['record_header'],
      type: 'api',
      target: '/api/v1/auth/update-user',
      visible: 'record.id == ctx.user.id',
      successMessage: 'Profile updated',
      refreshAfter: true,
      params: [
        { field: 'name', required: false, defaultFromRow: true },
        { field: 'image', required: false, defaultFromRow: true },
      ],
    },
    {
      name: 'change_my_password',
      label: 'Change Password',
      icon: 'key',
      variant: 'secondary',
      locations: ['record_header', 'record_more', 'record_section'],
      type: 'api',
      target: '/api/v1/auth/change-password',
      visible: 'record.id == ctx.user.id',
      successMessage: 'Password changed',
      refreshAfter: false,
      params: [
        { name: 'currentPassword', label: 'Current Password', type: 'text', required: true },
        { name: 'newPassword', label: 'New Password', type: 'text', required: true },
        { name: 'revokeOtherSessions', label: 'Sign out other devices', type: 'boolean', required: false, defaultValue: true },
      ],
    },
    {
      name: 'change_my_email',
      label: 'Change Email',
      icon: 'mail',
      variant: 'secondary',
      locations: ['record_header', 'record_more', 'record_section'],
      type: 'api',
      target: '/api/v1/auth/change-email',
      visible: 'record.id == ctx.user.id',
      successMessage: 'Verification email sent — check the new address to confirm.',
      refreshAfter: false,
      params: [
        { name: 'newEmail', label: 'New Email', type: 'email', required: true },
      ],
    },
    {
      name: 'resend_verification_email',
      label: 'Resend Verification Email',
      icon: 'mail-check',
      variant: 'secondary',
      locations: ['record_header', 'record_more', 'record_section'],
      type: 'api',
      target: '/api/v1/auth/send-verification-email',
      // Only render for the row owner AND when their email is still
      // unverified — there's nothing to resend once verified.
      visible: 'record.id == ctx.user.id && record.email_verified == false',
      successMessage: 'Verification email sent — check your inbox.',
      refreshAfter: false,
      params: [],
    },
    {
      name: 'delete_my_account',
      label: 'Delete My Account',
      icon: 'user-x',
      variant: 'danger',
      mode: 'delete',
      locations: ['record_more', 'record_section'],
      type: 'api',
      target: '/api/v1/auth/delete-user',
      visible: 'record.id == ctx.user.id',
      confirmText: 'Permanently delete your account? This cannot be undone — all your sessions will be terminated and all data you own will be removed per the configured retention policy.',
      successMessage: 'Account deleted',
      refreshAfter: false,
      params: [
        { name: 'password', label: 'Current Password', type: 'text', required: true },
      ],
    },
    // ── Two-factor authentication ─────────────────────────────────
    // Enable flow returns { totpURI, backupCodes } — surfacing those
    // safely needs a QR + verify UI that the generic action engine
    // can't render yet. We still expose it so the API call works
    // and the success toast displays the otpauth:// URI that users
    // can manually add to an authenticator app as a fallback.
    {
      name: 'enable_two_factor',
      label: 'Enable Two-Factor Auth',
      icon: 'shield-plus',
      variant: 'primary',
      locations: ['record_section'],
      type: 'api',
      target: '/api/v1/auth/two-factor/enable',
      visible: 'record.id == ctx.user.id && record.two_factor_enabled != true',
      successMessage: 'Two-factor authentication enabled. Scan the QR code or paste the otpauth URI into your authenticator app, then verify a code to complete setup.',
      refreshAfter: true,
      params: [
        { name: 'password', label: 'Current Password', type: 'text', required: true },
      ],
    },
    {
      name: 'disable_two_factor',
      label: 'Disable Two-Factor Auth',
      icon: 'shield-off',
      variant: 'danger',
      locations: ['record_section'],
      type: 'api',
      target: '/api/v1/auth/two-factor/disable',
      visible: 'record.id == ctx.user.id && record.two_factor_enabled == true',
      confirmText: 'Turn off two-factor authentication? Your account will be less secure.',
      successMessage: 'Two-factor authentication disabled.',
      refreshAfter: true,
      params: [
        { name: 'password', label: 'Current Password', type: 'text', required: true },
      ],
    },
    {
      name: 'generate_backup_codes',
      label: 'Regenerate Backup Codes',
      icon: 'list-restart',
      variant: 'secondary',
      locations: ['record_section'],
      type: 'api',
      target: '/api/v1/auth/two-factor/generate-backup-codes',
      visible: 'record.id == ctx.user.id && record.two_factor_enabled == true',
      confirmText: 'Generate a new set of backup codes? Any previously generated codes will stop working.',
      successMessage: 'New backup codes generated — save them somewhere safe.',
      refreshAfter: false,
      params: [
        { name: 'password', label: 'Current Password', type: 'text', required: true },
      ],
    },
  ],

  listViews: {
    // Self-service profile entry — surfaced by the Account App so every
    // authenticated user can view / edit their own basic profile (name,
    // email, avatar). Filtered to a single row (the caller) via the
    // `{current_user_id}` template variable; RLS additionally enforces
    // that non-admins cannot read other users' rows.
    me: {
      type: 'grid',
      name: 'me',
      label: 'My Profile',
      data: { provider: 'object', object: 'sys_user' },
      columns: ['name', 'email', 'email_verified', 'two_factor_enabled', 'updated_at'],
      filter: [{ field: 'id', operator: 'equals', value: '{current_user_id}' }],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 1 },
    },
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
    banned: {
      type: 'grid',
      name: 'banned',
      label: 'Banned',
      data: { provider: 'object', object: 'sys_user' },
      columns: ['name', 'email', 'banned', 'ban_reason', 'ban_expires'],
      filter: [{ field: 'banned', operator: 'equals', value: true }],
      sort: [{ field: 'updated_at', order: 'desc' }],
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

    // ── Admin (managed by better-auth `admin` plugin when enabled) ───
    role: Field.text({
      label: 'Platform Role',
      required: false,
      maxLength: 64,
      group: 'Admin',
      description: 'Platform-level role (admin, user, …). Set via the Set Platform Role action.',
    }),

    banned: Field.boolean({
      label: 'Banned',
      defaultValue: false,
      group: 'Admin',
      description: 'When true, the user cannot sign in. Toggle via Ban User / Unban User actions.',
    }),

    ban_reason: Field.text({
      label: 'Ban Reason',
      required: false,
      maxLength: 255,
      group: 'Admin',
    }),

    ban_expires: Field.datetime({
      label: 'Ban Expires',
      required: false,
      group: 'Admin',
      description: 'When set, the ban auto-clears at this time.',
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

  // Email uniqueness is enforced by the unique index above (and better-auth's
  // managed user table). A declarative `unique` validation rule is intentionally
  // not used — uniqueness needs a DB lookup, not a synchronous validation, so it
  // is not one of the declarable validation-rule types.
});
