---
name: objectstack-automation
description: >
  Design ObjectStack automation — Flows (visual logic), Workflows
  (declarative rules), Triggers, Approvals, scheduled jobs, and webhooks.
  Use when the user is adding `*.flow.ts` / `*.workflow.ts`, wiring an
  event-driven rule, or modelling an approval chain. Do not use for data
  lifecycle hooks at the object layer (see objectstack-data) or for kernel
  / plugin events (see objectstack-platform). CEL expressions in flow
  conditions / workflow predicates: load objectstack-formula alongside.
license: Apache-2.0
compatibility: Requires @objectstack/spec Zod schemas (v4+)
metadata:
  author: objectstack-ai
  version: "1.1"
  domain: automation
  tags: flow, workflow, trigger, approval, state-machine, scheduled, webhook
---

# Automation Design — ObjectStack Automation Protocol

Expert instructions for designing business automation using the ObjectStack
specification. This skill covers Flows (visual logic orchestration), Workflows
(state machines & approvals), Triggers (event-driven automation), and ETL
pipelines.

---

## When to Use This Skill

- You are building a **visual flow** (auto-launched, screen, or scheduled).
- You need a **state machine** or **approval process** for a business object.
- You are setting up **event-driven triggers** (record create/update/delete).
- You need **scheduled automation** (daily reports, data cleanup).
- You are designing an **ETL pipeline** for data synchronisation.

> **Predicates and conditions are CEL.** Every `condition` / `guard` /
> `entryCondition` / filter `value` in this skill is an **Expression**
> envelope evaluated by `@objectstack/formula`. Use the `P\`...\`` and
> `cel\`...\`` tagged templates from `@objectstack/spec`. See the
> **objectstack-formula** skill for the full CEL contract, stdlib
> (`now()`, `today()`, `daysFromNow(n)`, `isBlank(v)`, `coalesce(v, fb)`),
> and the legacy → CEL translation table.

---

## Flows — Visual Logic Orchestration

A **Flow** is a directed graph of nodes that execute sequentially or in
parallel. Flows are the primary automation building block in ObjectStack.

### Flow Types

| Type | When to Use |
|:-----|:------------|
| `autolaunched` | Runs without user interaction — triggered by events, APIs, or other flows |
| `screen` | Interactive — presents UI screens to the user (wizards, forms) |
| `schedule` | Runs on a cron schedule (daily cleanup, weekly reports) |
| `record_triggered` | Fires automatically on record create/update/delete |
| `platform_event` | Fires on platform events (webhooks, message queue) |

### Flow Node Types

Flows are built from **19 node types**:

#### Control Flow

| Node | Purpose |
|:-----|:--------|
| `start` | Entry point — every flow has exactly one |
| `end` | Exit point — can have multiple (early exit, error exit) |
| `decision` | Conditional branching (if/else/switch) |
| `loop` | Iterate over a collection |
| `parallel_gateway` | Fork execution into parallel branches |
| `join_gateway` | Synchronise parallel branches back together |
| `wait` | Pause execution until a condition or time elapses |
| `boundary_event` | Attach to another node — fires on timeout or error |
| `subflow` | Invoke another flow (reusable composition) |

#### Data Operations

| Node | Purpose |
|:-----|:--------|
| `assignment` | Set variable values |
| `create_record` | Insert a new record |
| `update_record` | Modify existing records |
| `delete_record` | Remove records |
| `query_record` | Fetch records with filters |

#### External Integration

| Node | Purpose |
|:-----|:--------|
| `http_request` | Call an external HTTP API |
| `connector_action` | Invoke a pre-built integration connector |
| `script` | Execute custom JavaScript/TypeScript logic |
| `screen` | Display a UI form to the user (screen flows only) |

#### Human Decision

| Node | Purpose |
|:-----|:--------|
| `approval` | Route a record for human sign-off — **suspends** the run until a decision, then continues down the `approve` / `reject` branch (contributed by `plugin-approvals`) |

### Flow Variables

Every flow defines input/output variables:

```typescript
variables: {
  case_id: {
    type: 'text',
    label: 'Case ID',
    isInput: true,    // passed in when flow is invoked
    isOutput: false,
  },
  approval_result: {
    type: 'boolean',
    label: 'Approved?',
    isInput: false,
    isOutput: true,   // returned when flow completes
  },
}
```

