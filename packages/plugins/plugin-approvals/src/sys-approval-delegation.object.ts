// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { F, P } from '@objectstack/spec';

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
 * `organization_id` is the organization the delegation belongs to: it
 * reroutes only the approvals opened in that organization, and an
 * organization-less row reroutes none (ADR-0131 D1;
 * `ApprovalService.lookupActiveDelegation`).
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
  // [ADR-0103, #3355] Admin/user-writable DATA on a platform-defined schema: a
  // user authors their own out-of-office delegation. The bucket default is full
  // CRUD (matching the full-CRUD apiMethods below), so no `userActions` block is
  // needed — RLS/permission sets are the authz.
  managedBy: 'system-data',
  // The sentence Setup shows under the "Delegations (OOO)" title. It says
  // "assigned to them personally" because only individually-routed approvers
  // (`user` / `field` / `manager`) are rerouted; team, department, position and
  // membership-level approvers are not (`ApprovalService.expandApprovers`).
  description: 'While someone is away, approvals assigned to them personally go to their delegate.',
  // [ADR-0079] The record title is `display_title`, a text formula over the
  // same two columns `titleFormat` named. With no pointer declared, the
  // registry's designate-only pass stamped `nameField: 'id'` (the first
  // title-eligible field), so a renderer honouring ADR-0079's order (an
  // explicit `nameField` wins over `titleFormat`) drew the raw id as the record
  // page's H1. The retired `titleFormat` template beside it is gone (refused at
  // save and by `os validate`); `sys-approval-delegation-display-title.test.ts`
  // holds the formula to the text that template drew.
  displayNameField: 'display_title',
  nameField: 'display_title', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
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

    // [ADR-0079] The record title (`nameField` above). A formula is computed on
    // read and has no stored column. Both source columns are required, so the
    // expression needs no null guard.
    display_title: Field.formula({
      label: 'Title',
      returnType: 'text',
      expression: F`record.delegator_id + ' → ' + record.delegate_id`,
      description: 'Record title: the delegator and the delegate (computed on read)',
      group: 'Delegation',
    }),

    // A delegation names its own author as delegator: on every non-system
    // write `bindDelegationWriteGuard` (lifecycle-hooks.ts) admits exactly one
    // value here, the acting user, and refuses any other with 403 (its
    // docstring holds why there is no admin exemption). So the picker offers
    // that one value, instead of every user with all but one refused:
    // `lookupFilters` is the picker's candidate query, and the engine resolves
    // `{current_user_id}` against the caller on every read. Presentation only
    // — the guard stays the enforcement, and what a write may store is
    // unchanged. Since that one value is always the acting user, the field
    // also defaults to it: `defaultValue: 'current_user'` is the spec's
    // runtime token for a `sys_user` lookup (`DEFAULT_VALUE_TOKENS`), so a new
    // delegation opens with the Delegator already filled instead of at an
    // empty picker. Pinned in `sys-approval-delegation-delegator-picker.test.ts`.
    delegator_id: Field.lookup('sys_user', {
      label: 'Delegator',
      required: true,
      defaultValue: 'current_user',
      lookupFilters: [{ field: 'id', operator: 'eq', value: '{current_user_id}' }],
      group: 'Delegation',
      description:
        'The user going out of office. You can delegate only your own approvals, so this is always you: '
        + 'it starts as you and offers no one else. Their individually-routed approver slots are rerouted while active.',
    }),

    delegate_id: Field.lookup('sys_user', {
      label: 'Delegate',
      required: true,
      group: 'Delegation',
      description: 'The backup who receives the delegator\'s approvals while this rule is active. Acts under their own identity.',
    }),

    // [ADR-0091 D2] `isGrantActive` is the shared validity predicate.
    valid_from: Field.datetime({
      label: 'Valid From',
      required: false,
      group: 'Delegation',
      description:
        'Rule is inactive before this instant. Null = active immediately. ' +
        'Checked each time an approval is routed, so the rule starts on time without any scheduled job.',
    }),

    valid_until: Field.datetime({
      label: 'Valid Until',
      required: false,
      group: 'Delegation',
      description:
        'The rule stops applying at this time (UTC). Leave empty for no end date.',
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
      description: 'The organization this delegation belongs to. It reroutes only the approvals opened in this organization.',
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

  // Two shapes the resolver can store but never applies: a window that ends at
  // or before it starts (`isGrantActive` drops it at every routing), and a
  // delegate who is the delegator (rerouting a slot onto the same person moves
  // nothing). Both used to land 201 and then do nothing, so the delegator
  // believed their approvals were covered. Refused at the write instead.
  //
  // Declared, not a hook: the engine evaluates an object's validation rules on
  // every write path — insert (single and batch) and update (by id, and per
  // matched row of a multi-row update), for system and non-system writers
  // alike — against the stored row overlaid with the patch, AFTER the
  // `beforeInsert` hooks, so a delegator the write guard stamps
  // (`bindDelegationWriteGuard`) is judged too.
  //
  // ⛔ A declared rule is an INVARIANT by default: it would refuse ANY edit to a
  // row that already violates. The `previous` clause narrows each rule to the
  // writes that make the shape — an insert (`previous` is null there), or an
  // update that moves one of the two columns it compares. A row stored before
  // these rules existed stays inert and keeps taking unrelated edits; the write
  // that repairs it is the only one that has to state a valid value.
  //
  // `datetime()` compares instants, not spellings. `cross_field` so each
  // violation attaches to the first field it lists, where a form shows it.
  // Same rule shape as `sys_user_permission_set.validity_window_order`.
  validations: [
    {
      type: 'cross_field',
      name: 'validity_window_order',
      label: 'Delegation window ends after it starts',
      // [ADR-0091 D1/D2] The validity window `isGrantActive` judges.
      description:
        'A delegation applies from valid_from up to, but not including, valid_until, so a window that '
        + 'ends at or before it starts never reroutes an approval. Judged on insert, and on an update that moves a bound.',
      fields: ['valid_until', 'valid_from'],
      condition: P`(previous == null || record.valid_from != previous.valid_from || record.valid_until != previous.valid_until) && record.valid_from != null && record.valid_until != null && datetime(record.valid_until) <= datetime(record.valid_from)`,
      severity: 'error',
      message:
        'Valid Until must be later than Valid From. The delegation applies from Valid From up to, but not including, '
        + 'Valid Until, so a window that ends at or before it starts never reroutes an approval. Leave either one empty for an open-ended window.',
    },
    {
      type: 'cross_field',
      name: 'delegate_not_delegator',
      label: 'Delegate is someone other than the delegator',
      description:
        'A delegation hands the delegator\'s approvals to another user, so a delegate who is the delegator '
        + 'never reroutes an approval. Judged on insert, and on an update that changes either user.',
      fields: ['delegate_id', 'delegator_id'],
      condition: P`(previous == null || record.delegate_id != previous.delegate_id || record.delegator_id != previous.delegator_id) && record.delegate_id != null && record.delegate_id == record.delegator_id`,
      severity: 'error',
      message:
        'Delegate must be someone other than the Delegator. A delegation hands your approvals to another user while '
        + 'you are away, so naming yourself as the delegate never reroutes an approval.',
    },
  ],

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
    // `bulk` = the batch shape of the verbs above; the gate is `bulk ∧ child`
    // (#3391 P1), so omitting it 405s /batch and the *Many routes (#3026).
    apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk'],
  },
});
