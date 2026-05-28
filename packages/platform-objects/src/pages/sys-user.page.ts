// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

/**
 * sys_user — Record Detail Page (slotted, default for ALL sys_user records)
 *
 * Tailors the synthesized admin form into a layout that works for both:
 *   • the end user landing on their own profile from the Account App, and
 *   • an admin opening someone else's user record from Setup.
 *
 * Strategy
 * --------
 *  - `kind: 'slotted'` + `isDefault: true`: overrides `highlights`,
 *    `details`, `tabs` and `discussion`. Header / actions fall through
 *    to the synthesizer so the object's declared actions
 *    (`update_my_profile / change_my_password / resend_verification_email
 *    / ban_user / set_user_role / impersonate_user / …`) still appear
 *    in the header overflow menu automatically.
 *  - `highlights` promotes the four signals worth scanning at the top:
 *    email, verification state, 2FA, platform role. Highlight fields
 *    are auto-dropped from the details grid below.
 *  - `details` re-groups remaining fields into sections and hides
 *    admin-internal audit columns. Banned / ban metadata is still
 *    editable from the header actions — we just don't show it in
 *    every user's body.
 *  - `tabs` is **explicitly curated** to the 4 related lists that matter
 *    on a user profile (Sessions / Linked Accounts / Organizations /
 *    Personal OAuth Apps). Without this override, the synthesizer
 *    auto-generates a tab per object that has a FK to sys_user
 *    (sys_role.created_by, sys_email.updated_by, sys_user_preference,
 *    sys_email_template.created_by, …) producing dozens of noisy
 *    "查看全部" cards on every profile.
 *  - `discussion: []` removes the Chatter feed — it has no business
 *    on a personal profile.
 */
