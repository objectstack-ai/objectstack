// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

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
  titleFormat: '{action} · {step_name}',
  compactLayout: ['request_id', 'step_name', 'action', 'actor_id', 'created_at'],

  listViews: {
    recent: {
      type: 'grid',
      name: 'recent',
      label: 'Recent',
      data: { provider: 'object', object: 'sys_approval_action' },
      columns: ['created_at', 'request_id', 'step_name', 'action', 'actor_id', 'comment'],
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
      columns: ['created_at', 'request_id', 'step_name', 'action', 'actor_id', 'comment'],
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
      // Keep in sync with `ApprovalActionKind` (spec/contracts). reassign /
      // remind / request_info / comment are thread interactions — they never
      // move the flow. revise / resubmit (ADR-0044) DO move it: send back for
      // revision and the later resubmission.
      ['submit', 'approve', 'reject', 'recall', 'escalate', 'reassign', 'remind', 'request_info', 'comment', 'revise', 'resubmit'],
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
});
