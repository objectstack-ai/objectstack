// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Task — a master-detail child of Project. This object is the primary
 * subject of the view gallery: its fields are chosen so a single object can
 * back all eight list-view types —
 *
 *   • `status`  → Kanban grouping
 *   • `due_date` → Calendar
 *   • `created_at` → Timeline
 *   • `start_date` / `end_date` → Gantt
 *   • `location` → Map
 *   • `cover` → Gallery cards
 *   • plus Grid and an aggregate Chart view
 */
export const Task = ObjectSchema.create({
  name: 'showcase_task',
  label: 'Task',
  pluralLabel: 'Tasks',
  icon: 'check-square',
  description: 'A unit of work inside a project.',

  fields: {
    title: Field.text({ label: 'Title', required: true, searchable: true, maxLength: 200 }),
    // NOTE: no `inlineEdit` here. A task is added to a project over time, not
    // entered together with it — so "New Project" must NOT force a Tasks
    // subtable (that felt heavy/odd). Tasks are added later from the Project
    // DETAIL page's Tasks related list (`relatedList*` below — the read side).
    // Inline master-detail entry is reserved for true header+line shapes like
    // Invoice + Invoice Line (see invoice.object.ts).
    project: Field.masterDetail('showcase_project', {
      label: 'Project',
      required: true,
      relatedListTitle: 'Tasks',
      relatedListColumns: ['title', 'status', 'priority', 'assignee', 'due_date'],
    }),
    assignee: Field.text({ label: 'Assignee', maxLength: 200 }),
    status: Field.select({
      label: 'Status',
      required: true,
      options: [
        { label: 'Backlog', value: 'backlog', default: true, color: '#94A3B8' },
        { label: 'To Do', value: 'todo', color: '#3B82F6' },
        { label: 'In Progress', value: 'in_progress', color: '#F59E0B' },
        { label: 'In Review', value: 'in_review', color: '#8B5CF6' },
        { label: 'Done', value: 'done', color: '#10B981' },
      ],
    }),
    priority: Field.select({
      label: 'Priority',
      options: [
        { label: 'Low', value: 'low', color: '#94A3B8' },
        { label: 'Medium', value: 'medium', default: true, color: '#3B82F6' },
        { label: 'High', value: 'high', color: '#F59E0B' },
        { label: 'Urgent', value: 'urgent', color: '#EF4444' },
      ],
    }),
    estimate_hours: Field.number({ label: 'Estimate (h)', min: 0, max: 1000 }),
    progress: { type: 'progress', label: 'Progress', min: 0, max: 100, defaultValue: 0 },
    done: Field.boolean({ label: 'Done', defaultValue: false }),
    due_date: Field.date({ label: 'Due Date' }),
    start_date: Field.date({ label: 'Start Date' }),
    end_date: Field.date({ label: 'End Date' }),
    created_at: Field.datetime({ label: 'Created At' }),
    location: Field.location({ label: 'Work Location' }),
    cover: Field.image({ label: 'Cover Image' }),
    labels: { type: 'tags', label: 'Labels' },
    notes: Field.textarea({ label: 'Notes' }),
    // Written by the Resilient Sync flow's try/catch region
    // (showcase_resilient_sync) when the outbound push exhausts its retries —
    // the catch branch flags the failure here for operator follow-up.
    sync_status: Field.select({
      label: 'Sync Status',
      options: [
        { label: 'Synced', value: 'synced', color: '#10B981' },
        { label: 'Failed', value: 'failed', color: '#EF4444' },
      ],
    }),
    sync_error: Field.textarea({ label: 'Sync Error' }),
  },

  validations: [
    {
      type: 'state_machine' as const,
      name: 'task_status_flow',
      label: 'Task Status Flow',
      description: 'Tasks move forward through the board (reopen allowed from Done).',
      field: 'status',
      // Transitions are validated on update; insert sets the initial state.
      events: ['update'] as const,
      message: 'Invalid task status transition.',
      transitions: {
        backlog: ['todo'],
        todo: ['in_progress', 'backlog'],
        in_progress: ['in_review', 'todo'],
        in_review: ['done', 'in_progress'],
        done: ['in_progress'],
      },
    },
  ],
});
