// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Task Detail — a record page that exercises the record-layout component set
 * beyond the basics:
 *   • `page:header`        — the record title bar: the task's `record_header`
 *                            actions inline and its `record_more` actions
 *                            under the ⋯ overflow (see the node below).
 *   • `record:path`        — Salesforce-style status stepper across the task
 *                            lifecycle (Backlog → … → Done).
 *   • `record:alert`       — a conditional banner shown only while the task is
 *                            In Review (demonstrates the ADR-0089 component-node
 *                            `visibleWhen` predicate, `has()`-guarded).
 *   • `record:quick_actions` — object Actions surfaced as inline buttons.
 *   • `record:highlights` + `record:details` — the standard compact + section
 *                            layout.
 * `kind: 'full'` — this page fully owns the record layout (vs the slotted
 * Project page which only overrides the tabs slot).
 */
export const TaskDetailPage = definePage({
  name: 'showcase_task_detail',
  label: 'Task',
  type: 'record',
  object: 'showcase_task',
  kind: 'full',
  template: 'default',
  isDefault: true,
  regions: [
    {
      name: 'main',
      width: 'full',
      components: [
        // The title bar, composed explicitly. A `kind: 'full'` page renders
        // exactly the nodes it declares, and the header is one of them: with
        // no `page:header` node the page has no title bar, so neither the
        // `record_header` nor the `record_more` location has a surface here.
        // The synthesized default page (and a `kind: 'slotted'` page that
        // leaves the `header` slot alone) gets one automatically; this page
        // does not.
        //
        // `actions` are action IDS, resolved against `showcase_task`'s own
        // metadata, and the header still places each by its `locations`:
        // `record_header` actions render as inline buttons, and an action
        // declaring `record_more` without `record_header` always goes under
        // the ⋯ overflow. The list is the object's whole `record_header` /
        // `record_more` set, which is what the synthesized header would carry;
        // `test/record-action-location-hosts.test.ts` holds the two equal.
        // The host still appends its own Edit / Share / Delete after these.
        // No `title`: the header derives it from the record.
        {
          type: 'page:header',
          properties: {
            actions: [
              // record_header — inline buttons.
              'showcase_mark_done',
              'showcase_log_time',
              'showcase_archive_task',
              // record_more only — the ⋯ overflow (url, api, api).
              'showcase_open_docs',
              'showcase_recalc_estimate',
              'showcase_recalc_selection',
            ],
          },
        },
        {
          type: 'record:path',
          properties: {
            statusField: 'status',
            stages: [
              { value: 'backlog', label: 'Backlog' },
              { value: 'todo', label: 'To Do' },
              { value: 'in_progress', label: 'In Progress' },
              { value: 'in_review', label: 'In Review' },
              { value: 'done', label: 'Done', terminal: 'won' },
            ],
          },
        },
        // The banner's gate is the ADR-0089 canonical, component-NODE
        // `visibleWhen` — a sibling of `properties`, never a key inside it.
        // `properties.visible` is declared on `record:alert` too, but the page
        // metadata serves that bag verbatim (`properties` is an opaque record
        // on `PageComponentSchema`), so a bare string there reaches the
        // renderer's LEGACY JS evaluator, which has no `has()`. The node key is
        // `ExpressionInputSchema`, normalized to `{ dialect: 'cel', source }`
        // before it is served, so it runs on CEL — where an absent key is a
        // FAULT and the surface is fail-soft, i.e. an unguarded predicate would
        // leave this banner permanently shown. Hence the `has()` guard, and
        // hence no `visible` beside it: a node `visibleWhen` and
        // `properties.visible` compose as AND, so leaving both would keep the
        // legacy predicate load-bearing.
        {
          type: 'record:alert',
          visibleWhen: "has(record.status) && record.status == 'in_review'",
          properties: {
            severity: 'warning',
            icon: 'eye',
            title: 'Awaiting review',
            body: 'This task is in review — confirm the work before marking it done.',
            dismissible: true,
          },
        },
        {
          type: 'record:highlights',
          properties: { fields: ['project', 'assignee', 'priority', 'due_date', 'progress'] },
        },
        {
          type: 'record:quick_actions',
          properties: {
            location: 'record_section',
            align: 'start',
            // showcase_archive_task is the `disabled`-predicate specimen:
            // visible on every task, greyed until `record.done` (contrast with
            // showcase_mark_done's `visible`, which HIDES once done).
            actionNames: ['showcase_mark_done', 'showcase_log_time', 'showcase_archive_task'],
          },
        },
        {
          type: 'record:details',
          properties: {
            sections: [
              // Reuses `objects.showcase_task._sections.{overview,schedule,details}` —
              // the same three names `ui/views/task.view.ts`'s `tabbed` form
              // already declares and `system/translations/index.ts` already
              // translates, so this page's headings resolve in zh-CN with no
              // new bundle entries (#8231).
              { name: 'overview', label: 'Overview', columns: 2, fields: ['title', 'project', 'assignee', 'status', 'priority'] },
              { name: 'schedule', label: 'Schedule', columns: 2, fields: ['start_date', 'end_date', 'due_date', 'estimate_hours'] },
              { name: 'details', label: 'Details', columns: 1, fields: ['labels', 'location', 'notes'] },
            ],
          },
        },
      ],
    },
  ],
});