export const SysUserDetailPage: Page = {
  name: 'sys_user_detail',
  label: 'User',
  type: 'record',
  object: 'sys_user',
  template: 'default',
  kind: 'slotted',
  isDefault: true,

  regions: [],

  slots: {
    // ── Highlight chips above the fold ────────────────────────────
    highlights: {
      type: 'record:highlights',
      properties: {
        fields: ['email', 'email_verified', 'two_factor_enabled', 'role'],
      },
    },

    // ── Body / details grid ───────────────────────────────────────
    details: {
      type: 'record:details',
      properties: {
        hideFields: [
          'id',
          'banned',
          'ban_reason',
          'ban_expires',
          // already promoted to highlights:
          'email',
          'email_verified',
          'two_factor_enabled',
          'role',
        ],
        sections: [
          {
            label: 'Identity',
            fields: ['name', 'image'],
          },
          {
            label: 'Audit',
            fields: ['created_at', 'updated_at'],
          },
        ],
      },
    },

    // ── Tabs: curated related lists ───────────────────────────────
    // Only the 4 lists that are semantically about THIS user account.
    // Everything else (sys_role created_by, sys_email_template
    // updated_by, …) is incidental authorship metadata and would only
    // create noise.
    tabs: {
      type: 'page:tabs',
      properties: {
        type: 'line',
        position: 'top',
        items: [
          {
            label: 'Sessions',
            icon: 'monitor',
            children: [
              {
                type: 'record:related_list',
                properties: {
                  objectName: 'sys_session',
                  relationshipField: 'user_id',
                  columns: ['user_agent', 'ip_address', 'created_at', 'expires_at'],
                  sort: [{ field: 'created_at', order: 'desc' }],
                  limit: 25,
                  showViewAll: true,
                  title: 'Sessions',
                },
              },
            ],
          },
          {
            label: 'Linked Accounts',
            icon: 'link',
            children: [
              {
                type: 'record:related_list',
                properties: {
                  objectName: 'sys_account',
                  relationshipField: 'user_id',
                  columns: ['provider_id', 'account_id', 'created_at'],
                  sort: [{ field: 'created_at', order: 'desc' }],
                  limit: 25,
                  showViewAll: true,
                  title: 'Linked Accounts',
                },
              },
            ],
          },
          {
            label: 'Organizations',
            icon: 'building-2',
            children: [
              {
                type: 'record:related_list',
                properties: {
                  objectName: 'sys_member',
                  relationshipField: 'user_id',
                  columns: ['organization_id', 'role', 'created_at'],
                  sort: [{ field: 'created_at', order: 'desc' }],
                  limit: 25,
                  showViewAll: true,
                  title: 'Organizations',
                },
              },
            ],
          },
          {
            label: 'OAuth Apps',
            icon: 'key-square',
            children: [
              {
                type: 'record:related_list',
                properties: {
                  objectName: 'sys_oauth_application',
                  relationshipField: 'user_id',
                  columns: ['name', 'client_id', 'created_at'],
                  sort: [{ field: 'created_at', order: 'desc' }],
                  limit: 25,
                  showViewAll: true,
                  title: 'OAuth Apps',
                },
              },
            ],
          },
          // ── Security ──────────────────────────────────────────────
          // Grouped self-service security controls. Each `record:quick_actions`
          // pulls its actions by name from the sys_user object metadata
          // (DRY — definitions stay on the object) and filters by
          // `location: 'record_section'` so they only render here, not
          // in the global header row.
          {
            label: 'Security',
            icon: 'shield',
            children: [
              {
                type: 'element:text',
                properties: {
                  variant: 'subheading',
                  content: 'Password & Sign-in',
                },
              },
              {
                type: 'element:text',
                properties: {
                  variant: 'caption',
                  content: 'Change your password or the email address associated with this account.',
                },
              },
              {
                type: 'record:quick_actions',
                properties: {
                  location: 'record_section',
                  align: 'start',
                  actionNames: ['change_my_password', 'change_my_email'],
                },
              },
              { type: 'element:divider' },
              {
                type: 'element:text',
                properties: {
                  variant: 'subheading',
                  content: 'Two-Factor Authentication',
                },
              },
              {
                type: 'element:text',
                properties: {
                  variant: 'caption',
                  content: 'Add a second layer of security using a TOTP authenticator app. Backup codes let you sign in if you lose your device.',
                },
              },
              {
                type: 'record:quick_actions',
                properties: {
                  location: 'record_section',
                  align: 'start',
                  actionNames: ['enable_two_factor', 'disable_two_factor', 'generate_backup_codes'],
                },
              },
              { type: 'element:divider' },
              {
                type: 'element:text',
                properties: {
                  variant: 'subheading',
                  content: 'Email Verification',
                },
              },
              {
                type: 'element:text',
                properties: {
                  variant: 'caption',
                  content: 'Verify your email so password resets and notifications reach you. The button appears only while verification is pending.',
                },
              },
              {
                type: 'record:quick_actions',
                properties: {
                  location: 'record_section',
                  align: 'start',
                  actionNames: ['resend_verification_email'],
                },
              },
              { type: 'element:divider' },
              {
                type: 'element:text',
                properties: {
                  variant: 'subheading',
                  content: 'Danger Zone',
                },
                className: 'text-destructive',
              },
              {
                type: 'element:text',
                properties: {
                  variant: 'caption',
                  content: 'Permanent. Once deleted, your account cannot be recovered.',
                },
              },
              {
                type: 'record:quick_actions',
                properties: {
                  location: 'record_section',
                  align: 'start',
                  actionNames: ['delete_my_account'],
                },
              },
            ],
          },
          // ── API Keys ──────────────────────────────────────────────
          // Programmatic credentials issued for this user. Filtered by
          // user_id FK; the sys_api_key object's own list-item actions
          // (revoke / restore) handle row operations.
          {
            label: 'API Keys',
            icon: 'key-round',
            children: [
              {
                type: 'record:related_list',
                properties: {
                  objectName: 'sys_api_key',
                  relationshipField: 'user_id',
                  columns: ['name', 'prefix', 'expires_at', 'revoked', 'created_at'],
                  sort: [{ field: 'created_at', order: 'desc' }],
                  limit: 25,
                  showViewAll: true,
                  title: 'API Keys',
                },
              },
            ],
          },
        ],
      },
    },

    // ── Suppress the Discussion / Chatter thread ──────────────────
    discussion: [],
  },
};
