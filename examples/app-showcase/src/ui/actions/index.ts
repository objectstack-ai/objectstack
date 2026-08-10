// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineAction } from '@objectstack/spec/ui';

// The action-GATING matrix (`visible` / `requiredPermissions` across all four
// action surfaces, and one predicate per field type) lives in its own file —
// it is a coverage fixture for the gates, not another ActionType specimen.
import { allPredicateMatrixActions } from './predicate-matrix.action.js';

export * from './predicate-matrix.action.js';

const task = 'showcase_task';
const invoice = 'showcase_invoice';
const fieldZoo = 'showcase_field_zoo';

/**
 * Action matrix — covers every `ActionType` (script / url / flow / modal /
 * api / form) surfaced across a spread of `ActionLocation`s (toolbar, row,
 * record header/more, related list, record section) — plus two HEADLESS
 * actions (`locations: []`), which is a declaration in its own right, not an
 * omission: callable over REST/MCP/AI with the capability gate and audit trail
 * intact, claiming no UI surface.
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
  // Hide once the task is complete. Gate on `record.done` (the boolean this
  // action sets) so the button vanishes after a successful click and stays
  // hidden on finished records (the "why is it still here?" report). NOTE the
  // `record.`-prefix: the ActionEngine evaluates a record-header action's
  // `visible` against `{ record, recordId, … }` with fail-closed semantics, so
  // a bare `done`/`status` throws (field not at top level) and silently hides
  // the action. Single operand, too — the template path throws on `&&`/`||`.
  visible: '!record.done',
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
  successMessage: 'Estimate recalculated.',
  locations: ['record_more', 'record_section'],
  // The endpoint is record-scoped and rejects a body without an id. On a
  // record surface the page supplies it; invoked from a LIST ROW (see the
  // `legacy_row_actions` view) nothing else can, so name the body key the
  // clicked row's id should be written to.
  recordIdParam: 'recordId',
  refreshAfter: true,
});

/**
 * api, AGGREGATE-dispatched — the `execution: 'aggregate'` specimen
 * (objectui#3139). The action itself is an ordinary api action; what makes it
 * aggregate is the VIEW's `bulkActionDefs` entry naming it with
 * `execution: 'aggregate'` (see `task.view.ts` → `bulk_actions`). The
 * renderer then dispatches it ONCE for the whole selection, with every
 * selected id in `params._selectedIds` — the recalc endpoint's batch branch
 * recomputes all of them in that single call (the "one zip for N devices"
 * shape, minus the zip). Contrast with RecalcEstimateAction above: same
 * endpoint, one POST per record.
 *
 * `locations` still has to be declared, even though the selection bar entry
 * comes from the view. Omitting it does NOT mean "nowhere": the action:bar
 * renderer treats a missing/empty `locations` as "every location"
 * (objectui `action-bar.tsx`), so a locations-less action also lands on the
 * LIST TOOLBAR — where there is no selection, so the dispatch posts no
 * `_selectedIds` and the endpoint rejects it. Declaring `record_more` keeps
 * the single-record entry somewhere it works (the endpoint's per-record
 * branch, via `recordIdParam`) and off the toolbar. See objectui#3142.
 */
export const RecalcSelectionAction = defineAction({
  name: 'showcase_recalc_selection',
  label: 'Recalculate Selection',
  icon: 'calculator',
  objectName: task,
  type: 'api',
  target: '/api/v1/showcase/recalc',
  successMessage: 'Estimates recalculated for the whole selection.',
  locations: ['record_more'],
  recordIdParam: 'recordId',
  refreshAfter: true,
});

/** form — open a parameter form dialog. */
export const LogTimeAction = defineAction({
  name: 'showcase_log_time',
  label: 'Log Time',
  icon: 'clock',
  objectName: task,
  type: 'form',
  // Targets the `edit` FORM view. `showcase_task.default` is the LIST view (the
  // container's main `list` implicitly claims the `default` key), so pointing a
  // form action there opens a list as a form — now a build error (#2554).
  target: 'showcase_task.edit',
  // `record_section` so it surfaces in the Task Detail quick-actions bar too.
  locations: ['record_header', 'record_related', 'record_section'],
  refreshAfter: true,
});

/**
 * modal — headless (`locations: []`).
 *
 * This action used to declare `locations: ['global_nav']`, which #6888 retired:
 * no product surface ever rendered that location, so the declaration placed the
 * action nowhere. Its live entry point is elsewhere and always was — the
 * Overview page's "Create Task" CTA (`../pages/index.ts`) carries an INLINE
 * action of the same name, which is the path a user actually clicks. So the
 * registered action keeps its declaration and states the truth about its UI
 * surface (`[]` — "nowhere, deliberately") rather than naming a location
 * nothing serves. No replacement placement was invented for it here: choosing
 * one is a product decision about the showcase, not a consequence of the
 * retirement (flagged on #6888).
 */
