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
      required: true,
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
