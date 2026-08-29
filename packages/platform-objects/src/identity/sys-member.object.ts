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
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
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
  //
  // The toolbar carries the TWO ways a teammate arrives, in the order an
  // admin wants them: `invite_user` sends an email invitation (the common
  // case), `add_member` attaches an ALREADY-REGISTERED user directly.
  actions: [
    {
      // THIRD mirror of `invite_user` (sys_user, sys_invitation are the other
      // two — keep all three consistent). It is here because the org record
      // page (ADR-0081) opens on tab-0 **Members**, and the email-invite entry
      // used to live only on tab-1 Invitations: an admin looking to "invite a
      // teammate by email" landed on Members, saw only "Add Member" (attach an
      // existing user by id), and concluded the product had no invite entry.
      // Declaration order is render order — the related-list toolbar bridge
      // maps the child object's `list_toolbar` actions in array order
      // (objectui `RelatedRecordActionsBridge.deriveActions` →
      // `RelatedList`), so this sits left of `add_member`.
      //
      // ⚠️ `email` is NOT a field of sys_member, so unlike the sys_invitation
      // copy this param MUST name its owner via `objectOverride`. Without it
      // the field-backed param is unresolvable and objectui's
      // `resolveActionParam` falls back to `type: 'text'` with the raw field
      // name as its label — a dialog that still submits, but loses the email
      // value shape and the i18n label, with nothing red anywhere (ADR-0078
      // valid-but-inert metadata). Same device as sys_user's own copy, which
      // reaches for `sys_member` for the `role` half. `role` needs no override
      // here: sys_member declares it, from the same
      // BUILTIN_MEMBERSHIP_ROLE_OPTIONS constant sys_invitation reads.
      name: 'invite_user',
      label: 'Invite User',
      icon: 'user-plus',
      variant: 'primary',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/organization/invite-member',
      // Same gate as the other two mirrors — the org CAPABILITY, not
      // multi-org (ADR-0093 D9: single-org sessions carry an active org
      // via plugin-auth's default-org bootstrap).
      requiresFeature: 'organization',
      successMessage: 'Invitation sent',
      refreshAfter: true,
      params: [
        { field: 'email', objectOverride: 'sys_invitation', required: true },
        { field: 'role', required: true },
      ],
    },
    {
      // Admin-only: directly attach an existing user to the active org,
      // bypassing the invite-accept flow. Better-auth:
      // `organization/add-member { userId, role, organizationId?, teamId? }`.
      // The two optional fields are NOT symmetric. `organizationId` defaults
      // to the caller's active organization when omitted; `teamId` has no such
      // fallback — omit it and the member simply joins no team. Measured on the
      // installed better-auth 1.7.1
      // (`dist/plugins/organization/routes/crud-members.mjs`, `addMember`):
      // `ctx.body.organizationId || session?.session.activeOrganizationId`
      // against `"teamId" in ctx.body ? ctx.body.teamId : void 0`, and no
      // `activeTeamId` read anywhere in that file. So `organizationId` is
      // carried as an optional param below and `teamId` is not a param at all
      // — this action never sends it, so it never exercises the team half.
      // Pinned against a vendor bump that ADDS the fallback by
      // plugin-auth's `organization-add-member-team-fallback.test.ts`.
      //
      // Chrome DIFFERENTIATED from the `invite_user` sibling above, which used
      // to be a byte-identical `primary` + `user-plus` pair — the visual half
      // of the discoverability defect. Both halves are honoured by the
      // related-list toolbar renderer, so neither is decoration:
      //  - `variant: 'secondary'` — objectui's `RelatedToolbarButton` maps
      //    `primary` to a FILLED button and every other variant to an
      //    `outline` one, so the invite entry reads as the primary path and
      //    this one as the secondary. (That mapping is also why `secondary`
      //    and `ghost` are indistinguishable HERE; the choice is `secondary`
      //    because it is what the button means, not what this surface draws.)
      //  - `icon: 'link-2'` — "attach an EXISTING record", the same icon
      //    sys_account's `link_social` uses for attaching an existing external
      //    identity. `user-plus` is reserved for the flows that bring a NEW
      //    person in.
      // The LABEL is deliberately left alone: "Add Member" and "Invite User"
      // already differ, and the four translation bundles' hand-written values
      // fill only gaps — a renamed source label would leave three locales
      // reading the old text under a green gate.
      name: 'add_member',
      label: 'Add Member',
      icon: 'link-2',
      variant: 'secondary',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/organization/add-member',
      // Gated on the org CAPABILITY, not multi-org (ADR-0093 D9): the
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
      // `has()` guards the SPARSE action face (#8990): this is a `list_item`
      // action, so a member list that does not project `role` would abort the
      // predicate at key resolution and drop the button silently. `has()`
      // alone — the operand is a bare equality against a literal (see
      // `materializeDeclaredFields` in `@objectstack/objectql`).
      visible: "has(record.role) && record.role != 'owner'",
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
      // hook registered on `sys_member` itself (cloud ADR-0024 D5.2,
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
