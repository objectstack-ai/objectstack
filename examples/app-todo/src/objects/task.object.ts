import { P } from '@objectstack/spec';
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

export const Task = ObjectSchema.create({
  name: 'todo_task',
  // [ADR-0090 D1] Explicit grandfather stamp: this demo object is
  // intentionally org-shared; without it the secure default (unset OWD =>
  // private) owner-filters it and the D7 publish linter fails the build.
  sharingModel: 'public_read_write',
  label: 'Task',
  pluralLabel: 'Tasks',
  icon: 'check-square',
  description: 'Personal tasks and to-do items',
  
  fields: {
    // Task Information
    subject: Field.text({
      label: 'Subject',
      required: true,
      searchable: true,
      maxLength: 255,
    }),
    
    description: Field.markdown({
      label: 'Description',
    }),
    
    // Task Management
    status: Field.select({
      label: 'Status',
      required: true,
      options: [
        { label: 'Not Started', value: 'not_started', color: '#808080', default: true },
        { label: 'In Progress', value: 'in_progress', color: '#3B82F6' },
        { label: 'Waiting', value: 'waiting', color: '#F59E0B' },
        { label: 'Completed', value: 'completed', color: '#10B981' },
        { label: 'Deferred', value: 'deferred', color: '#6B7280' },
      ]
    }),
    
    priority: Field.select({
      label: 'Priority',
      required: true,
      options: [
        { label: 'Low', value: 'low', color: '#60A5FA', default: true },
        { label: 'Normal', value: 'normal', color: '#10B981' },
        { label: 'High', value: 'high', color: '#F59E0B' },
        { label: 'Urgent', value: 'urgent', color: '#EF4444' },
      ]
    }),
    
    category: Field.select({
      label: 'Category',
      options: [
        { label: 'Personal', value: 'personal' },
        { label: 'Work', value: 'work' },
        { label: 'Shopping', value: 'shopping' },
        { label: 'Health', value: 'health' },
        { label: 'Finance', value: 'finance' },
        { label: 'Other', value: 'other' },
      ]
    }),
    
    // Dates
    due_date: Field.date({
      label: 'Due Date',
    }),
    
    reminder_date: Field.datetime({
      label: 'Reminder Date/Time',
    }),
    
    completed_date: Field.datetime({
      label: 'Completed Date',
      readonly: true,
    }),
    
    // Assignment — the platform user object is `sys_user` (better-auth managed);
    // `user` is not a registered object/table, so the old reference resolved to
    // a non-existent `user` table at seed/lookup time ("no such table: user").
    owner: Field.lookup('sys_user', {
      label: 'Assigned To',
    }),
    
    // Tags
    tags: Field.select({
      label: 'Tags',
      multiple: true,
      options: [
        { label: 'Important', value: 'important', color: '#EF4444' },
        { label: 'Quick Win', value: 'quick_win', color: '#10B981' },
        { label: 'Blocked', value: 'blocked', color: '#F59E0B' },
        { label: 'Follow Up', value: 'follow_up', color: '#3B82F6' },
        { label: 'Review', value: 'review', color: '#8B5CF6' },
      ]
    }),
    
    // Recurrence
    is_recurring: Field.boolean({
      label: 'Recurring Task',
      defaultValue: false,
    }),
    
    recurrence_type: Field.select({
      label: 'Recurrence Type',
      options: [
        { label: 'Daily', value: 'daily' },
        { label: 'Weekly', value: 'weekly' },
        { label: 'Monthly', value: 'monthly' },
        { label: 'Yearly', value: 'yearly' },
      ]
    }),
    
    recurrence_interval: Field.number({
      label: 'Recurrence Interval',
      defaultValue: 1,
      min: 1,
    }),
    
    // Flags
    is_completed: Field.boolean({
      label: 'Is Completed',
      defaultValue: false,
      readonly: true,
    }),
    
    is_overdue: Field.boolean({
      label: 'Is Overdue',
      defaultValue: false,
      readonly: true,
    }),
    
    // Progress
    progress_percent: Field.percent({
      label: 'Progress (%)',
      min: 0,
      max: 100,
      defaultValue: 0,
    }),
    
    // Time Tracking
    estimated_hours: Field.number({
      label: 'Estimated Hours',
      scale: 2,
      min: 0,
    }),
    
    actual_hours: Field.number({
      label: 'Actual Hours',
      scale: 2,
      min: 0,
    }),
    
    // Additional fields
    notes: Field.richtext({
      label: 'Notes',
      description: 'Rich text notes with formatting',
    }),
    
    category_color: Field.color({
      label: 'Category Color',
    }),
  },
  
  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    files: true,
    feeds: true,
    activities: true,
    trash: true,
    mru: true,
  },
  
  // Database indexes for performance
  indexes: [
    { fields: ['status'] },
    { fields: ['priority'] },
    { fields: ['owner'] },
    { fields: ['due_date'] },
    { fields: ['category'] },
  ],
  
  nameField: 'subject',
  highlightFields: ['subject', 'status', 'priority', 'due_date', 'owner'],
  
  validations: [
    {
      name: 'completed_date_required',
      type: 'script',
      severity: 'error',
      message: 'Completed date is required when status is Completed',
      condition: P`record.status == "completed" && isBlank(record.completed_date)`,
    },
    {
      name: 'recurrence_fields_required',
      type: 'script',
      severity: 'error',
      message: 'Recurrence type is required for recurring tasks',
      condition: P`record.is_recurring == true && isBlank(record.recurrence_type)`,
    },
  ],

  // NOTE (#1535): object-level `workflows[]` is NOT a supported ObjectSchema
  // field — it was silently stripped at build and never ran (ADR-0032 "no
  // silent failure"). Record-triggered automation for this object lives in the
  // supported mechanisms instead:
  //   • `task.hook.ts`        — lifecycle hook (defaults, completion logic)
  //   • `actions/task.handlers.ts` — stamps `completed_date` on completion
  //   • `flows/task.flow.ts`  — record_change + schedule flows (completion /
  //                              recurrence, reminders, overdue escalation)
});