### Flow Example — Auto-Escalate Overdue Cases

```typescript
{
  name: 'escalate_overdue_cases',
  type: 'schedule',
  schedule: cron`0 9 * * *`,    // daily at 09:00
  nodes: [
    {
      id: 'start',
      type: 'start',
      next: 'find_overdue',
    },
    {
      id: 'find_overdue',
      type: 'query_record',
      config: {
        object: 'support_case',
        filter: [
          { field: 'status', operator: 'in', value: ['new', 'open'] },
          { field: 'due_date', operator: 'less_than', value: cel`today()` },
        ],
      },
      next: 'loop_cases',
    },
    {
      id: 'loop_cases',
      type: 'loop',
      config: { collection: '$find_overdue.records' },
      next: 'update_status',
      afterLoop: 'notify_manager',
    },
    {
      id: 'update_status',
      type: 'update_record',
      config: {
        object: 'support_case',
        recordId: '$loop_cases.current.id',
        values: { status: 'escalated' },
      },
    },
    {
      id: 'notify_manager',
      type: 'http_request',
      config: {
        url: 'https://hooks.slack.com/services/...',
        method: 'POST',
        body: { text: 'Escalated $find_overdue.records.length overdue cases.' },
      },
      next: 'end',
    },
    { id: 'end', type: 'end' },
  ],
}
```

---

## Workflows — State Machines & Approvals

A **Workflow** defines the lifecycle of a record through states (statuses)
and the transitions between them.

### State Machine Configuration

```typescript
{
  name: 'case_lifecycle',
  field: 'status',       // the field that holds the state
  states: {
    new:       { label: 'New',       initial: true },
    open:      { label: 'Open' },
    escalated: { label: 'Escalated' },
    resolved:  { label: 'Resolved' },
    closed:    { label: 'Closed',    final: true },
  },
  transitions: [
    { from: 'new',       to: 'open',      trigger: 'assign' },
    { from: 'open',      to: 'escalated', trigger: 'escalate' },
    { from: 'open',      to: 'resolved',  trigger: 'resolve' },
    { from: 'escalated', to: 'open',      trigger: 'de_escalate' },
    { from: 'escalated', to: 'resolved',  trigger: 'resolve' },
    { from: 'resolved',  to: 'open',      trigger: 'reopen' },
    { from: 'resolved',  to: 'closed',    trigger: 'close' },
  ],
}
```

### Transition Guards

Transitions can have conditions that must be met:

```typescript
{
  from: 'open',
  to: 'resolved',
  trigger: 'resolve',
  guard: P`record.resolution != null`,    // CEL predicate
  actions: ['send_resolution_email'], // side-effect actions
}
```

### Approvals (Flow Nodes)

Since **ADR-0019** there is no standalone approval-process type. An approval is
authored as an **Approval node** (`type: 'approval'`) on an ordinary flow — the
run **suspends** when it reaches the node and **resumes** down the node's
`approve` / `reject` out-edge once a decision is recorded. Multi-step review is
just successive Approval nodes wired together on the canvas, so the whole review
is one diagram a reviewer (or AI) can read end-to-end.

> The old process-level concepts re-home onto the flow graph + node config — see
> the re-home table below. The approval *state* (`sys_approval_request` /
> `sys_approval_action`, the record lock, the status mirror, approver
> resolution) is unchanged and still owned by `plugin-approvals`.

