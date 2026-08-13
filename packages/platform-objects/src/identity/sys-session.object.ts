// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_session — System Session Object
 *
 * Active user session record for the ObjectStack platform.
 * Backed by better-auth's `session` model with ObjectStack field conventions.
 *
 * The `token` field is hidden by default — sessions are managed by the
 * auth plugin, not edited manually. Admins see session metadata
 * (user, expiry, IP, active context) without exposing the token value.
 *
 * @namespace sys
 */
export const SysSession = ObjectSchema.create({
  name: 'sys_session',
  label: 'Session',
  pluralLabel: 'Sessions',
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
  description: 'Active user sessions',
  displayNameField: 'user_id',
  nameField: 'user_id', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: 'Session — {user_id}',
  highlightFields: ['user_id', 'ip_address', 'expires_at'],

  // Custom actions — sessions are managed by better-auth (generic CRUD
  // suppressed). "Sign out other devices" is the high-value self-service
  // affordance every IdP exposes. Maps to better-auth's
  // `revoke-other-sessions` endpoint which terminates every session for
  // the current user except the one making the request.
  actions: [
    {
      name: 'revoke_my_other_sessions',
      label: 'Sign out other devices',
      icon: 'log-out',
      variant: 'danger',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/revoke-other-sessions',
      confirmText: 'Sign out of every other device where you\'re currently logged in? Your current session will remain active.',
      successMessage: 'All other sessions revoked',
      refreshAfter: true,
    },
    {
      name: 'revoke_session',
      label: 'Revoke Session',
      icon: 'log-out',
      variant: 'danger',
      mode: 'delete',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/revoke-session',
      // better-auth `revoke-session` keys off the session token, not the id.
      recordIdParam: 'token',
      recordIdField: 'token',
      confirmText: 'Revoke this session? The user will be signed out from that device.',
      successMessage: 'Session revoked',
      refreshAfter: true,
    },
  ],

  // [#7732] A `revoked_at` row is a TOMBSTONE — an ended session kept as the
  // ADR-0069 D4 audit record of its ending, not a session. Since the
  // interactive revoke stamps the row instead of deleting it, the two
  // session-listing views filter tombstones out (`revoke_session` still makes
  // the row leave the grid, exactly as it did when the row was deleted), and
  // the audit trail those columns exist for gets a view of its own — otherwise
  // the fields would be written and still readable nowhere, which is the same
  // declared-≠-enforced gap one layer up.
  listViews: {
    mine: {
      type: 'grid',
      name: 'mine',
      label: 'My Sessions',
      data: { provider: 'object', object: 'sys_session' },
      columns: ['ip_address', 'active_organization_id', 'created_at', 'expires_at'],
      filter: [
        { field: 'user_id', operator: 'equals', value: '{current_user_id}' },
        { field: 'revoked_at', operator: 'is_null' },
      ],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    all_sessions: {
      type: 'grid',
      name: 'all_sessions',
      label: 'All',
      data: { provider: 'object', object: 'sys_session' },
      columns: ['user_id', 'ip_address', 'active_organization_id', 'created_at', 'expires_at'],
      filter: [{ field: 'revoked_at', operator: 'is_null' }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    revoked: {
      type: 'grid',
      name: 'revoked',
      label: 'Revoked',
      data: { provider: 'object', object: 'sys_session' },
      columns: ['user_id', 'ip_address', 'revoked_at', 'revoke_reason', 'created_at'],
      filter: [{ field: 'revoked_at', operator: 'is_not_null' }],
      sort: [{ field: 'revoked_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    // ── Session owner & expiry ──────────────────────────────────
    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: true,
      searchable: true,
      group: 'Session',
    }),

    expires_at: Field.datetime({
      label: 'Expires At',
      required: true,
      group: 'Session',
    }),

    // ── ADR-0069 D4 — session controls (idle / absolute / revoke) ──
    last_activity_at: Field.datetime({
      label: 'Last Activity At',
      required: false,
      readonly: true,
      group: 'Session',
      description: 'Timestamp of the last request on this session; drives idle-timeout. System-managed.',
    }),
    revoked_at: Field.datetime({
      label: 'Revoked At',
      required: false,
      readonly: true,
      group: 'Session',
      description: 'When set, this session was revoked (idle / absolute-max / concurrent-cap / admin). System-managed.',
    }),
    revoke_reason: Field.text({
      label: 'Revoke Reason',
      required: false,
      maxLength: 64,
      readonly: true,
      group: 'Session',
      description: 'Why the session was revoked (idle_timeout, absolute_max, concurrent_cap, …).',
    }),

    // ── Active context (multi-org/team) ──────────────────────────
    active_organization_id: Field.lookup('sys_organization', {
      label: 'Active Organization',
      required: false,
      group: 'Context',
    }),

    active_team_id: Field.lookup('sys_team', {
      label: 'Active Team',
      required: false,
      group: 'Context',
    }),

    // ── Client fingerprint ───────────────────────────────────────
    ip_address: Field.text({
      label: 'IP Address',
      required: false,
      maxLength: 45, // Support IPv6
      group: 'Client',
    }),

    user_agent: Field.textarea({
      label: 'User Agent',
      required: false,
      group: 'Client',
    }),

    // ── Admin (managed by better-auth `admin` plugin) ────────────
    impersonated_by: Field.lookup('sys_user', {
      label: 'Impersonated By',
      required: false,
      group: 'Admin',
      description: 'User id of the admin that started this impersonation session, if any.',
    }),

    // ── Secret (hidden by default) ──────────────────────────────
    //
    // [#7823] `internal: true` is what makes the description below TRUE. It was
    // false on every build before this flag existed: `hidden` is a UI contract
    // ("Hidden from default UI"), never a serialization one, and the engine's
    // credential read mask collects by field TYPE — so this `text` column was
    // collected by nothing and the token came back on the generic data path.
    //
    // Measured on a real engine: an ADMIN caller got this column on list, on
    // get-by-id for ANOTHER user's session, and on an explicit `?select=id,token`.
    // The disclosure is admin-cross-user — a member's own reads are self-scoped
    // and the `sys_session_self` RLS policy already answers 404 across users.
    //
    // This column is a LIVE BEARER CREDENTIAL, which is where it differs from
    // its `sys_api_key.key` sibling (#7728): that one is a SHA-256 hash, while
    // the value here was replay-proven — a member's token, read off the data API
    // by an admin, authenticates as that member when sent as `Authorization:
    // Bearer <token>`. Disclosure is impersonation, not merely exposure.
    //
    // Still `text`, deliberately. `Field.secret` would encrypt at rest and
    // replace the column with a `sys_secret` ref, destroying the by-token
    // session lookup better-auth performs on every authenticated request — i.e.
    // it would break authentication to fix a disclosure. `password` is inert
    // here: the read mask skips `password` on `managedBy: 'better-auth'`
    // objects, and collects by TYPE anyway, so a `text` column is never
    // collected regardless. `internal` is read-side only: storage, the unique
    // index on `token` and the verifier's filter are all untouched.
    token: Field.text({
      label: 'Session Token',
      required: true,
      hidden: true,
      readonly: true,
      internal: true,
      description: 'Opaque session token — never exposed in UI',
      group: 'Secret',
    }),

    // ── System ───────────────────────────────────────────────────
    id: Field.text({
      label: 'Session ID',
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
    { fields: ['token'], unique: true },
    { fields: ['user_id'], unique: false },
    { fields: ['expires_at'], unique: false },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    // #1591 — reads only: writes are refused by the identity write guard
    // (ADR-0092 D2) and owned by better-auth. HTTP answers 405 before the 403.
    apiMethods: ['get', 'list'],
    clone: false,
  },
});
