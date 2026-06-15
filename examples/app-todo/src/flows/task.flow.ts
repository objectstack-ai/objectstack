// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Flow } from '@objectstack/spec/automation';

/** Task Reminder Flow — scheduled flow to send reminders for upcoming tasks */
export const TaskReminderFlow: Flow = {
  name: 'task_reminder',
  label: 'Task Reminder Notification',
  description: 'Automated flow to send reminders for tasks approaching their due date',
  type: 'schedule',

  variables: [
    { name: 'tasksToRemind', type: 'record_collection', isInput: false, isOutput: false },
  ],

  nodes: [
    { id: 'start', type: 'start', label: 'Start (Daily 8 AM)', config: { schedule: '0 8 * * *', objectName: 'todo_task' } },
    {
      id: 'get_upcoming_tasks', type: 'get_record', label: 'Get Tasks Due Tomorrow',
      config: { objectName: 'todo_task', filter: { due_date: '{tomorrow}', is_completed: false }, outputVariable: 'tasksToRemind', getAll: true },
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

  variables: [
    { name: 'overdueTasks', type: 'record_collection', isInput: false, isOutput: false },
  ],

  nodes: [
    { id: 'start', type: 'start', label: 'Start (Daily 9 AM)', config: { schedule: '0 9 * * *', objectName: 'todo_task' } },
    {
      id: 'get_overdue_tasks', type: 'get_record', label: 'Get Severely Overdue Tasks',
      config: {
        objectName: 'todo_task',
        filter: { due_date: { $lt: '{3_days_ago}' }, is_completed: false, is_overdue: true },
        outputVariable: 'overdueTasks', getAll: true,
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
    {
      id: 'check_recurring', type: 'decision', label: 'Is Recurring Task?',
      config: { condition: 'vars.completedTask.is_recurring == true' },
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
        fields: [
          { name: 'subject', label: 'Task Subject', type: 'text', required: true },
          { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'], defaultValue: 'normal' },
          { name: 'dueDate', label: 'Due Date', type: 'date', required: false },
          { name: 'category', label: 'Category', type: 'select', options: ['personal', 'work', 'shopping', 'health', 'finance', 'other'] },
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
      config: {
        message: 'Task "{subject}" created successfully!',
        buttons: [
          { label: 'Create Another', action: 'restart' },
          { label: 'View Task', action: 'navigate', target: '/task/{newTaskId.id}' },
          { label: 'Done', action: 'finish' },
        ],
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
