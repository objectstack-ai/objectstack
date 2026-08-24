// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_join_link — Universal Organization Join Link (V1, #11587 / epic #11586)
 *
 * ONE shareable, self-serve join link per organization: an org owner/admin
 * mints it and posts it to a group chat; anyone opening it registers/logs in
 * and joins the organization as a **member**. The admin never types an email
 * address. Role semantics are PINNED to `member` — deliberately NOT a field:
 * a link can never grant admin/owner in V1 (ruled on the epic), so there is
 * nothing to author and nothing to audit-drift.
 *
 * Owned end to end by plugin-auth's join-link endpoints
 * (`organization-join-link.ts`):
 *
 *   POST /api/v1/auth/organization/create-join-link   (org owner/admin)
 *   POST /api/v1/auth/organization/rotate-join-link   (org owner/admin)
 *   POST /api/v1/auth/organization/revoke-join-link   (org owner/admin)
 *   GET  /api/v1/auth/organization/get-join-link      (org owner/admin)
 *   GET  /api/v1/auth/organization/get-join-link-info (public, rate-limited)
 *   POST /api/v1/auth/organization/accept-join-link   (session + verified email)
 *
 * Generic CRUD is suppressed (`managedBy: 'engine-owned'` + read-only
 * apiMethods) — the sys_invitation pattern: rows are minted/revoked only
 * through the endpoints above, which enforce the ONE-active-link-per-org
 * invariant. A declared *partial* unique index cannot express that invariant:
 * the partial-index declaration surface was deliberately retired at protocol
 * 17 (#5248 — the maintainer chose remove over enforce), so the endpoint is
 * the single writer and the single enforcer.
 *
 * The `token` column is a BEARER CREDENTIAL (256-bit random, URL-safe):
 * anyone holding it can join as member while the link is live. V1 stores it
 * retrievable-plaintext in the org-scoped row (ruled acceptable on #11587:
 * member-grade, expiring, revocable — unlike an OAuth client_secret) so the
 * console can offer "copy link" at any time. Reads of this object are
 * org-scoped like every identity table; the mitigations are the ones the
 * epic pinned: default 7-day expiry, revocation/rotation, optional max-uses,
 * role pinned to member.
 *
 * `created_at` / `created_by` / `updated_*` are NOT declared here — the
 * registry injects the audit columns (`applySystemFields`), and the runtime
 * attributes `created_by` to the acting admin through the endpoint's
 * attribution seam.
 *
 * @namespace sys
 */
export const SysJoinLink = ObjectSchema.create({
  name: 'sys_join_link',
  label: 'Join Link',
  pluralLabel: 'Join Links',
  icon: 'link',
  isSystem: true,
  managedBy: 'engine-owned',
  // ADR-0010 §3.7 — schema owned by the platform; tenants may not edit it,
  // but may add overlay row-level config.
  protection: {
    lock: 'full',
    reason: 'Join-link tokens are bearer credentials managed by plugin-auth — see #11586.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'Shareable organization join links (self-serve member onboarding)',
  titleFormat: 'Join link for {organization_id}',
  highlightFields: ['organization_id', 'expires_at', 'use_count'],

  // Custom actions — generic CRUD is suppressed (engine-owned). These mirror
  // the endpoints so the generic console has entry points before the
  // dedicated dialog (objectui#5961) lands. All three are gated on the org
  // CAPABILITY flag, same as the sys_invitation actions (ADR-0081 D1), and
  // booked in PUBLIC_AUTH_FEATURES.organization.gatedInputs.
  actions: [
    {
      name: 'create_join_link',
      label: 'Create Join Link',
      icon: 'link',
      variant: 'primary',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/organization/create-join-link',
      requiresFeature: 'organization',
      successMessage: 'Join link created',
      refreshAfter: true,
    },
    // Param-LESS on purpose (#7278: `confirmText` beside params = two dialogs
    // for one decision): the row id rides `recordIdParam`, and the endpoint
    // resolves the organization scope from that row.
    {
      name: 'rotate_join_link',
      label: 'Rotate Join Link',
      icon: 'refresh-cw',
      variant: 'secondary',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/rotate-join-link',
      recordIdParam: 'joinLinkId',
      requiresFeature: 'organization',
      confirmText:
        'Rotate this organization\'s join link? The current link stops working immediately and a new one is minted.',
      successMessage: 'Join link rotated',
      refreshAfter: true,
    },
    {
      name: 'revoke_join_link',
      label: 'Revoke Join Link',
      icon: 'x-circle',
      variant: 'danger',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/revoke-join-link',
      recordIdParam: 'joinLinkId',
      requiresFeature: 'organization',
      confirmText:
        'Revoke this organization\'s join link? Anyone holding the link will no longer be able to join.',
      successMessage: 'Join link revoked',
      refreshAfter: true,
    },
  ],

  listViews: {
    all_join_links: {
      type: 'grid',
      name: 'all_join_links',
      label: 'All',
      data: { provider: 'object', object: 'sys_join_link' },
      columns: ['organization_id', 'expires_at', 'revoked_at', 'max_uses', 'use_count'],
      sort: [{ field: 'expires_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    id: Field.text({
      label: 'Join Link ID',
      required: true,
      readonly: true,
    }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      // Optional at the SCHEMA level for the same reason as sys_invitation:
      // single-tenant has no sys_organization row and no auto-stamp
      // (org-scoping is multi-tenant-only, ADR-0057 addendum). Every row the
      // endpoints mint carries a concrete organization id.
      required: false,
    }),

    token: Field.text({
      label: 'Token',
      required: true,
      readonly: true,
      description:
        'Opaque URL-safe join token (256-bit random) — a bearer credential: anyone holding it '
        + 'can join this organization as a member while the link is live.',
    }),

    expires_at: Field.datetime({
      label: 'Expires At',
      required: true,
      description: 'Hard expiry; the endpoints default it to creation +7 days.',
    }),

    revoked_at: Field.datetime({
      label: 'Revoked At',
      required: false,
      description: 'Set when the link is revoked or rotated away; never cleared.',
    }),

    max_uses: Field.number({
      label: 'Max Uses',
      required: false,
      description: 'Optional cap on successful joins; empty = unlimited until expiry/revocation.',
    }),

    use_count: Field.number({
      label: 'Use Count',
      required: false,
      readonly: true,
      defaultValue: 0,
      description: 'Successful joins through this link (best-effort counter).',
    }),
  },

  indexes: [
    // The token is an installation-wide reservation (an opaque random
    // credential), so the scope is 'global' — no organization key part.
    { fields: ['token'], unique: 'global' },
    { fields: ['organization_id'] },
    { fields: ['expires_at'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // Reads only (the sys_invitation pattern): every write goes through the
    // plugin-auth endpoints, which own the one-active-link-per-org invariant.
    apiMethods: ['get', 'list'],
  },
});
