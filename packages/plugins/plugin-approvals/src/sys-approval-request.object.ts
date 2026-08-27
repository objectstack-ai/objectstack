// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { APPROVAL_STATUSES, APPROVAL_STATUS_LABELS } from '@objectstack/spec/contracts';

/**
 * sys_approval_request — Live approval instance.
 *
 * ADR-0019: opened by a flow's **Approval node** when the run reaches it; the
 * run suspends until a decision is recorded. The row's lifecycle:
 *
 *   `pending` → (per-approver decisions) → `approved` | `rejected`
 *   `pending` → recalled by submitter → `recalled`
 *
 * `flow_run_id` / `flow_node_id` tie the request back to the suspended run so a
 * decision can resume it; `current_step` mirrors the node id. `node_config_json`
 * snapshots the Approval node config (approvers / behaviour) the request was
 * opened with.
 *
 * `payload_json` captures a snapshot of the target record at submission time.
 * It is retained as **audit evidence of what was actually submitted**, so the
 * column stays whole AT REST; it is served **redacted per reader** — the
 * SUBJECT object's field-level read controls are applied at serve time from
 * the security service's `getReadableFields`, on the approvals-inbox door and
 * on the generic data door alike (#11039).
 *
 * ⛔ Notifications are NOT a consumer of this snapshot, and the audit-evidence
 * sentence above — not "notifications need it" — is why the column holds a
 * full row. See the note on the field itself.
 *
 * @namespace sys
 */
