// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import {
  BUILTIN_MEMBERSHIP_ROLE_OPTIONS,
  InvitationStatus,
  MEMBERSHIP_ROLE_MEMBER,
} from '@objectstack/spec/identity';

/**
 * sys_invitation — System Invitation Object
 *
 * Organization invitation tokens for inviting users.
 * Backed by better-auth's organization plugin.
 *
 * @namespace sys
 */
export const SysInvitation = ObjectSchema.create({
  name: 'sys_invitation',
  label: 'Invitation',
  pluralLabel: 'Invitations',
  icon: 'mail',
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
  description: 'Organization invitations for user onboarding',
  // Title by invitee email rather than organization_id: the latter is null in
  // single-org mode (renders "Invitation to null"), and the recipient email is
  // the more useful identifier in both modes anyway.
  titleFormat: 'Invitation for {email}',
  highlightFields: ['email', 'organization_id', 'status'],

  // Custom actions — generic CRUD is suppressed (better-auth-managed).
  // Mirror the `invite_user` toolbar action from sys_user here so admins
  // landing on the Invitations page get an obvious entry point.
  actions: [
    {
      name: 'invite_user',
      label: 'Invite User',
      icon: 'user-plus',
      variant: 'primary',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/organization/invite-member',
      // Inviting/managing invitations is a multi-org-only flow (the
      // endpoint resolves an active org absent in single-org mode). Gate
      // the admin-side actions on the multi-org flag (mirrors
      // sys_organization.create_organization). The recipient-side
      // accept/reject actions below stay record-gated — they are
      // unreachable in single-org anyway (no invitation rows exist).
      requiresFeature: 'organization',
      successMessage: 'Invitation sent',
      refreshAfter: true,
      params: [
        { field: 'email', required: true },
        { field: 'role', required: true },
      ],
    },
    {
      name: 'cancel_invitation',
      label: 'Cancel Invitation',
      icon: 'x-circle',
      variant: 'danger',
      mode: 'delete',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/cancel-invitation',
      recordIdParam: 'invitationId',
      requiresFeature: 'organization',
      confirmText: 'Cancel this invitation? The recipient will no longer be able to accept it.',
      successMessage: 'Invitation canceled',
      refreshAfter: true,
    },
    {
      name: 'resend_invitation',
      label: 'Resend Invitation',
      icon: 'send',
      variant: 'secondary',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/invite-member',
      bodyExtra: { resend: true },
      requiresFeature: 'organization',
      successMessage: 'Invitation resent',
      refreshAfter: true,
      params: [
        { field: 'email', required: true, defaultFromRow: true },
        { field: 'role', required: true, defaultFromRow: true },
      ],
    },

    // ── Recipient-side actions (the invited user) ────────────────────
    //
    // These two are the counterpart to invite/cancel/resend: they are
    // visible only on invitations addressed to the current user. Used
    // by an "Inbox / Pending invitations" list opened from the user's
    // own account page. The recipient-only `visible` predicate keeps
    // them out of the admin org-management view.
    {
      name: 'accept_invitation',
      label: 'Accept Invitation',
      icon: 'check',
      variant: 'primary',
      locations: ['list_item', 'record_header'],
      type: 'api',
      target: '/api/v1/auth/organization/accept-invitation',
      recordIdParam: 'invitationId',
      visible: "record.email == ctx.user.email && record.status == 'pending'",
      successMessage: 'Invitation accepted',
      refreshAfter: true,
    },
    {
      name: 'reject_invitation',
      label: 'Decline Invitation',
      icon: 'x',
      variant: 'ghost',
      locations: ['list_item', 'record_header'],
      type: 'api',
      target: '/api/v1/auth/organization/reject-invitation',
      recordIdParam: 'invitationId',
      visible: "record.email == ctx.user.email && record.status == 'pending'",
      confirmText: 'Decline this invitation? The inviter will be notified and you will need a new invitation to join.',
      successMessage: 'Invitation declined',
      refreshAfter: true,
    },
  ],

  listViews: {
    pending: {
      type: 'grid',
      name: 'pending',
      label: 'Pending',
      data: { provider: 'object', object: 'sys_invitation' },
      columns: ['email', 'role', 'organization_id', 'inviter_id', 'expires_at'],
      filter: [{ field: 'status', operator: 'equals', value: 'pending' }],
      sort: [{ field: 'expires_at', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    accepted: {
      type: 'grid',
      name: 'accepted',
      label: 'Accepted',
      data: { provider: 'object', object: 'sys_invitation' },
      columns: ['email', 'role', 'organization_id', 'inviter_id', 'created_at'],
      filter: [{ field: 'status', operator: 'equals', value: 'accepted' }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    expired: {
      type: 'grid',
      name: 'expired',
      label: 'Expired / Canceled',
      data: { provider: 'object', object: 'sys_invitation' },
      columns: ['email', 'status', 'organization_id', 'expires_at'],
      filter: [{ field: 'status', operator: 'in', value: ['expired', 'rejected', 'canceled'] }],
      sort: [{ field: 'expires_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    all_invitations: {
      type: 'grid',
      name: 'all_invitations',
      label: 'All',
      data: { provider: 'object', object: 'sys_invitation' },
      columns: ['email', 'status', 'role', 'organization_id', 'inviter_id', 'created_at'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
  },
  
  fields: {
    id: Field.text({
      label: 'Invitation ID',
      required: true,
      readonly: true,
    }),
    
    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
    }),
    
    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      // Optional: single-tenant has no sys_organization row and no auto-stamp
      // (org-scoping is multi-tenant-only). Multi-tenant: OrgScopingPlugin stamps it
      // and tenant-isolation RLS hides null-org rows (fail-closed). ADR-0057 addendum.
      required: false,
    }),
    
    email: Field.email({
      label: 'Email',
      required: true,
      description: 'Email address of the invited user',
    }),
    
    // [ADR-0108 / #3723] Same list as `sys_member.role`, from the same
    // constant — this is the value that lands there on acceptance, so the two
    // can never be allowed to drift. The vocabulary is CLOSED: an app's own
    // business roles are positions, carried by this invitation's `positions`
    // placement field (ADR-0105 D8), which is authorized against the issuer's
    // `adminScope` instead of riding in un-gated on the role name.
    role: Field.select({
      label: 'Role',
      required: false,
      description: 'Role to assign upon acceptance',
      options: [...BUILTIN_MEMBERSHIP_ROLE_OPTIONS],
      defaultValue: MEMBERSHIP_ROLE_MEMBER,
    }),
    
    // [#7726] Same list as the spec's `InvitationStatus`, from that enum — the
    // two definitions of this vocabulary had already drifted once (the object
    // shipped `canceled`, which better-auth writes on cancel-invitation, while
    // the enum stopped at four values and so rejected a canceled row). Reading
    // the options from the enum makes a repeat impossible rather than merely
    // discouraged; `sys-invitation.status-vocabulary.test.ts` pins the rest.
    status: Field.select([...InvitationStatus.options], {
      label: 'Status',
      required: true,
      defaultValue: 'pending',
    }),
    
    inviter_id: Field.lookup('sys_user', {
      label: 'Inviter',
      required: true,
      description: 'User who sent the invitation',
    }),
    
    expires_at: Field.datetime({
      label: 'Expires At',
      required: true,
    }),
    
    team_id: Field.lookup('sys_team', {
      label: 'Team',
      required: false,
      description: 'Optional team to assign upon acceptance',
    }),

    // ── [ADR-0105 D8] Placement intent (ObjectStack extension fields) ──
    // Carried on the invitation and applied WITH the better-auth membership
    // on acceptance, so a delegated (plant) admin's invitee arrives already
    // in the right unit and role instead of waiting on a platform admin.
    // Issuance is authorized against the issuer's `adminScope` (ADR-0090
    // D12) by the `invitation-placement` service — an invitation can never
    // place what its issuer could not have assigned directly.
    business_unit_id: Field.lookup('sys_business_unit', {
      label: 'Placement Business Unit',
      required: false,
      description:
        'Business unit the invitee is placed under on acceptance (ADR-0105 D8). Must lie inside the issuer\'s delegated subtree.',
    }),

    positions: Field.json({
      label: 'Placement Positions',
      required: false,
      description:
        'sys_position names assigned on acceptance (ADR-0105 D8). Every position\'s permission sets must be allowlisted by the issuer\'s adminScope.',
    }),
  },
  
  indexes: [
    { fields: ['organization_id'] },
    { fields: ['email'] },
    { fields: ['expires_at'] },
  ],
  
  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // #1591 — reads only: writes are refused by the identity write guard
    // (ADR-0092 D2) and owned by better-auth. HTTP answers 405 before the 403.
    apiMethods: ['get', 'list'],
  },
});
