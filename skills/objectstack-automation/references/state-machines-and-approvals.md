## State Machines & Approvals

A record's **state machine** locks its status field's legal transitions so
automation cannot drive it into an illegal state. Unmarked blocks are
fragments.

### State Machine — a `state_machine` validation rule (ADR-0020)

Since **ADR-0020** there is **no `workflow` metadata type** and no
`object.stateMachines` map. A record state machine is **one `state_machine`
validation rule** in the object's `validations` array: a flat `field` +
`{ from: [allowedTo] }` transition table. It is **enforced on the write path**:
an update moving `field` to a state not listed for the current one is
rejected with the rule's `message`.

<!-- os:check -->
```typescript
import type { StateMachineValidation } from '@objectstack/spec/data';
const rule: StateMachineValidation = {
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
};
```

Notes:
- **One rule per field.** Parallel lifecycles (`status` + `payment_status`)
  are separate `state_machine` rules.
- **`initialStates`** gates INSERT: a record created in a state outside
  this list is rejected. `transitions` only governs updates, so a
  machine running on insert without it is refused at publish
  (`state-machine-no-initial-states`); an update-only machine
  (`events: ['update']`) needs none.
- **Conditional transitions / side effects are NOT part of the machine.** A
  guard is a sibling `script` / `conditional` rule; a reaction to
  a state change is a `record_change` flow (ADR-0019) whose start-node
  condition gates on the transition.
- **Introspection:** `GET /api/v1/meta/object/:name/state/:field?from=:state`
  returns the legal next states for UIs/agents to read (`next: null` = no
  FSM governs the field, **or** `?from=` was omitted — always pass `from`).
- **An unlisted `from` state is NOT guarded.** An update whose current state
  is not a key of `transitions` passes — list every state to guard.
- **Clearing the field is a transition to `''`.** An update to `null` or `''`
  is judged from the stored state: a clearable state lists `''` in its
  targets, e.g. `paused: ['open', '']`; from any other listed state it is
  refused (`invalid_transition`, `constraint.to: ''`).
- Sibling-rule predicates read the merged record in the **`record.<field>`**
  CEL scope (bare field names do not resolve).
- **An AI-gated irreversible transition** pairs this rule with a lock on
  `field`: **objectstack-ai** → Common Pitfalls.

### Approvals (Flow Nodes)

Since **ADR-0019** there is no standalone approval-process type. An approval is
authored as an **Approval node** (`type: 'approval'`) on an ordinary flow — the
run **suspends** when it reaches the node and **resumes** down the node's
`approve` / `reject` out-edge once a decision is recorded. Multi-step review is
successive Approval nodes.

> There is no `approvals: [...]` stack collection. The approval *state* (`sys_approval_request` /
> `sys_approval_action`, the record lock, the status mirror, approver
> resolution) is owned by `plugin-approvals`.

A record-triggered flow, as JSON: high-value opportunities need manager
sign-off, and director sign-off too when the amount clears 500k. In TypeScript
the same literal goes inside `defineFlow(...)`, and `` cel`…` `` builds each
`{ dialect, source }` envelope.

- The trigger is the START node's config.
- Decision routing lives on the OUT-EDGES, not in node config: the engine
  evaluates each out-edge's `condition` and follows every match — and an
  out-edge with NO condition ALWAYS runs (all such edges execute in PARALLEL).
  Guard every branch with a condition — `e4` / `e5`.
- Entry criteria re-home onto the edge entering the approval node — `e1`.

