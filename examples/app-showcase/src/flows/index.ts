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
 *
 * The manager step also demos ADR-0044 **send back for revision**: its
 * `revise` edge walks to a signal `wait` node where the record unlocks for
 * rework, and the submitter's resubmit re-enters the approval node over the
 * declared back-edge (round 2, fresh approver slate). `maxRevisions: 2` keeps
 * the loop guarded — a third send-back auto-rejects. The executive step has
 * NO revise edge on purpose: send-back there is rejected with a clear error.
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
        // Gate on the budget CHANGING, not on every update of a large-budget
        // project — otherwise any unrelated edit (status, health, …) re-opens
        // an approval and collides with other approval flows on the same
        // record (the approvals service dedupes pending requests per record).
        condition: 'budget > 100000 && budget != previous.budget',
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
        // ADR-0044: at most two send-backs; the third auto-rejects.
        maxRevisions: 2,
      },
    },
    {
      // ADR-0044 revise window: the run parks here while the submitter reworks
      // the (now unlocked) record; their resubmit resumes it over the back-edge.
      id: 'wait_revision',
      type: 'wait',
      label: 'Awaiting Revision',
      config: { eventType: 'signal', signalName: 'budget_revision' },
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
    // Decision branching is edge-condition driven (flow spec): the engine
    // routes a decision node by evaluating each out-edge's `condition`. Carry
    // the predicate on the edges (the node `config.condition` alone is not
    // evaluated by the engine), so budgets ≤ $500k skip the executive step.
    { id: 'e4', source: 'needs_exec', target: 'exec_review', label: 'true', condition: 'budget > 500000' },
    { id: 'e5', source: 'needs_exec', target: 'approved', label: 'false', condition: 'budget <= 500000' },
    { id: 'e6', source: 'exec_review', target: 'approved', label: 'approve' },
    { id: 'e7', source: 'exec_review', target: 'rejected', label: 'reject' },
    // ADR-0044 send-back-for-revision loop on the manager step: revise walks
    // to the wait node; the resubmit edge is the declared back-edge closing
    // the cycle (type 'back' — excluded from DAG validation, traversed
    // normally), re-entering the approval node as round 2.
    { id: 'e8', source: 'manager_review', target: 'wait_revision', label: 'revise' },
    { id: 'e9', source: 'wait_revision', target: 'manager_review', label: 'resubmit', type: 'back' },
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

/**
 * Scheduled Digest — the worked `schedule` trigger example.
 *
 * A `type: 'schedule'` flow whose start node carries an interval descriptor.
 * The automation engine parses that into a schedule binding; the schedule
 * trigger plugin (`@objectstack/trigger-schedule`, paired with the job
 * service) registers a job that fires this flow every interval. Each tick runs
 * the `notify` node, dropping a fresh `sys_inbox_message` row — so the
 * scheduled fire is observable end-to-end with no manual `engine.execute()`.
 *
 * Install `requires: ['automation', 'triggers', 'job', 'messaging']` and this
 * flow auto-launches on the interval.
 */
export const ScheduledDigestFlow = defineFlow({
  name: 'showcase_scheduled_digest',
  label: 'Scheduled Project Digest (interval)',
  description: 'Fires on a fixed interval and posts a digest to an inbox — demonstrates the schedule trigger.',
  type: 'schedule',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'Every 60s (demo)',
      config: {
        // DEMO-ONLY interval. Each tick fans out into job_run + notification +
        // delivery + receipt + inbox rows (all append-only, ADR-0057). At 20s
        // this filled dev.db to 260MB+ over a multi-day `pnpm dev`. 60s keeps
        // the schedule trigger observable within a minute while cutting the
        // write rate 3x. Production digests use a cron expression instead,
        // e.g. { type: 'cron', expression: '0 8 * * *' }. Real bounding comes
        // from the lifecycle/retention work (ADR-0057), not this number.
        schedule: { type: 'interval', intervalMs: 60000 },
      },
    },
    {
      id: 'digest',
      type: 'notify',
      label: 'Post Digest to Inbox',
      config: {
        topic: 'project.digest',
        recipients: ['admin@objectos.ai'],
        channels: ['inbox'],
        severity: 'info',
        title: 'Scheduled project digest',
        message: 'Your periodic project digest is ready — open Projects for the latest health.',
        actionUrl: '/showcase_project',
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'digest' },
    { id: 'e2', source: 'digest', target: 'end' },
  ],
});

