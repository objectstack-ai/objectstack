// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
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
  displayNameField: 'id',
  nameField: 'id', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{action} · {step_name}',
  highlightFields: ['request_id', 'step_name', 'action', 'actor_id', 'via_override', 'created_at'],

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
      columns: ['created_at', 'request_id', 'step_name', 'action', 'actor_id', 'via_override', 'comment'],
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
      columns: ['created_at', 'request_id', 'step_name', 'action', 'actor_id', 'via_override', 'comment'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 100 },
    },
  },

  fields: {
    id: Field.text({ label: 'Action ID', required: true, readonly: true, group: 'System' }),

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

    actor_id: Field.lookup('sys_user', {
      label: 'Actor',
      required: false,
      group: 'Action',
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
        'True when the actor was admitted to this action only by the privileged-override path (#3424) — '
        + 'they held no slot in the request’s pending-approver slate.',
    }),

    // Structured hand-off parties for `action: 'reassign'` (#4365). Before
    // these existed the pair lived only inside a default free-text comment
    // ("<from_id> → <to_id>"), which no client could parse or render readably.
    // `comment` is pure user input again; timelines render "from A to B" from
    // these fields.
    reassign_from: Field.lookup('sys_user', {
      label: 'Reassigned From',
      required: false,
      group: 'Action',
      description: 'User whose pending-approver slot was handed over (reassign actions only)',
    }),

    reassign_to: Field.lookup('sys_user', {
      label: 'Reassigned To',
      required: false,
      group: 'Action',
      description: 'User who received the pending-approver slot (reassign actions only)',
    }),

    attachments: Field.file({
      label: 'Attachments',
      required: false,
      multiple: true,
      group: 'Action',
      description: 'Files supporting this action — e.g. a signed contract or evidence (#3266).',
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