export const SysApprovalRequest = ObjectSchema.create({
  name: 'sys_approval_request',
  label: 'Approval Request',
  pluralLabel: 'Approval Requests',
  icon: 'inbox',
  isSystem: true,
  managedBy: 'engine-owned',
  description: 'Live approval instance tracked per submission',
  displayNameField: 'id',
  nameField: 'id', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{process_name} · {record_id}',
  highlightFields: ['process_name', 'object_name', 'record_id', 'status', 'current_step', 'submitter_id', 'updated_at'],

  // Curated built-in list views — render as segmented tabs in the console.
  // Filters use {current_user_id} substitution wired by the console.
  listViews: {
    my_pending: {
      type: 'grid',
      name: 'my_pending',
      label: 'My Pending',
      data: { provider: 'object', object: 'sys_approval_request' },
      columns: ['process_name', 'object_name', 'record_id', 'current_step', 'submitter_id', 'updated_at'],
      filter: [
        { field: 'status', operator: 'equals', value: 'pending' },
        { field: 'pending_approvers', operator: 'contains', value: '{current_user_id}' },
      ],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 25 },
      emptyState: { title: 'No pending approvals', message: 'You\'re all caught up.' },
    },
    submitted_by_me: {
      type: 'grid',
      name: 'submitted_by_me',
      label: 'I Submitted',
      data: { provider: 'object', object: 'sys_approval_request' },
      columns: ['process_name', 'object_name', 'record_id', 'status', 'current_step', 'updated_at'],
      filter: [{ field: 'submitter_id', operator: 'equals', value: '{current_user_id}' }],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 25 },
    },
    completed: {
      type: 'grid',
      name: 'completed',
      label: 'Completed',
      data: { provider: 'object', object: 'sys_approval_request' },
      columns: ['process_name', 'object_name', 'record_id', 'status', 'submitter_id', 'completed_at'],
      filter: [{ field: 'status', operator: 'in', value: ['approved', 'rejected', 'recalled'] }],
      sort: [{ field: 'completed_at', order: 'desc' }],
      pagination: { pageSize: 25 },
    },
    all_requests: {
      type: 'grid',
      name: 'all_requests',
      label: 'All',
      data: { provider: 'object', object: 'sys_approval_request' },
      columns: ['process_name', 'object_name', 'record_id', 'status', 'current_step', 'submitter_id', 'updated_at'],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    id: Field.text({ label: 'Request ID', required: true, readonly: true, group: 'System' }),

    // [#10101, the cloud#1395 Option A ruling] The SUBJECT record's
    // organization, with the acting context as fallback — resolved by the
    // SHARED platform-row resolver (`resolveRecordOrganizationField`,
    // `@objectstack/metadata-core`) in `openNodeRequest`, the row's only
    // writer. The same `requestOrg` stamps `sys_approval_action` and the
    // `sys_approval_approver` index, so all three move together.
    //
    // Why subject-first: an approval request is read through the organization
    // wall by the approvals inbox, and the acting context is NULL on every
    // schedule / time-relative / api triggered run (none carries a tenant, by
    // construction). Stamped from the actor alone — the pre-#10101 behaviour,
    // measured on cloud#1395 as 27 of 27 rows org-less on a walled HotCRM SaaS
    // boot — such a request LOCKED the record it was about while being
    // invisible in every inbox, its owner's included. Subject-first is also
    // what `sys_audit_log`'s writer already did (#8707 honouring #8287's
    // ruling), so an approval row and an audit row about the same record now
    // land behind the same wall instead of two.
    //
    // The `sys_api_key` divergence is deliberate and preserved: its
    // `tenancy.organizationField: 'active_organization_id'` (stamp-only,
    // #8778) wins limb 0 of the shared resolver, while the credential table
    // itself stays unwalled (`tenancy.enabled: false`) — who a row is ABOUT
    // and what an object is WALLED by remain different questions.
    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      group: 'System',
      // Reworded with the #10101 write-side fix (was "Tenant that owns this
      // approval request (propagated from submitter context)" — it claimed a
      // propagation that measurably did not happen, and said "Tenant" where
      // ADR-0120 §Terminology requires "organization"). Extracted into the
      // generated i18n bundles as `help`; the four locales regenerate in the
      // same pass.
      description: 'Organization of the record this request is about (falls back to the acting context when the record has none)',
    }),

    process_name: Field.text({
      label: 'Source',
      required: true,
      maxLength: 100,
      description: 'Origin of the request — `flow:<flowName|nodeId>` for node-driven approvals',
      group: 'Target',
    }),

    object_name: Field.text({
      label: 'Object',
      required: true,
      maxLength: 100,
      group: 'Target',
    }),

    record_id: Field.text({
      label: 'Record ID',
      required: true,
      maxLength: 100,
      // [#11386] The id half of this object's pointer pair (ADR-0052 §5),
      // adopting the #11339 carrier. VERIFIED for THIS object: the pair is not
      // decoration but the key the approval machinery QUERIES ON —
      // `approval-service.ts` finds a record's pending request with
      // `where: { object_name, record_id, status: 'pending' }`, and
      // `lifecycle-hooks.ts` holds the record LOCK on the same pair
      // (single-record and `$in` batch forms). `submit()` writes it from
      // `input.object` / `input.recordId`, so a stored value is always a
      // record id of the object the sibling names.
      //
      // Consequence of declaring, sharper here than elsewhere: a seeded
      // request whose `record_id` stayed a verbatim natural key locked
      // NOTHING and appeared under no record — it looked like a pending
      // approval while being invisible to both queries that give the row its
      // meaning. That is now a loud seed-time refusal. Both halves are
      // `required: true`, so the un-addressable case (id half authored, type
      // half empty) is already unreachable on this object.
      group: 'Target',
      //
      // ⚠️ ORDERING CONSTRAINT — this id half is `required: true`, and that
      // makes it ORDER-DEPENDENT in seeds even though a pointer pair
      // contributes no static ordering edge (#11674, measured against the real
      // engine in `packages/objectql/src/engine-seed-required-deferral.test.ts`):
      // the seed loader defers an unresolvable reference by DELETING the column
      // from the pass-1 insert, required-validation rejects that row, and pass 2
      // is then left with no row to back-fill. So the pass-2 healing that makes
      // an OPTIONAL id half order-independent (`sys_audit_log`) does not reach
      // this one. ⇒ SEED THE TARGET DATASET FIRST. The failure if you do not is
      // loud in three places — a write error naming this column, a
      // dropped-deferral error, and `success: false` — and since #11674 the
      // loader also WARNS at load time, before the engine rejects the row.
      referenceVia: 'object_name',
    }),

    submitter_id: Field.lookup('sys_user', {
      label: 'Submitter',
      required: false,
      group: 'Target',
    }),

    submitter_comment: Field.textarea({
      label: 'Submitter Comment',
      required: false,
      group: 'Target',
    }),

    status: Field.select(
      // Derived from the contract, not re-typed (#3786). `APPROVAL_STATUSES` is
      // where the list and the reason for each entry live; `ApprovalStatus` is
      // derived from it, so this column and the contract cannot disagree. The
      // authored English label per entry lives beside it in
      // `APPROVAL_STATUS_LABELS` (#8543) — mapped here, never re-typed, so the
      // `en` bundle regenerates from the contract's own text.
      APPROVAL_STATUSES.map((value) => ({ value, label: APPROVAL_STATUS_LABELS[value] })),
      {
        label: 'Status',
        required: true,
        defaultValue: 'pending',
        description: 'Lifecycle state of the request',
        group: 'State',
      },
    ),

    current_step: Field.text({
      label: 'Current Step',
      required: false,
      maxLength: 100,
      description: 'Machine name of the step awaiting approval',
      group: 'State',
    }),

    current_step_index: Field.number({
      label: 'Current Step Index',
      required: false,
      defaultValue: 0,
      group: 'State',
    }),

    pending_approvers: Field.textarea({
      label: 'Pending Approvers',
      required: false,
      description: 'Comma-separated user ids who can act on the current step',
      group: 'State',
    }),

    // The module docstring above used to justify this column with "used by
    // notifications so they can render before the record is locked or
    // changed". That consumer does not exist, and the claim was cited as the
    // reason the column holds a FULL row before anyone checked it. Measured
    // against every `this.notify(...)` call site in `approval-service.ts` —
    // all 12 of them: each passes `{ title, message, actionUrl }` (two also
    // `actions`), built from `object_name` / `record_id` and the caller's
    // comment. None reads this column or the parsed `payload`. The real
    // readers are the serve path (`rowFromRequest` -> `payload`, redacted per
    // reader), the decide-time approver re-resolution and the org backfill,
    // both under SYSTEM_CTX, and the free-text predicate.
    //
    // The `description` below is deliberately UNCHANGED: it is accurate, and
    // it is extracted into the four generated i18n bundles as `help`. The
    // false sentence lived only in the JSDoc above, which is not extracted —
    // so this correction moves no translation leaf.
    payload_json: Field.textarea({
      label: 'Snapshot',
      required: false,
      description: 'Record snapshot at submission time',
      group: 'State',
    }),

    // ── ADR-0019: approval-as-flow-node correlation ──────────────────
    // When a request is opened by an Approval *node* (rather than a standalone
    // process), these tie it back to the suspended flow run so a decision can
    // resume it. Null for legacy process-driven requests.
    flow_run_id: Field.text({
      label: 'Flow Run',
      required: false,
      maxLength: 100,
      readonly: true,
      description: 'Suspended automation run id this request gates (ADR-0019). The decision resumes it.',
      group: 'State',
    }),

    flow_node_id: Field.text({
      label: 'Flow Node',
      required: false,
      maxLength: 100,
      readonly: true,
      description: 'Approval node id within the flow that opened this request (ADR-0019).',
      group: 'State',
    }),

    node_config_json: Field.textarea({
      label: 'Node Config',
      required: false,
      readonly: true,
      description: 'Snapshot of the Approval node config (approvers/behavior) for node-driven requests (ADR-0019).',
      group: 'State',
    }),

    completed_at: Field.datetime({
      label: 'Completed At',
      required: false,
      group: 'State',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({ label: 'Updated At', required: false, group: 'System' }),
  },

  indexes: [
    // Look up "is there a pending request for this record?" — common
    // guard on submit and on edit-while-locked checks.
    { fields: ['object_name', 'record_id'] },
    { fields: ['status', 'object_name'] },
    // Status-windowed listings (escalation sweep, "All" tab ordering).
    // "My approvals" matching no longer scans this table: the service keeps
    // a normalized per-approver index in `sys_approval_approver` (#1745) and
    // resolves approver filters there; `pending_approvers` stays the
    // human-readable CSV source of truth only.
    { fields: ['status', 'updated_at'] },
    { fields: ['submitter_id', 'status'] },
  ],

  // Server-declared decision actions (objectui#2678 P2-4). The console's
  // generic action runtime renders and executes these wherever this object is
  // surfaced — the approvals inbox included — so new decision capabilities
  // (and their params) ship as metadata, not as hand-written buttons. Each
  // targets the existing approvals REST route; `{id}` resolves from the row
  // and `actorId` defaults to the caller server-side. The service remains the
  // authority on who may act; `visible` gates on the server-computed
  // per-viewer block (#3310): approver actions on `record.viewer.can_act`
  // (the caller is a current pending approver — same check the service
  // authorizes a decision with, so position/team approvers resolve correctly),
  // submitter actions on `record.viewer.is_submitter`. The four levers the
  // #3424 override covers (approve/reject/reassign, and recall since #12716)
  // additionally OR in `record.viewer.can_override`
  // so a platform/tenant admin can rescue a request routed to an
  // unstaffed position — otherwise undecidable, locking the record forever — by
  // approving, rejecting, reassigning it to a real approver, or recalling it
  // (the lever that releases the record without recording a decision nobody
  // made). `viewer` is
  // attached by getRequest/listRequests; where it is absent the predicate fails
  // closed.
  //
  // Every predicate below is guarded for the SPARSE action face (#8990). This
  // binding is a list row or a record read carrying only what the caller
  // projected, and CEL aborts the whole expression at key resolution — so the
  // unguarded `record.viewer.can_act` faulted (`No such key: viewer`) on any
  // row without the block, and the button silently vanished, indistinguishable
  // from "the gate said no". `materializeDeclaredFields`'s doc comment in
  // `@objectstack/objectql` is the canonical statement of the guard rule; this
  // file follows it and does not restate it.
  //
  // `viewer` is a NESTED block, which needs one measurement the canonical rule
  // does not spell out. Measured against the `@objectstack/formula` CEL engine:
  // `has(record.viewer) && record.viewer != null && record.viewer.can_act`
  // still FAULTS on `{viewer: {}}` (`No such key: can_act`) and on
  // `{viewer: {can_act: null}}` (`Logical operator requires bool operands`).
  // Guarding the LEAF instead — `has(record.viewer) &&
  // has(record.viewer.can_act) && record.viewer.can_act == true` — is total
  // over every binding AND subsumes the parent `!= null` half, because `has()`
  // on a path whose parent is null answers `false` rather than faulting. So the
  // leaf `has()` plus the `== true` comparison is the MINIMAL safe form here,
  // not a longer one: `== true` is load-bearing (a bare truthy read of a null
  // leaf faults the logical operator), the parent `!= null` is not.
  actions: [
    {
      name: 'approval_approve',
      label: 'Approve',
      icon: 'check-circle',
      // Primary decision — the console renders this filled/highlighted so it
      // stands out from the secondary levers in the drawer's action bar,
      // matching the mobile card hierarchy (objectui#2762 P1-5).
      variant: 'primary',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/approve',
      params: [
        { name: 'comment', label: 'Comment', type: 'textarea', required: false },
        // Decision attachments (#3266). The console renders `type:'file'` params
        // through the shared upload widget and POSTs the resolved `attachments:
        // string[]`; the decision route persists them on `sys_approval_action`.
        { name: 'attachments', label: 'Attachments', type: 'file', multiple: true, required: false },
      ],
      visible:
        'has(record.viewer) && has(record.viewer.can_act) && record.viewer.can_act == true' +
        ' || has(record.viewer) && has(record.viewer.can_override) && record.viewer.can_override == true',
      locations: ['record_section', 'list_item'],
      successMessage: 'Approved.',
      refreshAfter: true,
    },
    {
      name: 'approval_reject',
      label: 'Reject',
      // The confirm question lives HERE, not in `confirmText`: this action
      // collects params, so the console would otherwise chain a confirm dialog
      // and then the param dialog for one decision — and the first one already
      // reads as "the action ran" (#7278, maintainer ruling 2026-08-10). The
      // param dialog renders this as its description, and nothing is POSTed
      // until its own Confirm: one condition, one wording, one dialog.
      // NB: the top-level action `description` (#7367), never `ai.description`
      // — that one is the LLM-facing tool contract and is not shown to anyone.
      description: 'Reject this request? A rejection is final for every approver.',
      icon: 'x-circle',
      // Destructive decision — rendered in the console's danger styling so it
      // reads as the irreversible action it is (objectui#2762 P1-5).
      variant: 'danger',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/reject',
      params: [
        { name: 'comment', label: 'Comment', type: 'textarea', required: false },
        { name: 'attachments', label: 'Attachments', type: 'file', multiple: true, required: false },
      ],
      visible:
        'has(record.viewer) && has(record.viewer.can_act) && record.viewer.can_act == true' +
        ' || has(record.viewer) && has(record.viewer.can_override) && record.viewer.can_override == true',
      locations: ['record_section', 'list_item'],
      successMessage: 'Rejected.',
      refreshAfter: true,
    },
    {
      name: 'approval_reassign',
      label: 'Reassign',
      icon: 'arrow-right-left',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/reassign',
      params: [
        // Field-backed on `submitter_id` (the object's only `sys_user` lookup):
        // the console resolves its lookup config (`reference_to: sys_user`) so the
        // dialog renders a real user picker, while `name: 'to'` overrides the
        // request-body key to the `to` the reassign route expects. This is a
        // config-borrow, not a submitter pre-fill (`defaultFromRow` stays off).
        { field: 'submitter_id', name: 'to', label: 'New approver', required: true, helpText: 'User to hand this step to' },
        { name: 'comment', label: 'Comment', type: 'textarea', required: false },
      ],
      visible:
        'has(record.viewer) && has(record.viewer.can_act) && record.viewer.can_act == true' +
        ' || has(record.viewer) && has(record.viewer.can_override) && record.viewer.can_override == true',
      locations: ['record_section'],
      successMessage: 'Reassigned.',
      refreshAfter: true,
    },

    // ── Approver secondary decisions ────────────────────────────────
    // Send back for revision / request more info (ADR-0044). Both are approver
    // actions, so `visible` gates on `record.viewer.can_act` (a current pending
    // approver) — same as approve/reject. The service stays the authority.
    {
      name: 'approval_send_back',
      label: 'Send back',
      icon: 'corner-up-left',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/revise',
      params: [
        { name: 'comment', label: 'Reason', type: 'textarea', required: false },
      ],
      visible: 'has(record.viewer) && has(record.viewer.can_act) && record.viewer.can_act == true',
      locations: ['record_section'],
      successMessage: 'Sent back for revision.',
      refreshAfter: true,
    },
    {
      name: 'approval_request_info',
      label: 'Request info',
      icon: 'help-circle',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/request-info',
      params: [
        { name: 'comment', label: 'What do you need?', type: 'textarea', required: true },
      ],
      visible: 'has(record.viewer) && has(record.viewer.can_act) && record.viewer.can_act == true',
      locations: ['record_section'],
      successMessage: 'Information requested.',
      refreshAfter: true,
    },

    // ── Submitter continuity actions ────────────────────────────────
    // Remind / recall (pending) and resubmit / recall (returned). These are the
    // submitter's own levers, so `visible` gates on `record.viewer.is_submitter`
    // (server-computed on the current viewer). The service re-checks ownership;
    // the predicate keeps a plain non-submitter from ever seeing a button they
    // cannot use.
    //
    // `recall` is the one exception, and it is not a widening: it ALSO ORs in
    // the #3424 admin override (#12716), because an override admin is a caller
    // `ApprovalService.recall` already authorises. Remind and resubmit keep no
    // override arm.
    {
      name: 'approval_remind',
      label: 'Send reminder',
      icon: 'bell-ring',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/remind',
      params: [
        { name: 'comment', label: 'Note', type: 'textarea', required: false },
      ],
      visible: 'has(record.status) && record.status == "pending" && has(record.viewer) && has(record.viewer.is_submitter) && record.viewer.is_submitter == true',
      locations: ['record_section'],
      successMessage: 'Reminder sent.',
      refreshAfter: true,
    },
    {
      name: 'approval_recall',
      label: 'Recall',
      // Confirm question as the param dialog's description, not `confirmText`
      // — same one-decision-one-dialog rule as `approval_reject` above (#7278).
      description: 'Recall this request? Approvers can no longer act on it and the record is unlocked.',
      icon: 'undo-2',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/recall',
      params: [
        { name: 'comment', label: 'Comment', type: 'textarea', required: false },
      ],
      // Recall applies while the request is live for the submitter — pending
      // (withdraw) or returned (abandon the revision instead of resubmitting).
      //
      // The second arm is the #3424 admin override, spelled byte-identically to
      // the three core decision levers above (#12716). `ApprovalService.recall`
      // has admitted the override caller since #3424 — `isOverrideActor`'s own
      // doc block names recall as one of the four levers — so until this arm
      // landed, recall was the one authorised capability with no button: an
      // admin could approve or reject their way out of a stuck request (writing
      // a decision that did not happen) or reassign it, but could not withdraw.
      //
      // The override arm carries no status test of its own, on purpose, because
      // it does not need one and the siblings do not have one either: the flag
      // is already status-scoped where it is COMPUTED. `attachViewers` in
      // `approval-service.ts` sets
      // `can_override: row.status === 'pending' && isOverrideActor(...)` —
      // ANDed — so `record.viewer.can_override` can never be true off `pending`,
      // and this arm is pending-only in effect however CEL groups the
      // expression. Pinned in both directions in
      // `action-predicate-sparse-face.test.ts`, with the flag's own scoping
      // pinned against the real service in `approval-revise.test.ts`.
      visible:
        'has(record.status) && (record.status == "pending" || record.status == "returned")' +
        ' && has(record.viewer) && has(record.viewer.is_submitter) && record.viewer.is_submitter == true' +
        ' || has(record.viewer) && has(record.viewer.can_override) && record.viewer.can_override == true',
      locations: ['record_section'],
      successMessage: 'Recalled.',
      refreshAfter: true,
    },
    {
      name: 'approval_resubmit',
      label: 'Resubmit',
      icon: 'refresh-cw',
      type: 'api',
      method: 'POST',
      target: '/api/v1/approvals/requests/{id}/resubmit',
      params: [
        { name: 'comment', label: 'What changed?', type: 'textarea', required: false },
      ],
      visible: 'has(record.status) && record.status == "returned" && has(record.viewer) && has(record.viewer.is_submitter) && record.viewer.is_submitter == true',
      locations: ['record_section'],
      successMessage: 'Resubmitted.',
      refreshAfter: true,
    },
  ],

  enable: {
    // [ADR-0103] Engine-owned: the approval engine owns the request lifecycle
    // (SYSTEM_CTX); users act via domain actions (Submit/Approve/Recall), never
    // generic CRUD. Reads stay open.
    apiMethods: ['get', 'list'],
  },
});