/**
 * Task Completed → REST Ping (self) — the worked `connector_action` example on
 * the generic `rest` connector.
 *
 * Where {@link TaskCompletedSlackFlow} targets the `slack` connector (which
 * needs a real bot token + channel), this flow dispatches to the `rest`
 * connector contributed by `@objectstack/connector-rest`, configured to point
 * at the running server itself. On task completion it issues
 * `GET /api/v1/health`; the request and its `{ status: 'ok' }` response are
 * captured on the flow run, so the connector dispatch is fully observable
 * without any external service or credentials.
 */
export const TaskCompletedRestPingFlow = defineFlow({
  name: 'showcase_task_completed_rest_ping',
  label: 'REST Ping on Task Completed',
  description: 'Calls the local server health endpoint via the rest connector when a task is marked Done.',
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
      id: 'ping',
      type: 'connector_action',
      label: 'GET /api/v1/health',
      connectorConfig: {
        connectorId: 'rest',
        actionId: 'request',
        input: {
          method: 'GET',
          path: '/api/v1/health',
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'ping' },
    { id: 'e2', source: 'ping', target: 'end' },
  ],
});

/**
 * Task Follow-up Reminder — the worked `wait` (durable timer) example.
 *
 * When a task is created, the flow pauses at a `wait` node for a fixed delay,
 * then reminds the assignee to update it. The `wait` node *suspends* the run
 * (ADR-0019 durable pause, like `screen`/`approval`); a one-shot job scheduled
 * via the job service (`{ type: 'once', at }`) resumes it when the timer
 * elapses — so the delayed reminder fires end-to-end with no manual
 * `engine.resume()`. Without a job service the run still suspends and can be
 * resumed by an external `resume(runId)` (it never silently no-ops).
 *
 * A short demo delay keeps it observable in-session; a production reminder would
 * use e.g. `timerDuration: 'P3D'`. Install
 * `requires: ['automation', 'triggers', 'job', 'messaging']`.
 */
export const TaskFollowUpFlow = defineFlow({
  name: 'showcase_task_follow_up',
  label: 'Task Follow-up Reminder (wait)',
  description: 'Waits a fixed delay after a task is created, then reminds the assignee — demonstrates the durable wait node.',
  type: 'autolaunched',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Task Created',
      config: {
        objectName: 'showcase_task',
        triggerType: 'record-after-create',
      },
    },
    {
      id: 'hold',
      type: 'wait',
      label: 'Wait 1 min',
      // Timer wait: suspends the run, then a one-shot job resumes it after the
      // duration. ISO-8601 duration; production reminders would use e.g. 'P3D'.
      waitEventConfig: { eventType: 'timer', timerDuration: 'PT1M', onTimeout: 'continue' },
    },
    {
      id: 'remind',
      type: 'notify',
      label: 'Remind Assignee',
      config: {
        topic: 'task.followup',
        recipients: ['{record.assignee}'],
        channels: ['inbox'],
        severity: 'info',
        title: 'Follow up on: {record.title}',
        message: 'This task has been open for a while — please update its status.',
        actionUrl: '/showcase_task/{record.id}',
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'hold' },
    { id: 'e2', source: 'hold', target: 'remind' },
    { id: 'e3', source: 'remind', target: 'end' },
  ],
});

/**
 * Notify Owner — a reusable **subflow** (`template: true`). Other flows invoke
 * it through a `subflow` node, passing `ownerId` + `message`; it fans a
 * notification to the owner. Centralising "how we notify an owner" here means
 * callers don't duplicate the notify wiring.
 */
