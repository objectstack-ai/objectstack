// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_approval_request — Live approval instance.
 *
 * ADR-0019: opened by a flow's **Approval node** when the run reaches it; the
 * run suspends until a decision is recorded. The row's lifecycle:
 *
 *   `pending` → (per-approver decisions) → `approved` | `rejected`
 *   `pending` → recalled by submitter → `recalled`
 *
 * `flow_run_id` / `flow_node_id` tie the request back to the suspended run so a
 * decision can resume it; `current_step` mirrors the node id. `node_config_json`
 * snapshots the Approval node config (approvers / behaviour) the request was
 * opened with.
 *
 * `payload_json` captures a snapshot of the target record at submission
 * time — used by notifications so they can render before the record is
 * locked or changed.
 *
 * @namespace sys
 */
export const SysApprovalRequest = ObjectSchema.create({
  name: 'sys_approval_request',
  label: 'Approval Request',
  pluralLabel: 'Approval Requests',
  icon: 'inbox',
  isSystem: true,
  managedBy: 'system',
  description: 'Live approval instance tracked per submission',
  displayNameField: 'id',
  nameField: 'id', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{process_name} · {record_id}',
  highlightFields: ['process_name', 'object_name', 'record_id', 'status', 'current_step', 'submitter_id', 'updated_at'],

  // Curated built-in list views — render as segmented tabs in the console.
  // Filters use {current_user_id} substitution wired by the console.
  listViews: {
    my_pending: {
      type: 'grid',
      name: 'my_pending',
      label: 'My Pending',
      data: { provider: 'object', object: 'sys_approval_request' },
      columns: ['process_name', 'object_name', 'record_id', 'current_step', 'submitter_id', 'updated_at'],
      filter: [
        { field: 'status', operator: 'equals', value: 'pending' },
        { field: 'pending_approvers', operator: 'contains', value: '{current_user_id}' },
      ],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 25 },
      emptyState: { title: 'No pending approvals', message: 'You\'re all caught up.' },
    },
    submitted_by_me: {
      type: 'grid',
      name: 'submitted_by_me',
      label: 'I Submitted',
      data: { provider: 'object', object: 'sys_approval_request' },
      columns: ['process_name', 'object_name', 'record_id', 'status', 'current_step', 'updated_at'],
      filter: [{ field: 'submitter_id', operator: 'equals', value: '{current_user_id}' }],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 25 },
    },
    completed: {
      type: 'grid',
      name: 'completed',
      label: 'Completed',
      data: { provider: 'object', object: 'sys_approval_request' },
      columns: ['process_name', 'object_name', 'record_id', 'status', 'submitter_id', 'completed_at'],
      filter: [{ field: 'status', operator: 'in', value: ['approved', 'rejected', 'recalled'] }],
      sort: [{ field: 'completed_at', order: 'desc' }],
      pagination: { pageSize: 25 },
    },
    all_requests: {
      type: 'grid',
      name: 'all_requests',
      label: 'All',
      data: { provider: 'object', object: 'sys_approval_request' },
      columns: ['process_name', 'object_name', 'record_id', 'status', 'current_step', 'submitter_id', 'updated_at'],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    id: Field.text({ label: 'Request ID', required: true, readonly: true, group: 'System' }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      group: 'System',
      description: 'Tenant that owns this approval request (propagated from submitter context)',
    }),

    process_name: Field.text({
      label: 'Source',
      required: true,
      maxLength: 100,
      description: 'Origin of the request — `flow:<flowName|nodeId>` for node-driven approvals',
      group: 'Target',
    }),

    object_name: Field.text({
      label: 'Object',
      required: true,
      maxLength: 100,
      group: 'Target',
    }),

    record_id: Field.text({
      label: 'Record ID',
      required: true,
      maxLength: 100,
      group: 'Target',
    }),

    submitter_id: Field.lookup('sys_user', {
      label: 'Submitter',
      required: false,
      group: 'Target',
    }),

    submitter_comment: Field.textarea({
      label: 'Submitter Comment',
      required: false,
      group: 'Target',
    }),

    status: Field.select(
      // Keep in sync with `ApprovalStatus` (spec/contracts). `returned` =
      // sent back for revision (ADR-0044) — terminal for this round.
      ['pending', 'approved', 'rejected', 'recalled', 'returned'],
      {
        label: 'Status',
        required: true,
        defaultValue: 'pending',
        description: 'Lifecycle state of the request',
        group: 'State',
      },
    ),

    current_step: Field.text({
      label: 'Current Step',
      required: false,
      maxLength: 100,
      description: 'Machine name of the step awaiting approval',
      group: 'State',
    }),

    current_step_index: Field.number({
      label: 'Current Step Index',
      required: false,
      defaultValue: 0,
      group: 'State',
    }),

    pending_approvers: Field.textarea({
      label: 'Pending Approvers',
      required: false,
      description: 'Comma-separated user ids who can act on the current step',
      group: 'State',
    }),

    payload_json: Field.textarea({
      label: 'Snapshot',
      required: false,
      description: 'Record snapshot at submission time',
      group: 'State',
    }),

    // ── ADR-0019: approval-as-flow-node correlation ──────────────────
    // When a request is opened by an Approval *node* (rather than a standalone
    // process), these tie it back to the suspended flow run so a decision can
    // resume it. Null for legacy process-driven requests.
    flow_run_id: Field.text({
      label: 'Flow Run',
      required: false,
      maxLength: 100,
      readonly: true,
      description: 'Suspended automation run id this request gates (ADR-0019). The decision resumes it.',
      group: 'State',
    }),

    flow_node_id: Field.text({
      label: 'Flow Node',
      required: false,
      maxLength: 100,
      readonly: true,
      description: 'Approval node id within the flow that opened this request (ADR-0019).',
      group: 'State',
    }),

    node_config_json: Field.textarea({
      label: 'Node Config',
      required: false,
      readonly: true,
      description: 'Snapshot of the Approval node config (approvers/behavior) for node-driven requests (ADR-0019).',
      group: 'State',
    }),

    completed_at: Field.datetime({
      label: 'Completed At',
      required: false,
      group: 'State',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({ label: 'Updated At', required: false, group: 'System' }),
  },

  indexes: [
    // Look up "is there a pending request for this record?" — common
    // guard on submit and on edit-while-locked checks.
    { fields: ['object_name', 'record_id'] },
    { fields: ['status', 'object_name'] },
    // Status-windowed listings (escalation sweep, "All" tab ordering).
    // "My approvals" matching no longer scans this table: the service keeps
    // a normalized per-approver index in `sys_approval_approver` (#1745) and
    // resolves approver filters there; `pending_approvers` stays the
    // human-readable CSV source of truth only.
    { fields: ['status', 'updated_at'] },
    { fields: ['submitter_id', 'status'] },
  ],

  // Server-declared decision actions (objectui#2678 P2-4). The console's
  // generic action runtime renders and executes these wherever this object is
  // surfaced — the approvals inbox included — so new decision capabilities
  // (and their params) ship as metadata, not as hand-written buttons. Each
  // targets the existing approvals REST route; `{id}` resolves from the row
  // and `actorId` defaults to the caller server-side. The service remains the
  // authority on who may act (pending-approver check) — `visible` only trims
  // the obvious non-pending case.
  actions: [
    {
      name: 'approval_approve',
      label: 'Approve',
      icon: 'check-circle',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/approve',
      params: [
        { name: 'comment', label: 'Comment', type: 'textarea', required: false },
      ],
      visible: 'record.status == "pending"',
      locations: ['record_section', 'list_item'],
      successMessage: 'Approved.',
      refreshAfter: true,
    },
    {
      name: 'approval_reject',
      label: 'Reject',
      icon: 'x-circle',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/reject',
      params: [
        { name: 'comment', label: 'Comment', type: 'textarea', required: false },
      ],
      visible: 'record.status == "pending"',
      confirmText: 'Reject this request? A rejection is final for every approver.',
      locations: ['record_section', 'list_item'],
      successMessage: 'Rejected.',
      refreshAfter: true,
    },
    {
      name: 'approval_reassign',
      label: 'Reassign',
      icon: 'arrow-right-left',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/reassign',
      params: [
        // Field-backed on `submitter_id` (the object's only `sys_user` lookup):
        // the console resolves its lookup config (`reference_to: sys_user`) so the
        // dialog renders a real user picker, while `name: 'to'` overrides the
        // request-body key to the `to` the reassign route expects. This is a
        // config-borrow, not a submitter pre-fill (`defaultFromRow` stays off).
        { field: 'submitter_id', name: 'to', label: 'New approver', required: true, helpText: 'User to hand this step to' },
        { name: 'comment', label: 'Comment', type: 'textarea', required: false },
      ],
      visible: 'record.status == "pending"',
      locations: ['record_section'],
      successMessage: 'Reassigned.',
      refreshAfter: true,
    },

    // ── Approver secondary decisions ────────────────────────────────
    // Send back for revision / request more info (ADR-0044). Both are approver
    // actions on a pending request; the service is the authority on who may act,
    // so `visible` only trims the non-pending case (matching approve/reject).
    {
      name: 'approval_send_back',
      label: 'Send back',
      icon: 'corner-up-left',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/revise',
      params: [
        { name: 'comment', label: 'Reason', type: 'textarea', required: false },
      ],
      visible: 'record.status == "pending"',
      locations: ['record_section'],
      successMessage: 'Sent back for revision.',
      refreshAfter: true,
    },
    {
      name: 'approval_request_info',
      label: 'Request info',
      icon: 'help-circle',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/request-info',
      params: [
        { name: 'comment', label: 'What do you need?', type: 'textarea', required: true },
      ],
      visible: 'record.status == "pending"',
      locations: ['record_section'],
      successMessage: 'Information requested.',
      refreshAfter: true,
    },

    // ── Submitter continuity actions ────────────────────────────────
    // Remind / recall (pending) and resubmit / recall (returned). These are the
    // submitter's own levers, so `visible` gates on `submitter_id == ctx.user.id`
    // — the current user is exposed via the console's predicate scope. The
    // service re-checks ownership; the predicate keeps a non-submitter from ever
    // seeing a button they cannot use.
    {
      name: 'approval_remind',
      label: 'Send reminder',
      icon: 'bell-ring',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/remind',
      params: [
        { name: 'comment', label: 'Note', type: 'textarea', required: false },
      ],
      visible: 'record.status == "pending" && record.submitter_id == ctx.user.id',
      locations: ['record_section'],
      successMessage: 'Reminder sent.',
      refreshAfter: true,
    },
    {
      name: 'approval_recall',
      label: 'Recall',
      icon: 'undo-2',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/recall',
      params: [
        { name: 'comment', label: 'Comment', type: 'textarea', required: false },
      ],
      // Recall applies while the request is live for the submitter — pending
      // (withdraw) or returned (abandon the revision instead of resubmitting).
      visible: '(record.status == "pending" || record.status == "returned") && record.submitter_id == ctx.user.id',
      confirmText: 'Recall this request? Approvers can no longer act on it and the record is unlocked.',
      locations: ['record_section'],
      successMessage: 'Recalled.',
      refreshAfter: true,
    },
    {
      name: 'approval_resubmit',
      label: 'Resubmit',
      icon: 'refresh-cw',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/resubmit',
      params: [
        { name: 'comment', label: 'What changed?', type: 'textarea', required: false },
      ],
      visible: 'record.status == "returned" && record.submitter_id == ctx.user.id',
      locations: ['record_section'],
      successMessage: 'Resubmitted.',
      refreshAfter: true,
    },
  ],
});
