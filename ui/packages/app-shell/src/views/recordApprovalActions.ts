/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * How a business record page surfaces the decision actions of the approval
 * request that is pending on it (objectui#3055).
 *
 * There is no action list here on purpose. The actions ARE
 * `sys_approval_request`'s own declared metadata — approve / reject (both with
 * a comment and decision attachments), reassign, send back for revision,
 * request info, and the submitter's remind / recall / resubmit — resolved from
 * the object definition at render time and executed by the shared console
 * action runtime through `<DeclaredActionsBar>`. What this module pins is only
 * the three coordinates that wiring needs, so they are stated once and can be
 * asserted without mounting the whole record page.
 *
 * Before this, the record page hand-wrote two buttons (approve / reject only)
 * against a bespoke `type:'approval'` handler, with its own copy and its own
 * CLIENT-side approver test. The result was a record page that could not
 * reassign, could not send back, could not request info, could not attach a
 * file to a decision, and phrased everything differently from the approvals
 * list — for the same request, over the same nine REST routes.
 */

/**
 * The object whose declared actions render on the host record page. The
 * dispatch record is the pending REQUEST row (not the business record), which
 * is what resolves `{id}` in each action's target and what gives each action's
 * `visible` predicate the server-computed `viewer` block to read.
 */
export const SYS_APPROVAL_REQUEST_OBJECT = 'sys_approval_request';

/**
 * The declared `locations` entry the record page renders.
 *
 * `sys_approval_request` places its decision levers at `record_section` (the
 * per-record action group) and the two headline decisions additionally at
 * `list_item`. The record page consumes `record_section` verbatim rather than
 * re-mapping it onto the host's own `record_header` / `record_more` slots:
 * those two are the HOST object's locations, evaluated against the HOST
 * record, and routing another object's actions through them would need a
 * translation layer on every one of them. Reading the location the metadata
 * already declares keeps "add a decision action" a metadata-only change.
 */
export const RECORD_APPROVAL_ACTION_LOCATION = 'record_section';

/**
 * Declared actions the record page renders ITSELF, so the bar must not
 * double-render them.
 *
 * `approval_remind` only: `RecordApprovalsPanel` already offers remind with
 * throttle-aware copy (`THROTTLED` / 429 → "a reminder was sent recently")
 * and reloads the action timeline in place, which a generic POST + toast
 * cannot do. Every other declared action — including the submitter's recall
 * and resubmit — comes from the bar.
 */
export const RECORD_APPROVAL_EXCLUDED_ACTIONS = ['approval_remind'] as const;