```typescript
// A record-triggered flow: high-value opportunities need manager sign-off,
// and director sign-off too when the amount clears 500k.
{
  name: 'opportunity_discount_approval',
  label: 'Opportunity Discount Approval',
  type: 'record_triggered',
  trigger: { object: 'opportunity', event: 'after_update' },
  nodes: [
    { id: 'start', type: 'start' },
    {
      id: 'manager_review',
      type: 'approval',
      label: 'Sales Manager Review',
      config: {
        approvers: [{ type: 'role', value: 'sales_manager' }],
        behavior: 'first_response',            // or 'unanimous'
        lockRecord: true,                      // lock the record while pending
        approvalStatusField: 'approval_status', // mirror pending|approved|rejected|recalled onto the row
      },
    },
    { id: 'needs_director', type: 'decision', config: { condition: cel`record.amount > 500000` } },
    {
      id: 'director_signoff',
      type: 'approval',
      label: 'Sales Director Sign-off',
      config: {
        approvers: [{ type: 'role', value: 'sales_director' }],
        behavior: 'unanimous',
        approvalStatusField: 'approval_status',
      },
    },
    { id: 'mark_won', type: 'update_record',
      config: { object: 'opportunity', recordId: '$record.id', values: { stage: 'closed_won' } } },
    { id: 'approved', type: 'end' },
    { id: 'rejected', type: 'end' },
  ],
  edges: [
    { id: 'e1', source: 'start',          target: 'manager_review',
      // entry criteria re-homes onto the edge entering the approval node:
      condition: cel`record.amount > 100000` },
    { id: 'e2', source: 'manager_review',  target: 'needs_director',   label: 'approve' },
    { id: 'e3', source: 'manager_review',  target: 'rejected',         label: 'reject'  },
    { id: 'e4', source: 'needs_director',  target: 'director_signoff', label: 'true'    },
    { id: 'e5', source: 'needs_director',  target: 'mark_won',         label: 'false'   },
    { id: 'e6', source: 'director_signoff', target: 'mark_won',        label: 'approve' },
    { id: 'e7', source: 'director_signoff', target: 'rejected',        label: 'reject'  },
    { id: 'e8', source: 'mark_won',         target: 'approved' },
  ],
}
```

### Re-homing the old process model

If you've seen the pre-ADR-0019 `ApprovalProcess.create({...})` shape, every
concept maps onto the flow:

| Old process concept | Now |
|:--------------------|:----|
| `steps: [...]` (linear list) | successive **Approval nodes** joined by edges |
| `entryCriteria` (process or step) | a `condition` on the **edge entering** the node |
| `onApprove` / `onReject` actions | downstream **nodes** wired to the `approve` / `reject` out-edge |
| `rejectionBehavior: 'back_to_previous'` | a **back-edge** to an earlier node |
| `rejectionBehavior: 'reject_process'` | the `reject` edge routed to an `end` node |
| `approvers` / `behavior` / `lockRecord` / `approvalStatusField` / `escalation` | the Approval node's `config` (`ApprovalNodeConfigSchema`) |

There is no `approvals: [...]` stack collection anymore — approval flows live in
your normal `flows: [...]`.

### Recording a decision

A decision is recorded through `ApprovalService.decide()` (or the REST routes
`POST /api/v1/approvals/requests/:id/approve` | `/reject`). That finalizes the
`sys_approval_request` and **resumes** the suspended run down the matching
branch — you never resume the flow by hand.

### Approver Types

| `type` | Resolves to |
|:-------|:------------|
| `user`       | A specific user id (`value` = user id) |
| `role`       | All users with the named role (`sys_member.role`) |
| `team`       | Members of a flat `sys_team` |
| `department` | A department + all descendant departments |
| `manager`    | The submitter's manager (`sys_user.manager_id`) |
| `field`      | User id read from a record field (`value` = field name) |
| `queue`      | A data-ownership queue |

### Node Config (`ApprovalNodeConfigSchema`)

| Field | Purpose |
|:------|:--------|
| `approvers` | Who may act (≥ 1 — see Approver Types above) |
| `behavior` | `first_response` (first approver decides) or `unanimous` (all must approve). Default `first_response` |
| `lockRecord` | Lock the triggering record from edits while pending. Default `true` |
| `approvalStatusField` | Business-object field to mirror `pending`/`approved`/`rejected`/`recalled` onto (should be readonly) |
| `escalation` | Optional per-node SLA — `{ enabled, timeoutHours, action: reassign\|auto_approve\|auto_reject\|notify, escalateTo?, notifySubmitter }` |

### Branching, side-effects & rejection

These are wired on the **graph**, not in node config:

- **Conditional step** — put a `decision` node before the Approval node, or a
  `condition` on the edge entering it (the old per-step `entryCriteria`).
