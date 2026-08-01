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
      id: 'send_reminder', type: 'script', label: 'Send Reminder Email',
      config: {
        actionType: 'email',
        inputs: {
          to: '{currentTask.owner.email}',
          subject: 'Task Due Tomorrow: {currentTask.subject}',
          template: 'task_reminder_email',
          data: { taskSubject: '{currentTask.subject}', dueDate: '{currentTask.due_date}', priority: '{currentTask.priority}' },
        },
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
      id: 'notify_owner', type: 'script', label: 'Notify Task Owner',
      config: {
        actionType: 'email',
        inputs: {
          to: '{currentTask.owner.email}',
          subject: 'URGENT: Task Overdue - {currentTask.subject}',
          template: 'overdue_escalation_email',
          data: { taskSubject: '{currentTask.subject}', dueDate: '{currentTask.due_date}', daysOverdue: '{currentTask.days_overdue}' },
        },
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

  variables: [
    { name: 'taskId', type: 'text', isInput: true, isOutput: false },
    { name: 'completedTask', type: 'record', isInput: false, isOutput: false },
  ],

  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { objectName: 'todo_task', triggerCondition: 'record.status != previous.status && record.status == "completed"' } },
    {
      id: 'get_task', type: 'get_record', label: 'Get Completed Task',
      config: { objectName: 'todo_task', filter: { id: '{taskId}' }, outputVariable: 'completedTask' },
    },
    // A plain exclusive gateway — the branching is on the OUT-EDGES (e3/e4
    // carry the predicate and its negation). It used to also set
    // `config.condition`, which no executor reads: that key is the trigger gate
    // on a `start` node and inert everywhere else, so it was a third copy of the
    // same predicate, doing nothing (#4414).
    { id: 'check_recurring', type: 'decision', label: 'Is Recurring Task?' },
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
          due_date: 'DATEADD({completedTask.due_date}, {completedTask.recurrence_interval}, "{completedTask.recurrence_type}")',
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
    { id: 'e3', source: 'check_recurring', target: 'create_next_task', type: 'default', condition: 'vars.completedTask.is_recurring == true', label: 'Yes' },
    { id: 'e4', source: 'check_recurring', target: 'end', type: 'default', condition: 'vars.completedTask.is_recurring != true', label: 'No' },
    { id: 'e5', source: 'create_next_task', target: 'end', type: 'default' },
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
