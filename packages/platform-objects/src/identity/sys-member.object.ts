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
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema,
  // but may add overlay row-level config. Use `no-overlay` if you need to
  // forbid sys_metadata overlays entirely.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
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
    // Transfer ownership is modeled as `update-member-role` with role=owner
    // (better-auth's organization plugin auto-demotes the previous owner
    // to admin). Kept as a separate action so the row menu can present a
    // distinct destructive-style affordance with the right confirm copy —
    // mixing it into `update_member_role` would hide the ownership-handoff
    // semantics behind a generic role dropdown.
    {
      name: 'transfer_ownership',
      label: 'Transfer Ownership',
      icon: 'crown',
      variant: 'danger',
      mode: 'custom',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/update-member-role',
      recordIdParam: 'memberId',
      bodyExtra: { role: 'owner' },
      visible: "record.role != 'owner'",
      confirmText: 'Transfer ownership of this organization to the selected member? You will be demoted to admin and lose owner-only privileges.',
      successMessage: 'Ownership transferred',
      refreshAfter: true,
    },
  ],

  listViews: {
    mine: {
      type: 'grid',
      name: 'mine',
      label: 'My Memberships',
      data: { provider: 'object', object: 'sys_member' },
      columns: ['organization_id', 'role', 'created_at'],
      filter: [{ field: 'user_id', operator: 'equals', value: '{current_user_id}' }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
      emptyState: {
        title: 'No organizations yet',
        message: 'You haven\'t joined any organizations.',
      },
    },
  },

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
      // Optional: single-tenant has no sys_organization row and no auto-stamp
      // (org-scoping is multi-tenant-only). Multi-tenant: OrgScopingPlugin stamps it
      // and tenant-isolation RLS hides null-org rows (fail-closed). ADR-0057 addendum.
      required: false,
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
