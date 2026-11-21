// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

/**
 * sys_approval_request — Record Detail Page (`kind: 'full'`, default for
 * ALL sys_approval_request records).
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
 *  - `kind: 'full'` + `isDefault: true`: the page is drawn as authored at
 *    every width. It was a `kind: 'slotted'` page until the `tabs` slot
 *    retired (#27053). Its `page:header` is the one the synthesizer supplied:
 *    the request's title, and the object's placed header actions read live
 *    (`placedActions: true`, #29951). The object places none of its own (its
 *    decision actions are `record_section` ones, drawn by the panel below), so
 *    the header draws only what an installed package places on
 *    `sys_approval_request` at `record_header` / `record_more`.
 *  - Then the highlight strip: the object's `highlightFields` WITHOUT
 *    `record_id`. `record_id` / `object_name` is a declared `referenceVia`
 *    pointer pair, and the page reaches the record it points at through the
 *    panel below, which draws that record whole and links to it. The object's
 *    own `highlightFields` keeps `record_id`: other surfaces read it. The
 *    strip and the object's list change together, never the strip alone.
 *  - Then ONE `record:approval_decision` node, the rest of the page
 *    (#34588; maintainer 2026-11-17: 「审批页应该直接显示完整的记录；「动态」在
 *    最后」): the request's declared decision actions, the reply
 *    (`approval_comment`) included; the business record as submitted, whole,
 *    in its default record page's sections, with what changed since
 *    submission marked, and its child tables; and a right rail of approval
 *    progress, attachments and activity, the activity last. The type is
 *    declared with an empty strict props row, so the node carries no
 *    `properties` at all; the panel reads the bound request, its record and
 *    the object's own actions.
 *  - The flow chip is `process_label` (the flow's label), not `process_name`
 *    (the machine source, `flow:NAME`). The console reads a request through
 *    the approvals get, which serves `process_label` by the one display-label
 *    chain (`display-labels.ts`): the stored label, else the node-config
 *    snapshot's, else the humanized machine name. Where the chain yields
 *    nothing, the field has no value, the strip draws no Flow chip, and the
 *    record title still names `process_name`.
 *  - The step chip is `current_step_label` (the "Approval Step" field), not
 *    `current_step` (the Approval node's machine id, such as `approve_step`).
 *    The approvals get serves it by the same chain: the stored label, else
 *    the snapshot's `__nodeLabel`, else the humanized node id. A request with
 *    no step at all serves neither field, and the strip draws no step chip.
 *  - There is no Object chip. `object_name` is the target object's API name
 *    as stored (`showcase_announcement`), and the object declares no field
 *    that holds that object's label. The panel names the target object
 *    beside the submitted record's heading, translated and read from the
 *    object's definition when the page draws.
 *  - There are no tabs. The page had two: Details (the pointer pair's card)
 *    and Timeline (`sys_approval_action` as a related list). The panel now
 *    draws the record itself and, last in its rail, the request's thread.
 *  - There is no `record:discussion` node: the generic discussion thread has
 *    no place here. A request's thread is its activity, and its reply is the
 *    declared `approval_comment` action, which the service stores as a
 *    `sys_approval_action` row the activity lists.
 *  - There is no aside region: the panel lays out its own rail, so the rail
 *    and the record stack in one order on a narrow screen.
 *
 * The page-level `label` is the one key a translation bundle reaches
 * (`pages.sys_approval_request_detail.label`, in `translations/pages.ts`).
 */
export const SysApprovalRequestDetailPage: Page = {
  name: 'sys_approval_request_detail',
  label: 'Approval Request',
  type: 'record',
  object: 'sys_approval_request',
  template: 'default',
  kind: 'full',
  isDefault: true,

  regions: [
    {
      name: 'main',
      width: 'full',
      components: [
        // ── The record header: the request's title (the console names the
        // request by the business record it is about, linked to it, wherever
        // the approvals get serves that record's title, objectstack#35415;
        // else by the flow's label, the object's `nameField`), and every action placed
        // on the object at `record_header` / `record_more`, read live, as the
        // synthesized header drew them. The object places none of its own, so
        // only an action another package places there shows (a bare header
        // dropped it, #29951); the host appends its system actions.
        { type: 'page:header', properties: { placedActions: true } },

        // ── Highlight chips, `record_id` left out (see the header) ─────
        {
          type: 'record:highlights',
          properties: {
            fields: ['process_label', 'status', 'current_step_label', 'submitter_id', 'updated_at'],
          },
        },

        // ── The request, whole: decisions, the record as submitted, and the
        // rail of progress, attachments and activity (objectstack#34588) ──
        { type: 'record:approval_decision' },

        // No `record:discussion` node: the reply is `approval_comment`.
      ],
    },
  ],
};
