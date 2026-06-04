// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * ai_pending_actions — Human-in-the-Loop queue for AI-initiated actions.
 *
 * When the agent picks a tool that maps to a dangerous declarative action
 * (delete, danger variant, or any action with `confirmText`), the tool
 * runtime does **not** dispatch immediately. Instead it persists a row
 * here and returns a `{ status: 'pending_approval', pendingActionId }`
 * envelope so the LLM can summarise the request. A human then approves
 * (or rejects) via Studio's pending-actions inbox, at which point the
 * service re-dispatches the action with full permissions.
 *
 * One row per proposed tool call. Lifecycle:
 *   pending → approved → executed   (happy path)
 *           ↘ approved → failed     (execution blew up)
 *           ↘ rejected              (human said no)
 *
 * @namespace ai
 */
export const AiPendingActionObject = ObjectSchema.create({
  name: 'ai_pending_actions',
  label: 'AI Pending Action',
  pluralLabel: 'AI Pending Actions',
  icon: 'shield-check',
  isSystem: true,
  description: 'Queue of AI-proposed action invocations awaiting human approval',

  fields: {
    id: Field.text({
      label: 'Request ID',
      required: true,
      readonly: true,
    }),

    conversation_id: Field.lookup('ai_conversations', {
      label: 'Conversation',
      required: false,
      description: 'Conversation that produced this proposal, if any',
    }),

    message_id: Field.lookup('ai_messages', {
      label: 'Message',
      required: false,
      description: 'Assistant message containing the proposed tool call',
    }),

    object_name: Field.text({
      label: 'Object',
      required: true,
      maxLength: 128,
      description: 'Target object name (e.g. "task")',
    }),

    action_name: Field.text({
      label: 'Action',
      required: true,
      maxLength: 128,
      description: 'Declarative action name (e.g. "delete_task")',
    }),

    tool_name: Field.text({
      label: 'Tool',
      required: true,
      maxLength: 128,
      description: 'AI tool name exposed to the LLM (e.g. "action_delete_task")',
    }),

    tool_input: Field.textarea({
      label: 'Tool Input',
      required: true,
      description: 'JSON-serialised tool arguments the LLM passed',
    }),

    status: Field.select({
      label: 'Status',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending Approval', value: 'pending' },
        { label: 'Approved (queued)', value: 'approved' },
        { label: 'Executed', value: 'executed' },
        { label: 'Failed', value: 'failed' },
        { label: 'Rejected', value: 'rejected' },
      ],
    }),

    result: Field.textarea({
      label: 'Execution Result',
      required: false,
      description: 'JSON-serialised result from the action when executed',
    }),

    error: Field.textarea({
      label: 'Error',
      required: false,
      description: 'Error message when status=failed',
    }),

    rejection_reason: Field.textarea({
      label: 'Rejection Reason',
      required: false,
      description: 'Why the reviewer rejected (shown back to the LLM)',
    }),

    proposed_by: Field.text({
      label: 'Proposed By',
      required: false,
      maxLength: 128,
      description: 'Principal id of the AI agent that proposed the action',
    }),

    decided_by: Field.text({
      label: 'Decided By',
      required: false,
      maxLength: 128,
      description: 'User id of the human who approved/rejected',
    }),

    proposed_at: Field.datetime({
      label: 'Proposed At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
    }),

    decided_at: Field.datetime({
      label: 'Decided At',
      required: false,
      description: 'When approve/reject happened',
    }),
  },

  indexes: [
    { fields: ['status'] },
    { fields: ['conversation_id'] },
    { fields: ['object_name'] },
    { fields: ['proposed_at'] },
  ],

  actions: [
    {
      name: 'approve_pending_action',
      label: 'Approve',
      type: 'api',
      target: '/api/v1/ai/pending-actions/{recordId}/approve',
      method: 'POST',
      locations: ['list_item', 'record_header'],
      variant: 'primary',
      confirmText: 'Approve and execute this action now?',
      successMessage: 'Action approved and executed.',
      // Human-only by design: not opted into AI (no `ai.exposed`). The approval
      // click is the operator's authorisation gesture — the LLM must not be
      // able to bypass HITL by approving itself.
    },
    {
      name: 'reject_pending_action',
      label: 'Reject',
      type: 'api',
      target: '/api/v1/ai/pending-actions/{recordId}/reject',
      method: 'POST',
      locations: ['list_item', 'record_header'],
      variant: 'danger',
      confirmText: 'Reject this pending action? It will not be executed.',
      successMessage: 'Action rejected.',
      // Human-only by design: not opted into AI (no `ai.exposed`).
    },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
    trash: false,
    mru: false,
  },
});
