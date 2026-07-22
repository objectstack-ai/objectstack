// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_approval_delegation — self-service out-of-office (OOO) delegation (#1322 M1).
 *
 * A standing, self-declared rule: "while I (the delegator) am out between
 * `valid_from` and `valid_until`, route the approver slots that would resolve
 * to me onto my delegate instead." The approval service consults active rows
 * in `ApprovalService.expandApprovers` when resolving an approval node's
 * INDIVIDUALLY-routed approvers (`type: user` / `field` / `manager`) — the
 * delegate becomes a real pending approver and acts under their own identity,
 * so nothing is impersonated and the audit trail stays honest.
 *
 * Modelled as its own object (not a scalar on the better-auth-locked
 * `sys_user`), mirroring the `sys_user_position` delegation precedent
 * (ADR-0091): the validity window is enforced at RESOLUTION time via the
 * shared `isGrantActive` predicate — never by a background job (ADR-0049).
 * The window is half-open `[valid_from, valid_until)` in UTC.
 *
 * Scope note: this is the community-core OOO auto-skip only. Long-term proxy
 * "act-as" access (viewing/acting on another user's full queue under their
 * authority), delegation governance / segregation-of-duties, and org-wide
 * administration of others' delegations are enterprise concerns tracked
 * separately (objectstack-ai/cloud#855), not here.
 *
 * @namespace sys
 */
export const SysApprovalDelegation = ObjectSchema.create({
  name: 'sys_approval_delegation',
  label: 'Approval Delegation',
  pluralLabel: 'Approval Delegations',
  icon: 'user-clock',
  isSystem: true,
  managedBy: 'system',
  // [ADR-0103] Admin/user-writable DATA on a platform-defined schema: a user
  // authors their own out-of-office delegation. Affordance only (matches the
  // full-CRUD apiMethods below) — RLS/permission sets are the authz; opening it
  // keeps the system write guard from rejecting the self-service write.
  userActions: { create: true, edit: true, delete: true },
  description:
    'Self-service out-of-office rule: route this user\'s approver slots to a delegate within a time window (#1322 M1).',
  titleFormat: '{delegator_id} → {delegate_id}',
  highlightFields: ['delegator_id', 'delegate_id', 'valid_from', 'valid_until'],

  listViews: {
    active: {
      type: 'grid',
      name: 'active',
      label: 'Active',
      data: { provider: 'object', object: 'sys_approval_delegation' },
      columns: ['delegator_id', 'delegate_id', 'valid_from', 'valid_until', 'reason'],
      sort: [{ field: 'valid_until', order: 'asc' }],
      pagination: { pageSize: 50 },
      emptyState: {
        title: 'No delegations',
        message: 'Declare an out-of-office delegation so approvals route to a backup while you are away.',
      },
    },
  },

  fields: {
    id: Field.text({ label: 'Delegation ID', required: true, readonly: true, group: 'System' }),

    delegator_id: Field.lookup('sys_user', {
      label: 'Delegator',
      required: true,
      group: 'Delegation',
      description: 'The user going out of office; their individually-routed approver slots are rerouted while active.',
    }),

    delegate_id: Field.lookup('sys_user', {
      label: 'Delegate',
      required: true,
      group: 'Delegation',
      description: 'The backup who receives the delegator\'s approvals while this rule is active. Acts under their own identity.',
    }),

    valid_from: Field.datetime({
      label: 'Valid From',
      required: false,
      group: 'Delegation',
      description:
        'Rule is inactive before this instant. Null = active immediately. ' +
        'Enforced at resolution time via isGrantActive (ADR-0091 D2 predicate) — never by a background job.',
    }),

    valid_until: Field.datetime({
      label: 'Valid Until',
      required: false,
      group: 'Delegation',
      description:
        'Rule is inactive AT and AFTER this instant (half-open [from, until), UTC). Null = never expires.',
    }),

    reason: Field.text({
      label: 'Reason',
      required: false,
      maxLength: 500,
      group: 'Delegation',
      description: 'Why the delegation exists (e.g. "Annual leave 5/26–5/30"). Recorded on the substitution audit row.',
    }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      group: 'System',
      description: 'Tenant that owns this rule; null = applies across tenants for this delegator.',
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
    // Resolution-time lookup: "active delegations for this delegator".
    { fields: ['delegator_id', 'organization_id'] },
    { fields: ['delegate_id'] },
    { fields: ['valid_until'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
  },
});