- **On approve / on reject** — wire downstream nodes (`update_record`,
  `http_request`, an email node, …) to the `approve` / `reject` out-edge.
- **Roll back on reject** — route the `reject` edge as a **back-edge** to an
  earlier node so the submitter can revise (the old `back_to_previous`).
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

---

## Triggers — Event-Driven Automation

Triggers fire automatically when data events occur.

### Trigger Events

| Event | Fires When |
|:------|:-----------|
| `before_insert` | Before a record is created (can modify/reject) |
| `after_insert` | After a record is created |
| `before_update` | Before a record is updated |
| `after_update` | After a record is updated |
| `before_delete` | Before a record is deleted |
| `after_delete` | After a record is deleted |

### Trigger Configuration

```typescript
{
  name: 'notify_on_escalation',
  object: 'support_case',
  event: 'after_update',
  condition: P`previous.status != 'escalated' && record.status == 'escalated'`,
  action: {
    type: 'flow',
    flow: 'send_escalation_notification',
    input: { case_id: '$record.id' },
  },
}
```

> **`previous`** and **`record`** are the CEL variables available in update
> triggers — `previous.x` is the value before the change, `record.x` is the
> value after. (Salesforce-flavor `OLD` / `NEW` were removed in M9.5 and now
> evaluate to `null`.) See [objectstack-formula](../objectstack-formula/SKILL.md).

---

## Best Practices

### Flow Design

1. **Keep flows small and composable.** Use `subflow` nodes to break complex
   logic into reusable parts.
2. **Always handle errors.** Add `boundary_event` nodes for timeout and error
   scenarios.
3. **Use variables for all dynamic values.** Never hard-code record IDs or
   API keys in node config.
4. **Prefer `query_record` over multiple `http_request` calls** when the data
   lives in ObjectStack.
5. **Set `timeoutMs` on HTTP nodes.** Default is generous; tighten it for
   critical paths.

### State Machine Design

1. **Mark exactly one state as `initial: true`.**
2. **Mark terminal states as `final: true`.**
3. **Define explicit transitions** — do not rely on implicit "any → any".
4. **Add guards** to transitions that require preconditions.
5. **Use `actions` on transitions** for side-effects (emails, notifications).

### Trigger Design

1. **Prefer `after_*` triggers** unless you need to modify/reject the record.
2. **Avoid infinite loops:** Do not update the same object in an `after_update`
   trigger without a guard condition.
3. **Use `condition`** to narrow when the trigger fires — avoid running
   expensive logic on every save.

---

## Common Pitfalls

1. **Circular flow references.** Flow A calls Flow B which calls Flow A. Use
   a depth counter or `visited` set to detect cycles.
2. **Unmatched `parallel_gateway` / `join_gateway`.** Every fork must have a
   corresponding join.
3. **Missing `end` node.** Every path through the flow must terminate.
4. **`before_*` trigger throwing unhandled errors.** This silently prevents
   the record operation — always provide a user-friendly error message.
5. **Scheduled flows without idempotency.** If the flow runs twice
   accidentally, the result should be the same.

---

## CRM Automation Blueprint

For enterprise automation design, align with this CRM-style structure:

| Automation Type | Typical Location | Pattern |
|:--|:--|:--|
| Screen flow | `src/flows/*.flow.ts` | Use explicit `variables`, node graph (`nodes` + `edges`), and decision branches |
| Approval flow | `src/flows/*.flow.ts` | A flow with `approval` node(s); set `approvers` / `behavior` / `lockRecord` / `approvalStatusField` in node `config`, branch on `approve` / `reject` edges |
| Flow registry | `src/flows/index.ts` | Export `allFlows: Flow[]` and register centrally in `defineStack({ flows })` |
| Action-to-flow bridge | `src/actions/*.actions.ts` | Trigger screen flows via `Action.type = 'flow'` for user-driven automation entry |

Default approach for metadata apps: model business lifecycle in Flow/Approval
metadata first; reserve custom code for edge-case integrations.

---

## References

See [references/_index.md](./references/_index.md) for the full list of Zod
schemas (with one-line descriptions) — pointers into
`node_modules/@objectstack/spec/src/`. Always `Read` the source for exact field
shapes; do not rely on memory of property names.

