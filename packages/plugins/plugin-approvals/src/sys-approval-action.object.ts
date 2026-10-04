// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { F } from '@objectstack/spec';
import { APPROVAL_ACTION_KINDS, APPROVAL_ACTION_KIND_LABELS } from '@objectstack/spec/contracts';

/**
 * sys_approval_action — Audit trail row per approval action.
 *
 * Append-only: every `submit`, `approve`, `reject`, `recall`, or
 * `escalate` event lands here. The engine reads back per-step approval
 * rows to evaluate `behavior: 'unanimous'` (all approvers must approve
 * before advancing) versus `first_response` (any single approval
 * advances the step).
 *
 * @namespace sys
 */
export const SysApprovalAction = ObjectSchema.create({
  name: 'sys_approval_action',
  label: 'Approval Action',
  pluralLabel: 'Approval Actions',
  icon: 'check-circle',
  isSystem: true,
  managedBy: 'append-only',
  description: 'Append-only audit trail for approval actions',
  // [ADR-0079] The record title is `display_title`, a text formula over the
  // same two columns `titleFormat` names. The pointer used to be `id`: once a
  // renderer honours ADR-0079's order (an explicit `nameField` wins over
  // `titleFormat`), that made the record page's H1 the raw id. `titleFormat`
  // stays for renderers that still read it first;
  // `sys-approval-display-title.test.ts` holds the two to the same text.
  displayNameField: 'display_title',
  nameField: 'display_title', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{action} · {step_name}',
  highlightFields: ['request_id', 'step_name', 'action', 'actor_id', 'acted_as', 'via_override', 'created_at'],

  // ADR-0104 D3 wave 2. `attachments` is a media field, so the files it holds
  // are OWNED by this row — and the storage service would otherwise authorize
  // their download by testing whether the caller can READ this row. It cannot:
  // this table is deliberately closed to ordinary approver positions, so that
  // test denies the very approver the attachment was filed for. The approvals
  // service already owns the rule for seeing a decision (visibility of the
  // parent request, exactly as `listActions` applies it), so it answers.
  fileAccessDelegate: 'approvals',

  listViews: {
    recent: {
      type: 'grid',
      name: 'recent',
      label: 'Recent',
      data: { provider: 'object', object: 'sys_approval_action' },
      columns: ['created_at', 'request_id', 'step_name', 'action', 'actor_id', 'acted_as', 'via_override', 'comment'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
      emptyState: { title: 'No approval actions yet', message: 'Actions are logged automatically when approvals progress.' },
    },
    by_actor: {
      type: 'grid',
      name: 'by_actor',
      label: 'By Actor',
      data: { provider: 'object', object: 'sys_approval_action' },
      columns: ['actor_id', 'created_at', 'request_id', 'step_name', 'action'],
      sort: [{ field: 'actor_id', order: 'asc' }, { field: 'created_at', order: 'desc' }],
      grouping: { fields: [{ field: 'actor_id', order: 'asc', collapsed: false }] },
      pagination: { pageSize: 100 },
    },
    all_actions: {
      type: 'grid',
      name: 'all_actions',
      label: 'All',
      data: { provider: 'object', object: 'sys_approval_action' },
      columns: ['created_at', 'request_id', 'step_name', 'action', 'actor_id', 'acted_as', 'via_override', 'comment'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 100 },
    },
  },

  fields: {
    id: Field.text({ label: 'Action ID', required: true, readonly: true, group: 'System' }),

    // [ADR-0079] The record title (`nameField` above). A formula is computed on
    // read and has no stored column. `step_name` is nullable, so a row without
    // one is titled by its action alone rather than failing to evaluate.
    display_title: Field.formula({
      label: 'Title',
      returnType: 'text',
      expression: F`record.step_name != null ? record.action + ' · ' + record.step_name : record.action`,
      description: 'Record title: the action and, when recorded, its step (computed on read)',
      group: 'Action',
    }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      group: 'System',
      description: 'Tenant that owns this action (mirrors the parent request)',
    }),

    request_id: Field.lookup('sys_approval_request', {
      label: 'Request',
      required: true,
      group: 'Target',
    }),

    step_name: Field.text({
      label: 'Step',
      required: false,
      maxLength: 100,
      description: 'Machine name of the step at the time of the action',
      group: 'Target',
    }),

    step_index: Field.number({
      label: 'Step Index',
      required: false,
      group: 'Target',
    }),

    action: Field.select(
      // Derived from the contract, not re-typed (#3786). `APPROVAL_ACTION_KINDS`
      // is where the list and the per-kind notes live (which kinds move the flow
      // and which are thread-only); `ApprovalActionKind` is derived from it, so
      // this column and the contract cannot disagree. The authored English label
      // per kind lives beside it in `APPROVAL_ACTION_KIND_LABELS` (#8580 — the
      // #7232 humanization pass missed this field) — mapped here, never
      // re-typed, so the `en` bundle regenerates from the contract's own text.
      APPROVAL_ACTION_KINDS.map((value) => ({ value, label: APPROVAL_ACTION_KIND_LABELS[value] })),
      {
        label: 'Action',
        required: true,
        group: 'Action',
      },
    ),

    // [ADR-0118 D1] The PERSON who took the action — a `sys_user` id or
    // nothing, never a slot literal or a sentinel. The slot the action was
    // admitted under is a separate fact and lives in `acted_as` below: one
    // holder of a position acts for it, one person can hold several slots, and
    // a slot recorded HERE (as it once was) left the decider on no column at
    // all, and dropped the row from every join on this lookup. Empty means no
    // person is recorded: a system-initiated action — the SLA sweep's
    // `escalate` and the auto-decision after it, the dead-run sweep's `recall`;
    // a machine has no `sys_user` id, and what it did is the row's kind — or,
    // with `acted_as` set, a decision recorded before the person was captured,
    // whose decider no stored record names. The boot-time `backfillActionSlots`
    // moved such a slot out of this column rather than guess a person, and
    // nulls the machine sentinels earlier writers stored here.
    actor_id: Field.lookup('sys_user', {
      label: 'Actor',
      required: false,
      group: 'Action',
      description:
        'The user who took this action. Empty when no person is recorded: a system-initiated action, or a '
        + 'decision recorded before the deciding user was captured, which still shows the slot it was taken '
        + 'as.',
    }),

    // The pending-approver slot the action was taken AS — the slot's address in
    // its stored spelling, exactly as it stood in `pending_approvers` when the
    // action was admitted: a user id, an email, or a `type:value` literal such
    // as `position:<name>`. `ApprovalActionRow.acted_as` is the contract's
    // reading of this column.
    //
    // It is never a person (that is `actor_id`), and it is what every
    // slot-against-slate comparison reads: the multi-approver tally,
    // `decision_progress`, and the slot half of the already-acted probe. ⛔ No
    // reader falls back to `actor_id` for a slot.
    //
    // Empty on an action no slot admitted — the submitter's own actions, a
    // system action, an admin override (`via_override`) — and on a row written
    // before this column whose slot could not be recovered without guessing.
    acted_as: Field.text({
      label: 'Acted As',
      required: false,
      maxLength: 255,
      group: 'Action',
      description:
        'The pending-approver slot this action was taken as, in the slot’s stored spelling: a user id, an '
        + 'email, or a position address. Empty when no slot admitted the action, such as the submitter’s own '
        + 'actions, system actions and admin overrides.',
    }),

    comment: Field.textarea({ label: 'Comment', required: false, group: 'Action' }),

    // #4466 — the one bit of "who really decided this" that was still dropped.
    // A privileged admin may act on a request whose staffed approver slate they
    // hold no slot in (the #3424 override path); before this column, that
    // decision was byte-for-byte identical to the designated approver's own
    // approval. A reader of the timeline saw `approve` by the admin and could
    // not tell whether the admin WAS an approver or OVERRODE the ones who were,
    // and the bypassed approver's later `409 INVALID_STATE` was the only trace
    // — existing only if they happened to try.
    //
    // The platform KNOWS at decision time: it took the `isOverrideActor` branch
    // to admit the call at all. This is dropped information, not unavailable
    // information.
    //
    // Set on exactly the decisions that were admitted BY that branch — an admin
    // who is also a genuine slot holder is approving normally and is recorded
    // as such. Nullable and additive: rows written before this column exists
    // carry `null`, which reads as "not recorded", never as "not an override".
    via_override: Field.boolean({
      label: 'Via Admin Override',
      required: false,
      group: 'Action',
      description:
        'True when the actor held no slot in the request’s pending-approver slate and was admitted to '
        + 'this action only by the privileged override, which lets a platform or organization admin act '
        + 'on any pending request so that one nobody in its slate can decide never stays stuck.',
    }),

    // Structured hand-off parties for `action: 'reassign'` (#4365). Before
    // these existed the pair lived only inside a default free-text comment
    // ("<from_id> → <to_id>"), which no client could parse or render readably.
    // `comment` is pure user input again; timelines render "from A to B" from
    // these fields.
    //
    // [ADR-0118 D1] A reassignment moves a pending-approver SLOT, not
    // necessarily a person, so both hold the slot's ADDRESS in its stored
    // spelling — a user id, an email, or a `type:value` literal such as
    // `position:<name>` — the same kind of column as `acted_as`, and for the
    // same reason. As `sys_user` lookups they held addresses no join could
    // resolve, and dropped those rows from every report on them. The person who
    // made the move is `actor_id`.
    reassign_from: Field.text({
      label: 'Reassigned From',
      required: false,
      maxLength: 255,
      group: 'Action',
      description:
        'The pending-approver slot that was handed over, in the slot’s stored spelling: a user id, an email, '
        + 'or a position address (reassign actions only).',
    }),

    reassign_to: Field.text({
      label: 'Reassigned To',
      required: false,
      maxLength: 255,
      group: 'Action',
      description:
        'The pending-approver address the slot was handed to, in its stored spelling: a user id, an email, '
        + 'or a position address (reassign actions only).',
    }),

    attachments: Field.file({
      label: 'Attachments',
      required: false,
      multiple: true,
      group: 'Action',
      description: 'Files supporting this action — e.g. a signed contract or evidence.',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['request_id', 'created_at'] },
    { fields: ['request_id', 'step_index', 'action'] },
  ],

  enable: {
    // [ADR-0103] Engine-owned append-only decision log: appended by the approval
    // engine (SYSTEM_CTX). Reads stay open.
    apiMethods: ['get', 'list'],
  },
});
