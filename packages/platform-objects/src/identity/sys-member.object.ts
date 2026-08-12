// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { BUILTIN_MEMBERSHIP_ROLE_OPTIONS, MEMBERSHIP_ROLE_MEMBER } from '@objectstack/spec/identity';

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
  // Org-independent title: organization_id is null in single-org mode, so a
  // '{user_id} in {organization_id}' format renders "… in null". User + role
  // identifies the membership in both single- and multi-org deployments.
  titleFormat: '{user_id} ({role})',
  highlightFields: ['user_id', 'organization_id', 'role'],

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
      // Gated on the org CAPABILITY, not multi-org (ADR-0081 D1): the
      // better-auth endpoints resolve the session's active org, which
      // single-org mode now guarantees via plugin-auth's default-org
      // bootstrap. Same gate on every membership mutation below.
      requiresFeature: 'organization',
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
      requiresFeature: 'organization',
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
      requiresFeature: 'organization',
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
      // The residual row predicate stays hand-written; the feature gate is
      // AND-composed onto it by the requiresFeature lowering.
      visible: "record.role != 'owner'",
      requiresFeature: 'organization',
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
      // [#7724] A membership without its user is meaningless, so deleting the
      // user takes its memberships with it. This must be DECLARED: a `lookup`
      // defaults to `set_null`, and the engine escalates a *defaulted*
      // `set_null` on a REQUIRED foreign key to `restrict` (you cannot null a
      // NOT NULL column). That escalation vetoed every `sys_user` delete on any
      // deployment where the membership reconciler had run — i.e. all of them,
      // since `reconcile-membership.ts` binds every user to the default org at
      // sign-up, and (since #7796) invitation acceptance ADOPTS that same row.
      // So `/admin/remove-user` could never succeed, and the operator could not
      // clear the blocker by hand either: `enable.apiMethods` below is read-only.
      //
      // Audited before declaring it, because the engine's own error naming
      // `deleteBehavior:'cascade'` is a suggestion, not an audit: nothing
      // depends on the restrict. In particular it is NOT an accidental
      // last-administrator guard — that invariant is enforced by a `beforeDelete`
      // hook registered on `sys_member` itself (ADR-0024 D5.2,
      // `last-admin-guard.ts`), and the engine's cascade recurses through the
      // PUBLIC `delete()` precisely so the child's own hooks and events fire.
      // The guard therefore still refuses a cascade that would take the last
      // administrator's standing away; it simply refuses it one row deeper.
      deleteBehavior: 'cascade',
    }),
    
    // [ADR-0108 / #3723] The framework's four roles — the WHOLE list. Nothing
    // widens it at boot, and an app's business roles do not belong here: this
    // column is ORGANIZATION GRADE, and every value in it is projected into
    // `current_user.positions`, so a name added here is capability granted
    // with none of ADR-0090 D12's controls. Capability = `position`
    // (ADR-0090 D3); one-step admission = an invitation carrying placement
    // (ADR-0105 D8).
    //
    // This select is ENFORCED on write: better-auth's own accept-invitation
    // membership insert is validated like any other row (system context does
    // not exempt it), so the closed list is the write-side guardrail, not a
    // limitation to work around. `delegated_admin` (ADR-0105 D8 / #3697) is in
    // the list because it is a GRADE — what you may reach — not a capability.
    role: Field.select({
      label: 'Role',
      required: false,
      description: 'Member role within the organization',
      options: [...BUILTIN_MEMBERSHIP_ROLE_OPTIONS],
      defaultValue: MEMBERSHIP_ROLE_MEMBER,
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
    // #1591 — reads only: writes are refused by the identity write guard
    // (ADR-0092 D2) and owned by better-auth. HTTP answers 405 before the 403.
    apiMethods: ['get', 'list'],
  },
});
