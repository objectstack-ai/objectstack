---
name: objectstack-automation
description: >
  Design ObjectStack automation — Flows (visual logic), Triggers, Approvals,
  state machines, and the `jobs` (`defineJob`) / `webhooks` (`defineWebhook`)
  stack collections. Use when the user is adding `*.flow.ts`, wiring an
  event-driven rule, modelling an approval chain, or building an interactive
  screen flow / wizard (objectstack-ui routes those here). Do not use for data
  lifecycle hooks at the object layer (see objectstack-data) or for kernel
  / plugin events (see objectstack-platform). CEL expressions in flow
  conditions / edge guards: load objectstack-formula alongside.
license: Apache-2.0
compatibility: Requires @objectstack/spec 17.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "1.3"
  domain: automation
  tags: flow, workflow, trigger, approval, state-machine, scheduled, webhook
---

# Automation Design — ObjectStack Automation Protocol

## When to Use This Skill

- You are building a **visual flow** (auto-launched, screen, or scheduled).
- You need a **state machine** or **approval process** for a business object.
- You are setting up **event-driven triggers** (record create/update/delete).
- You need **scheduled automation** (daily reports, data cleanup).

> **Predicates and conditions are CEL** — every `condition` / `guard` /
> `entryCondition` / filter `value` here is an **Expression** envelope evaluated
> by `@objectstack/formula`. A slot takes a plain CEL string; the
> `P\`...\`` / `cel\`...\`` tags wrap the same string with author-time validation.
> Both parse — pick one per file (the example apps use plain strings). See
> **objectstack-formula** for the CEL contract, stdlib and legacy → CEL table.

---

## Flows — Visual Logic Orchestration

A **Flow** is a directed graph of nodes that execute sequentially or in
parallel. Flows are the primary automation building block in ObjectStack.

### Flow Types

