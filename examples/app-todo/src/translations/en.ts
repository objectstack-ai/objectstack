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
  // `messages` ids are single-segment, and that is the whole contract, not a
  // style preference: `t()` resolves a key by walking its dot path
  // (`key.split('.')`, identically in `packages/core/src/fallbacks/memory-i18n.ts`
  // and `packages/services/service-i18n/src/file-i18n-adapter.ts`), while
  // `messages` is a FLAT `Record<string, string>`. So an id that merely
  // *contains* a dot — `'common.save'` — is one key NAMED `common.save`, and
  // `t('messages.common.save', …)` looks for a nested `common` object, finds
  // none, and returns the key string. `messages.commonSave` resolves (#18566).
  // Rule: `content/docs/protocol/kernel/i18n-standard.mdx`; proof that these
  // ids reach a value through both implementations:
  // `./message-id-resolution.test.ts`.
  messages: {
    commonSave: 'Save',
    commonCancel: 'Cancel',
    commonDelete: 'Delete',
    commonEdit: 'Edit',
    commonCreate: 'Create',
    commonSearch: 'Search',
    commonFilter: 'Filter',
    commonSort: 'Sort',
    commonRefresh: 'Refresh',
    commonExport: 'Export',
    commonBack: 'Back',
    commonConfirm: 'Confirm',
    successSaved: 'Successfully saved',
    successDeleted: 'Successfully deleted',
    successCompleted: 'Task marked as completed',
    confirmDelete: 'Are you sure you want to delete this task?',
    confirmComplete: 'Mark this task as completed?',
    errorRequired: 'This field is required',
    errorLoadFailed: 'Failed to load data',
  },
  // `validationMessages` retired in spec 17.0.0 (#4667) — no resolver ever read
  // it, so the zh-CN / ja-JP strings here were never rendered and the `en` ones
  // merely duplicated the rule's own text. The live home for these messages is
  // `validations[].message` on the task object.
};
