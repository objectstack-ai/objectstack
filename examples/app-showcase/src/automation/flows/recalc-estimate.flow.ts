// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineFlow } from '@objectstack/spec';

/**
 * The estimate recalculation behind the two `api` actions
 * (`showcase_recalc_estimate`, `showcase_recalc_selection`) — declared, with
 * no handler code anywhere.
 *
 * The actions POST to `RecalcEstimatesEndpoint` (`src/system/apis/index.ts`),
 * a `type: 'flow'` endpoint, so the request runs through the platform's own
 * door: the caller's session is resolved, `authRequired` turns an anonymous
 * caller away with `401` before anything runs, and the flows below run AS THE
 * CALLER (`runAs: 'user'`). Every read and write they make is judged by the
 * security layer as that user's own edit — a caller without edit rights on a
 * task is refused there, and nothing is written.
 *
 * ⛔ Not `runAs: 'system'`. An elevated recalc would write a row its caller
 * may not edit: the endpoint would become a way around the caller's own
 * permissions, which is the opposite of what an example should teach.
 *
 * Two flows, because the selection is a list and the recalculation is per row:
 *
 *  - {@link RecalcTaskEstimateFlow} recalculates ONE task: read its schedule
 *    window, compute the estimate in an `assignment`, write it with
 *    `update_record`.
 *  - {@link RecalcEstimatesFlow} is the endpoint's target. It turns either
 *    request body into a list of ids and runs the per-task flow once per id
 *    through a `map` node — the single-record body is a list of one.
 */

/**
 * The window's days × 8h, in CEL: inclusive whole days from `start_date` to
 * `end_date`, eight hours each. A task with no window — either date unset, or
 * an end before its start — gets one day (8h).
 *
 * `has()` comes first because CEL refuses to read a key the record does not
 * carry; `daysBetween` takes the two dates as stored (`YYYY-MM-DD`) and counts
 * whole days between them, so the `+ 1` is what makes the window inclusive.
 */
const WINDOW_ESTIMATE =
  'has(task.start_date) && has(task.end_date) && task.start_date != null && task.end_date != null'
  + ' && daysBetween(task.start_date, task.end_date) >= 0'
  + ' ? (daysBetween(task.start_date, task.end_date) + 1) * 8'
  + ' : 8';

/** Recalculate one task's `estimate_hours` from its own schedule window. */
export const RecalcTaskEstimateFlow = defineFlow({
  name: 'showcase_recalc_task_estimate',
  label: 'Recalculate One Task Estimate',
  description: 'Recomputes one task’s estimate_hours from its schedule window (inclusive days × 8h) and writes it, as the caller.',
  // Started only by `RecalcEstimatesFlow`'s `map` node, never as an entry.
  type: 'autolaunched',
  // The caller's own identity, stated rather than left to the default: this is
  // the line that makes the write the caller's edit.
  runAs: 'user',
  variables: [
    { name: 'recordId', type: 'text', isInput: true },
    { name: 'estimate_hours', type: 'number', isOutput: true },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'load_task',
      type: 'get_record',
      label: 'Read the schedule window',
      // The window is read from the stored row, never from the request: the
      // console sends only the id, and a body could carry any dates at all.
      config: {
        objectName: 'showcase_task',
        filter: { id: { dialect: 'cel', source: 'recordId' } },
        fields: ['start_date', 'end_date'],
        outputVariable: 'task',
      },
    },
    {
      id: 'compute_estimate',
      type: 'assignment',
      label: 'Days in the window × 8h',
      config: {
        assignments: {
          estimate_hours: { dialect: 'cel', source: WINDOW_ESTIMATE },
        },
      },
    },
    {
      id: 'write_estimate',
      type: 'update_record',
      label: 'Write the estimate',
      config: {
        objectName: 'showcase_task',
        filter: { id: { dialect: 'cel', source: 'recordId' } },
        fields: { estimate_hours: { dialect: 'cel', source: 'estimate_hours' } },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'load_task' },
    { id: 'e2', source: 'load_task', target: 'compute_estimate' },
    { id: 'e3', source: 'compute_estimate', target: 'write_estimate' },
    { id: 'e4', source: 'write_estimate', target: 'end' },
  ],
});

/**
 * The endpoint's target: recalculate the tasks a request names.
 *
 * The two actions send the two bodies the bulk-dispatch contract defines
 * (`execution` on the action, `bulkActionDefs` on the view):
 *
 *  - per record — `{ recordId }`, one request per task;
 *  - aggregate — `{ _selectedIds: [...] }`, ONE request for the whole
 *    selection.
 *
 * Both become one list, and the `map` node runs {@link RecalcTaskEstimateFlow}
 * for each id, in order. The `map` stops at the first task it cannot
 * recalculate and the whole request is refused, so a caller is never told the
 * selection was recalculated when part of it was not — the aggregate contract's
 * "a handler that cannot cover the whole selection must reject" (`bulkActionDefs`
 * in `@objectstack/spec`'s list view). The run is not a transaction: tasks
 * before the refused one keep their new estimate. The contract's remedy is to
 * run the action again, and that is safe here because recalculating a task
 * twice writes the same value.
 *
 * A body naming no task at all is refused too: the list is then `[null]`, and
 * the per-task read refuses a filter whose id evaluates to nothing.
 *
 * `type: 'screen'` because it IS an entry — a signed-in caller starts it on
 * demand through the endpoint (the `showcase_inquiry_purge` precedent). It has
 * no screen, so it runs straight through.
 */
export const RecalcEstimatesFlow = defineFlow({
  name: 'showcase_recalc_estimates',
  label: 'Recalculate Estimates',
  description: 'Recalculates the estimate of every task a request names — one id, or a whole selection — by running the per-task recalculation for each, as the caller.',
  type: 'screen',
  runAs: 'user',
  variables: [
    // Each body carries exactly one of the two, so both default to `null`: an
    // unbound name cannot even be compared in CEL.
    { name: 'recordId', type: 'text', isInput: true, defaultValue: null },
    { name: '_selectedIds', type: 'list', isInput: true, defaultValue: null },
    // Each task's recalculated estimate, in request order.
    { name: 'estimates', type: 'list', isOutput: true },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'collect_ids',
      type: 'assignment',
      label: 'The tasks this request names',
      config: {
        assignments: {
          task_ids: {
            dialect: 'cel',
            source: '_selectedIds != null && size(_selectedIds) > 0 ? _selectedIds : [recordId]',
          },
        },
      },
    },
    {
      id: 'recalc_each',
      type: 'map',
      label: 'Recalculate each task',
      config: {
        collection: { dialect: 'cel', source: 'task_ids' },
        flowName: 'showcase_recalc_task_estimate',
        iteratorVariable: 'task_id',
        input: { recordId: { dialect: 'cel', source: 'task_id' } },
        outputVariable: 'estimates',
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'collect_ids' },
    { id: 'e2', source: 'collect_ids', target: 'recalc_each' },
    { id: 'e3', source: 'recalc_each', target: 'end' },
  ],
});