```json
{
  "name": "crm_opportunity_discount_approval",
  "label": "Opportunity Discount Approval",
  "type": "record_change",
  "nodes": [
    { "id": "start", "type": "start", "label": "On Opportunity Update", "config": {
        "objectName": "opportunity", "triggerType": "record-after-update",
        "condition": { "dialect": "cel", "source": "record.amount != null && record.amount > 100000" } } },
    { "id": "manager_review", "type": "approval", "label": "Sales Manager Review", "config": {
        "approvers": [{ "type": "position", "value": "crm_sales_manager" }],
        "behavior": "first_response", "lockRecord": true, "approvalStatusField": "approval_status" } },
    { "id": "needs_director", "type": "decision", "label": "Needs Director?" },
    { "id": "director_signoff", "type": "approval", "label": "Sales Director Sign-off", "config": {
        "approvers": [{ "type": "position", "value": "crm_sales_director" }],
        "behavior": "unanimous", "approvalStatusField": "approval_status" } },
    { "id": "mark_won", "type": "update_record", "label": "Mark Won", "config": {
        "objectName": "opportunity", "filter": { "id": { "dialect": "cel", "source": "record.id" } },
        "fields": { "stage": "closed_won" } } },
    { "id": "approved", "type": "end", "label": "Approved" },
    { "id": "rejected", "type": "end", "label": "Rejected" }
  ],
  "edges": [
    { "id": "e1", "source": "start", "target": "manager_review",
      "condition": { "dialect": "cel", "source": "record.amount > 100000" } },
    { "id": "e2", "source": "manager_review", "target": "needs_director", "label": "approve" },
    { "id": "e3", "source": "manager_review", "target": "rejected", "label": "reject" },
    { "id": "e4", "source": "needs_director", "target": "director_signoff", "label": "true",
      "condition": { "dialect": "cel", "source": "record.amount > 500000" } },
    { "id": "e5", "source": "needs_director", "target": "mark_won", "label": "false",
      "condition": { "dialect": "cel", "source": "record.amount <= 500000" } },
    { "id": "e6", "source": "director_signoff", "target": "mark_won", "label": "approve" },
    { "id": "e7", "source": "director_signoff", "target": "rejected", "label": "reject" },
    { "id": "e8", "source": "mark_won", "target": "approved" }
  ]
}
```

### Send-back for revision (ADR-0044)

Approval centers also model **send back for revision** — distinct from
`reject` (terminate) and from a comment thread (which keeps the request pending).
Send-back is a **flow movement**: the request finalizes as `returned`, the run
walks a **`revise`** out-edge to an **`approval_revise`** node (the *revise
window*) where the record unlocks and the submitter reworks it, and an explicit
*resubmit* re-enters the approval node over a **declared back-edge**, opening
round N+1 with a fresh approver slate.

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
   as a DAG, so an **unmarked** cycle is rejected. At
   run time a back-edge traverses normally.
3. **`maxRevisions`** on the approval `config` (default `3`) — the budget of
   send-backs per run; exceeding it **auto-rejects** (resumes down the `reject`
   edge). `maxRevisions: 0` disables send-back, so never pair `0` with a `revise`
   edge.