export const NotifyOwnerSubflow = defineFlow({
  name: 'showcase_notify_owner',
  label: 'Notify Owner (reusable subflow)',
  description: 'Reusable subflow: notifies a record owner. Invoked by other flows via a subflow node.',
  type: 'autolaunched',
  template: true,
  variables: [
    { name: 'ownerId', type: 'text', isInput: true },
    { name: 'message', type: 'text', isInput: true },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'notify',
      type: 'notify',
      label: 'Notify Owner',
      config: {
        topic: 'project.notice',
        recipients: ['{ownerId}'],
        channels: ['inbox'],
        severity: 'info',
        title: 'Project update',
        message: '{message}',
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
 * Task Done → Notify Owner (subflow) — the worked `subflow` example. On task
 * completion it invokes {@link NotifyOwnerSubflow} via a `subflow` node, mapping
 * the task's owner + a message into the subflow's input variables.
 */
export const TaskDoneNotifyOwnerFlow = defineFlow({
  name: 'showcase_task_done_notify_owner',
  label: 'Task Done → Notify Owner (subflow)',
  description: 'On task completion, invokes the reusable notify-owner subflow — demonstrates subflow reuse.',
  type: 'autolaunched',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Task Done',
      config: {
        objectName: 'showcase_task',
        triggerType: 'record-after-update',
        condition: 'status == "done" && previous.status != "done"',
      },
    },
    {
      id: 'call_notify',
      type: 'subflow',
      label: 'Notify Owner',
      config: {
        flowName: 'showcase_notify_owner',
        input: {
          ownerId: '{record.project.owner}',
          message: 'Task "{record.title}" is done.',
        },
        outputVariable: 'notifyResult',
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'call_notify' },
    { id: 'e2', source: 'call_notify', target: 'end' },
  ],
});

/**
 * Closure Sign-off — a reusable **approval subflow**: pauses on a manager
 * approval and reports the decision as its output. Together with
 * {@link ProjectClosureFlow} this is the worked example of **nested durable
 * pause** (linked-runs model): a pausing node (`approval`) inside a `subflow`
 * suspends BOTH runs — the child at the approval, the parent at its subflow
 * node (`correlation: subflow:<childRunId>`) — and the eventual decision
 * bubbles back up through the chain.
 */
export const ClosureSignoffSubflow = defineFlow({
  name: 'showcase_closure_signoff',
  label: 'Closure Sign-off (approval subflow)',
  description: 'Reusable subflow: requests a manager sign-off and outputs the decision. Demonstrates approval inside a subflow (nested durable pause).',
  type: 'autolaunched',
  template: true,
  variables: [
    { name: 'reason', type: 'text', isInput: true },
    { name: 'decision', type: 'text', isOutput: true },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'ask_signoff',
      type: 'approval',
      label: 'Manager Sign-off',
      config: {
        approvers: [{ type: 'role', value: 'manager' }],
        behavior: 'first_response',
        // The parent project just hit a terminal status — no point locking it.
        lockRecord: false,
      },
    },
    {
      id: 'mark_approved',
      type: 'assignment',
      label: 'Record Approval',
      config: { assignments: { decision: 'approved' } },
    },
    {
      id: 'mark_rejected',
      type: 'assignment',
      label: 'Record Rejection',
      config: { assignments: { decision: 'rejected' } },
    },
    { id: 'end_ok', type: 'end', label: 'Signed Off' },
    { id: 'end_no', type: 'end', label: 'Declined' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'ask_signoff' },
    { id: 'e2', source: 'ask_signoff', target: 'mark_approved', label: 'approve' },
    { id: 'e3', source: 'ask_signoff', target: 'mark_rejected', label: 'reject' },
    { id: 'e4', source: 'mark_approved', target: 'end_ok' },
    { id: 'e5', source: 'mark_rejected', target: 'end_no' },
  ],
});

/**
 * Project Closure with Sign-off — the worked **nested durable pause** example.
 *
 * When a project is marked Completed, the flow invokes
 * {@link ClosureSignoffSubflow} through a `subflow` node. The child suspends on
 * its `approval` node, which suspends THIS run too — both continuations are
 * persisted as linked runs (`sys_automation_run`), surviving restarts. When a
 * manager decides (approvals API / inbox), the child resumes down the matching
 * branch, completes, and **bubbles** its `decision` output back into this run
 * (`signoffResult`), which continues to notify the project owner.
 *
 * Observe it end-to-end: complete a project → both runs show `paused` in the
 * Runs panel (parent at `signoff`, child at `ask_signoff`) → approve via
 * `POST /api/v1/approvals/requests/:id/approve` → both runs complete and the
 * owner's inbox gets the decision.
 */
export const ProjectClosureFlow = defineFlow({
  name: 'showcase_project_closure',
  label: 'Project Closure with Sign-off (nested pause)',
  description: 'On project completion, requests sign-off via an approval-inside-subflow, then notifies the owner — demonstrates nested durable pause.',
  type: 'autolaunched',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Project Completed',
      config: {
        objectName: 'showcase_project',
        triggerType: 'record-after-update',
        condition: 'status == "completed" && previous.status != "completed"',
      },
    },
    {
      id: 'signoff',
      type: 'subflow',
      label: 'Request Sign-off',
      config: {
        flowName: 'showcase_closure_signoff',
        input: {
          reason: 'Project "{record.name}" was marked completed — please sign off the closure.',
        },
        outputVariable: 'signoffResult',
      },
    },
    {
      id: 'notify_owner',
      type: 'notify',
      label: 'Notify Owner of Decision',
      config: {
        topic: 'project.closure',
        recipients: ['{record.owner}'],
        channels: ['inbox'],
        severity: 'info',
        title: 'Closure sign-off: {record.name}',
        message: 'Closure sign-off decision for "{record.name}": {signoffResult.decision}.',
        actionUrl: '/showcase_project/{record.id}',
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'signoff' },
    { id: 'e2', source: 'signoff', target: 'notify_owner' },
    { id: 'e3', source: 'notify_owner', target: 'end' },
  ],
});

/**
 * Batch Reminders — demonstrates the ADR-0031 **structured loop container**.
 *
 * The `loop` node owns a bounded **body region** (`config.body`, a
 * single-entry/single-exit sub-graph) and iterates it over a collection: each
 * task is bound to `task` (and its index to `taskIndex`) in the enclosing
 * variable scope, and the body sends a reminder. A hard `maxIterations` guard
 * keeps iteration bounded. The loop node's ordinary out-edge (`→ end`) is the
 * after-loop continuation — the DAG invariant for ordinary edges is preserved.
 */
export const BatchRemindersFlow = defineFlow({
  name: 'showcase_batch_reminders',
  label: 'Batch Task Reminders (Loop)',
  description: 'Iterates a collection of tasks and sends a reminder for each (structured loop container, ADR-0031).',
  type: 'autolaunched',
  variables: [
    { name: 'tasks', type: 'list', isInput: true, isOutput: false },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'loop_tasks',
      type: 'loop',
      label: 'For each task',
      config: {
        collection: '{tasks}',
        iteratorVariable: 'task',
        indexVariable: 'taskIndex',
        maxIterations: 500,
        body: {
          nodes: [
            {
              id: 'send_reminder',
              type: 'script',
              label: 'Send Reminder',
              config: {
                actionType: 'email',
                inputs: {
                  to: '{task.owner.email}',
                  subject: 'Reminder ({taskIndex}): {task.title}',
                  template: 'showcase_task_reminder_email',
                },
              },
            },
          ],
          edges: [],
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'loop_tasks' },
    { id: 'e2', source: 'loop_tasks', target: 'end' },
  ],
});

/**
 * Fan-out Notify — demonstrates the ADR-0031 **structured parallel block**.
 *
 * The `parallel` node declares two branch regions in `config.branches[]`; both
 * run concurrently in the enclosing variable scope and **join implicitly** at
 * block end (the engine continues once both complete). There is no
 * author-visible split/join gateway. The node's ordinary out-edge (`→ end`) is
 * the after-block continuation.
 */
export const FanOutNotifyFlow = defineFlow({
  name: 'showcase_fan_out_notify',
  label: 'Fan-out Notify (Parallel)',
  description: 'Notifies owner and watchers concurrently via a parallel block, joining before completion (ADR-0031).',
  type: 'autolaunched',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Task Completed',
      config: {
        objectName: 'showcase_task',
        triggerType: 'record-after-update',
        condition: 'status == "done" && previous.status != "done"',
      },
    },
    {
      id: 'fan_out',
      type: 'parallel',
      label: 'Notify in parallel',
      config: {
        branches: [
          {
            name: 'Email the owner',
            nodes: [
              {
                id: 'email_owner',
                type: 'script',
                label: 'Email Owner',
                config: {
                  actionType: 'email',
                  inputs: { to: '{record.project.owner}', subject: '✅ Done: {record.title}' },
                },
              },
            ],
            edges: [],
          },
          {
            name: 'Post to Slack',
            nodes: [
              {
                id: 'slack_post',
                type: 'script',
                label: 'Slack Notify',
                config: {
                  actionType: 'slack',
                  inputs: { channel: '#tasks', text: 'Task done: {record.title}' },
                },
              },
            ],
            edges: [],
          },
        ],
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'fan_out' },
    { id: 'e2', source: 'fan_out', target: 'end' },
  ],
});

/**
 * Resilient Sync — demonstrates the ADR-0031 **try/catch/retry** construct.
 *
 * The `try_catch` node runs a protected `try` region (an outbound HTTP push);
 * on failure it retries with exponential backoff, and if it still fails the
 * `catch` region records the failure with the caught error bound to `$error`.
 * Both regions are single-entry/single-exit and run in the enclosing scope; the
 * node's ordinary out-edge (`→ end`) is the after-block continuation.
 */
export const ResilientSyncFlow = defineFlow({
  name: 'showcase_resilient_sync',
  label: 'Resilient Sync (Try/Catch/Retry)',
  description: 'Pushes a task to an external system, retrying on failure and recording errors via try/catch (ADR-0031).',
  type: 'autolaunched',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Task Completed',
      config: {
        objectName: 'showcase_task',
        triggerType: 'record-after-update',
        condition: 'status == "done" && previous.status != "done"',
      },
    },
    {
      id: 'guarded_push',
      type: 'try_catch',
      label: 'Push with retry',
      config: {
        retry: { maxRetries: 3, retryDelayMs: 1000, backoffMultiplier: 2, maxRetryDelayMs: 10000 },
        errorVariable: '$error',
        try: {
          nodes: [
            {
              id: 'push',
              type: 'http',
              label: 'Push to CRM',
              config: {
                url: 'https://api.example.com/v1/tasks',
                method: 'POST',
                body: { id: '{record.id}', title: '{record.title}', status: 'done' },
              },
            },
          ],
          edges: [],
        },
        catch: {
          nodes: [
            {
              id: 'record_failure',
              type: 'update_record',
              label: 'Flag Sync Failure',
              config: {
                objectName: 'showcase_task',
                filter: { id: '{record.id}' },
                fields: { sync_status: 'failed', sync_error: '{$error.message}' },
              },
            },
          ],
          edges: [],
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'guarded_push' },
    { id: 'e2', source: 'guarded_push', target: 'end' },
  ],
});

/**
 * Invoice Dual Sign-off — the worked **parallel-approval** example (ADR-0039
 * Track A: aggregating approval node, no engine-core change).
 *
 * "Finance AND legal must both sign off before an invoice is sent" is expressed
 * as a **single `approval` node** with two approver groups and
 * `behavior: 'unanimous'`. On entry the node opens ONE `sys_approval_request`
 * whose `pending_approvers` holds *both* groups — they are notified
 * concurrently (parallel). The node stays suspended until **every** group has
 * approved (the aggregation / AND), then resumes down the `approve` edge; any
 * rejection resumes down `reject`. One node, one suspend/resume, no token tree —
 * the multi-instance pattern Camunda and Step Functions use for exactly this.
 *
 * Decide via the approvals API (never a raw engine `resume`):
 *   POST /api/v1/automation/showcase_invoice_signoff/runs/{runId}/...  ← no
 *   POST /api/v1/approvals/requests/{id}/approve  { actorId: 'role:finance' }
 *   POST /api/v1/approvals/requests/{id}/approve  { actorId: 'role:legal' }   ← now it continues
 */
export const InvoiceDualSignoffFlow = defineFlow({
  name: 'showcase_invoice_signoff',
  label: 'Invoice Dual Sign-off (parallel approval)',
  description: 'On send, requires finance AND legal to both approve via one aggregating approval node — demonstrates parallel approvals without a token tree (ADR-0039 Track A).',
  type: 'autolaunched',
  // The revert-on-reject write is an approval-process outcome, not an act of the
  // submitter — run it as the system principal so it lands regardless of whether
  // the submitter still has edit rights on a "sent" invoice (#1888 runAs enforced).
  runAs: 'system',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Invoice Sent',
      config: {
        objectName: 'showcase_invoice',
        triggerType: 'record-after-update',
        condition: 'status == "sent" && previous.status != "sent"',
      },
    },
    {
      id: 'dual_signoff',
      type: 'approval',
      label: 'Finance + Legal Sign-off',
      config: {
        // Two approver groups, notified in parallel; `unanimous` waits for both.
        approvers: [
          { type: 'role', value: 'finance' },
          { type: 'role', value: 'legal' },
        ],
        behavior: 'unanimous',
        // The invoice keeps flowing through other automations while it waits.
        lockRecord: false,
      },
    },
    {
      id: 'notify_cleared',
      type: 'notify',
      label: 'Notify: Cleared',
      config: {
        topic: 'invoice.signoff',
        recipients: ['{record.account.owner}'],
        channels: ['inbox'],
        severity: 'info',
        title: 'Invoice cleared: {record.name}',
        message: 'Invoice "{record.name}" passed finance + legal sign-off and is on its way.',
        actionUrl: '/showcase_invoice/{record.id}',
      },
    },
    {
      id: 'flag_held',
      type: 'update_record',
      label: 'Flag: Held',
      config: {
        objectName: 'showcase_invoice',
        filter: { id: '{record.id}' },
        fields: { status: 'draft' },
      },
    },
    { id: 'end_ok', type: 'end', label: 'Sent' },
    { id: 'end_held', type: 'end', label: 'Held' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'dual_signoff' },
    { id: 'e2', source: 'dual_signoff', target: 'notify_cleared', label: 'approve' },
    { id: 'e3', source: 'dual_signoff', target: 'flag_held', label: 'reject' },
    { id: 'e4', source: 'notify_cleared', target: 'end_ok' },
    { id: 'e5', source: 'flag_held', target: 'end_held' },
  ],
});

