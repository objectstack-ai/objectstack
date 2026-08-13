// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';

/**
 * English (en) — Todo App Translations
 *
 * Per-locale file: one file per language, following the `per_locale` convention.
 * Each file exports a single `TranslationData` object for its locale.
 */
export const en: TranslationData = {
  objects: {
    todo_task: {
      label: 'Task',
      pluralLabel: 'Tasks',
      fields: {
        subject: { label: 'Subject', help: 'Brief title of the task' },
        description: { label: 'Description' },
        status: {
          label: 'Status',
          options: {
            not_started: 'Not Started',
            in_progress: 'In Progress',
            waiting: 'Waiting',
            completed: 'Completed',
            deferred: 'Deferred',
          },
        },
        priority: {
          label: 'Priority',
          options: {
            low: 'Low',
            normal: 'Normal',
            high: 'High',
            urgent: 'Urgent',
          },
        },
        category: {
          label: 'Category',
          options: {
            personal: 'Personal',
            work: 'Work',
            shopping: 'Shopping',
            health: 'Health',
            finance: 'Finance',
            other: 'Other',
          },
        },
        due_date: { label: 'Due Date' },
        reminder_date: { label: 'Reminder Date/Time' },
        completed_date: { label: 'Completed Date' },
        owner: { label: 'Assigned To' },
        tags: {
          label: 'Tags',
          options: {
            important: 'Important',
            quick_win: 'Quick Win',
            blocked: 'Blocked',
            follow_up: 'Follow Up',
            review: 'Review',
          },
        },
        is_recurring: { label: 'Recurring Task' },
        recurrence_type: {
          label: 'Recurrence Type',
          options: {
            daily: 'Daily',
            weekly: 'Weekly',
            monthly: 'Monthly',
            yearly: 'Yearly',
          },
        },
        recurrence_interval: { label: 'Recurrence Interval' },
        progress_percent: { label: 'Progress (%)' },
        estimated_hours: { label: 'Estimated Hours' },
        actual_hours: { label: 'Actual Hours' },
        notes: { label: 'Notes' },
        category_color: { label: 'Category Color' },
      },
    },
  },
  apps: {
    todo_app: {
      label: 'Todo Manager',
      description: 'Personal task management application',
    },
  },
  messages: {
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.create': 'Create',
    'common.search': 'Search',
    'common.filter': 'Filter',
    'common.sort': 'Sort',
    'common.refresh': 'Refresh',
    'common.export': 'Export',
    'common.back': 'Back',
    'common.confirm': 'Confirm',
    'success.saved': 'Successfully saved',
    'success.deleted': 'Successfully deleted',
    'success.completed': 'Task marked as completed',
    'confirm.delete': 'Are you sure you want to delete this task?',
    'confirm.complete': 'Mark this task as completed?',
    'error.required': 'This field is required',
    'error.load_failed': 'Failed to load data',
  },
  // `validationMessages` retired in spec 17.0.0 (#4667) — no resolver ever read
  // it, so the zh-CN / ja-JP strings here were never rendered and the `en` ones
  // merely duplicated the rule's own text. The live home for these messages is
  // `validations[].message` on the task object.
};
