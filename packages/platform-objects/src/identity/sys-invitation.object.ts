// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

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
  titleFormat: 'Invitation to {organization_id}',
  compactLayout: ['email', 'organization_id', 'status'],

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
    
    role: Field.select({
      label: 'Role',
      required: false,
      description: 'Role to assign upon acceptance',
      options: [
        { label: 'Owner', value: 'owner' },
        { label: 'Admin', value: 'admin' },
        { label: 'Member', value: 'member' },
      ],
      defaultValue: 'member',
    }),
    
    status: Field.select(['pending', 'accepted', 'rejected', 'expired', 'canceled'], {
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
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
    trash: false,
    mru: false,
  },
});