/**
 * Project Escalation — the worked **composite** example: several constructs
 * nested in one realistic flow, where every other showcase flow demos one
 * construct in isolation. When a project's health turns red:
 *
 *   decision (critical budget?)
 *     ├─ critical → parallel { alert owner ∥ alert exec }  →  try/catch {
 *     │     push to the incident system, catch → log the failure }
 *     └─ normal  → a single owner notification
 *   → converge → end
 *
 * It exercises construct **interactions** (parallel + try/catch under a decision
 * branch, converging edges) that single-construct flows don't — and runs
 * synchronously (no pause), so it completes in one pass and is fully visible in
 * the Runs panel with nested step folding.
 */
export const ProjectEscalationFlow = defineFlow({
  name: 'showcase_project_escalation',
  label: 'Project Escalation (composite)',
  description: 'On health → red, branches on severity then alerts in parallel and pushes to an incident system with try/catch — demonstrates nested construct composition.',
  type: 'autolaunched',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Health Red',
      config: {
        objectName: 'showcase_project',
        triggerType: 'record-after-update',
        condition: 'health == "red" && previous.health != "red"',
      },
    },
    { id: 'triage', type: 'decision', label: 'Critical budget?' },
    {
      id: 'alert',
      type: 'parallel',
      label: 'Alert in parallel',
      config: {
        branches: [
          {
            name: 'Owner',
            nodes: [{ id: 'alert_owner', type: 'script', label: 'Alert Owner', config: { actionType: 'email', inputs: { to: '{record.owner}', subject: '🔴 Critical: {record.name}' } } }],
            edges: [],
          },
          {
            name: 'Exec',
            nodes: [{ id: 'alert_exec', type: 'script', label: 'Alert Exec', config: { actionType: 'email', inputs: { to: 'exec@example.com', subject: '🔴 Critical project: {record.name}' } } }],
            edges: [],
          },
        ],
      },
    },
    {
      id: 'push_incident',
      type: 'try_catch',
      label: 'Push to incident system',
      config: {
        retry: { maxRetries: 2, retryDelayMs: 500, backoffMultiplier: 2 },
        errorVariable: '$error',
        try: {
          nodes: [{ id: 'push', type: 'http', label: 'POST incident', config: { url: 'https://api.example.com/v1/incidents', method: 'POST', body: { project: '{record.id}', severity: 'critical' } } }],
          edges: [],
        },
        catch: {
          nodes: [{ id: 'log_fail', type: 'notify', label: 'Log push failure', config: { topic: 'project.escalation', recipients: ['admin@objectos.ai'], channels: ['inbox'], severity: 'warning', title: 'Incident push failed: {record.name}', message: 'Could not reach the incident system: {$error.message}' } }],
          edges: [],
        },
      },
    },
    {
      id: 'notify_normal',
      type: 'notify',
      label: 'Notify Owner',
      config: { topic: 'project.escalation', recipients: ['{record.owner}'], channels: ['inbox'], severity: 'info', title: 'Project needs attention: {record.name}', message: 'Health dropped to red — please review.' },
    },
    {
      id: 'converge',
      type: 'notify',
      label: 'Escalation Handled',
      config: { topic: 'project.escalation', recipients: ['{record.owner}'], channels: ['inbox'], severity: 'info', title: 'Escalation handled: {record.name}', message: 'The red-health escalation has been processed.' },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'triage' },
    { id: 'e2', source: 'triage', target: 'alert', label: 'critical', condition: 'budget > 200000' },
    { id: 'e3', source: 'triage', target: 'notify_normal', label: 'normal', condition: 'budget <= 200000' },
    { id: 'e4', source: 'alert', target: 'push_incident' },
    { id: 'e5', source: 'push_incident', target: 'converge' },
    { id: 'e6', source: 'notify_normal', target: 'converge' },
    { id: 'e7', source: 'converge', target: 'end' },
  ],
});

