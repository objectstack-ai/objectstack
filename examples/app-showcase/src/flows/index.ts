// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineFlow } from '@objectstack/spec';

/**
 * Task Completed → Notify — an autolaunched, record-triggered flow that fires
 * when a task transitions to Done and emails the project owner.
 */
export const TaskCompletedFlow = defineFlow({
  name: 'showcase_task_completed',
  label: 'Notify on Task Completed',
  description: 'Emails the project owner when a task is marked Done.',
  type: 'autolaunched',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Task Update',
      config: {
        objectName: 'showcase_task',
        triggerType: 'record-after-update',
        condition: 'status == "done" && previous.status != "done"',
      },
    },
    {
      id: 'notify',
      type: 'script',
      label: 'Send Completion Email',
      config: {
        actionType: 'email',
        inputs: {
          to: '{record.project.owner}',
          subject: '✅ Task done: {record.title}',
          template: 'showcase_task_done_email',
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'notify' },
    { id: 'e2', source: 'notify', target: 'end' },
  ],
});

/**
 * Reassign Wizard — a screen flow launched from the Tasks toolbar action
 * (`showcase_bulk_reassign`). Collects a new assignee and writes it back.
 */
export const ReassignWizardFlow = defineFlow({
  name: 'showcase_reassign_wizard',
  label: 'Reassign Task',
  description: 'Screen flow that reassigns a task to a new owner.',
  type: 'screen',
  status: 'active',
  runAs: 'user',
  variables: [
    { name: 'recordId', type: 'text', isInput: true, isOutput: false },
    { name: 'new_assignee', type: 'text', isInput: true, isOutput: false },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'collect',
      type: 'screen',
      label: 'New Assignee',
      config: {
        fields: [
          { name: 'new_assignee', label: 'New Assignee', type: 'text', required: true },
        ],
      },
    },
    {
      id: 'apply',
      type: 'update_record',
      label: 'Apply Reassignment',
      config: {
        objectName: 'showcase_task',
        filter: { id: '{recordId}' },
        fields: { assignee: '{new_assignee}' },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'collect' },
    { id: 'e2', source: 'collect', target: 'apply' },
    { id: 'e3', source: 'apply', target: 'end' },
  ],
});

/**
 * Task Assigned → Notify Assignee — the worked `notify` example (ADR-0012).
 *
 * Where {@link TaskCompletedFlow} hand-waves notification through a `script`
 * node, this flow uses the baseline `notify` node: it hands a topic +
 * recipient + message to the messaging service, which fans out to the user's
 * channels (inbox by default). The `notify` node ships in every automation
 * engine; delivery is backed by `@objectstack/service-messaging`
 * (`MessagingServicePlugin`). Without that plugin the node degrades to a
 * logged no-op instead of failing the flow — install it and this flow starts
 * landing inbox rows with no edit.
 */
export const TaskAssignedNotifyFlow = defineFlow({
  name: 'showcase_task_assigned_notify',
  label: 'Notify Assignee on Task Assignment',
  description: 'Notifies the new assignee (inbox channel) when a task is reassigned.',
  type: 'autolaunched',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Task Assignee Change',
      config: {
        objectName: 'showcase_task',
        triggerType: 'record-after-update',
        condition: 'assignee != previous.assignee',
      },
    },
    {
      id: 'notify_assignee',
      type: 'notify',
      label: 'Notify Assignee',
      config: {
        topic: 'task.assigned',
        recipients: ['{record.assignee}'],
        channels: ['inbox'],
        severity: 'info',
        title: 'New task assigned: {record.title}',
        message: 'You have been assigned "{record.title}".',
        actionUrl: '/showcase_task/{record.id}',
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'notify_assignee' },
    { id: 'e2', source: 'notify_assignee', target: 'end' },
  ],
});

/**
 * Project Budget Approval — ADR-0019 approval-as-flow-node.
 *
 * What used to be a standalone two-step approval *process* is now an ordinary
 * autolaunched flow with two `approval` nodes. The flow suspends on each
 * approval and resumes down the matching `approve` / `reject` edge. The
 * executive step only runs for budgets above $500k — that gate is a decision
 * node on the manager step's approve edge.
 */
export const BudgetApprovalFlow = defineFlow({
  name: 'showcase_budget_approval',
  label: 'Project Budget Approval',
  description: 'Two-step approval for projects above budget thresholds.',
  type: 'autolaunched',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Large Budget',
      config: {
        objectName: 'showcase_project',
        triggerType: 'record-after-update',
        condition: 'budget > 100000',
      },
    },
    {
      id: 'manager_review',
      type: 'approval',
      label: 'Manager Review',
      config: {
        approvers: [{ type: 'role', value: 'manager' }],
        behavior: 'first_response',
        lockRecord: true,
      },
    },
    {
      id: 'needs_exec',
      type: 'decision',
      label: 'Budget Above $500k?',
      config: { condition: 'budget > 500000' },
    },
    {
      id: 'exec_review',
      type: 'approval',
      label: 'Executive Review',
      config: {
        approvers: [{ type: 'role', value: 'exec' }],
        behavior: 'unanimous',
        lockRecord: true,
      },
    },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'manager_review' },
    { id: 'e2', source: 'manager_review', target: 'needs_exec', label: 'approve' },
    { id: 'e3', source: 'manager_review', target: 'rejected', label: 'reject' },
    { id: 'e4', source: 'needs_exec', target: 'exec_review', label: 'true' },
    { id: 'e5', source: 'needs_exec', target: 'approved', label: 'false' },
    { id: 'e6', source: 'exec_review', target: 'approved', label: 'approve' },
    { id: 'e7', source: 'exec_review', target: 'rejected', label: 'reject' },
  ],
});

/**
 * Task Completed → Post to Slack — the worked `connector_action` example
 * (ADR-0018 §Addendum, ADR-0022).
 *
 * Unlike {@link TaskCompletedFlow}, which hand-waves notification via a `script`
 * node, this flow takes the "raw API call" path: a baseline `connector_action`
 * node dispatches to the `slack` connector's `chat.postMessage` action. The
 * `connector_action` node type is built into every automation engine; the
 * `slack` connector itself is contributed at runtime by the
 * `@objectstack/connector-slack` plugin (static bot-token auth). Load that
 * plugin in your stack and the node resolves; omit it and the step fails with a
 * clear "connector slack not registered" error rather than silently no-op'ing.
 *
 * The connector → action → input pickers the designer shows for this node are
 * fed by `GET /api/v1/automation/connectors`, which enumerates the live
 * registry (see `getConnectorDescriptors`).
 */
export const TaskCompletedSlackFlow = defineFlow({
  name: 'showcase_task_completed_slack',
  label: 'Post to Slack on Task Completed',
  description: 'Posts to a Slack channel via the slack connector when a task is marked Done.',
  type: 'autolaunched',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Task Update',
      config: {
        objectName: 'showcase_task',
        triggerType: 'record-after-update',
        condition: 'status == "done" && previous.status != "done"',
      },
    },
    {
      id: 'post_to_slack',
      type: 'connector_action',
      label: 'Post to #wins',
      connectorConfig: {
        connectorId: 'slack',
        actionId: 'chat.postMessage',
        input: {
          channel: 'C0WINS000',
          text: '✅ Task done: {record.title}',
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'post_to_slack' },
    { id: 'e2', source: 'post_to_slack', target: 'end' },
  ],
});

export const allFlows = [
  TaskCompletedFlow,
  ReassignWizardFlow,
  BudgetApprovalFlow,
  TaskCompletedSlackFlow,
  TaskAssignedNotifyFlow,
];
