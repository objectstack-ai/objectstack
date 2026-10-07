// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Project detail — a slotted record page that surfaces the project's Tasks as
 * an INLINE-EDITABLE `record:line_items` grid (ObjectUI ADR-0001), beside the
 * read-only Tasks related list. The grid is the "view + edit the children
 * together" half of the master-detail story: open a project, edit its tasks in
 * place, and Save persists the diff (create/update/delete) with the
 * `master_detail` FK maintained.
 *
 * `kind: 'slotted'` with only the `tabs` slot overridden — the synthesizer
 * fills in the header / highlights / details / discussion. Overriding `tabs`
 * replaces the whole synthesized tab strip (a slot is a full replacement, with
 * no merge), and that strip is where the synthesized related lists live — so
 * the page puts the Tasks related list back itself, in a Related tab (below).
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
                    { name: 'overview', label: 'Overview', columns: 2, fields: ['name', 'account', 'owner', 'status'] },
                    { name: 'financials', label: 'Financials', columns: 2, fields: ['budget', 'spent'] },
                    { name: 'timeline', label: 'Timeline', columns: 2, fields: ['start_date', 'end_date'] },
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
                    { name: 'title', label: 'Title', type: 'text', required: true },
                    {
                      name: 'status',
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
                      name: 'priority',
                      label: 'Priority',
                      type: 'select',
                      options: [
                        { label: 'Low', value: 'low' },
                        { label: 'Medium', value: 'medium' },
                        { label: 'High', value: 'high' },
                        { label: 'Urgent', value: 'urgent' },
                      ],
                    },
                    { name: 'estimate_hours', label: 'Estimate (h)', type: 'number' },
                    { name: 'due_date', label: 'Due Date', type: 'date' },
                  ],
                },
              },
            ],
          },
          {
            // The read side of the same relationship: the Tasks related list,
            // as the synthesized strip would draw it for a non-primary
            // relationship (a `Related` tab, `?tab=related`). The `tabs`
            // override above removed that strip, and `showcase_task.project`
            // is the task's only parent relationship, so without this tab no
            // record page in the showcase shows tasks as a related list.
            //
            // It is the same `record:related_list` node the synthesizer emits,
            // under the same record page, so its rows carry what a synthesized
            // list's rows carry: the task's `list_item` actions, plus its
            // `record_related` ones, which only render on a related list
            // inside a parent record. No `actions` key on purpose — authoring
            // one would replace those host-supplied actions with the list
            // named here.
            //
            // `title` and `columns` repeat what the FK declares
            // (`relatedListTitle` / `relatedListColumns` on
            // `showcase_task.project`): only the synthesizer reads those keys,
            // and an authored node is not synthesized.
            // `test/record-action-location-hosts.test.ts` holds the two equal.
            value: 'related',
            label: 'Related',
            children: [
              {
                type: 'record:related_list',
                properties: {
                  objectName: 'showcase_task',
                  relationshipField: 'project',
                  title: 'Tasks',
                  columns: ['title', 'status', 'priority', 'assignee', 'due_date'],
                },
              },
            ],
          },
        ],
      },
    },
  },
});