export const NewTaskAction = defineAction({
  name: 'showcase_new_task',
  label: 'New Task',
  icon: 'plus',
  objectName: task,
  type: 'modal',
  target: 'showcase_component_gallery',
  locations: [],
  refreshAfter: true,
});

/**
 * script — Submit an invoice for finance + legal sign-off (§1 demo entry point).
 *
 * Flipping `status` to `sent` is exactly the transition the `showcase_invoice_signoff`
 * flow's start gate watches (`status == "sent" && previous.status != "sent"`), so
 * this button opens a fresh 会签 (finance ∧ legal) approval request from the record
 * header — the same request the boot-time demo seeds (src/security/seed-approval-demo.ts),
 * but on demand. The sandboxed body's write fires the record-change trigger like any
 * user edit. Gated to draft invoices so it disappears once submitted.
 */
export const SubmitForSignoffAction = defineAction({
  name: 'showcase_submit_signoff',
  label: 'Submit for Sign-off',
  icon: 'send',
  objectName: invoice,
  type: 'script',
  body: {
    language: 'js',
    source:
      "var id = ctx.recordId || (ctx.record && ctx.record.id) || input.recordId;" +
      "if (!id) throw new Error('No invoice to submit');" +
      "await ctx.api.object('showcase_invoice').update({ id: id, status: 'sent' });" +
      "return { ok: true, id: id };",
    capabilities: ['api.write'],
  },
  successMessage: 'Invoice submitted for finance + legal sign-off.',
  // Only on invoices not yet sent. `record.`-prefixed single comparison, per the
  // ActionEngine's fail-closed CEL evaluation (see MarkDoneAction's note).
  visible: "record.status != 'sent'",
  locations: ['list_item', 'record_header'],
  refreshAfter: true,
});

/**
 * script — the **action-param widget gallery** (ADR-0059). One inline param of
 * every non-trivial widget type, so the `ActionParamDialog` renders each real
 * field widget (not a text box): richtext editor, color picker, date picker,
 * select, number, the AutoNumber widget for an `autonumber` param, and — the
 * ⚠️ ones — `image`/`file` uploads through the ambient UploadProvider with
 * `multiple` / `accept` / `maxSize` honored, and the **upload guard** (Confirm
 * stays disabled while a file is still uploading). Lives on Field Zoo, the
 * "one specimen of everything" object, next to its every-field-type record.
 *
 * The body just echoes the received keys — the point is the dialog, not a side
 * effect — so it needs no capabilities.
 */
export const ActionParamGalleryAction = defineAction({
  name: 'showcase_action_param_gallery',
  label: 'Action Param Gallery',
  icon: 'sparkles',
  objectName: fieldZoo,
  type: 'script',
  params: [
    { name: 'p_text', type: 'text', label: 'Title', required: true, placeholder: 'A short title' },
    { name: 'p_richtext', type: 'richtext', label: 'Rich note', helpText: 'Renders the rich-text editor, not a plain textarea.' },
    {
      name: 'p_priority', type: 'select', label: 'Priority', defaultValue: 'normal',
      options: [
        { label: 'Low', value: 'low' },
        { label: 'Normal', value: 'normal' },
        { label: 'High', value: 'high' },
      ],
    },
    { name: 'p_date', type: 'date', label: 'Effective date' },
    // #3405 — an INLINE record picker. `reference` names the object the picker
    // searches; without it the param would degrade to a "paste the record id
    // (UUID)" text box, which is what shipped before. Accounts are seeded with
    // enough volume (incl. a CJK name) to exercise search here.
    {
      name: 'p_account', type: 'lookup', reference: 'showcase_account', label: 'Related account',
      helpText: 'Inline lookup param — searchable record picker, no UUID typing.',
    },
    // #3405 — the same inline picker aimed at a SYSTEM object. This is the
    // shape the bug was reported against (PLAT-DEF-005: "assign an inspector"
    // handed the supervisor a box wanting a pasted UUID), so it earns its own
    // specimen: `sys_user` is not one of the app's own objects, and a person is
    // the reference a human is least able to identify by id.
    {
      name: 'p_assignee', type: 'lookup', reference: 'sys_user', label: 'Assignee',
      helpText: 'Inline lookup at a system object — searchable by name/email, never a UUID.',
    },
    { name: 'p_color', type: 'color', label: 'Accent color', defaultValue: '#7C3AED' },
    // Spec `autonumber` param → the AutoNumber widget (read-only, auto-assigned).
    { name: 'p_reference', type: 'autonumber', label: 'Reference #' },
    // ⚠️ image/file uploads: real widget + upload guard + multiple/accept/maxSize.
    { name: 'p_cover', type: 'image', label: 'Cover image', accept: ['image/*'], maxSize: 5 * 1024 * 1024 },
    {
      name: 'p_attachments', type: 'file', label: 'Attachments', multiple: true,
      accept: ['application/pdf', 'image/*'], maxSize: 10 * 1024 * 1024,
      helpText: 'Confirm stays disabled while a file is still uploading (ADR-0059 upload guard).',
    },
  ],
  body: {
    language: 'js',
    // No side effect — the value of this action is the dialog's widgets. Echo
    // the keys the dialog collected so the result dialog shows something.
    source: 'return { ok: true, received: Object.keys(input || {}) };',
    capabilities: [],
  },
  successMessage: 'Params received — every widget type rendered through the shared field-widget map.',
  locations: ['record_header', 'list_item'],
  refreshAfter: false,
});