/**
 * One Task Sign-off — a reusable per-item **approval subflow**, invoked once
 * per task by {@link ReleaseSignoffFlow}'s `map` node. The mapped task is
 * exposed to this subflow as its record, so the `approval` node opens against
 * *that* task.
 */
export const OneTaskSignoffSubflow = defineFlow({
  name: 'showcase_one_task_signoff',
  label: 'One Task Sign-off (per-item subflow)',
  description: 'Reusable subflow: requests sign-off on a single task. Invoked per item by the batch sign-off map.',
  type: 'autolaunched',
  template: true,
  variables: [{ name: 'decision', type: 'text', isOutput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'review',
      type: 'approval',
      label: 'Task Sign-off',
      config: {
        approvers: [{ type: 'role', value: 'manager' }],
        behavior: 'first_response',
        lockRecord: false,
      },
    },
    { id: 'mark_ok', type: 'assignment', label: 'Approved', config: { assignments: { decision: 'approved' } } },
    { id: 'mark_no', type: 'assignment', label: 'Rejected', config: { assignments: { decision: 'rejected' } } },
    { id: 'end_ok', type: 'end', label: 'Signed Off' },
    { id: 'end_no', type: 'end', label: 'Declined' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'review' },
    { id: 'e2', source: 'review', target: 'mark_ok', label: 'approve' },
    { id: 'e3', source: 'review', target: 'mark_no', label: 'reject' },
    { id: 'e4', source: 'mark_ok', target: 'end_ok' },
    { id: 'e5', source: 'mark_no', target: 'end_no' },
  ],
});

