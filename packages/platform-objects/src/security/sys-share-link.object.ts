// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_share_link — Capability-Token Public Share Links
 *
 * Each row authorises read (or write) access to ONE record of ONE
 * object via an opaque URL-safe token. Complements `sys_record_share`,
 * which models principal-based grants (share with a specific user /
 * team / role). A single record may have rows in both tables; the
 * union determines effective access.
 *
 * Lifecycle:
 *
 *   1. `IShareLinkService.createLink` validates the request against the
 *      target object's `publicSharing` whitelist and inserts a row.
 *      Token is a 24-char URL-safe random string.
 *
 *   2. `IShareLinkService.resolveToken` (called from the public
 *      `/api/v1/share-links/:token` middleware on every request)
 *      verifies the row is not revoked / not expired, applies audience
 *      / password gates, increments `use_count` + `last_used_at`, and
 *      returns the effective redaction set.
 *
 *   3. `IShareLinkService.revokeLink` stamps `revoked_at`. Rows are
 *      preserved for audit; resolveToken returns null after revocation.
 *
 * Conventions:
 *  - `object_name` is the short object name (`account`, `ai_conversation`, …)
 *  - `record_id` is the primary key of the target record within object_name
 *  - `audience` mirrors `ShareLinkAudience` in spec/contracts; the
 *    middleware enforces additional gating per audience
 *  - `redact_fields` overlays on top of the schema-default redaction
 *    set declared on `object.publicSharing.redactFields`
 *
 * managedBy: 'system' — admins inspect via the audit grid but all
 * writes flow through `IShareLinkService` so the per-object opt-in,
 * expiry caps, and audit hooks fire.
 *
 * @namespace sys
 */
export const SysShareLink = ObjectSchema.create({
  name: 'sys_share_link',
  label: 'Share Link',
  pluralLabel: 'Share Links',
  icon: 'link-2',
  isSystem: true,
  managedBy: 'system',
  description: 'Opaque capability token granting access to a single record. Notion/Figma-style public link sharing.',
  titleFormat: '{object_name}/{record_id} ({permission})',
  compactLayout: ['object_name', 'record_id', 'permission', 'audience', 'expires_at', 'revoked_at'],

  listViews: {
    active_links: {
      type: 'grid',
      name: 'active_links',
      label: 'Active',
      data: { provider: 'object', object: 'sys_share_link' },
      columns: ['object_name', 'record_id', 'permission', 'audience', 'expires_at', 'use_count', 'last_used_at'],
      filter: [{ field: 'revoked_at', operator: 'isNull' }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 100 },
    },
    by_me: {
      type: 'grid',
      name: 'by_me',
      label: 'Created by Me',
      data: { provider: 'object', object: 'sys_share_link' },
      columns: ['object_name', 'record_id', 'permission', 'audience', 'expires_at', 'revoked_at'],
      filter: [{ field: 'created_by', operator: 'equals', value: '{current_user_id}' }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 100 },
    },
    revoked: {
      type: 'grid',
      name: 'revoked',
      label: 'Revoked',
      data: { provider: 'object', object: 'sys_share_link' },
      columns: ['object_name', 'record_id', 'revoked_at', 'created_by'],
      filter: [{ field: 'revoked_at', operator: 'isNotNull' }],
      sort: [{ field: 'revoked_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    all_links: {
      type: 'grid',
      name: 'all_links',
      label: 'All',
      data: { provider: 'object', object: 'sys_share_link' },
      columns: ['object_name', 'record_id', 'permission', 'audience', 'expires_at', 'revoked_at', 'created_at'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 200 },
    },
  },

  fields: {
    id: Field.text({
      label: 'Link ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    // ── Token (the secret) ───────────────────────────────────────
    token: Field.text({
      label: 'Token',
      required: true,
      maxLength: 64,
      description: 'Opaque URL-safe random token (≥ 22 chars). The only secret in this row.',
      group: 'Token',
    }),

    // ── Target ───────────────────────────────────────────────────
    object_name: Field.text({
      label: 'Object',
      required: true,
      maxLength: 100,
      description: 'Short object name of the shared record (e.g. ai_conversation, contracts_contract)',
      group: 'Target',
    }),

    record_id: Field.text({
      label: 'Record',
      required: true,
      maxLength: 100,
      description: 'Primary key of the shared record within object_name',
      group: 'Target',
    }),

    // ── Access Policy ────────────────────────────────────────────
    permission: Field.select(
      [
        { label: 'View',    value: 'view' },
        { label: 'Comment', value: 'comment' },
        { label: 'Edit',    value: 'edit' },
      ],
      {
        label: 'Permission',
        required: true,
        defaultValue: 'view',
        description: 'What the link holder can do with the record',
        group: 'Access Policy',
      },
    ),

    audience: Field.select(
      [
        { label: 'Public (indexable)', value: 'public' },
        { label: 'Anyone with the link', value: 'link_only' },
        { label: 'Signed-in users', value: 'signed_in' },
        { label: 'Specific emails', value: 'email' },
      ],
      {
        label: 'Audience',
        required: true,
        defaultValue: 'link_only',
        description: 'Gating layer applied on top of the token check',
        group: 'Access Policy',
      },
    ),

    expires_at: Field.datetime({
      label: 'Expires At',
      description: 'When set, resolveToken returns null after this timestamp',
      group: 'Access Policy',
    }),

    email_allowlist: Field.json({
      label: 'Email Allowlist',
      description: 'Lowercased addresses checked when audience=email',
      group: 'Access Policy',
    }),

    password_hash: Field.text({
      label: 'Password Hash',
      maxLength: 256,
      description: 'Argon2/bcrypt hash. When set, the UI prompts for a password before rendering.',
      group: 'Access Policy',
    }),

    redact_fields: Field.json({
      label: 'Per-Link Redactions',
      description: 'Extra fields stripped from the response, on top of the object-default set',
      group: 'Access Policy',
    }),

    label: Field.text({
      label: 'Label',
      maxLength: 200,
      description: 'Free-text shown in the share dialog (e.g. "ACME Q3 contract")',
      group: 'Metadata',
    }),

    // ── Lifecycle ────────────────────────────────────────────────
    revoked_at: Field.datetime({
      label: 'Revoked At',
      readonly: true,
      description: 'When set, the link is permanently disabled',
      group: 'Lifecycle',
    }),

    created_by: Field.lookup('sys_user', {
      label: 'Created By',
      readonly: true,
      description: 'Issuer of the link',
      group: 'Lifecycle',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'Lifecycle',
    }),

    last_used_at: Field.datetime({
      label: 'Last Used At',
      readonly: true,
      description: 'Stamped by resolveToken; used by the dashboard to highlight active links',
      group: 'Lifecycle',
    }),

    use_count: Field.number({
      label: 'Use Count',
      defaultValue: 0,
      readonly: true,
      description: 'Incremented by resolveToken on every successful resolution',
      group: 'Lifecycle',
    }),
  },

  indexes: [
    // Hot path: resolveToken — one row lookup per public request.
    { fields: ['token'], unique: true },
    // Management UI: "all links for this record".
    { fields: ['object_name', 'record_id'] },
    // "Active links I issued".
    { fields: ['created_by', 'revoked_at'] },
    // Reaper for expired rows (background sweep).
    { fields: ['expires_at'] },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    // The /api/v1/share-links endpoints are the authoritative surface;
    // the generic data API is exposed read-only for the admin grid.
    apiMethods: ['get', 'list'],
    trash: false,
    mru: false,
    clone: false,
  },
});