```typescript
{
  id: 'manager_review', type: 'approval', label: 'Manager Review',
  config: { approvers: [{ type: 'position', value: 'crm_manager' }], lockRecord: true, maxRevisions: 2 },
},
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
> **without** `type: 'back'`. Resubmit is never a record-save.

### Recording a decision

A decision is recorded through `ApprovalService.decide()` (or the REST routes
`POST /api/v1/approvals/requests/:id/approve` | `/reject`), a reject always
with a non-blank `comment`, its reason (else `400 VALIDATION_ERROR`). That
finalizes the `sys_approval_request` and **resumes** the suspended run down the
matching branch — you never resume the flow by hand, and you *cannot*: the
`approval` node declares `resumeAuthority: 'service'`, so
`POST /api/v1/automation/:name/runs/:runId/resume` answers **403** for a run
parked on one (including via a `subflow` pause) and changes nothing.

A decision may also carry **structured outputs** (`{ outputs: { … } }` in the
decide body) when the node declares the keys in `decisionOutputs`. Accepted
outputs resume the run as
`<nodeId>.<key>` flow variables, so a LATER node reads them as
`vars.<nodeId>.<key>` (Dynamic approvers ② below). A decision carrying an
undeclared key is rejected; `decision` / `requestId` are reserved. A declaration marked
`required: true` must carry a non-blank value to **approve** (never to
reject) — enforced before any write, with no elevation bypass, so the run
cannot resume past the node with the key a later `expression` approver reads
still missing.

A typed entry renders the matching picker in the decision dialog, and `type`
and `multiple` are also enforced at the decision, on approve and reject alike,
before any write. A picker value must resolve through the `expression`
approver's resolvers: `user` by any account's record id, `department` by record
id in the request's organization, `team` by record id (not another
organization's), `position` by the machine name of a position someone in that
organization holds. `multiple: true` takes a list of distinct values (every
kind, bare keys included); without it, one value. Any other non-blank value is
`400 VALIDATION_FAILED` naming `outputs.KEY`. The Console sends a list for a
`multiple: true` text output. The `lead_review` node below is the example.

### Reading the lock

A page over a record under approval must not offer an edit the server then
refuses with `409 RECORD_LOCKED`. The request row tells only a participant,
or any reader once the object declares `enable.approvalsVisibleToReaders`;
everyone else is served no row. Ask the lock itself —
`GET /api/v1/approvals/records/:object/:recordId/lock`, in the SDK
`client.approvals.getRecordLock(object, recordId)` — answered to anyone who
can read the record as `{ success: true, data: { locked } }`: `locked` and
nothing else (request, approvers and history stay behind that switch), the
same judgement the lock hook applies to an edit. The record is read as the
caller: one they cannot read answers `404 RECORD_NOT_FOUND`, the same body
an id that does not exist gets.

### Approver Types

| `type` | Resolves to |
|:-------|:------------|
| `user`       | A specific user id (`value` = user id) |
| `position`   | Holders of a position — `value` = the position machine name, resolved via `sys_user_position` (ADR-0090 D3) |
| `org_membership_level` | The **org-membership tier** — `value` is one of `owner`/`admin`/`delegated_admin`/`member`. **NOT** a position: `{ type: 'org_membership_level', value: 'crm_sales_manager' }` matches nobody; use `position`. Spelled `role` before ADR-0090 D3 — that spelling is deprecated, still resolves, and is removed in the next major |
| `team`       | Members of a flat `sys_team` |
| `department` | A department + all descendant departments |
| `manager`    | The submitter's manager (`sys_user.manager_id`) |
| `field`      | User id read from a record field (`value` = field name). Resolved against the record's **live** state at node entry, so a field written mid-flow routes correctly; a multi-select user field fans out into one approver per user |
| `queue`      | Members of ownership queue `value` at node entry; an empty queue adds nobody. In a packaged flow, see below |
| `expression` | A **CEL expression** resolved at node entry (`value` = the expression) — see **Dynamic approvers** below. The optional `resolveAs: 'user'(default) \| 'department' \| 'position' \| 'team'` re-expands each resolved id through the graph |

**A packaged flow's `queue` approver** (ADR-0150 D3) resolves `value` as a
packaged assignment rule does (SKILL.md § Assignment rules), from the package
whose flow body runs; a disabled package holds none. `acme.deals` naming
`acme.crm`'s `crm_finance` declares `dependencies: { 'acme.crm': '^1.0.0' }`.
Refused (`outside-closure`, `ambiguous-in-closure`), the node opens no request:
`APPROVER_DIRECTORY_UNREADABLE: … its name was refused (ADR-0150 D3, <reason>)`
naming every candidate, `retryable: false`, no `fallbackApprovers` /
`onEmptyApprovers`. A deployment-authored flow or `.custom` override reads
environment-wide (`ambiguous-in-environment`).

### Dynamic approvers (`type: 'expression'`)

An `expression` approver computes WHO approves at the moment the node is
entered. Its CEL source sees exactly **three roots** — nothing else:

| Root | Meaning |
|:-----|:--------|
| `current.*` | The record's **live** state at node entry — fields written by earlier steps/approvers are visible |
| `trigger.*` | The **submit-time snapshot** (what flow conditions call `record`) |
| `vars.*` | Flow variables — node outputs (`vars.<nodeId>.<key>`), `get_record` results, `vars.previous` (the pre-update row) |

**`record` and bare field names are NOT available and fail the node loudly:**
say which time you mean, `current.x` or `trigger.x`.

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

// ③ Dynamic co-sign: expression yields department ids; resolveAs expands
//    each into its members, and with behavior: 'per_group' EACH department is
//    its own sign-off group:
{
  approvers: [{ type: 'expression', value: cel`current.picked_departments`, resolveAs: 'department' }],
  behavior: 'per_group',
  onEmptyApprovers: 'fail',
}
```