/**
 * Release Sign-off — the worked **batch-approval** example (ADR-0039 Track A2:
 * the sequential `map` / multi-instance node).
 *
 * "Every task in the release must be signed off, one at a time" is a **single
 * `map` node** over the task list. For each task it runs the
 * {@link OneTaskSignoffSubflow}, which **pauses** on its `approval`; when that
 * task is decided, the map **re-enters** and moves to the next task — the run
 * holds a single program counter throughout (no token tree). The per-task
 * decisions are collected into `signoffResults`, then the owner is notified.
 *
 * Trigger it with the tasks to sign off, e.g.:
 *   POST /api/v1/automation/showcase_release_signoff/trigger
 *   { "params": { "items": [ {task record}, {task record} ] } }
 * then decide each task's approval in turn via /api/v1/approvals.
 */
export const ReleaseSignoffFlow = defineFlow({
  name: 'showcase_release_signoff',
  label: 'Release Sign-off (batch approval / map)',
  description: 'Signs off every task in a release one at a time via a map node — demonstrates batch approval (ADR-0039 Track A2).',
  type: 'autolaunched',
  variables: [
    { name: 'items', type: 'list', isInput: true },
    { name: 'signoffResults', type: 'list', isOutput: true },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'signoffs',
      type: 'map',
      label: 'Sign off each task',
      config: {
        collection: '{items}',
        iteratorVariable: 'task',
        flowName: 'showcase_one_task_signoff',
        itemObject: 'showcase_task',
        outputVariable: 'signoffResults',
      },
    },
    {
      id: 'notify_done',
      type: 'notify',
      label: 'Notify: Release Cleared',
      config: {
        topic: 'release.signoff',
        recipients: ['admin@objectos.ai'],
        channels: ['inbox'],
        severity: 'info',
        title: 'Release sign-off complete',
        message: 'Every task in the release has been signed off.',
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'signoffs' },
    { id: 'e2', source: 'signoffs', target: 'notify_done' },
    { id: 'e3', source: 'notify_done', target: 'end' },
  ],
});


