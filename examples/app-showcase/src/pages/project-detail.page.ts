// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

/**
 * Project detail — a slotted record page that surfaces the project's Tasks as
 * an INLINE-EDITABLE `record:line_items` grid (ObjectUI ADR-0001), instead of
 * a read-only related list. This is the "view + edit the children together"
 * half of the master-detail story: open a project, edit its tasks in place,
 * and Save persists the diff (create/update/delete) with the `master_detail`
 * FK maintained.
 *
 * `kind: 'slotted'` with only the `tabs` slot overridden — the synthesizer
 * fills in the header / highlights / details / discussion; the Tasks tab below
 * replaces the synthesized related-list strip.
 */
export const ProjectDetailPage: Page = {
  name: 'showcase_project_detail',
  label: 'Project',
  type: 'record',
  object: 'showcase_project',
  kind: 'slotted',
  isDefault: true,
  regions: [],
  slots: {
    tabs: {
      type: 'page:tabs',
      properties: {
        type: 'line',
        items: [
          {
            key: 'tasks',
            label: 'Tasks',
            children: [
              {
                type: 'record:line_items',
                properties: {
                  childObject: 'showcase_task',
                  relationshipField: 'project',
                  amountField: 'estimate_hours',
                  title: 'Tasks',
                  columns: [
                    { field: 'title', label: 'Title', type: 'text', required: true },
                    {
                      field: 'status',
                      label: 'Status',
                      type: 'select',
                      options: [
                        { label: 'Backlog', value: 'backlog' },
                        { label: 'To Do', value: 'todo' },
                        { label: 'In Progress', value: 'in_progress' },
                        { label: 'In Review', value: 'in_review' },
                        { label: 'Done', value: 'done' },
                      ],
                    },
                    {
                      field: 'priority',
                      label: 'Priority',
                      type: 'select',
                      options: [
                        { label: 'Low', value: 'low' },
                        { label: 'Medium', value: 'medium' },
                        { label: 'High', value: 'high' },
                        { label: 'Urgent', value: 'urgent' },
                      ],
                    },
                    { field: 'estimate_hours', label: 'Estimate (h)', type: 'number' },
                    { field: 'due_date', label: 'Due Date', type: 'date' },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  },
};
