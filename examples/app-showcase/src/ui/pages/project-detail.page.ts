// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

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
export const ProjectDetailPage = definePage({
  name: 'showcase_project_detail',
  label: 'Project',
  type: 'record',
  object: 'showcase_project',
  kind: 'slotted',
  template: 'default',
  isDefault: true,
  regions: [],
  slots: {
    // Explicit highlights strip — exercises the page editor's field-list picker
    // (objectFrom:'page' resolves showcase_project's fields).
    highlights: {
      type: 'record:highlights',
      properties: {
        fields: ['account', 'status', 'health', 'budget', 'end_date'],
      },
    },
    tabs: {
      type: 'page:tabs',
      properties: {
        // `tabStyle`, not `type` (#6776): a props key named `type` collides
        // with the component node's own dispatch key, so the old spelling
        // could not be written in a flat or JSX page at all.
        tabStyle: 'line',
        items: [
          {
            // Explicit details sections — each section's `fields` is a
            // field-list bound to showcase_project in the page editor.
            //
            // `value` is the tab's stable `?tab=` URL token (#5776): the key
            // `PageTabsProps.items[]` declares and objectui's tabs renderer
            // reads. `key` was neither — an unknown prop nothing verifies and
            // nothing reads, which left both tabs on the index-derived
            // `tab-<i>` fallback and their deep links non-durable.
            value: 'details',
            label: 'Details',
            children: [
              {
                type: 'record:details',
                properties: {
                  sections: [
                    { label: 'Overview', columns: 2, fields: ['name', 'account', 'owner', 'status'] },
                    { label: 'Financials', columns: 2, fields: ['budget', 'spent'] },
                    { label: 'Timeline', columns: 2, fields: ['start_date', 'end_date'] },
                  ],
                },
              },
            ],
          },
          {
            value: 'tasks',
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
});
