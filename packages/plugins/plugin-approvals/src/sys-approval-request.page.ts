// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

/**
 * sys_approval_request — Record Detail Page (slotted, default for ALL
 * sys_approval_request records).
 *
 * **Audience**: the people on a request — its submitter and its approvers —
 * opening it from the approvals inbox or from Setup → Approvals → Requests.
 *
 * This is the page the console mounts `RecordDetailView` over for a request:
 * the placement of every block on it is metadata served from here, through
 * this plugin's manifest `pages` (the way plugin-auth ships `sys_user`'s), and
 * the console only registers renderers. Every block is a declared spec type,
 * so `os validate` checks the page whole, props included.
 *
 * Strategy
 * --------
 *  - `kind: 'slotted'` + `isDefault: true`. `header` falls through to the
 *    synthesizer, so the request's title and its header actions stay as the
 *    object declares them.
 *  - `actions` holds ONE `record:approval_decision` node: the request's
 *    decision progress and its declared decision actions, the reply
 *    (`approval_comment`) included, in one panel. The type is declared with an
 *    empty strict props row, so the node carries no `properties` at all; the
 *    panel reads the bound request and the object's own actions.
 *  - `highlights` is the object's `highlightFields` WITHOUT `record_id`. The
 *    details grid hides every field a mounted highlights strip shows, and
 *    `record_id` / `object_name` is a declared `referenceVia` pointer pair that
 *    the console draws as a card of the target record IN THE DETAILS GRID — a
 *    strip carrying `record_id` would take the card off the page. The object's
 *    own `highlightFields` is left as it is: other surfaces read it, and only
 *    this page has a grid the pair must stay in.
 *  - `tabs` is authored: Details (`record:details`, the request's own fields
 *    by the object's field groups) and Timeline — `sys_approval_action` as a
 *    related list keyed on `request_id`, newest first. The `tabs` slot is
 *    authored rather than `details` because the console builds the tab strip
 *    from `tabs` when both are present; the details body therefore lives in
 *    the first tab here, and the page authors no `details` slot.
 *  - `discussion: []` removes the generic discussion thread. A request's
 *    thread is its timeline, and its reply is the declared `approval_comment`
 *    action, which the service stores as a `sys_approval_action` row the
 *    Timeline tab lists.
 *  - There is no aside: the slot map has no right-rail slot.
 *
 * Copy inside `slots` is authored as inline locale maps, the ruled route for
 * page prose; the page-level `label` is the one key a translation bundle
 * reaches (`pages.sys_approval_request_detail.label`, in
 * `translations/pages.ts`).
 */
export const SysApprovalRequestDetailPage: Page = {
  name: 'sys_approval_request_detail',
  label: 'Approval Request',
  type: 'record',
  object: 'sys_approval_request',
  template: 'default',
  kind: 'slotted',
  isDefault: true,

  regions: [],

  slots: {
    // ── The decision panel ────────────────────────────────────────
    actions: [{ type: 'record:approval_decision' }],

    // ── Highlight chips, `record_id` left to the details grid ─────
    highlights: {
      type: 'record:highlights',
      properties: {
        fields: ['process_name', 'object_name', 'status', 'current_step', 'submitter_id', 'updated_at'],
      },
    },

    // ── Tabs: the request's fields, then its timeline ─────────────
    tabs: {
      type: 'page:tabs',
      properties: {
        tabStyle: 'line',
        position: 'top',
        items: [
          {
            label: { en: 'Details', 'zh-CN': '详情', 'ja-JP': '詳細', 'es-ES': 'Detalles' },
            icon: 'file-text',
            children: [{ type: 'record:details' }],
          },
          {
            label: { en: 'Timeline', 'zh-CN': '时间线', 'ja-JP': 'タイムライン', 'es-ES': 'Cronología' },
            icon: 'history',
            children: [
              {
                type: 'record:related_list',
                properties: {
                  objectName: 'sys_approval_action',
                  relationshipField: 'request_id',
                  columns: ['created_at', 'action', 'actor_id', 'step_name', 'comment', 'attachments'],
                  sort: [{ field: 'created_at', order: 'desc' }],
                  limit: 50,
                  showViewAll: true,
                  title: { en: 'Timeline', 'zh-CN': '时间线', 'ja-JP': 'タイムライン', 'es-ES': 'Cronología' },
                },
              },
            ],
          },
        ],
      },
    },

    // ── No generic discussion thread: the reply is `approval_comment` ──
    discussion: [],
  },
};