| Type | When to Use |
|:-----|:------------|
| `autolaunched` | Runs without user interaction — triggered by events, APIs, or other flows |
| `screen` | Interactive — presents UI screens to the user (wizards, forms) |
| `schedule` | Runs on a cron/interval cadence declared on the **start node's `config.schedule`** (daily cleanup, weekly reports) — or a **per-record date sweep** via `config.timeRelative`, see *Time-relative triggers* |
| `record_change` | Fires automatically on record create/update/delete (bind via the `start` node's `triggerType`). `autolaunched` + the same `record-*` binding behaves identically — the engine reads the start node either way; `record_change` also opts into the trigger-readiness lint |
| `api` | Invoked explicitly via the API / `engine.execute()`, **or** bound as an inbound **webhook**: `POST /api/v1/automation/hooks/:flowName/:hookId` (see *Inbound webhook triggers* below) |

### Flow Node Types

Flows are built from **20 built-in node types** (the `FlowNodeAction` seed set —
plugins register more via `registerNodeExecutor`, e.g. `approval` below):

#### Control Flow

| Node | Purpose |
|:-----|:--------|
| `start` | Entry point — every flow has exactly one |
| `end` | Exit point — can have multiple (early exit, error exit) |
| `decision` | Conditional branching — routed by **edge `condition` predicates**, not node config (see the approval example below) |
| `loop` | Iterate a **nested `config.body` region** once per item of `config.collection`; `iteratorVariable` (default `item`) and optional `indexVariable` bind inside it, `maxIterations` caps it |
| `parallel` | Fan out into `config.branches[]` (≥ 2 regions) run concurrently, **joined implicitly** at block end — no split/join pair to mis-wire |
| `try_catch` | Run `config.try`; on failure run `config.catch` with the error in `errorVariable` (default `$error`); `config.retry` re-runs `try` with backoff first. **No `finally`** — the container's ordinary out-edges are the continuation |
| `map` | Sequential multi-instance — invoke a subflow once per item of a collection; each iteration may pause (batch approvals) |
| `wait` | Pause execution until a timer elapses or a named signal arrives |
| `subflow` | Invoke another flow (reusable composition) |
| `parallel_gateway` / `join_gateway` / `boundary_event` | **Not author-facing** — BPMN-interop forms the mapper lowers a `parallel` / `try_catch` container INTO (`automation/control-flow.zod.ts`). Author the container |

#### Data Operations

| Node | Purpose |
|:-----|:--------|
| `assignment` | Set variable values |
| `create_record` | Insert a new record |
| `update_record` | Modify existing records |
| `delete_record` | Remove records |
| `get_record` | Fetch records with filters — there is **no `query_record`** node (that name has no executor and throws) |

#### External Integration

| Node | Purpose |
|:-----|:--------|
| `http` | Call an external HTTP API — canonical since protocol 11.0; `http_request` survives only as a deprecation-window alias |
| `notify` | Send a notification through the messaging service (inbox channel by default) |
| `connector_action` | Invoke a pre-built integration connector |
| `script` | Call a **registered** function named by `config.function` (see *Valid-but-silently-wrong* #3) |
| `screen` | Display a UI form to the user (screen flows only) |

#### Human Decision

| Node | Purpose |
|:-----|:--------|
| `approval` | Route a record for human sign-off — **suspends** the run until a decision, then continues down the `approve` / `reject` branch (contributed by `plugin-approvals`) |

### `notify` — the most-used node type

`NotifyConfigSchema` (`automation/io-node-config.zod.ts`) is `strictObject` — an
undeclared key is a named parse error. **RAW** keys never interpolate: a
`{token}` in one is forwarded verbatim, never resolved.

```ts
{ id: 'tell_owner', type: 'notify', label: 'Notify Owner', config: {
    recipients: '{record.assignee}',   // REQUIRED — id, CSV, or string[]
    title: 'Done: {record.title}',     // inline path; XOR `template` (RAW, localizable)
    message: 'Closed by {$User.Id}',   // body; only with inline `title`
    topic: 'task',                     // RAW; default 'notify'
    severity: 'warning',               // RAW; CLOSED enum info|warning|critical
    channels: ['inbox'],               // RAW; default inbox
    sourceObject: 'task',              // click-through: a PAIR, else dropped
    sourceId: '{record.id}',           //   at execute time
    actionUrl: 'https://…/tasks/123',  // overrides the synthesized link
} }
```

### Flow Variables

Every flow defines input/output variables. `variables` is an **array** of
`{ name, type, isInput, isOutput }` entries — not a name-keyed map, and there
is no `label` property on a variable:

```typescript
variables: [
  {
    name: 'case_id',
    type: 'text',
    isInput: true,    // passed in when flow is invoked
    isOutput: false,
  },
  {
    name: 'approval_result',
    type: 'boolean',
    isInput: false,
    isOutput: true,   // returned when flow completes
  },
],
```

→ Moved verbatim to [references/examples-flows.md](./references/examples-flows.md) § Flow Example — Auto-Escalate Overdue Cases.

### Failure routing & `runAs`

> **Handling a failed node: a `fault` edge.** `{ source, target, type: 'fault' }`
> routes a failed node to a handler instead of ending the run. **`type: 'fault'`
> is what routes — a `label: 'error'` alone does nothing:** the edge stays
> ordinary, and every unconditional out-edge traverses on SUCCESS, so the
> handler would run when the node succeeds and never when it fails
> (`objectstack validate` reports `flow-error-label-not-fault`).
> A handled failure does NOT consume a flow-level `errorHandling.retry`, which
> replays the flow from the start — prefer a fault edge when the failure is
> local. The handler reads `{<nodeId>.error}` (or run-wide `{$error}`). The run
> then reports success, and the failed step stays in the trace.
>
> **It is not a way past a guardrail.**

| ROUTES (runtime failure) | Does NOT route (fatal either way) |
|:--|:--|
| 404, rate-limit, rejected write, failed subflow | missing required config key (`objectName`, `url`, `flowName`, `connectorId`/`actionId`); filter token that resolved to nothing; graph past the nesting ceiling; unscoped run |

Routing a guard refusal is worse than the failure: a dropped filter condition
**widens** the query, so a routed `delete_record` empties the object while the
run reports success. `objectstack validate` names the offending template.

> **Writing a `readonly` field? Set `runAs: 'system'`.** `readonly: true`
> governs the end-user surface: under the default `runAs: 'user'`, the engine
> **strips** a `readonly` field from any non-system write — `create_record` and
> `update_record` alike — the step reports success but the value never lands,
> and the drop is named in the step's warnings. A flow that
> maintains a `readonly` field (approval stamps, conversion flags, SLA
> markers, rollups) must run `runAs: 'system'`, the trusted-writer channel.
> `os validate` / `os build` fail a `runAs:'user'` `update_record` that writes
> a `readonly` field, so the mismatch surfaces at build time, not as wrong data
> days later. (`readonlyWhen` fields are the same story, per record state —
> flagged as a warning.) Do **not** work around this by removing `readonly`;
> that loses the field's edit protection.

> **Elevate the write, not the flow.** A `screen` flow stays `runAs: 'user'`.
> When one step in it must write a `readonly` field, move that step into a
> dedicated `runAs: 'system'` flow and call it from a `subflow` node — raising
> the whole flow silently elevates every other write in it.
>
> **A `runAs: 'system'` sweep must pin its organization.** System context has no
> trigger user, so nothing narrows the query: a scan or rollup with no
> organization predicate reads and writes across every tenant. The tenant column
> is platform-injected — filter on it, never re-declare it per object.

> **A hook elevates itself with `runAs`, never with `sudo`.** An object hook
> (objectstack-data) declares its own `runAs: 'system' | 'user' | 'inherit'` —
> default `'inherit'`, the context of the write that fired it — scoping that
> hook's `ctx.api` data operations only, on the in-process `handler` and the
> sandboxed `body` alike. A `'user'` hook whose trigger resolved no user has
> nothing to scope to: its `ctx.api` data operations are refused
> (`HOOK_UNSCOPED_DATA_ACCESS`, 403) rather than run unscoped — declare
> `runAs: 'system'` when the elevation is intended. `sudo` is not a hook key.

### Filter tokens (`config.filter`)

The one slot where two `{…}` dialects meet, and the one whose failure **widens**
a query instead of narrowing it.

- **Precedence — flow variables win, placeholders pass through.** The flow
  template engine runs first. A whole-string token it resolves is a flow value;
  one it does **not** resolve that IS a recognised filter placeholder
  (`{current_user_id}`, `{current_year_start}`) passes through **verbatim** for
  the query engine to expand. So a flow variable named after a placeholder
  **shadows** it. Only `filter` gets this hand-off — in `title`, `message`,
  `fields` and `url` a bare `{current_year_start}` is a nonsense reference.
- **Static checkability splits by position.** A `{record.…}` token **inside a
  filter** naming an unknown field, or hopping a relation the start node does not
  list in `config.expand`, is an **ERROR** at `objectstack validate`: it resolves
  to nothing, the condition is DROPPED, and the node refuses to execute. The
  *same* reference **outside** a filter (message body, `http` url, write payload)
  only renders an empty string — a **warning**. A `{var}` naming a flow variable
  or node output is **not statically checkable at all**.

---

## Valid-but-silently-wrong (passes build, fails at runtime)

These are *legal* metadata that authors — AI especially — get wrong. Most are now
caught by `objectstack build` (a hard error, or an advisory warning), but write
them right the first time:

1. **Flow node VALUE interpolation uses SINGLE braces.** Value fields on a node's
   `config` (`fields`, `inputs`, notify `message`/`title`, …) interpolate
   `{token}`:
   - `{var}` / `{record.title}` — variable / record field
   - `{record.tags.0}` — **array index** (e.g. a `multiple: true` lookup, stored as an array)
   - `{$User.Id}` / `{NOW()}` / `{TODAY() + 30}` — current user / date macros
   - `{round(x)}` `{floor(x)}` `{ceil(x)}` `{abs(x)}` `{min(a,b)}` `{max(a,b)}` —
     mirror the CEL stdlib 1:1. `round` is **integer-only** (no `round(x, 2)`);
     for N decimals write `{round(x * 100) / 100}` (scale 2)
   - anything without `{…}` is a **literal**

   ❌ `body: '{{ai_reply}}'` — double-brace is the *formula / template-field* dialect, **not** flow values
   ❌ `ticket: '$source.id'` — a bare `$ref` is a literal string, not interpolated
   ✅ `body: '{ai_reply}'`, `ticket: '{source.id}'`
   ❌ `'{ROUND(x, 2)}'` / `'{Math.round(x)}'` / `'{(x).toFixed(2)}'` — any other
   name in call position **fails the node** with a named error naming the
   supported set. The build does **not** catch these (conditions are checked,
   call-position names are not) and a `fault` edge cannot route it.

2. **`create_record`'s `outputVariable` holds the created RECORD, not its id.**
   Reference a field explicitly.
   ❌ `update_record … fields: { ref: '{newRec}' }` → yields the whole record object
   ✅ `fields: { ref: '{newRec.id}' }`

3. **`script` nodes call a registered function — that is all they do.** Set
   `config.function` to a function registered via
   `defineStack({ functions: { my_fn: (ctx) => … } })`. It is **required**: an
   empty `script` node refuses at execute, and one pointing at an unregistered
   function fails loudly.

   There is no other dispatch form: use **`notify`** for delivery, a
   **`connector_action`** or `http` webhook for Slack, a function for logic.

   **A flow `function` is a PURE compute step — it does NOT read/write the
   database.** It receives `ctx.input` and **returns** a value; `config.outputVariable`
   exposes that value as a flow variable, and a later **declarative** node persists
   it. Keep data effects on the flow graph (visible, governed, build-checkable):

   ```ts
   // ❌ DON'T: expect the function to update the record itself (it has no data API)
   // ✅ DO: function returns values → outputVariable → update_record persists
   { id: 'ai', type: 'script', config: {
       function: 'helpdesk.aiTriageStub',     // returns { ai_category, ai_sentiment, … }
       inputs: { ticketId: '{record.id}' },   // inputs are interpolated
       outputVariable: 'ai',
   } },
   { id: 'apply', type: 'update_record', config: {
       objectName: 'helpdesk_ticket',
       filter: { id: '{record.id}' },
       fields: { ai_category: '{ai.ai_category}', ai_sentiment: '{ai.ai_sentiment}' },
   } },
   ```

   `defineStack({ functions: { 'helpdesk.aiTriageStub': (ctx) => ({ ai_category: 'other', … }) } })`.
   If you genuinely need data-lifecycle **side effects** (read/write other records),
   that's an L2 **hook** (objectstack-data) — hooks get `ctx.api`; flow functions don't.

   A function that writes where the platform cannot see **declares** it, so the
   run reports "cannot say" rather than `acted: 0`:

   ```ts
   defineStack({ functions: {
     'helpdesk.aiTriageStub': (ctx) => ({ ai_category: 'other' }),  // pure — the default
     'billing.sync': { handler: syncBilling, effect: 'writes' },    // declared writer
   } });
   ```

4. **Conditions are bare CEL — the stdlib is what you may call bare.** `now()`,
   `today()`, `daysFromNow(n)`, `daysAgo(n)`, `daysBetween(a, b)`, `isBlank(v)`,
   `coalesce(a, b)`, `abs/round/min/max`, `upper/lower/contains/matches`, plus CEL
   built-ins (`has`, `size`, `int`, `string`, …) — see **objectstack-formula** for that
   table: it is `CEL_STDLIB_FUNCTIONS`, the bare-callable public subset, so receiver
   methods (called on a value, never bare) are not in it.
   An UNKNOWN function (`PRIOR()`, a typo'd name) and a `{…}`-wrapped field ref
   both **fail the build**: a brace is a template, not CEL — write `record.x`,
   not `{record.x}`.

5. **`notify` reports SUCCESS when the `messaging` capability is absent.** The
   executor logs `no messaging service registered` and returns success with
   `output: { delivered: 0, failed: 0, skipped: true }` and `metrics.acted: 0` —
   a green run that delivered nothing. Declare `messaging` in `requires`.

---

→ State Machines & Approvals moved verbatim to [references/state-machines-and-approvals.md](./references/state-machines-and-approvals.md) (State Machine — a `state_machine` validation rule · Approvals (Flow Nodes) · Send-back for revision · Recording a decision · Approver Types · Dynamic approvers (`type: 'expression'`) · Node Config (`ApprovalNodeConfigSchema`) · Branching, side-effects & rejection · Approval Best Practices).

---

## Triggers — Event-Driven Automation

A `record_change` flow fires automatically on a data event. There is **no
standalone trigger object and no top-level `trigger` / `event` key** — the
binding lives entirely in the flow's **`start` node `config`**, which the
automation engine parses (`resolveTriggerBinding`) and wires to the matching
ObjectQL lifecycle hook.

### Prerequisite — declare the capabilities your nodes need

Metadata registers without its token; the surface just never runs — two of them
silently:

| `requires` token | Turns on | Absent ⇒ |
|:--|:--|:--|
| `automation` | the flow engine + node executors | flows never execute |
| `triggers` | `record-*` / schedule / `api` start bindings | flows register, never fire |
| `job` | cron cadence + the `timeRelative` sweep | scheduled flows never launch |
| `queue` | the inbound-webhook consumer | inbound POST answers **503** |
| `approvals` | `approval` / `approval_revise` (`plugin-approvals`) | no executor for the node type |
| `messaging` | `notify` delivery to inbox (`sys_inbox_message`) | **silent:** success with `skipped: true` |
| `webhooks` | `defineStack({ webhooks })` outbound registrations | nothing delivered outbound |

```typescript
defineStack({
  // …
  requires: ['automation', 'triggers', 'job', 'queue', 'approvals', 'messaging'],
});
```

### Inbound webhook (`api`) triggers (ADR-0041 Tier 1)

An `api` flow can be bound to an inbound HTTP endpoint:
`POST /api/v1/automation/hooks/:flowName/:hookId`. Configure it on the **start
node `config`** (the start `config` is a free-form record, so these keys are
read at runtime, not Zod-validated):

| `config` key | Purpose |
|:-------------|:--------|
| `hookId` | URL path token (default `'default'`). **Rotate it to revoke** a leaked endpoint |
| `secret` | HMAC-SHA256 shared secret. Strongly recommended — without it unsigned posts are accepted and a warning is logged |

- **Signature:** sender sends `x-objectstack-signature: sha256=<hex>` (GitHub/Stripe style).
- **Idempotency:** `x-idempotency-key` dedupes retries — author the flow to be idempotent (delivery is at-least-once).
- **Queue-backed:** the endpoint ACKs `202` and enqueues; the flow runs on the consumer, never in-band. Requires the `queue` service (see prerequisite).
- The JSON body surfaces to the flow as the trigger record (`record.*` / bare fields) plus `params`.

### Trigger Types (start-node `config.triggerType`)

| `triggerType` | Fires | ObjectQL hook |
|:------|:------|:------|
| `record-before-create` | before insert (can modify/reject) | `beforeInsert` |
| `record-after-create` | after insert | `afterInsert` |
| `record-before-update` | before update | `beforeUpdate` |
| `record-after-update` | after update | `afterUpdate` |
| `record-before-delete` | before delete | `beforeDelete` |
| `record-after-delete` | after delete | `afterDelete` |
| `record-before-write` / `record-after-write` | create OR update — one flow, both events | both insert + update hooks |

### Trigger Configuration — on the `start` node

The binding is the START NODE — this is that node, not a whole flow (a flow also
owns `label`, `type`, `nodes` and the `edges` `FlowSchema` requires):

```typescript
{
  id: 'start',
  type: 'start',
  label: 'On Case Escalated',
  config: {
    objectName: 'support_case',
    triggerType: 'record-after-update',
    // bare CEL; gates whether the flow launches on the event
    condition: "previous.status != 'escalated' && record.status == 'escalated'",
  },
}
```

> **Prefer `record-after-*`** unless you must modify or reject the record;
> **guard** one that writes its own object, or it re-triggers itself. A
> `record-before-*` flow that throws silently blocks the write — give it a
> user-facing message.

> **`previous`** and **`record`** are the CEL variables available in update
> triggers — `previous.x` is the value before the change, `record.x` is the
> value after. See [objectstack-formula](../objectstack-formula/SKILL.md).

→ Moved verbatim to [references/examples-flows.md](./references/examples-flows.md) § Time-relative triggers — scheduled per-record date sweep.

---

## CRM Automation Blueprint

For enterprise automation design, align with this CRM-style structure:

| Automation Type | Typical Location | Pattern |
|:--|:--|:--|
| Screen flow | `src/flows/*.flow.ts` | Use explicit `variables`, node graph (`nodes` + `edges`), and decision branches |
| Approval flow | `src/flows/*.flow.ts` | A flow with `approval` node(s); set `approvers` / `behavior` / `lockRecord` / `approvalStatusField` in node `config`, branch on `approve` / `reject` edges |
| Flow registry | `src/flows/index.ts` | Export `allFlows: Flow[]` and register centrally in `defineStack({ flows })` |

Default approach for metadata apps: model business lifecycle in Flow/Approval
metadata first; reserve custom code for edge-case integrations.

---

## Verify your work

A bare ref (`status == 'open'`) resolves — the engine flattens the record's
fields into scope — so a typo there is only an advisory did-you-mean.
`record.status` stays canonical, and `os validate` errors on an unknown
`record.<field>`:

```bash
os validate     # CEL/predicate validation (record.<field> existence) + schema
# or: os build  # the same gates, plus emits dist/
```

It runs the ADR-0032 gate over every condition, edge guard, validation and
sharing rule, exiting non-zero. In a scaffolded project: `npm run validate`.

---

## References

The send-back shape has a graded eval at
[evals/approvals/test-revise-loop.md](./evals/approvals/test-revise-loop.md).

See [references/_index.md](./references/_index.md) for the full list of Zod
schemas (with one-line descriptions) — pointers into
`node_modules/@objectstack/spec/src/`. Always `Read` the source for exact field
shapes; do not rely on memory of property names.