The full "previous approver picks the next step's approvers" loop, end to end:

<!-- os:check -->
```typescript
import { defineFlow } from '@objectstack/spec';

export const DynamicApprovalFlow = defineFlow({
  name: 'crm_dynamic_approval',
  label: 'Dynamic Approval',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    {
      id: 'start', type: 'start', label: 'On Submit',
      config: { objectName: 'expense', triggerType: 'record-after-update', condition: "record.status == 'submitted'" },
    },
    {
      // Node A declares what a decision may hand to the flow; the lead
      // approves with outputs:
      //   POST …/approve { outputs: { next_reviewers: ['u2', 'u3'] } }
      id: 'lead_review', type: 'approval', label: 'Lead Review',
      config: {
        approvers: [{ type: 'org_membership_level', value: 'owner' }],
        decisionOutputs: [{ key: 'next_reviewers', label: 'Next Reviewers', type: 'user', multiple: true, required: true }],
      },
    },
    {
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

Time-word cheat sheet across surfaces:

| Surface | Event-time record | Pre-event record | Live record |
|:--------|:------------------|:-----------------|:------------|
| Flow condition / CEL envelope / `{{ }}` hole | `record` (trigger snapshot) | `previous` | — (use a `get_record` node) |
| Approval `expression` approver | `trigger.*` | `vars.previous` | `current.*` |

Object-hook `ctx` is a different vocabulary — see **objectstack-data**
`references/data-hooks.md`.

### Node Config (`ApprovalNodeConfigSchema`)

| Field | Purpose |
|:------|:--------|
| `approvers` | Who may act (≥ 1 — see Approver Types above). Each approver may carry an optional **`group`** label (e.g. `{ type: 'position', value: 'crm_auditor', group: 'finance' }`) — with `behavior: 'per_group'`, approvers sharing a label form one group; unlabelled approvers each form their own |
| `behavior` | `first_response` (first approver decides), `unanimous` (all must approve), `quorum` (`minApprovals` of N — M-of-N collective sign-off), or `per_group` (EACH approver `group` must reach `minApprovals` — one-from-each-group sign-off). In every mode a single rejection finalizes the node as `rejected`. Default `first_response` |
| `minApprovals` | Approvals required — total for `quorum`, per group for `per_group`. Omitted ⇒ ALL resolvable approvers under `quorum`, `1` per group; clamped at runtime so a misconfiguration can never deadlock |
| `lockRecord` | Lock the triggering record from edits while pending. Default `true` |
| `approvalStatusField` | Business-object field to mirror `pending`/`approved`/`rejected`/`returned`/`recalled` onto (should be readonly) |
| `onEmptyApprovers` | What an EMPTY resolved slate does: `admin_rescue` (default — request opens on the organization's administrators; never waves through, never kills the run), `fail` (node fails — treat an empty slate as a config bug), `auto_approve` (skip the request, continue down `approve` with `output.autoApproved = true` — opt-in because it silently waves the record through), `fallback` (request opens on the sibling `fallbackApprovers` instead — same shape as `approvers`, required by this policy and refused under any other; a fallback that itself resolves to nobody degrades to `admin_rescue`). Declare it explicitly on any node with an `expression` approver (linted) |
| `excludeSubmitter` | `true` drops the run's submitter (`submitter_id`) from the resolved slate, whatever approver type produced them — segregation of duties; a slate it empties takes the `onEmptyApprovers` route, never a silent pass. `onEmptyApprovers: 'auto_approve'` is **refused** beside it (it would approve exactly the request this exists to stop): use `admin_rescue`, `fail` or `fallback`. Default `false` |
| `decisionOutputs` | Decision outputs a decision may carry: bare keys (free text) **or typed declarations** `{ key, label?, type: 'text'\|'user'\|'department'\|'position'\|'team', multiple?, required? }`, enforced at the decision — see *Recording a decision* |
| `escalation` | Optional per-node SLA — `{ enabled, timeoutHours, clock, calendar?, action: reassign\|auto_approve\|auto_reject\|notify, escalateTo?, notifySubmitter }`. `clock` sets how `timeoutHours` counts: `'wall_clock'` (default) counts nights, weekends and holidays; `'working_time'` counts working hours on a working calendar (`sys_work_calendar`, maintained per organization in Setup): the `calendar` code, else the organization's default, else refused — never wall-clock. While the calendar cannot count the deadline (none resolves, or not maintained that far) the request does not escalate: its row carries `sla_due_refusal` instead of `sla_due_at`, the inbox shows why, and each sweep retries. `calendar` without `clock: 'working_time'` is lint error `approval-escalation-calendar-without-working-time`. `escalateTo` is a **position machine name** (resolved like a `position` approver) or a specific user id — never a membership tier. `reassign` without `escalateTo` degrades to notify (linted) |
| `maxRevisions` | Send-backs per run before auto-reject (ADR-0044) |

### Branching, side-effects & rejection

These are wired on the **graph**, not in node config:

- **On approve / on reject** — wire downstream nodes (`update_record`,
  `http`, a `notify` node, …) to out-edges labelled exactly `approve` and
  `reject`. With only one, or another spelling (`Approved`), publish refuses
  the flow (`flow-approval-decision-unrouted`): both branches would run.
- **A write on that branch that may be refused** (a record hook, a validation
  rule, a permission) — draw a `fault` edge from that step to a handler
  (SKILL.md § Failure routing): the refusal takes it and the decision answers
  normally. Without one, `POST …/approve` (or `/reject`) answers
  `500 RESUME_FAILED`: the decision stands (`finalized: true`), the run is
  stranded, and the body may carry `innerRefusal` (`{ code, message }`) and
  `userMessage`, the hook's declared sentence for the approver.
- **Roll back on reject** — route the `reject` edge as a **back-edge** to an
  earlier node so the submitter can revise.

### Approval Best Practices

1. **Set `approvalStatusField`** to mirror status onto the row — views and
   formulas can then filter on it without joining `sys_approval_request`.
2. **Keep `lockRecord: true`** unless you have a strong reason to allow
   edits while pending — otherwise approvers chase a moving target.
3. **Notify the submitter from downstream nodes** wired to the `approve` /
   `reject` edges. Opening already tells each resolved approver
   (`approval.requested`); ⛔ no `notify` node for the opening: it tells
   them twice.
4. **A flow reacting to the mirrored status runs as the person who acted.**
   The `approvalStatusField` write is elevated but attributed — submit carries
   the submitter, approve / reject / recall / send-back the person who decided —
   so a `record_change` flow on that field ("when the invoice is approved, do
   X") stays `runAs: 'user'` and runs with the decider's own grants. Only the
   two machine-driven transitions carry no user — an SLA `escalation`
   auto-decision and the release of a record whose run died — and a
   `runAs: 'user'` flow fired by one has its data steps refused: a flow that
   must react to those too declares `runAs: 'system'`.
