// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineAction } from '@objectstack/spec/ui';

const task = 'showcase_task';

/**
 * Action matrix — covers every `ActionType` (script / url / flow / modal /
 * api / form) surfaced across a spread of `ActionLocation`s (toolbar, row,
 * record header/more, related list, global nav).
 */

/**
 * script — inline sandboxed handler, shown on each row and the record header.
 *
 * The `body` (L2 sandboxed JS) is what makes this action *executable*: AppPlugin
 * walks the bundle's actions on bind and only registers an engine handler for
 * those carrying a `body` (or `target` -> bundle function). Without it the
 * runtime has nothing to invoke and `POST /actions/showcase_task/showcase_mark_done`
 * fails with "Action ... not found".
 *
 * It flips the dedicated `done` flag and `progress` rather than the `status`
 * select on purpose: `status` is governed by the `task_status_flow`
 * state-machine (only `in_review -> done` is a legal direct jump), so writing
 * `status: 'done'` from a Backlog/To Do/In Progress row would be rejected. The
 * `done` boolean is the completion flag that works from any state.
 */
export const MarkDoneAction = defineAction({
  name: 'showcase_mark_done',
  label: 'Mark Done',
  icon: 'check',
  objectName: task,
  type: 'script',
  body: {
    language: 'js',
    source:
      "var id = ctx.recordId || (ctx.record && ctx.record.id) || input.recordId;" +
      "if (!id) throw new Error('No record to mark done');" +
      "await ctx.api.object('showcase_task').update({ id: id, done: true, progress: 100 });" +
      "return { ok: true, id: id };",
    capabilities: ['api.write'],
  },
  successMessage: 'Task marked done.',
  // `record_section` so the Task Detail page's `record:quick_actions` bar
  // (which names this action) resolves it — the engine location-filters even
  // explicitly-named actions, mirroring the platform's own sys-user pages.
  locations: ['list_item', 'record_header', 'record_section'],
  refreshAfter: true,
});

/** url — navigate out, from the row overflow menu. */
export const OpenDocsAction = defineAction({
  name: 'showcase_open_docs',
  label: 'Open Docs',
  icon: 'book-open',
  objectName: task,
  type: 'url',
  target: 'https://docs.objectstack.ai',
  locations: ['record_more'],
  refreshAfter: false,
});

/**
 * flow — launch the Reassign screen-flow wizard. Row-level (`list_item`) so the
 * row's `recordId` flows into the flow, which collects `new_assignee` via a
 * `screen` node and writes it back with `update_record`. The objectui
 * FlowRunner renders the screen and resumes the run.
 */
export const BulkReassignAction = defineAction({
  name: 'showcase_bulk_reassign',
  label: 'Reassign…',
  icon: 'users',
  objectName: task,
  type: 'flow',
  target: 'showcase_reassign_wizard',
  locations: ['list_item', 'list_toolbar'],
  refreshAfter: true,
});

/** modal — open a dialog/page. */
export const QuickViewAction = defineAction({
  name: 'showcase_quick_view',
  label: 'Quick View',
  icon: 'eye',
  objectName: task,
  type: 'modal',
  target: 'showcase_component_gallery',
  locations: ['list_item'],
  refreshAfter: false,
});

/** api — call a custom endpoint. */
export const RecalcEstimateAction = defineAction({
  name: 'showcase_recalc_estimate',
  label: 'Recalculate Estimate',
  icon: 'calculator',
  objectName: task,
  type: 'api',
  target: '/api/v1/showcase/recalc',
  locations: ['record_more', 'record_section'],
  refreshAfter: true,
});

/** form — open a parameter form dialog. */
export const LogTimeAction = defineAction({
  name: 'showcase_log_time',
  label: 'Log Time',
  icon: 'clock',
  objectName: task,
  type: 'form',
  target: 'showcase_task.default',
  // `record_section` so it surfaces in the Task Detail quick-actions bar too.
  locations: ['record_header', 'record_related', 'record_section'],
  refreshAfter: true,
});

/** global nav command-palette action. */
export const NewTaskAction = defineAction({
  name: 'showcase_new_task',
  label: 'New Task',
  icon: 'plus',
  objectName: task,
  type: 'modal',
  target: 'showcase_component_gallery',
  locations: ['global_nav'],
  refreshAfter: true,
});

export const allActions = [
  MarkDoneAction,
  OpenDocsAction,
  BulkReassignAction,
  QuickViewAction,
  RecalcEstimateAction,
  LogTimeAction,
  NewTaskAction,
];
