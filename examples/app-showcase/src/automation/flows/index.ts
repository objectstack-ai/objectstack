// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineFlow } from '@objectstack/spec';
import { DynamicApprovalFlow } from './dynamic-approval.flow';
import { ApproverBindingsFlow } from './approver-bindings.flow';

/**
 * Task Completed → Notify — an autolaunched, record-triggered flow that fires
 * when a task transitions to Done, composes a one-line summary in a registered
 * function, and notifies the assignee.
 *
 * It also carries the two node types #4343 sorted out from each other:
 *
 *  - **`script`** calls a registered function (`defineStack({ functions })`) and
 *    binds its RETURN value to a flow variable. That is the whole of what the
 *    node does now — the `actionType` side effects it used to offer were
 *    logger-backed stubs that delivered nothing.
 *  - **`notify`** is the real delivery mechanism: it hands the messaging service
 *    the notification (the in-app inbox by default, email once
 *    `@objectstack/plugin-email` is installed).
 */
export const TaskCompletedFlow = defineFlow({
  name: 'showcase_task_completed',
  label: 'Notify on Task Completed',
  description: 'Summarizes a completed task in a registered function, then notifies its assignee.',
  type: 'autolaunched',
  status: 'active',
  variables: [
    { name: 'summary', type: 'string', isInput: false, isOutput: false },
  ],
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
      id: 'summarize',
      type: 'script',
      label: 'Compose Summary',
      config: {
        // Registered in `defineStack({ functions })` — see objectstack.config.ts.
        // A flow function is PURE: it takes `inputs`, RETURNS a value, and a
        // later declarative node uses or persists it (#4396).
        function: 'summarizeCompletedTask',
        inputs: { title: '{record.title}', priority: '{record.priority}' },
        outputVariable: 'summary',
      },
    },
    {
      id: 'notify',
      type: 'notify',
      label: 'Notify the assignee',
      config: {
        // A field ON the record — deliberately, so this flow stays the simple
        // specimen. The flow record carries `project` as a scalar id, so
        // `{record.project.owner}` would resolve to an empty string unless the
        // start node declared `expand: ['project']`; the sibling
        // `showcase_task_done_notify_owner` is where that hop is demonstrated.
        recipients: '{record.assignee}',
        title: '✅ Task done: {record.title}',
        message: '{summary}',
        sourceObject: 'showcase_task',
        sourceId: '{record.id}',
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'summarize' },
    { id: 'e2', source: 'summarize', target: 'notify' },
    { id: 'e3', source: 'notify', target: 'end' },
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
  status: 'active',
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
  status: 'active',
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
        approvers: [{ type: 'position', value: 'manager' }],
        behavior: 'first_response',
        // Deliberately UNLOCKED, and the counterpart to `exec_review` below —
        // together they dogfood both record-lock policies in one flow
        // (objectui#2902). A single-approver step like this is the case the
        // flag exists for: the manager is expected to correct the budget
        // narrative in place rather than send the whole thing back. It also
        // matches this node's own revise loop, which assumes the record is
        // reworkable. The console must show "in approval · editable" here and
        // keep inline editing live; on `exec_review` it must show the lock.
        lockRecord: false,
        // ADR-0044: at most two send-backs; the third auto-rejects.
        maxRevisions: 2,
      },
    },
    {
      // ADR-0044 revise window: the run parks here while the submitter reworks
      // the (now unlocked) record; their resubmit resumes it over the back-edge.
      //
      // `approval_revise`, not `wait` — the shape D3 originally prescribed and
      // its 2026-07-28 amendment reversed (#3823). This pause is service-owned:
      // `POST /api/v1/approvals/requests/:id/resubmit` is the only thing that
      // may end it (submitter-only, audited, refusing a colliding pending
      // request), and the descriptor says so with `resumeAuthority: 'service'`
      // so the generic run-resume route refuses it. A `wait` here was
      // raw-resumable by anyone holding the run id — hence no `waitEventConfig`
      // either: the window has no signal to wait on.
      id: 'wait_revision',
      type: 'approval_revise',
      label: 'Awaiting Revision',
    },
    // A plain exclusive gateway: the predicate is on the out-edges (e4/e5).
    // It also carried `config.condition` — inert on every node but `start`, and
    // the comment on those edges already said so. Keeping a copy that nothing
    // reads is the shape #4414 is about, so it is gone; `os validate` reports
    // it as `flow-inert-node-condition`.
    { id: 'needs_exec', type: 'decision', label: 'Budget Above $500k?' },
    {
      id: 'exec_review',
      type: 'approval',
      label: 'Executive Review',
      config: {
        approvers: [{ type: 'position', value: 'exec' }],
        behavior: 'unanimous',
        // Locked, unlike `manager_review` — a multi-approver sign-off must
        // decide on a stable record, so edits are refused until it completes.
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
    // Decision branching is edge-condition driven: the engine routes a decision
    // by evaluating each out-edge's `condition`, so the predicate lives here and
    // budgets ≤ $500k skip the executive step. These two are complementary, so
    // exactly one runs; the other correct spelling is one `condition` plus
    // `isDefault: true` on the fallback edge (#4414).
    { id: 'e4', source: 'needs_exec', target: 'exec_review', label: 'true', condition: 'budget > 500000' },
    { id: 'e5', source: 'needs_exec', target: 'approved', label: 'false', condition: 'budget <= 500000' },
    { id: 'e6', source: 'exec_review', target: 'approved', label: 'approve' },
    { id: 'e7', source: 'exec_review', target: 'rejected', label: 'reject' },
    // ADR-0044 send-back-for-revision loop on the manager step: revise walks
    // to the revise-window node; the resubmit edge is the declared back-edge
    // closing the cycle (type 'back' — excluded from DAG validation, traversed
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
  status: 'active',
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
  status: 'active',
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
 * `GET /api/v1/health`; the response body is captured on the flow run as the
 * declared output variable `ping.body` (`{ status: 'ok' }`), so the connector
 * dispatch is fully observable without any external service or credentials.
 */
export const TaskCompletedRestPingFlow = defineFlow({
  name: 'showcase_task_completed_rest_ping',
  label: 'REST Ping on Task Completed',
  description: 'Calls the local server health endpoint via the rest connector when a task is marked Done.',
  type: 'autolaunched',
  status: 'active',
  // Surface the health response on the run output. Nothing is captured on a run
  // unless the flow ASKS for it: the engine collects `run.output` from the
  // declared `isOutput` variables only (#7542). The `request` action of the
  // `rest` connector returns `{ status, ok, body }`, written back under
  // `${nodeId}.${key}` — so `ping.body` is the parsed `{ status: 'ok' }` payload.
  variables: [{ name: 'ping.body', type: 'json', isOutput: true }],
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
 * Declarative Connector Ping — the worked ADR-0097 example: a `connector_action`
 * dispatching a **provider-bound declarative connector instance**.
 *
 * Where {@link TaskCompletedRestPingFlow} targets the `rest` connector a *plugin*
 * registered (ConnectorRestPlugin, ADR-0018 §Addendum), this flow targets
 * `showcase_status_api` — a connector declared as pure metadata in
 * src/system/connectors/ and *materialized* into the registry at boot by the
 * `rest` generic executor (ADR-0097). Nothing registered it in code: the
 * `connectors:` entry named `provider: 'rest'`, and the automation service turned
 * it into a live connector. On task creation the flow issues `GET /api/v1/health`
 * through it; the response body is captured on the flow run as the declared
 * output variable `ping.body` (`{ status: 'ok' }`), proving the declarative path
 * dispatches end-to-end.
 */
export const ShowcaseDeclarativeConnectorPingFlow = defineFlow({
  name: 'showcase_declarative_connector_ping',
  label: 'Declarative Connector Ping (ADR-0097)',
  description:
    'Dispatches GET /api/v1/health through showcase_status_api — a provider-bound connector instance materialized from pure metadata at boot.',
  type: 'autolaunched',
  status: 'active',
  // Same as TaskCompletedRestPingFlow above: the materialized `showcase_status_api`
  // instance is built by the same `rest` factory, so its `request` action returns
  // `{ status, ok, body }` and `ping.body` carries the `{ status: 'ok' }` payload
  // onto `run.output` (#7542).
  variables: [{ name: 'ping.body', type: 'json', isOutput: true }],
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
      id: 'ping',
      type: 'connector_action',
      label: 'GET /api/v1/health (declarative)',
      connectorConfig: {
        connectorId: 'showcase_status_api',
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
 * MCP Connector Echo (ADR-0097 / #3056) — dispatches through the DECLARATIVE
 * MCP instance `showcase_mcp_tools` (src/system/connectors/index.ts), which the
 * `mcp` provider materialized at boot from the in-repo stdio fixture server:
 * its `tools/list` became the action list, and this `connector_action` invokes
 * the `echo_upper` tool via `tools/call`. The run's captured output
 * (`structuredContent.upper === 'OBJECTSTACK'`) proves the full chain —
 * metadata entry → provider factory → MCP handshake → flow dispatch — with no
 * external dependency. Completes the `provider: 'mcp'` acceptance demo from
 * ADR-0097 §6, deferred at #3017.
 */
export const ShowcaseMcpConnectorEchoFlow = defineFlow({
  name: 'showcase_mcp_connector_echo',
  label: 'MCP Connector Echo (ADR-0097)',
  description:
    'Dispatches the echo_upper tool of showcase_mcp_tools — a declarative MCP connector instance materialized ' +
    'at boot from the in-repo stdio fixture (scripts/mcp-fixture.mjs).',
  type: 'autolaunched',
  status: 'active',
  // Surface the tool result on the run output, so the flow run view (and the
  // dogfood proof) can assert the MCP round-trip observably.
  variables: [{ name: 'echo.structuredContent', type: 'json', isOutput: true }],
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
      id: 'echo',
      type: 'connector_action',
      label: 'echo_upper via MCP (declarative)',
      connectorConfig: {
        connectorId: 'showcase_mcp_tools',
        actionId: 'echo_upper',
        input: { text: 'objectstack' },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'echo' },
    { id: 'e2', source: 'echo', target: 'end' },
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
  status: 'active',
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
      // No `onTimeout`: it was retired in #4158 because nothing ever read it —
      // `wait` has no timeout, and this run resumes when the timer elapses.
      waitEventConfig: { eventType: 'timer', timerDuration: 'PT1M' },
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
  status: 'active',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Task Done',
      config: {
        objectName: 'showcase_task',
        triggerType: 'record-after-update',
        condition: 'status == "done" && previous.status != "done"',
        // The SAME resume-time trap this flow's sibling hit (#7381): the node
        // below hops `{record.project.owner}`, and a flow record carries
        // `project` as a scalar FK. Un-hydrated it resolved to nothing, the
        // subflow's `notify` refused for want of a recipient, and every
        // completion of a task ran this flow to a failure. Unlike the invoice
        // case the hop is sound — `showcase_project.owner` is a real, seeded
        // field — so the relation only needed declaring.
        expand: ['project'],
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
        approvers: [{ type: 'position', value: 'manager' }],
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
  status: 'active',
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
              type: 'notify',
              label: 'Send Reminder',
              config: {
                recipients: '{task.owner}',
                title: 'Reminder ({taskIndex}): {task.title}',
                sourceObject: 'showcase_task',
                sourceId: '{task.id}',
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
  status: 'active',
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
            name: 'Notify the owner',
            nodes: [
              {
                id: 'notify_owner',
                type: 'notify',
                label: 'Notify Owner',
                config: {
                  recipients: '{record.assignee}',
                  title: '✅ Done: {record.title}',
                  sourceObject: 'showcase_task',
                  sourceId: '{record.id}',
                },
              },
            ],
            edges: [],
          },
          {
            // Slack is a CONNECTOR, not a notify channel (#4343): post through
            // an incoming webhook, or a `connector_action` with the Slack
            // connector. The retired `script` + `actionType: 'slack'` shape
            // logged a line and delivered nothing.
            name: 'Post to Slack',
            nodes: [
              {
                id: 'slack_post',
                type: 'http',
                label: 'Slack Notify',
                config: {
                  url: 'https://hooks.slack.com/services/T000/B000/XXXX',
                  method: 'POST',
                  body: { channel: '#tasks', text: 'Task done: {record.title}' },
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
  status: 'active',
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
        // Canonical retry policy (`@objectstack/spec` 17.0.0, #4661): the base
        // delay is `backoffMs` on BOTH `try_catch.retry` and `job.retryPolicy`.
        // The pre-17 automation-side spelling `retryDelayMs` is tombstoned and
        // only survives via the `retry-policy-converged` conversion, which
        // retires in protocol 18 — never author it. `maxRetryDelayMs` is NOT
        // part of that rename: it is a canonical key of `RetryPolicySchema`
        // (the ceiling for a single backoff delay).
        retry: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2, maxRetryDelayMs: 10000 },
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
 * Decide via the approvals API — a raw engine `resume` is refused, not merely
 * discouraged: the `approval` node declares `resumeAuthority: 'service'`, so
 * the generic run-resume route answers 403 for a run parked on one (#3801).
 *   POST /api/v1/automation/showcase_invoice_signoff/runs/{runId}/resume  ← 403
 *   POST /api/v1/approvals/requests/{id}/approve  { actorId: 'position:finance' }
 *   POST /api/v1/approvals/requests/{id}/approve  { actorId: 'position:legal' }   ← now it continues
 */
export const InvoiceDualSignoffFlow = defineFlow({
  name: 'showcase_invoice_signoff',
  label: 'Invoice Dual Sign-off (parallel approval)',
  description: 'On send, requires finance AND legal to both approve via one aggregating approval node — demonstrates parallel approvals without a token tree (ADR-0039 Track A).',
  type: 'autolaunched',
  status: 'active',
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
        // #3475 opt-in single-hop hydration. A flow record carries `account` as
        // a scalar FK, so `{record.account.*}` reads nothing unless the relation
        // is declared here; the engine re-reads it once, before the run starts,
        // and the expanded object is part of the run state that survives the
        // approval pause — which is why `notify_cleared` can still read it at
        // RESUME time, hours or days later (#7381).
        expand: ['account'],
      },
    },
    {
      id: 'dual_signoff',
      type: 'approval',
      label: 'Finance + Legal Sign-off',
      config: {
        // Two approver groups, notified in parallel; `unanimous` waits for both.
        approvers: [
          { type: 'position', value: 'finance' },
          { type: 'position', value: 'legal' },
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
        // The INVOICE's own owner, not `{record.account.owner}` (#7381).
        // `showcase_account` has no `owner` field at all — its people-ish keys
        // are `billing_email` and the injected `owner_id` — so that hop resolved
        // to nothing however the relation was hydrated, and the notify node
        // refuses a run with no recipients: approving the demo stranded its run
        // instead of delivering this message. `showcase_invoice.owner` is the
        // seeded rep (the same RLS anchor the contributor permission set uses),
        // which is who "your invoice cleared sign-off" is addressed to anyway.
        recipients: ['{record.owner}'],
        channels: ['inbox'],
        severity: 'info',
        // The expanded relation is read HERE — `{record.account.name}` is what
        // makes the start node's `expand: ['account']` live rather than inert,
        // and it is the hydration path this kitchen-sink flow exists to teach.
        title: 'Invoice cleared: {record.name}',
        message: 'Invoice "{record.name}" for {record.account.name} passed finance + legal sign-off and is on its way.',
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
  status: 'active',
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
            nodes: [{ id: 'alert_owner', type: 'notify', label: 'Alert Owner', config: { recipients: '{record.owner}', title: '🔴 Critical: {record.name}', severity: 'critical', sourceObject: 'showcase_project', sourceId: '{record.id}' } }],
            edges: [],
          },
          {
            name: 'Exec',
            nodes: [{ id: 'alert_exec', type: 'notify', label: 'Alert Exec', config: { recipients: 'exec@example.com', title: '🔴 Critical project: {record.name}', severity: 'critical', sourceObject: 'showcase_project', sourceId: '{record.id}' } }],
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
        // Canonical `backoffMs` — see the note on ResilientSyncFlow above.
        retry: { maxRetries: 2, backoffMs: 500, backoffMultiplier: 2 },
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
  variables: [{ name: 'decision', type: 'text', isOutput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'review',
      type: 'approval',
      label: 'Task Sign-off',
      config: {
        approvers: [{ type: 'position', value: 'manager' }],
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
  status: 'active',
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

/**
 * Inquiry Purge — the worked `get_record` + `delete_record` example, closing
 * the CRUD node quartet (create: InboundTaskWebhookFlow · update:
 * ReassignWizardFlow · get + delete: here). A janitor flow: fetch the
 * already-closed inquiries (records mode), gate on whether any exist, delete
 * by the same filter, and report. Config keys follow the executor contract
 * exactly — `objectName` + `filter` + the declared bulk intent `multi`
 * (Prime Directive #12: no `object`/`filters` aliases). `runAs: 'system'`
 * because a janitor acts
 * across owners; autolaunched with no record trigger — invoke it on demand
 * (API/subflow) rather than on every write.
 */
export const InquiryPurgeFlow = defineFlow({
  name: 'showcase_inquiry_purge',
  label: 'Purge Closed Inquiries',
  description: 'Deletes inquiries already marked closed — demonstrates get_record + delete_record.',
  type: 'autolaunched',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'purge_check',
      type: 'get_record',
      label: 'Find closed inquiries',
      // `limit > 1` is what makes this a LIST read (`find`, not `findOne`) — the
      // executor has no `mode` key, so a `mode: 'records'` used to sit here doing
      // nothing while the comment credited it for the behaviour `limit` actually
      // produced (found by the #4045 unknown-config-key check). `outputVariable`
      // then lands the array in the variable context, where the out-edge CEL below
      // reads it — the engine routes on EDGE conditions, same contract as
      // BudgetApprovalFlow's gate.
      config: {
        objectName: 'showcase_inquiry',
        filter: { status: 'closed' },
        limit: 200,
        outputVariable: 'closedInquiries',
      },
    },
    { id: 'any_found', type: 'decision', label: 'Anything to purge?' },
    {
      id: 'purge',
      type: 'delete_record',
      label: 'Delete them',
      // `multi: true` is what makes this a PREDICATE delete — and without it the
      // node had never deleted anything: the data engine accepts a delete only
      // when `filter` names one row by scalar `id`, so every run of this flow
      // failed here with `Delete requires an ID or options.multi=true` and
      // reported `acted: 0` (#5225, found by the #5112 boot probes). No bulk
      // spelling existed on this node's config at all until #5393/PR #5485
      // declared one; the engine's refusal was the contract working, not a bug
      // to route around — which is why the fix is this declaration and not a
      // get→loop→delete-by-id rewrite (PD #5).
      //
      // ⚠️ `filter` is NOT optional decoration here: `multi: true` with an
      // absent or empty `filter` is a declared WHOLE-OBJECT delete. This node is
      // the reference for "bulk intent, bounded by a predicate" — the shape the
      // #5482 lint rule must leave at zero warnings.
      config: { objectName: 'showcase_inquiry', filter: { status: 'closed' }, multi: true },
    },
    {
      id: 'report',
      type: 'notify',
      label: 'Report cleanup',
      // `recipients` + `title` are the notify contract's required pair — this
      // node used to omit both, so every purge run FAILED here at execute time
      // (found when the executors started parsing their config, #4277).
      config: { topic: 'inquiry_purge', recipients: ['admin@objectos.ai'], title: 'Closed inquiries purged', message: 'Closed inquiries purged.' },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'purge_check' },
    { id: 'e2', source: 'purge_check', target: 'any_found' },
    { id: 'e3', source: 'any_found', target: 'purge', label: 'yes', condition: 'size(closedInquiries) > 0' },
    { id: 'e4', source: 'any_found', target: 'end', label: 'no', condition: 'size(closedInquiries) == 0' },
    { id: 'e5', source: 'purge', target: 'report' },
    { id: 'e6', source: 'report', target: 'end' },
  ],
});

/**
 * Expense Sign-off (#3266) — a `per_group` approval demonstrating 会签: a
 * MANAGER **and** a FINANCE/audit approver must EACH sign off (one from each
 * group) before a submitted expense report is approved; either rejection
 * vetoes. Where {@link BudgetApprovalFlow} chains position steps in series,
 * this gates a SINGLE node on two groups at once — the node-internal parallel
 * pattern (钉钉/Salesforce style) that needs no parallel branches. Set
 * `minApprovals` > 1 for "two from each group"; use `behavior: 'quorum'` +
 * `minApprovals` for M-of-N collective sign-off.
 */
export const ExpenseSignoffFlow = defineFlow({
  name: 'showcase_expense_signoff',
  label: 'Expense Report Sign-off',
  description: 'Manager + finance per-group sign-off (会签) on a submitted expense report (#3266).',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Submitted',
      config: {
        objectName: 'showcase_expense_report',
        triggerType: 'record-after-update',
        condition: 'status == "submitted" && previous.status != "submitted"',
      },
    },
    {
      id: 'dual_signoff',
      type: 'approval',
      label: 'Manager + Finance Sign-off',
      config: {
        approvers: [
          { type: 'position', value: 'manager', group: 'manager' },
          { type: 'position', value: 'auditor', group: 'finance' },
        ],
        behavior: 'per_group',
        minApprovals: 1,
        lockRecord: true,
      },
    },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'dual_signoff' },
    { id: 'e2', source: 'dual_signoff', target: 'approved', label: 'approve' },
    { id: 'e3', source: 'dual_signoff', target: 'rejected', label: 'reject' },
  ],
});

/**
 * Committee Quorum (#3266) — a `quorum` (M-of-N) approval, the collective
 * sign-off complement to {@link ExpenseSignoffFlow}'s per-group 会签. A
 * high-value expense report needs **any 2 of 3** committee members (manager /
 * finance / legal) to approve; a single rejection still vetoes, and
 * `minApprovals` clamps to the approver count so a misconfiguration can never
 * deadlock. Where `per_group` requires one from EACH group, `quorum` counts a
 * flat tally across all approvers.
 */
export const CommitteeQuorumFlow = defineFlow({
  name: 'showcase_committee_quorum',
  label: 'High-Value Expense — Committee Quorum',
  description: 'Any 2-of-3 committee members approve a high-value expense report (#3266 quorum / M-of-N).',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On High-Value Submitted',
      config: {
        objectName: 'showcase_expense_report',
        triggerType: 'record-after-update',
        condition: 'status == "submitted" && previous.status != "submitted" && total_amount >= 5000',
      },
    },
    {
      id: 'committee',
      type: 'approval',
      label: 'Committee Sign-off (2 of 3)',
      config: {
        approvers: [
          { type: 'position', value: 'manager' },
          { type: 'position', value: 'finance' },
          { type: 'position', value: 'legal' },
        ],
        behavior: 'quorum',
        minApprovals: 2,
        lockRecord: true,
      },
    },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'committee' },
    { id: 'e2', source: 'committee', target: 'approved', label: 'approve' },
    { id: 'e3', source: 'committee', target: 'rejected', label: 'reject' },
  ],
});

/**
 * Task Due Reminder (#1874) — a declarative `timeRelative` sweep, far more
 * robust than a `record_change` flow gated on `due_date == daysFromNow(n)`
 * (which fires only if the task happens to be edited on the exact threshold
 * day). A daily sweep launches this flow **once per matching task** at T-minus
 * 3 and 1 days before its `due_date`, with the task on the flow context. Swap
 * `offsetDays` for `withinDays: 7` to nudge everything due within a week
 * (negative = overdue lookback).
 */
export const TaskDueReminderFlow = defineFlow({
  name: 'showcase_task_due_reminder',
  label: 'Task Due Reminder',
  description: 'Daily sweep: remind the owner 3 and 1 days before an open task is due (#1874 time-relative).',
  type: 'schedule',
  status: 'active',
  runAs: 'system', // a sweep has no trigger user — elevate explicitly
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'Daily Sweep',
      config: {
        timeRelative: {
          object: 'showcase_task',
          dateField: 'due_date',
          offsetDays: [3, 1], // — or — withinDays: 7 (negative = overdue lookback)
          filter: { status: { $ne: 'done' } }, // optional, ANDed with the date window
        },
        // schedule defaults to daily 08:00 UTC; override with
        // schedule: { type: 'cron', expression: '0 8 * * *' }
      },
    },
    {
      id: 'remind_owner',
      type: 'notify',
      label: 'Remind Owner',
      config: {
        topic: 'task.due_soon',
        // The contract's required audience — this node used to omit it, so
        // every sweep run FAILED here ("at least one recipient is required")
        // and the #1874 demo never delivered (surfaced by #4277's parse).
        recipients: ['{record.assignee}'],
        channels: ['inbox'],
        severity: 'warning',
        title: 'Task due soon: {record.title}',
        message: 'Your task "{record.title}" is due on {record.due_date}.',
        actionUrl: '/showcase_task',
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'remind_owner' },
    { id: 'e2', source: 'remind_owner', target: 'end' },
  ],
});

/**
 * Urgent Task Alert — a single `record-after-write` flow that fires on BOTH
 * create and update (#3427), so "a task was created urgent OR just escalated to
 * urgent" is one flow, not two near-identical copies.
 *
 * `record-after-write` binds afterInsert + afterUpdate; exactly one fires per
 * mutation. The start condition uses the create/update discrimination the write
 * trigger enables: `previous == null` is the create leg (no prior row), so the
 * `||` also matches a brand-new urgent task; on the update leg it fires only when
 * priority actually crosses INTO 'urgent' (not on every later save while urgent).
 */
export const UrgentTaskAlertFlow = defineFlow({
  name: 'showcase_urgent_task_alert',
  label: 'Alert on Urgent Task (created or escalated)',
  description:
    'One record-after-write flow: notifies when a task is created as Urgent or its priority is raised to Urgent.',
  type: 'record_change',
  status: 'active',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Task Created or Updated',
      config: {
        objectName: 'showcase_task',
        // create OR update in one flow (#3427)
        triggerType: 'record-after-write',
        // Fire on the transition into 'urgent': a freshly-created urgent task
        // (previous == null) OR an escalation (previous.priority != 'urgent').
        condition: "priority == 'urgent' && (previous == null || previous.priority != 'urgent')",
      },
    },
    {
      id: 'alert',
      type: 'notify',
      label: 'Notify Assignee',
      config: {
        topic: 'task.urgent',
        // Notify the assignee; fall back to whoever raised the priority
        // (`{$User.Id}` = the triggering user) so an as-yet-unassigned urgent task
        // still pings someone. Empty recipients are dropped, so the fallback only
        // applies when `assignee` is unset.
        recipients: ['{record.assignee}', '{$User.Id}'],
        channels: ['inbox'],
        severity: 'warning',
        title: 'Urgent task: {record.title}',
        message: 'Task "{record.title}" is now Urgent — it needs attention.',
        actionUrl: '/showcase_task',
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'alert' },
    { id: 'e2', source: 'alert', target: 'end' },
  ],
});

export const allFlows = [
  TaskCompletedFlow,
  UrgentTaskAlertFlow,
  ExpenseSignoffFlow,
  CommitteeQuorumFlow,
  TaskDueReminderFlow,
  ReassignWizardFlow,
  InquiryPurgeFlow,
  BudgetApprovalFlow,
  InvoiceDualSignoffFlow,
  OneTaskSignoffSubflow,
  ReleaseSignoffFlow,
  TaskCompletedSlackFlow,
  TaskAssignedNotifyFlow,
  ScheduledDigestFlow,
  TaskCompletedRestPingFlow,
  ShowcaseDeclarativeConnectorPingFlow,
  ShowcaseMcpConnectorEchoFlow,
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
  // #3447 P2 dogfood: expression approvers + decision outputs, end to end.
  DynamicApprovalFlow,
  // #3508 dogfood: one approval node per record-backed approver kind, so the
  // designer's Value control has a specimen for each. Draft on purpose — see
  // the module docstring.
  ApproverBindingsFlow,
];