/**
 * script — the `disabled` predicate specimen. Where `visible` HIDES an action
 * (see MarkDoneAction), `disabled` keeps it ON SCREEN but greyed until its
 * precondition holds: Archive stays visible on every task and only becomes
 * clickable once the task is done. Same authoring rules as `visible`
 * (`record.`-prefixed, single comparison; disabled when the CEL is TRUE).
 * Exercises the renderer-side wiring (objectui: DeclaredActionsBar +
 * action:button/group/icon/menu) that #1885's follow-through completed.
 */
export const ArchiveTaskAction = defineAction({
  name: 'showcase_archive_task',
  label: 'Archive',
  icon: 'archive',
  objectName: task,
  type: 'script',
  body: {
    language: 'js',
    // No destructive side effect — the specimen's value is the disabled
    // behavior itself; echo which record would be archived.
    source:
      "var id = ctx.recordId || (ctx.record && ctx.record.id) || input.recordId;" +
      "return { ok: true, archived: id };",
    capabilities: [],
  },
  successMessage: 'Task archived (demo — no data changed).',
  // Disabled while the task is not done — visible either way.
  disabled: 'record.done != true',
  locations: ['record_header', 'record_section'],
  refreshAfter: false,
});

/**
 * script, **OBJECT-LESS** — the `global` action specimen (framework#3913).
 *
 * Every other action here declares an `objectName`. This one deliberately does
 * NOT, which is the whole point: `objectName` is optional, and an action
 * without one is an *object-less* action. `AppPlugin` registers it under the
 * canonical `'global'` engine key (`action.object || 'global'`), and it is
 * reachable over REST at BOTH object-less URL shapes:
 *
 *   POST /api/v1/actions/global/showcase_portfolio_snapshot
 *   POST /api/v1/actions//showcase_portfolio_snapshot      ← empty object segment
 *
 * Why the app needed this: framework#3913 was filed because object-less actions
 * were unreachable (registered under `'global'`, looked up under `'*'`), and its
 * follow-up found the empty-segment URL had no route registration at all. Both
 * were fixed blind — the showcase, the "one specimen of everything" app, had no
 * object-less action, so neither the dispatch path nor either URL shape had a
 * live specimen to exercise. This is that specimen.
 *
 * The body is genuinely object-less: it counts across SEVERAL objects, so there
 * is no single record or object the action could sensibly hang off. It is
 * HEADLESS for the same reason — an object-less action has no row and no record
 * header to render on — which `locations: []` declares outright: callable over
 * REST/MCP/AI, with its capability gate, param contract and audit trail intact,
 * and claiming no UI surface. It used to say `locations: ['global_nav']`, which
 * meant the same thing in intent but named a location no renderer served;
 * #6888 retired that value and this is the declaration it always meant.
 */
export const PortfolioSnapshotAction = defineAction({
  name: 'showcase_portfolio_snapshot',
  label: 'Portfolio Snapshot',
  icon: 'gauge',
  // NO objectName — this is what makes it an object-less ('global') action.
  type: 'script',
  body: {
    language: 'js',
    source:
      "var accounts = await ctx.api.object('showcase_account').count({});" +
      "var projects = await ctx.api.object('showcase_project').count({});" +
      "var invoices = await ctx.api.object('showcase_invoice').count({});" +
      "return { ok: true, scope: 'global', accounts: accounts, projects: projects, invoices: invoices };",
    capabilities: ['api.read'],
  },
  successMessage: 'Portfolio snapshot taken.',
  locations: [],
  refreshAfter: false,
  ai: {
    exposed: true,
    description:
      'Count the accounts, projects and invoices in this workspace. Use when the user asks how big the portfolio is, or for a quick health snapshot across objects.',
  },
});

export const allActions = [
  MarkDoneAction,
  OpenDocsAction,
  BulkReassignAction,
  QuickViewAction,
  RecalcEstimateAction,
  RecalcSelectionAction,
  LogTimeAction,
  NewTaskAction,
  SubmitForSignoffAction,
  ActionParamGalleryAction,
  ArchiveTaskAction,
  PortfolioSnapshotAction,
  ...allPredicateMatrixActions,
];
