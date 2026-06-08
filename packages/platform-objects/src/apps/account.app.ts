// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Account App — personal self-service surface for the current user.
 *
 * Hidden from the App Switcher (`hidden: true`) and surfaced by the
 * shell through the avatar / user dropdown instead — the same pattern
 * GitHub, Google, and Salesforce use for personal settings.
 *
 * Replaces the legacy standalone `apps/account` SPA (M10.31): rather
 * than ship a second shell just for security settings, we expose the
 * same `sys_*` identity objects here and rely on RLS to scope rows to
 * the caller. Crucially this app declares **no** `requiredPermissions`,
 * so every authenticated user can reach it — unlike Setup which
 * requires `setup.access` and therefore excludes the default
 * `member_default` permission set.
 *
 * The C-tier `resultDialog` actions previously shipped on these objects
 * make the experience equivalent to the old account SPA for supported
 * surfaces:
 *   - `sys_oauth_application.create` — one-time client_secret reveal
 *   - `sys_account.link_social` — OAuth redirect URL
 *
 * The same objects also appear (admin-only) in `setup.app.ts`'s
 * Advanced group, gated by `manage_platform_settings`, for tenant-wide
 * inspection. The duplication is intentional: end users get a friendly
 * self-service view, platform admins get the browsable tables.
 */

import type { App } from '@objectstack/spec/ui';

export const ACCOUNT_APP: App = {
  name: 'account',
  label: 'Account',
  description: 'Personal security and identity settings',
  icon: 'user-circle',
  active: true,
  isDefault: false,
  // Surface via the avatar dropdown, not the App Switcher — see App.hidden.
  hidden: true,
  branding: {
    primaryColor: '#0ea5e9', // sky-500 — distinct from Setup's slate
  },
  // No `requiredPermissions`: any authenticated user must be able to
  // manage their own linked accounts / personal OAuth apps. RLS on each
  // object scopes rows to the caller.
  navigation: [
    // Profile is the canonical landing — a hand-written React settings card
    // (Vercel/Linear style) registered in the Console SPA as
    // `account:profile_card`. The renderer reads the current user via
    // `useAuth()` and writes via `client.auth.updateUser`, so there is no
    // sys_user record context here — this is intentional. The admin-facing
    // sys_user record page (see `pages/sys-user.page.ts`) stays focused on
    // record browsing (Identity/Audit fields, related lists, admin actions)
    // and is reached through Setup, never from the Account App.
    {
      id: 'nav_account_profile',
      type: 'component',
      label: 'Profile',
      componentRef: 'account:profile_card',
      icon: 'user-circle',
    },

    // --- Inbox & work assigned to me -----------------------------------
    // Notifications, approvals waiting on me, and the orgs I belong to.
    // All three rely on pre-existing `*.mine` / `*.my_pending` listViews
    // that filter by `{current_user_id}` via RLS — no new objects needed.
    {
      id: 'grp_account_inbox',
      type: 'group',
      label: 'Inbox',
      icon: 'inbox',
      defaultOpen: true,
      children: [
        {
          // ADR-0030: the user-facing inbox is the materialization
          // (sys_inbox_message), not the L2 event (sys_notification).
          id: 'nav_account_notifications',
          type: 'object',
          label: 'Notifications',
          objectName: 'sys_inbox_message',
          viewName: 'mine',
          icon: 'bell',
          requiresObject: 'sys_inbox_message',
        },
        {
          id: 'nav_account_approvals',
          type: 'object',
          label: 'Approvals',
          objectName: 'sys_approval_request',
          viewName: 'my_pending',
          icon: 'check-circle',
          requiresObject: 'sys_approval_request',
        },
        {
          id: 'nav_account_memberships',
          type: 'object',
          label: 'My Organizations',
          objectName: 'sys_member',
          viewName: 'mine',
          icon: 'building-2',
          requiresObject: 'sys_member',
        },
      ],
    },

    // --- Security -------------------------------------------------------
    {
      id: 'grp_account_security',
      type: 'group',
      label: 'Security',
      icon: 'shield',
      defaultOpen: true,
      children: [
        {
          id: 'nav_account_linked',
          type: 'object',
          label: 'Linked Accounts',
          objectName: 'sys_account',
          icon: 'link-2',
          requiresObject: 'sys_account',
        },
        {
          id: 'nav_account_sessions',
          type: 'object',
          label: 'Active Sessions',
          objectName: 'sys_session',
          viewName: 'mine',
          icon: 'monitor-smartphone',
          requiresObject: 'sys_session',
        },
      ],
    },

    // --- Developer ------------------------------------------------------
    {
      id: 'grp_account_developer',
      type: 'group',
      label: 'Developer',
      icon: 'code',
      defaultOpen: false,
      children: [
        {
          id: 'nav_account_api_keys',
          type: 'object',
          label: 'API Keys',
          objectName: 'sys_api_key',
          viewName: 'mine',
          icon: 'key-round',
          requiresObject: 'sys_api_key',
        },
        {
          id: 'nav_account_oauth_apps',
          type: 'object',
          label: 'OAuth Applications',
          objectName: 'sys_oauth_application',
          viewName: 'mine',
          icon: 'app-window',
          requiresObject: 'sys_oauth_application',
        },
      ],
    },

    // Note: `sys_user_preference` is intentionally NOT exposed in the
    // Account App. It's an internal key-value store the UI uses for state
    // like `ui.recent`, `ui.favorites`, theme, sidebar collapse — not
    // a user-curatable settings surface. A future
    // `account:preferences_card` React component should provide the
    // curated theme / locale / timezone / notifications toggles when we
    // need them; until then there is no nav entry.
  ],
};
