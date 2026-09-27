## State Machines & Approvals

A record's **state machine** locks the legal transitions of its status field
so that automation — increasingly AI-generated — cannot drive a record into an
illegal state.

### State Machine — a `state_machine` validation rule (ADR-0020)

Since **ADR-0020** there is **no `workflow` metadata type** and no
`object.stateMachines` map. A record state machine is **one `state_machine`
validation rule** in the object's `validations` array: a flat `field` +
`{ from: [allowedTo] }` transition table. It is **enforced on the write path** —
an update whose `field` moves to a state not listed for the current state is
rejected with the rule's `message`. A `from` state mapped to `[]` is a declared
dead-end.

```typescript
{
  type: 'state_machine',
  name: 'case_lifecycle',
  label: 'Case Lifecycle',
  field: 'status',                 // the field that holds the state
  message: 'Invalid status transition.',
  initialStates: ['new'],          // states a record may be CREATED in
  transitions: {
    new:       ['open'],
    open:      ['escalated', 'resolved'],
    escalated: ['open', 'resolved'],
    resolved:  ['open', 'closed'],
    closed:    [],                 // final — no outgoing transitions
  },
}
```

Notes:
- **One rule per field.** Parallel lifecycles (e.g. `status` + `payment_status`)
  are N separate `state_machine` rules, one per field.
- **`initialStates`** (optional) gates INSERT: a record created with its
  state field outside this list is rejected. `transitions` only governs
  updates, so without it a record can be born mid-flow (e.g. created already
  `resolved`). Omit to keep the legacy no-check-on-insert behavior.
- **Conditional transitions / side effects are NOT part of the machine.** A
  guard is expressed as a sibling `script` / `conditional` validation rule;
  "do something when the state changes" is a **record-triggered Flow**
  (ADR-0019) — a `record_change` flow whose start-node condition gates on the
  transition, e.g. `previous.status != 'escalated' && record.status == 'escalated'`.
- **Introspection:** `GET /api/v1/meta/object/:name/state/:field?from=:state`
  returns the legal next states so UIs/agents can read the transition table
  instead of hard-coding it (`next: null` = no FSM governs the field, **or**
  `?from=` was omitted — always pass `from`).
- **An unlisted `from` state is NOT guarded.** An update whose current state is
  not a key of `transitions` is treated leniently (no lock) — list every state
  you want guarded rather than relying on an implicit "any → any".
- Predicate conditions in sibling rules evaluate against the merged record in
  the **`record.<field>`** CEL scope (bare field names do not resolve).

### Approvals (Flow Nodes)

Since **ADR-0019** there is no standalone approval-process type. An approval is
authored as an **Approval node** (`type: 'approval'`) on an ordinary flow — the
run **suspends** when it reaches the node and **resumes** down the node's
`approve` / `reject` out-edge once a decision is recorded. Multi-step review is
just successive Approval nodes wired together on the canvas, so the whole review
is one diagram a reviewer (or AI) can read end-to-end.

> There is no `approvals: [...]` stack collection — approval flows live in your
> normal `flows: [...]`. The approval *state* (`sys_approval_request` /
> `sys_approval_action`, the record lock, the status mirror, approver
> resolution) is owned by `plugin-approvals`.

