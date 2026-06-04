// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Action } from '@objectstack/spec/ui';

/** Mark Task as Complete */
export const CompleteTaskAction: Action = {
  name: 'complete_task',
  label: 'Mark Complete',
  objectName: 'todo_task',
  icon: 'check-circle',
  type: 'script',
  target: 'completeTask',
  locations: ['record_header', 'list_item'],
  successMessage: 'Task marked as complete!',
  refreshAfter: true,
  ai: {
    exposed: true,
    description: 'Mark a todo task as complete. Use when the user says a task is done or finished.',
  },
};

/** Mark Task as In Progress */
export const StartTaskAction: Action = {
  name: 'start_task',
  label: 'Start Task',
  objectName: 'todo_task',
  icon: 'play-circle',
  type: 'script',
  target: 'startTask',
  locations: ['record_header', 'list_item'],
  successMessage: 'Task started!',
  refreshAfter: true,
  ai: {
    exposed: true,
    description: 'Mark a todo task as in progress. Use when the user says they are starting or working on a task.',
  },
};

/** Defer Task */
export const DeferTaskAction: Action = {
  name: 'defer_task',
  label: 'Defer Task',
  objectName: 'todo_task',
  icon: 'clock',
  type: 'modal',
  target: 'defer_task_modal',
  locations: ['record_header'],
  params: [
    {
      name: 'new_due_date',
      label: 'New Due Date',
      type: 'date',
      required: true,
    },
    {
      name: 'reason',
      label: 'Reason for Deferral',
      type: 'textarea',
      required: false,
    }
  ],
  successMessage: 'Task deferred successfully!',
  refreshAfter: true,
};

/** Set Reminder */
export const SetReminderAction: Action = {
  name: 'set_reminder',
  label: 'Set Reminder',
  objectName: 'todo_task',
  icon: 'bell',
  type: 'modal',
  target: 'set_reminder_modal',
  locations: ['record_header', 'list_item'],
  params: [
    {
      name: 'reminder_date',
      label: 'Reminder Date/Time',
      type: 'datetime',
      required: true,
    }
  ],
  successMessage: 'Reminder set!',
  refreshAfter: true,
};

/** Clone Task */
export const CloneTaskAction: Action = {
  name: 'clone_task',
  label: 'Clone Task',
  objectName: 'todo_task',
  icon: 'copy',
  type: 'script',
  target: 'cloneTask',
  locations: ['record_header'],
  successMessage: 'Task cloned successfully!',
  refreshAfter: true,
  ai: {
    exposed: true,
    description: 'Duplicate an existing todo task, copying its fields into a new task record.',
  },
};

/** Mass Complete Tasks */
export const MassCompleteTasksAction: Action = {
  name: 'mass_complete',
  label: 'Complete Selected',
  objectName: 'todo_task',
  icon: 'check-square',
  type: 'script',
  target: 'massCompleteTasks',
  locations: ['list_toolbar'],
  successMessage: 'Selected tasks marked as complete!',
  refreshAfter: true,
  ai: {
    exposed: true,
    description: 'Mark all currently selected todo tasks as complete in one bulk operation.',
  },
};

/** Delete Completed Tasks */
export const DeleteCompletedAction: Action = {
  name: 'delete_completed',
  label: 'Delete Completed',
  objectName: 'todo_task',
  icon: 'trash-2',
  type: 'script',
  target: 'deleteCompletedTasks',
  locations: ['list_toolbar'],
  // Destructive + irreversible — flag as danger so Studio paints it red
  // and the AI tool runtime routes through the HITL approval queue when
  // `enableActionApproval` is on.
  variant: 'danger',
  confirmText: 'Permanently delete all completed tasks? This cannot be undone.',
  successMessage: 'Completed tasks deleted!',
  refreshAfter: true,
  ai: {
    exposed: true,
    description:
      'Permanently delete every completed todo task. Destructive and irreversible — only after the user confirms.',
    // confirmText + variant:'danger' default this to requiring HITL approval;
    // it registers only when enableActionApproval is on, then routes to the queue.
  },
};

/** Export Tasks to CSV */
export const ExportToCsvAction: Action = {
  name: 'export_csv',
  label: 'Export to CSV',
  objectName: 'todo_task',
  icon: 'download',
  type: 'script',
  target: 'exportTasksToCSV',
  locations: ['list_toolbar'],
  successMessage: 'Export completed!',
  refreshAfter: false,
  ai: {
    exposed: true,
    description: 'Export the current list of todo tasks to a downloadable CSV file.',
  },
};