/**
 * Inbound Webhook → Task — the worked `trigger-api` example (ADR-0041 Tier 1).
 *
 * A `type: 'api'` flow waits for an external POST instead of a record change
 * or a schedule. The start node's config arms the hook:
 *
 *   POST /api/v1/automation/hooks/showcase_inbound_task_webhook/intake
 *   x-objectstack-signature: sha256=<hmac-sha256 of the raw body, key below>
 *   { "title": "...", "assignee": "...", "project": "<showcase_project id>" }
 *
 * The trigger validates the HMAC (constant-time), enqueues, and ACKs 202; a
 * queue consumer runs the flow with the JSON payload as the trigger record —
 * so `{record.title}` here reads straight from the webhook body, exactly like
 * a record-change flow reads its record.
 */
export const InboundTaskWebhookFlow = defineFlow({
  name: 'showcase_inbound_task_webhook',
  label: 'Inbound Task Webhook',
  description: 'Creates a task from an external system via the HMAC-verified inbound hook.',
  type: 'api',
  // An inbound webhook has no authenticated user, so the create must run as the
  // system principal (#1888 runAs is now enforced). Without this it relies on the
  // "no identity → security-skipped" fall-through, which breaks the moment the
  // target object carries row-level security.
  runAs: 'system',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Webhook',
      config: {
        triggerType: 'api',
        hookId: 'intake',
        // Demo secret — real deployments inject this from configuration.
        secret: 'showcase-webhook-secret',
      },
    },
    {
      id: 'create_task',
      type: 'create_record',
      label: 'Create Task',
      config: {
        objectName: 'showcase_task',
        fields: {
          title: '{record.title}',
          assignee: '{record.assignee}',
          project: '{record.project}',
          status: 'todo',
        },
        outputVariable: 'taskId',
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'create_task' },
    { id: 'e2', source: 'create_task', target: 'end' },
  ],
});

export const allFlows = [
  TaskCompletedFlow,
  ReassignWizardFlow,
  BudgetApprovalFlow,
  InvoiceDualSignoffFlow,
  OneTaskSignoffSubflow,
  ReleaseSignoffFlow,
  TaskCompletedSlackFlow,
  TaskAssignedNotifyFlow,
  ScheduledDigestFlow,
  TaskCompletedRestPingFlow,
  TaskFollowUpFlow,
  NotifyOwnerSubflow,
  TaskDoneNotifyOwnerFlow,
  ClosureSignoffSubflow,
  ProjectClosureFlow,
  BatchRemindersFlow,
  FanOutNotifyFlow,
  ResilientSyncFlow,
  ProjectEscalationFlow,
  InboundTaskWebhookFlow,
];