```typescript
// A record-triggered flow: high-value opportunities need manager sign-off,
// and director sign-off too when the amount clears 500k.
{
  name: 'opportunity_discount_approval',
  label: 'Opportunity Discount Approval',
  type: 'record_change',
  nodes: [
    // Record-change flows bind via the START NODE's config — there is no
    // separate top-level `trigger`. `triggerType` is one of
    // `record-(before|after)-(create|update|delete)`; `condition` (bare CEL)
    // gates whether the flow launches.
    {
      id: 'start',
      type: 'start',
      label: 'On Opportunity Update',
      config: {
        objectName: 'opportunity',
        triggerType: 'record-after-update',
        condition: cel`record.amount > 100000`,
      },
    },
    {
      id: 'manager_review',
      type: 'approval',
      label: 'Sales Manager Review',
      config: {
        approvers: [{ type: 'position', value: 'sales_manager' }],
        behavior: 'first_response',            // or 'unanimous' / 'quorum' / 'per_group'
        lockRecord: true,                      // lock the record while pending
        approvalStatusField: 'approval_status', // mirror pending|approved|rejected|recalled onto the row
      },
    },
    // Decision routing lives on the OUT-EDGES, not in node config: the engine
    // evaluates each out-edge's `condition` and follows every match — and an
    // out-edge with NO condition ALWAYS runs (all such edges execute in
    // PARALLEL). Guard every branch with a condition — see e4/e5 below.
    { id: 'needs_director', type: 'decision', label: 'Needs Director?' },
    {
      id: 'director_signoff',
      type: 'approval',
      label: 'Sales Director Sign-off',
      config: {
        approvers: [{ type: 'position', value: 'sales_director' }],
        behavior: 'unanimous',
        approvalStatusField: 'approval_status',
      },
    },
    { id: 'mark_won', type: 'update_record', label: 'Mark Won',
      config: { objectName: 'opportunity', filter: { id: '{record.id}' }, fields: { stage: 'closed_won' } } },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start',          target: 'manager_review',
      // entry criteria re-homes onto the edge entering the approval node:
      condition: cel`record.amount > 100000` },
    { id: 'e2', source: 'manager_review',  target: 'needs_director',   label: 'approve' },
    { id: 'e3', source: 'manager_review',  target: 'rejected',         label: 'reject'  },
    // Decision branches: mutually-exclusive edge `condition` predicates.
    // Without them BOTH branches would execute (unguarded edges run in parallel).
    { id: 'e4', source: 'needs_director',  target: 'director_signoff', label: 'true',
      condition: cel`record.amount > 500000` },
    { id: 'e5', source: 'needs_director',  target: 'mark_won',         label: 'false',
      condition: cel`record.amount <= 500000` },
    { id: 'e6', source: 'director_signoff', target: 'mark_won',        label: 'approve' },
    { id: 'e7', source: 'director_signoff', target: 'rejected',        label: 'reject'  },
    { id: 'e8', source: 'mark_won',         target: 'approved' },
  ],
}
```

### Send-back for revision (ADR-0044)

Approval centers also model **send back for revision** (退回修改) — distinct from
`reject` (terminate) and from a comment thread (which keeps the request pending).
Send-back is a **flow movement**: the request finalizes as `returned`, the run
walks a **`revise`** out-edge to an **`approval_revise`** node (the *revise
window*) where the record unlocks and the submitter reworks it, and an explicit
*resubmit* re-enters the approval node over a **declared back-edge**, opening
round N+1 with a fresh approver slate.

```
approval ──approve──▶ …
         ──reject───▶ …
         ──revise───▶ approval_revise (record unlocked, submitter edits)
                        └──resubmit──[type:'back']──▶ approval   (round N+1)
```

Three pieces author it:

1. **`revise` out-edge** — a third branch label alongside `approve` / `reject`,
   targeting an **`approval_revise`** node. It must be that node type: the window
   is a *service-owned* pause (`resumeAuthority: 'service'`), ended only by
   `POST /api/v1/approvals/requests/:id/resubmit`; a `wait` is
   `resumeAuthority: 'any'`, so a raw run-resume would walk the back-edge
   unchecked. The node takes **no config** — there is no signal to wait on.
2. **`type: 'back'` resubmit edge** — the edge from the revise window back into
   the approval node MUST be typed `'back'`. This is the *only* thing that
   legalizes the cycle: `registerFlow` validates the graph **minus `back` edges**
   as a DAG, so an **unmarked** cycle is rejected — you opt in, edge by edge. At
   run time a back-edge traverses normally (it just re-enters the node).
3. **`maxRevisions`** on the approval `config` (default `3`) — the budget of
   send-backs per run; exceeding it **auto-rejects** (resumes down the `reject`
   edge). `maxRevisions: 0` disables send-back, so never pair `0` with a `revise`
   edge.

