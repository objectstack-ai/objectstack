// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Flow } from '@objectstack/spec/automation';

/** Task Reminder Flow — scheduled flow to send reminders for upcoming tasks */
export const TaskReminderFlow: Flow = {
  name: 'task_reminder',
  label: 'Task Reminder Notification',
  description: 'Automated flow to send reminders for tasks approaching their due date',
  type: 'schedule',
  // A scheduled run has no trigger user, so it must declare its elevation: this
  // daily sweep reads every user's tasks to remind them. (ADR-0049 / #1888)
  runAs: 'system',

  variables: [
    { name: 'tasksToRemind', type: 'record_collection', isInput: false, isOutput: false },
  ],

  nodes: [
    { id: 'start', type: 'start', label: 'Start (Daily 8 AM)', config: { schedule: '0 8 * * *', objectName: 'todo_task' } },
    {
      id: 'get_upcoming_tasks', type: 'get_record', label: 'Get Tasks Due Tomorrow',
      // `limit > 1` is the declared way to make this a LIST read (`find`, not
      // `findOne`) — the undeclared `getAll` that sat here was never read, so
      // this sweep silently fetched a single task (#4277 rejects the key now).
      config: { objectName: 'todo_task', filter: { due_date: '{tomorrow}', is_completed: false }, outputVariable: 'tasksToRemind', limit: 200 },
    },
    {
      id: 'loop_tasks', type: 'loop', label: 'Loop Through Tasks',
      config: { collection: '{tasksToRemind}', iteratorVariable: 'currentTask' },
    },
    {
      // `notify` is what actually delivers (#4343): it hands the messaging
      // service the notification — the in-app inbox by default, and email once
      // `@objectstack/plugin-email` is installed. The `script` node this
      // replaced only ever logged a line and reported success.
      id: 'send_reminder', type: 'notify', label: 'Send Reminder',
      config: {
        recipients: '{currentTask.owner}',
        title: 'Task due tomorrow: {currentTask.subject}',
        message: 'Due {currentTask.due_date} · priority {currentTask.priority}.',
        sourceObject: 'todo_task',
        sourceId: '{currentTask.id}',
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],

  edges: [
    { id: 'e1', source: 'start', target: 'get_upcoming_tasks', type: 'default' },
    { id: 'e2', source: 'get_upcoming_tasks', target: 'loop_tasks', type: 'default' },
    { id: 'e3', source: 'loop_tasks', target: 'send_reminder', type: 'default' },
    { id: 'e4', source: 'send_reminder', target: 'end', type: 'default' },
  ],
};

/** Overdue Task Escalation Flow */
export const OverdueEscalationFlow: Flow = {
  name: 'overdue_escalation',
  label: 'Overdue Task Escalation',
  description: 'Escalates tasks that have been overdue for more than 3 days',
  type: 'schedule',
  // A scheduled run has no trigger user; this daily sweep reads + escalates every
  // user's overdue tasks, so it must run elevated. (ADR-0049 / #1888)
  runAs: 'system',

  variables: [
    { name: 'overdueTasks', type: 'record_collection', isInput: false, isOutput: false },
  ],

  nodes: [
    { id: 'start', type: 'start', label: 'Start (Daily 9 AM)', config: { schedule: '0 9 * * *', objectName: 'todo_task' } },
    {
      id: 'get_overdue_tasks', type: 'get_record', label: 'Get Severely Overdue Tasks',
      // `limit > 1` = LIST read; the undeclared `getAll` was never read (#4277).
      config: {
        objectName: 'todo_task',
        filter: { due_date: { $lt: '{3_days_ago}' }, is_completed: false, is_overdue: true },
        outputVariable: 'overdueTasks', limit: 200,
      },
    },
    {
      id: 'loop_overdue', type: 'loop', label: 'Loop Through Overdue Tasks',
      config: { collection: '{overdueTasks}', iteratorVariable: 'currentTask' },
    },
    {
      id: 'update_priority', type: 'update_record', label: 'Escalate Priority',
      config: {
        objectName: 'todo_task',
        filter: { id: '{currentTask.id}' },
        fields: { priority: 'urgent', tags: ['important', 'follow_up'] },
      },
    },
    {
      id: 'notify_owner', type: 'notify', label: 'Notify Task Owner',
      config: {
        recipients: '{currentTask.owner}',
        title: 'URGENT: task overdue — {currentTask.subject}',
        message: 'Due {currentTask.due_date}, {currentTask.days_overdue} day(s) overdue.',
        severity: 'critical',
        sourceObject: 'todo_task',
        sourceId: '{currentTask.id}',
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],

  edges: [
    { id: 'e1', source: 'start', target: 'get_overdue_tasks', type: 'default' },
    { id: 'e2', source: 'get_overdue_tasks', target: 'loop_overdue', type: 'default' },
    { id: 'e3', source: 'loop_overdue', target: 'update_priority', type: 'default' },
    { id: 'e4', source: 'update_priority', target: 'notify_owner', type: 'default' },
    { id: 'e5', source: 'notify_owner', target: 'end', type: 'default' },
  ],
};

/** Task Completion Flow */
export const TaskCompletionFlow: Flow = {
  name: 'task_completion',
  label: 'Task Completion Process',
  description: 'Flow triggered when a task is marked as complete',
  type: 'record_change',
  // The other half of "arm it deliberately" (#6882). `draft` is the status the
  // schema applies when none is authored, and draft flows DO fire — so on a
  // flow that now genuinely routes, the omission is the ambiguity
  // `flow-draft-status-ambiguous` exists to report, and it started reporting
  // here the moment the trigger resolved (while the flow was dead it routed
  // nowhere, so even that rule skipped it). Declared, not silenced: `active`
  // says the firing is intended, which is exactly this card's decision. The two
  // schedule flows above keep their pre-existing `draft` — a separate call.
  status: 'active',

  variables: [
    // #6882 — `taskId` used to be declared here as an `isInput` variable and
    // read by `get_task` as `{taskId}`. Nothing ever bound it: a record-change
    // run seeds `params` from the triggering RECORD, which carries `id`, not
    // `taskId`, and `seedDeclaredVariables` binds an input only from
    // `context.params[name]` (or a `defaultValue`, #4697 — this had neither).
    // Invisible while the flow was dead; the first armed run failed at
    // `get_task` with "1 filter condition(s) resolved to nothing and were
    // dropped from the query: `{taskId}` (at id)". The triggering record is
    // already in scope as `record`, which is how every other record-change flow
    // in the corpus addresses it, so the declaration is gone rather than
    // re-plumbed — declared means bound.
    { name: 'completedTask', type: 'record', isInput: false, isOutput: false },
    // #7037 — the next due date, computed by the `compute_next_due_date` script
    // node below and persisted by `create_next_task`. Declared for the same
    // reason `showcase_task_completed` declares its `summary`: a script node's
    // `outputVariable` is the flow's contract with the node after it.
    { name: 'nextDueDate', type: 'date', isInput: false, isOutput: false },
  ],

  nodes: [
    // #6882 — this start node declared NEITHER of the two keys that arm a
    // record-change flow, so the flow was registered and never bound:
    //
    //   • no `triggerType` at all. `AutomationEngine.resolveTriggerBinding`
    //     claims a record-change flow only for a token starting with `record-`;
    //     with the key absent every later branch missed too (`timeRelative`,
    //     `config.schedule`, `flow.type === 'schedule'|'api'`) and the method
    //     returned `undefined`, so `activateFlowTrigger` returned without
    //     binding. `getTriggerBindingAudit` then SKIPS it (`if (!resolved)
    //     continue` — it reads as a manual/screen flow), which is why nothing
    //     anywhere reported the dead flow.
    //   • the predicate was written to `triggerCondition`, which no code reads.
    //     The trigger gate is `config.condition` — the key the binding copies
    //     and `execute()` evaluates. A node `config` is an open slot by design
    //     (ADR-0018), so the misspelling parsed silently; arming the trigger
    //     without moving it would have fired this flow on EVERY update.
    //
    // `record-after-update` (not `-write`): "marked as complete" is a
    // transition, so the insert leg has no `previous` to transition FROM — the
    // same shape the showcase's `showcase_task_completed` uses for this exact
    // semantic. Keeping insert out of the binding is also what makes the
    // predicate total: `previous` is bound to `null` on the insert leg, and
    // `previous.status` against `null` aborts the whole CEL predicate with
    // `No such key: status` (measured) rather than answering false.
    {
      id: 'start', type: 'start', label: 'Start',
      config: {
        objectName: 'todo_task',
        triggerType: 'record-after-update',
        condition: 'status == "completed" && previous.status != "completed"',
      },
    },
    {
      id: 'get_task', type: 'get_record', label: 'Get Completed Task',
      config: { objectName: 'todo_task', filter: { id: '{record.id}' }, outputVariable: 'completedTask' },
    },
    // A plain exclusive gateway — the branching is on the OUT-EDGES (e3/e4
    // carry the predicate and its negation). It used to also set
    // `config.condition`, which no executor reads: that key is the trigger gate
    // on a `start` node and inert everywhere else, so it was a third copy of the
    // same predicate, doing nothing (#4414).
    { id: 'check_recurring', type: 'decision', label: 'Is Recurring Task?' },
    // #7037 — the date arithmetic the recurrence needs, on the one surface that
    // actually evaluates anything.
    //
    // `due_date` below used to read
    // `DATEADD({completedTask.due_date}, {completedTask.recurrence_interval}, "…")`.
    // Two independent faults: `DATEADD` exists nowhere in the platform (not a
    // CEL builtin, not registered by `packages/formula` under any casing), and a
    // `create_record` node's `fields` are TEMPLATE-interpolated rather than
    // evaluated — the `{…}` holes are filled and the surrounding text passed
    // through verbatim. So the driver received the literal string
    // `DATEADD(2026-08-10, 1, "daily")` and refused the write with `Due Date
    // must be a valid date (ISO-8601)`, failing the whole run. Dead while the
    // flow was unbound; live on every recurring completion once #6882 armed it.
    //
    // Computing it here is not a stylistic preference — no flow node evaluates a
    // value-producing expression. The builtin vocabulary's only expression slots
    // are PREDICATES (`config.condition`, `edge.condition`,
    // `decision.conditions[].expression`, `screen.fields[].visibleWhen`) and
    // `flow-template` REFERENCES (`loop.collection`, `map.collection`) — the
    // ledger is `FLOW_NODE_EXPRESSION_PATHS` in `@objectstack/spec/automation`,
    // and an `assignment` node interpolates rather than evaluates. A `script`
    // node calling a registered function is the shipped way to compute a value
    // mid-flow (#1870), and the pure-function shape — takes `input`, RETURNS a
    // value, a later declarative node persists it (#4396) — is the one
    // `showcase_task_completed` already uses.
    {
      id: 'compute_next_due_date', type: 'script', label: 'Compute Next Due Date',
      config: {
        // Registered in `defineStack({ functions })` — see objectstack.config.ts
        // and src/functions/task.functions.ts.
        function: 'computeNextTaskDueDate',
        inputs: {
          dueDate: '{completedTask.due_date}',
          recurrenceType: '{completedTask.recurrence_type}',
          interval: '{completedTask.recurrence_interval}',
        },
        outputVariable: 'nextDueDate',
      },
    },
    {
      id: 'create_next_task', type: 'create_record', label: 'Create Next Recurring Task',
      config: {
        objectName: 'todo_task',
        fields: {
          subject: '{completedTask.subject}', description: '{completedTask.description}',
          priority: '{completedTask.priority}', category: '{completedTask.category}',
          owner: '{completedTask.owner}', is_recurring: true,
          recurrence_type: '{completedTask.recurrence_type}',
          recurrence_interval: '{completedTask.recurrence_interval}',
          // A whole-string token, so `interpolate()` hands the create the RAW
          // value the script node returned instead of a stringified copy.
          due_date: '{nextDueDate}',
          status: 'not_started', is_completed: false,
        },
        outputVariable: 'newTaskId',
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],

  edges: [
    { id: 'e1', source: 'start', target: 'get_task', type: 'default' },
    { id: 'e2', source: 'get_task', target: 'check_recurring', type: 'default' },
    // The recurring branch now runs `compute_next_due_date` first (#7037); the
    // gate itself is unchanged, so the non-recurring path still routes straight
    // to `end` and skips both nodes.
    { id: 'e3', source: 'check_recurring', target: 'compute_next_due_date', type: 'default', condition: 'vars.completedTask.is_recurring == true', label: 'Yes' },
    { id: 'e4', source: 'check_recurring', target: 'end', type: 'default', condition: 'vars.completedTask.is_recurring != true', label: 'No' },
    { id: 'e5', source: 'create_next_task', target: 'end', type: 'default' },
    { id: 'e6', source: 'compute_next_due_date', target: 'create_next_task', type: 'default' },
  ],
};

/** Quick Add Task Flow — screen flow for quickly adding tasks */
export const QuickAddTaskFlow: Flow = {
  name: 'quick_add_task',
  label: 'Quick Add Task',
  description: 'Screen flow for quickly creating a new task',
  type: 'screen',

  variables: [
    { name: 'subject', type: 'text', isInput: true, isOutput: false },
    { name: 'priority', type: 'text', isInput: true, isOutput: false },
    { name: 'dueDate', type: 'date', isInput: true, isOutput: false },
    { name: 'newTaskId', type: 'text', isInput: false, isOutput: true },
  ],

  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'screen_1', type: 'screen', label: 'Task Details',
      config: {
        // Select options are `{ value, label }` pairs (the screen contract's
        // shape — bare strings fail the executor's config parse, #4277).
        fields: [
          { name: 'subject', label: 'Task Subject', type: 'text', required: true },
          {
            name: 'priority', label: 'Priority', type: 'select', defaultValue: 'normal',
            options: [
              { value: 'low', label: 'Low' },
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
              { value: 'urgent', label: 'Urgent' },
            ],
          },
          { name: 'dueDate', label: 'Due Date', type: 'date', required: false },
          {
            name: 'category', label: 'Category', type: 'select',
            options: [
              { value: 'personal', label: 'Personal' },
              { value: 'work', label: 'Work' },
              { value: 'shopping', label: 'Shopping' },
              { value: 'health', label: 'Health' },
              { value: 'finance', label: 'Finance' },
              { value: 'other', label: 'Other' },
            ],
          },
        ],
      },
    },
    {
      id: 'create_task', type: 'create_record', label: 'Create Task',
      config: {
        objectName: 'todo_task',
        fields: { subject: '{subject}', priority: '{priority}', due_date: '{dueDate}', category: '{category}', status: 'not_started', owner: '{$User.Id}' },
        outputVariable: 'newTaskId',
      },
    },
    {
      id: 'success_screen', type: 'screen', label: 'Success',
      // The screen contract has no `message`/`buttons` keys — nothing ever
      // read them, so this "success screen" was an invisible pass-through
      // (#4277 rejects the keys now). `description` + `waitForInput: true`
      // is the declared way to pause on a message-only confirmation screen.
      config: {
        title: 'Task Created',
        description: 'Task "{subject}" created successfully!',
        waitForInput: true,
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],

  edges: [
    { id: 'e1', source: 'start', target: 'screen_1', type: 'default' },
    { id: 'e2', source: 'screen_1', target: 'create_task', type: 'default' },
    { id: 'e3', source: 'create_task', target: 'success_screen', type: 'default' },
    { id: 'e4', source: 'success_screen', target: 'end', type: 'default' },
  ],
};
