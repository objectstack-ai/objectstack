// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_member — System Member Object
 *
 * Organization membership linking users to organizations with roles.
 * Backed by better-auth's organization plugin.
 *
 * @namespace sys
 */
export const SysMember = ObjectSchema.create({
  name: 'sys_member',
  label: 'Member',
  pluralLabel: 'Members',
  icon: 'user-check',
  isSystem: true,
  managedBy: 'better-auth',
  description: 'Organization membership records',
  titleFormat: '{user_id} in {organization_id}',
  compactLayout: ['user_id', 'organization_id', 'role'],

  // Row-level actions: better-auth `organization/update-member-role` and
  // `organization/remove-member`. Generic CRUD is suppressed on better-auth
  // managed tables, so these are the canonical edit/delete entry points.
  // The `add_member` toolbar action covers the admin "attach an existing
  // user directly without sending an invitation" flow.
  actions: [
    {
      // Admin-only: directly attach an existing user to the active org,
      // bypassing the invite-accept flow. Better-auth:
      // `organization/add-member { userId, role, organizationId?, teamId? }`.
      // organizationId/teamId default to the caller's active org/team when
      // omitted, so we leave them as optional params.
      name: 'add_member',
      label: 'Add Member',
      icon: 'user-plus',
      variant: 'primary',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/organization/add-member',
      successMessage: 'Member added',
      refreshAfter: true,
      params: [
        { name: 'userId', field: 'user_id', required: true },
        { field: 'role', required: true },
        { name: 'organizationId', field: 'organization_id' },
      ],
    },
    {
      name: 'update_member_role',
      label: 'Change Role',
      icon: 'shield',
      mode: 'edit',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/update-member-role',
      recordIdParam: 'memberId',
      successMessage: 'Member role updated',
      refreshAfter: true,
      params: [
        { field: 'role', required: true, defaultFromRow: true },
      ],
    },
    {
      name: 'remove_member',
      label: 'Remove Member',
      icon: 'user-minus',
      variant: 'danger',
      mode: 'delete',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/remove-member',
      recordIdParam: 'memberIdOrEmail',
      confirmText: 'Remove this member from the organization? They will lose access to all org resources.',
      successMessage: 'Member removed',
      refreshAfter: true,
    },
  ],

  fields: {
    id: Field.text({
      label: 'Member ID',
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
    
    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: true,
    }),
    
    role: Field.select({
      label: 'Role',
      required: false,
      description: 'Member role within the organization',
      options: [
        { label: 'Owner', value: 'owner' },
        { label: 'Admin', value: 'admin' },
        { label: 'Member', value: 'member' },
      ],
      defaultValue: 'member',
    }),
  },
  
  indexes: [
    { fields: ['organization_id', 'user_id'], unique: true },
    { fields: ['user_id'] },
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