```typescript
{
  id: 'manager_review', type: 'approval', label: 'Manager Review',
  config: { approvers: [{ type: 'position', value: 'manager' }], lockRecord: true, maxRevisions: 2 },
},
// No config and no `waitEventConfig`: the window ends on the submitter's
// explicit resubmit, not on a signal or a timer.
{ id: 'wait_revision', type: 'approval_revise', label: 'Awaiting Revision' },
// …among the approval's edges…
{ id: 'rev',  source: 'manager_review', target: 'wait_revision',  label: 'revise' },
{ id: 'back', source: 'wait_revision',  target: 'manager_review', label: 'resubmit', type: 'back' },
```

> Three mistakes the compile-time flow lint flags: a `revise` edge into anything
> but an `approval_revise` node (an **error** — `sendBack` refuses that metadata,
> so the branch cannot run; `flow-approval-revise-target-not-service-owned`), a
> `revise` edge whose window never loops back (a dead end `registerFlow` accepts
> but that leaves the submitter nowhere to resubmit), and a resubmit edge left
> **without** `type: 'back'` (an unmarked cycle `registerFlow` rejects). Resubmit
> is an explicit verb (`POST /api/v1/approvals/requests/:id/resubmit`), never a
> record-save. See the `showcase_budget_approval` flow in the showcase app in
> the framework repo for the canonical shape.

### Recording a decision

A decision is recorded through `ApprovalService.decide()` (or the REST routes
`POST /api/v1/approvals/requests/:id/approve` | `/reject`). That finalizes the
`sys_approval_request` and **resumes** the suspended run down the matching
branch — you never resume the flow by hand, and you *cannot*: the
`approval` node declares `resumeAuthority: 'service'`, so
`POST /api/v1/automation/:name/runs/:runId/resume` answers **403** for a run
parked on one (including via a `subflow` pause) and changes nothing.

A decision may also carry **structured outputs** (`{ outputs: { … } }` in the
decide body) when the node declares the keys in `decisionOutputs` — the author
declares keys, approvers only fill values. Accepted outputs resume the run as
`<nodeId>.<key>` flow variables, so a LATER node reads them as
`vars.<nodeId>.<key>` — this is how "the previous approver picks the next
step's approvers" works without writing to a record field (see Dynamic
approvers below). A decision carrying an undeclared key is rejected;
`decision` / `requestId` are reserved. A declaration marked
`required: true` must carry a non-blank value to **approve** (never to
reject) — enforced before any write, with no elevation bypass, so the run
cannot resume past the node with the key a later `expression` approver reads
still missing.

### Approver Types

| `type` | Resolves to |
|:-------|:------------|
| `user`       | A specific user id (`value` = user id) |
| `position`   | Holders of a position — `value` = the position machine name, resolved via `sys_user_position` (ADR-0090 D3) |
| `org_membership_level` | The **org-membership tier** — `value` is one of `owner`/`admin`/`delegated_admin`/`member`. **NOT** a position: `{ type: 'org_membership_level', value: 'sales_manager' }` matches nobody; use `position`. Spelled `role` before ADR-0090 D3 — that spelling is deprecated, still resolves, and is removed in the next major |
| `team`       | Members of a flat `sys_team` |
| `department` | A department + all descendant departments |
| `manager`    | The submitter's manager (`sys_user.manager_id`) |
| `field`      | User id read from a record field (`value` = field name). Resolved against the record's **live** state at node entry, so a field written mid-flow routes correctly; a multi-select user field fans out into one approver per user |
| `queue`      | ⛔ Declared but never resolved — the slot routes to nobody. Do not author |
| `expression` | A **CEL expression** resolved at node entry (`value` = the expression) — see **Dynamic approvers** below. Only `current.*` / `trigger.*` / `vars.*` roots are available; the optional `resolveAs: 'user'(default) \| 'department' \| 'position' \| 'team'` re-expands each resolved id through the graph |

### Dynamic approvers (`type: 'expression'`)

An `expression` approver computes WHO approves at the moment the node is
entered. Its CEL source sees exactly **three roots** — nothing else:

| Root | Meaning | Analog |
|:-----|:--------|:-------|
| `current.*` | The record's **live** state at node entry — fields written by earlier steps/approvers are visible | ServiceNow `current` |
| `trigger.*` | The **submit-time snapshot** (what flow conditions call `record`) | ServiceNow Flow Designer `trigger.record`, Power Automate `triggerBody()` |
| `vars.*` | Flow variables — node outputs (`vars.<nodeId>.<key>`), `get_record` results, `vars.previous` (the pre-update row) | BPMN process variables |

