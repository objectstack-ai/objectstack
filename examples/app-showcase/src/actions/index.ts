// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Action } from '@objectstack/spec/ui';

const task = 'showcase_task';

/**
 * Action matrix — covers every `ActionType` (script / url / flow / modal /
 * api / form) surfaced across a spread of `ActionLocation`s (toolbar, row,
 * record header/more, related list, global nav).
 */

/** script — inline handler, shown on each row and the record header. */
export const MarkDoneAction: Action = {
  name: 'showcase_mark_done',
  label: 'Mark Done',
  icon: 'check',
  objectName: task,
  type: 'script',
  locations: ['list_item', 'record_header'],
  refreshAfter: true,
};

/** url — navigate out, from the row overflow menu. */
export const OpenDocsAction: Action = {
  name: 'showcase_open_docs',
  label: 'Open Docs',
  icon: 'book-open',
  objectName: task,
  type: 'url',
  target: 'https://docs.objectstack.ai',
  locations: ['record_more'],
  refreshAfter: false,
};

/**
 * flow — launch the Reassign screen-flow wizard. Row-level (`list_item`) so the
 * row's `recordId` flows into the flow, which collects `new_assignee` via a
 * `screen` node and writes it back with `update_record`. The objectui
 * FlowRunner renders the screen and resumes the run.
 */
export const BulkReassignAction: Action = {
  name: 'showcase_bulk_reassign',
  label: 'Reassign…',
  icon: 'users',
  objectName: task,
  type: 'flow',
  target: 'showcase_reassign_wizard',
  locations: ['list_item', 'list_toolbar'],
  refreshAfter: true,
};

/** modal — open a dialog/page. */
export const QuickViewAction: Action = {
  name: 'showcase_quick_view',
  label: 'Quick View',
  icon: 'eye',
  objectName: task,
  type: 'modal',
  target: 'showcase_component_gallery',
  locations: ['list_item'],
  refreshAfter: false,
};

/** api — call a custom endpoint. */
export const RecalcEstimateAction: Action = {
  name: 'showcase_recalc_estimate',
  label: 'Recalculate Estimate',
  icon: 'calculator',
  objectName: task,
  type: 'api',
  target: '/api/v1/showcase/recalc',
  locations: ['record_more', 'record_section'],
  refreshAfter: true,
};

/** form — open a parameter form dialog. */
export const LogTimeAction: Action = {
  name: 'showcase_log_time',
  label: 'Log Time',
  icon: 'clock',
  objectName: task,
  type: 'form',
  target: 'showcase_task.default',
  locations: ['record_header', 'record_related'],
  refreshAfter: true,
};

/** global nav command-palette action. */
export const NewTaskAction: Action = {
  name: 'showcase_new_task',
  label: 'New Task',
  icon: 'plus',
  objectName: task,
  type: 'modal',
  target: 'showcase_component_gallery',
  locations: ['global_nav'],
  refreshAfter: true,
};

export const allActions = [
  MarkDoneAction,
  OpenDocsAction,
  BulkReassignAction,
  QuickViewAction,
  RecalcEstimateAction,
  LogTimeAction,
  NewTaskAction,
];