**`record` and bare field names are NOT available and fail the node loudly.**
Everywhere else on this platform `record` means "the record at event time"
(flow conditions: the trigger snapshot; hook conditions: the stored record
overlaid with the write's payload) — at an
approval node that phrase is ambiguous between two different times, so you must
say which one: `current.x` or `trigger.x`. Do not carry the `record.x` habit
over from conditions.

Result contract: a user-id string, a CSV string, or an array of ids. An **empty**
result (present-but-empty field/variable) triggers `onEmptyApprovers`. A
**missing** key (`vars.never_written`) is a loud error, never a silent empty
slate — guard genuinely-optional inputs explicitly, e.g.
`has(vars.picked) ? vars.picked : []`.

```typescript
// ① Route on a field an EARLIER approver filled in mid-flow (live value):
{ type: 'expression', value: cel`current.co_review_departments`, resolveAs: 'department' }

// ② The previous approval node's decision outputs pick this node's approvers:
{ type: 'expression', value: cel`vars.lead_review.next_reviewers` }

// ③ Dynamic co-sign (会签): expression yields department ids; resolveAs expands
//    each into its members, and with behavior: 'per_group' EACH department is
//    its own sign-off group:
{
  approvers: [{ type: 'expression', value: cel`current.picked_departments`, resolveAs: 'department' }],
  behavior: 'per_group',
  onEmptyApprovers: 'fail',
}
```

The full "previous approver picks the next step's approvers" loop, end to end
(the shipped `showcase_dynamic_approval` flow in the showcase app is this shape):

<!-- os:check -->
```typescript
import { defineFlow } from '@objectstack/spec';

export const DynamicApprovalFlow = defineFlow({
  name: 'dynamic_approval',
  label: 'Dynamic Approval',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    {
      id: 'start', type: 'start', label: 'On Submit',
      config: { objectName: 'expense', triggerType: 'record-after-update', condition: "status == 'submitted'" },
    },
    {
      // Node A declares what a decision may hand to the flow. The TYPED
      // declaration renders a multi-select sys_user picker in the decision
      // dialog; the lead approves with outputs:
      //   POST …/approve { outputs: { next_reviewers: ['u2', 'u3'] } }
      // `required: true` is enforced by the runtime on APPROVE (never on
      // reject) — node B below has nobody to route to without it.
      id: 'lead_review', type: 'approval', label: 'Lead Review',
      config: {
        approvers: [{ type: 'org_membership_level', value: 'owner' }],
        decisionOutputs: [{ key: 'next_reviewers', label: 'Next Reviewers', type: 'user', multiple: true, required: true }],
      },
    },
    {
      // Node B resolves them at entry from the lead's decision outputs.
      id: 'co_sign', type: 'approval', label: 'Co-sign',
      config: {
        approvers: [{ type: 'expression', value: 'vars.lead_review.next_reviewers' }],
        behavior: 'unanimous',
        onEmptyApprovers: 'fail',
      },
    },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'lead_review' },
    { id: 'e2', source: 'lead_review', target: 'co_sign', label: 'approve' },
    { id: 'e3', source: 'lead_review', target: 'rejected', label: 'reject' },
    { id: 'e4', source: 'co_sign', target: 'approved', label: 'approve' },
    { id: 'e5', source: 'co_sign', target: 'rejected', label: 'reject' },
  ],
});
```

Time-word cheat sheet across surfaces (do not mix them up):

| Surface | Event-time record | Pre-event record | Live record |
|:--------|:------------------|:-----------------|:------------|
| Flow condition / `{…}` template | `record` (trigger snapshot) | `previous` | — (use a `get_record` node) |
| Approval `expression` approver | `trigger.*` | `vars.previous` | `current.*` |

Object-hook `ctx` is a different vocabulary — see **objectstack-data**
`references/data-hooks.md`.

### Node Config (`ApprovalNodeConfigSchema`)

| Field | Purpose |
|:------|:--------|
| `approvers` | Who may act (≥ 1 — see Approver Types above). Each approver may carry an optional **`group`** label (e.g. `{ type: 'position', value: 'auditor', group: 'finance' }`) — with `behavior: 'per_group'`, approvers sharing a label form one group; unlabelled approvers each form their own |
| `behavior` | `first_response` (first approver decides), `unanimous` (all must approve), `quorum` (`minApprovals` of N — M-of-N collective sign-off), or `per_group` (EACH approver `group` must reach `minApprovals` — one-from-each-group sign-off, 会签). In every mode a single rejection finalizes the node as `rejected`. Default `first_response` |
| `minApprovals` | Approvals required — total for `quorum`, per group for `per_group`. Omitted ⇒ ALL resolvable approvers under `quorum`, `1` per group; clamped at runtime so a misconfiguration can never deadlock |
| `lockRecord` | Lock the triggering record from edits while pending. Default `true` |
| `approvalStatusField` | Business-object field to mirror `pending`/`approved`/`rejected`/`recalled` onto (should be readonly) |
| `onEmptyApprovers` | What an EMPTY resolved slate does: `admin_rescue` (default — request opens, only a privileged admin can act via Reassign; never waves through, never kills the run), `fail` (node fails — treat an empty slate as a config bug), `auto_approve` (skip the request, continue down `approve` with `output.autoApproved = true` — opt-in because it silently waves the record through), `fallback` (request opens on the sibling `fallbackApprovers` instead — same shape as `approvers`, required by this policy and refused under any other; a fallback that itself resolves to nobody degrades to `admin_rescue`). Declare it explicitly on any node with an `expression` approver (linted) |
| `decisionOutputs` | Decision outputs a decision may carry (author declares, approvers fill values). Entries are bare keys (free-text input) **or typed declarations** `{ key, label?, type: 'text'\|'user'\|'department'\|'position'\|'team', multiple?, required? }` — a typed entry renders the matching record picker in the decision dialog (`multiple` collects an id array). Accepted outputs resume the run as `<nodeId>.<key>` variables; undeclared keys reject the decision; `decision`/`requestId` reserved |
| `escalation` | Optional per-node SLA — `{ enabled, timeoutHours, action: reassign\|auto_approve\|auto_reject\|notify, escalateTo?, notifySubmitter }`. `timeoutHours` is **calendar (wall-clock) hours** — nights, weekends and holidays count; the platform ships no business-hours calendar. `escalateTo` is a **position machine name** (expanded to its holders via `sys_user_position`, ADR-0090 D3) or a specific user id — never a membership tier. `reassign` without `escalateTo` degrades to notify (linted) |
| `maxRevisions` | ADR-0044 — max **send-backs-for-revision** per run before auto-reject. Default `3`; `0` disables send-back. Only meaningful when the node has a `revise` out-edge |

### Branching, side-effects & rejection

These are wired on the **graph**, not in node config:

- **Conditional step** — put a `decision` node before the Approval node, or a
  `condition` on the edge entering it (the old per-step `entryCriteria`).
- **On approve / on reject** — wire downstream nodes (`update_record`,
  `http`, a `notify` node, …) to the `approve` / `reject` out-edge.
- **Roll back on reject** — route the `reject` edge as a **back-edge** to an
  earlier node so the submitter can revise (the old `back_to_previous`).
- **Send back for revision (ADR-0044)** — distinct from a plain reject: a
  `revise` out-edge into an **`approval_revise`** window, closed by a
  `type: 'back'` resubmit edge. See *Send-back for revision* above.
- **Hard reject** — route the `reject` edge to an `end` node (the old
  `reject_process`).

### Approval Best Practices

1. **Gate entry on the edge** (`condition` into the Approval node) so the flow
   only pauses for records that actually need sign-off.
2. **Set `approvalStatusField`** to mirror status onto the row — views and
   formulas can then filter on it without joining `sys_approval_request`.
3. **Keep `lockRecord: true`** unless you have a strong reason to allow
   edits while pending — otherwise approvers chase a moving target.
4. **Model rejection as a visible branch** — a back-edge to revise, or an `end`
   node to terminate. The path is on the diagram, not hidden in config.
5. **Notify from downstream nodes** wired to the `approve` / `reject` edges
   rather than expecting the node to send mail itself.
