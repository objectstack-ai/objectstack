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
compatibility: Requires @objectstack/spec 18.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "18.2.0"
  domain: automation
  tags: flow, workflow, trigger, approval, state-machine, scheduled, webhook
---

# Automation Design — ObjectStack Automation Protocol

## When to Use This Skill

Flows (auto-launched, screen, scheduled), state machines and approvals,
record-change triggers, scheduled automation, vendor integrations and their
callbacks, and **assignment rules** that route a new record to a queue or a person.

> **Predicates and conditions are CEL** — every `condition` / `guard` /
> `entryCondition` / filter `value` here is an **Expression** envelope evaluated
> by `@objectstack/formula`. A slot takes a plain CEL string; the
> `P\`...\`` / `cel\`...\`` tags wrap the same string with author-time validation.
> Both parse — pick one per file. See
> **objectstack-formula** for the CEL contract, stdlib and legacy → CEL table.

---

## Flows — Visual Logic Orchestration

A **Flow** is a directed graph of nodes — the primary automation building block.

### Flow Types

| Type | When to Use |
|:-----|:------------|
| `autolaunched` | Runs without user interaction — triggered by events, APIs, or other flows |
| `screen` | Interactive — presents UI screens to the user (wizards, forms) |
| `schedule` | Runs on a cron/interval cadence declared on the **start node's `config.schedule`** — or a **per-record date sweep** via `config.timeRelative`, see *Time-relative triggers* |
| `record_change` | Fires automatically on record create/update/delete (bind via the `start` node's `triggerType`). `autolaunched` + the same `record-*` binding behaves identically; `record_change` also opts into the trigger-readiness lint |
| `api` | Inbound **webhook** — needs a start-node `secretRef` (or a literal `secret`; see *Inbound webhook triggers* below); a flow only ever started explicitly is `autolaunched` |

### Flow Node Types

Flows are built from **20 built-in node types** (plugins register more, e.g.
`approval`):

#### Control Flow

| Node | Purpose |
|:-----|:--------|
| `start` | Entry point — every flow has exactly one |
| `end` | Exit point — can have multiple (early exit, error exit) |
| `decision` | Conditional branching — routed by **edge `condition` predicates**, not node config |
| `loop` | Iterate a **nested `config.body` region** once per item of `config.collection` — a CEL value envelope (`{ dialect: 'cel', source: 'rows' }`) or an inline list, never a string; `iteratorVariable` (default `item`) and optional `indexVariable` bind inside it, `maxIterations` caps it |
| `parallel` | Fan out into `config.branches[]` (≥ 2 regions) run concurrently, **joined implicitly** at block end — no split/join pair to mis-wire |
| `try_catch` | Run `config.try`; on failure run `config.catch` with the error in `errorVariable` (default `$error`); `config.retry` re-runs `try` with backoff first. **No `finally`** — the container's ordinary out-edges are the continuation |
| `map` | Sequential multi-instance — invoke a subflow once per item of `config.collection` (shaped as `loop`'s); each iteration may pause (batch approvals) |
| `wait` | Pause execution until a timer elapses or a named signal arrives |
| `subflow` | Invoke another flow (reusable composition) |
| `parallel_gateway` / `join_gateway` / `boundary_event` | **Not author-facing** — BPMN-interop forms a `parallel` / `try_catch` container lowers into; author the container |

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
| `http` | Call an external HTTP API — always set `timeoutMs` (unset = no timeout). `url` and `headers` are served as written with the definition to every member who can read flows — only `signingSecret` and a start node's `secret` are withheld — so never a credential there: a credential means a declared connector called via `connector_action` |
| `notify` | Send a notification through the messaging service (inbox by default) |
| `connector_action` | Dispatch an action of a declared connector (a `connectors:` entry with a `provider`, § *Integrations are declared, not coded*) or a plugin's. `connectorConfig.input` is sent as written — no CEL or `{{ }}` in it |
| `script` | Call a **registered** function named by `config.function` (see *Valid-but-silently-wrong* #3) |
| `screen` | Display a UI form to the user (screen flows only). `config.fields[]`: `{ name, label, type, required, options, defaultValue }`, `type` an open widget hint; `'file'` renders the upload widget and resumes with the `sys_file` id bound to `name` — a later `create_record` / `update_record` writes it into a `file` field, which claims the file: collect first, write after the last screen. `'record_link'` (never `'record'`, an object field type) takes no input — it shows the `reference` record whose id `defaultValue` evaluates to, by display name, as a link to its record page: the result screen of a flow that created records, `{ name: 'account_link', type: 'record_link', reference: 'crm_account', defaultValue: { dialect: 'cel', source: 'account.id' } }` over a `create_record` `outputVariable: 'account'`. Both keys required; `required` / `options` / `placeholder` / `min` / `max` refused; a resume value under its name refused (`400 INVALID_SCREEN_INPUT`). A completed `end` `message` is refused and a markdown link in a screen `description` renders literally. Next / Submit and "Step N of M" are not authored: the engine reads the graph when the screen pauses and serves `progress` (`nextScreen: 'none' | 'possible' | 'certain'`; `step` / `stepCount` only when every path agrees), which alone labels the button and draws the counter. A `decision`, `fault` edge, loop back, non-screen pause (`approval`, `wait`) or `subflow` after a screen answers `possible` — "Next", no count. `progress` in a node `config` is refused; never hand-roll a button label or step counter into `fields` |

#### Human Decision

| Node | Purpose |
|:-----|:--------|
| `approval` | Route a record for human sign-off — **suspends** the run until a decision, then continues down the `approve` / `reject` branch (from `plugin-approvals`) |

### `notify` — the most-used node type

`NotifyConfigSchema` is `strictObject` — an undeclared key is a named parse
error. **RAW** keys are read as written: a
`{token}` in one is refused.

```ts
{ id: 'tell_owner', type: 'notify', label: 'Notify Owner', config: {
    recipients: { dialect: 'cel', source: 'record.assignee' }, // REQUIRED — id, list, or envelope; a CSV is ONE id.
    // 4th form `{ emailField: 'applicant_email' }`: an `email` field of the trigger record, for a non-user —
    // then `channels: 'email'` alone. An envelope must yield USER ids: an address no user holds fails the node
    title: 'Done: {{ record.title }}', // inline; XOR `template` (RAW, localizable)
    message: 'Closed {{ record.closed_at | date:long }}', // body; only with inline `title`
    topic: 'task',                     // RAW; default 'notify'
    severity: 'warning',               // RAW; CLOSED enum info|warning|critical
    channels: ['inbox'],               // RAW; default inbox
    sourceObject: 'task',              // click-through: a PAIR, else dropped
    sourceId: { dialect: 'cel', source: 'record.id' }, // (a value slot)
    actionUrl: '/tasks/{{ record.id }}', // text slot; overrides the synthesized link
} }
```

### Flow Variables

`variables` is an **array** of `{ name, type, isInput, isOutput }` entries —
not a name-keyed map; a variable has no `label`: `variables: [{ name: 'case_id',
type: 'text', isInput: true }, { name: 'approval_result', type: 'boolean', isOutput: true }]`.

→ [references/examples-flows.md](./references/examples-flows.md) § Flow Example — Auto-Escalate Overdue Cases.

### Failure routing & `runAs`

> **Handling a failed node: a `fault` edge.** `{ source, target, type: 'fault' }`
> routes a failed node to a handler instead of ending the run. **`type: 'fault'`
> is what routes — a `label: 'error'` alone does nothing:** an ordinary edge
> traverses on SUCCESS (`objectstack validate` reports `flow-error-label-not-fault`).
> A handled failure does not consume a flow-level `errorHandling.retry`, which
> replays from the start — prefer a fault edge for a local failure. The handler
> reads `{{ <nodeId>.error }}` (run-wide `{{ $error.message }}`; in CEL,
> `vars["$error"]`); the run then reports success and the failed step stays in the trace.

| ROUTES (runtime failure) | Does NOT route (fatal either way) |
|:--|:--|
| 404, rate-limit, rejected write, failed subflow | missing required config key (`objectName`, `url`, `flowName`, `connectorId`/`actionId`); filter operand that evaluated to `null`; graph past the nesting ceiling; unscoped run |

> **Writing a `readonly` field? Set `runAs: 'system'`.** Under the default
> `runAs: 'user'` the engine **strips** a `readonly` field from `create_record`
> and `update_record` alike — the step reports success, the value never lands,
> the drop is named in the step's warnings — so a flow maintaining one (approval
> stamps, conversion flags, SLA markers, rollups) runs `runAs: 'system'`.
> `os validate` / `os build` fail a `runAs:'user'` `update_record` writing one
> (`readonlyWhen`: a warning, per record state). Do **not** remove `readonly`
> instead; that loses the field's edit protection.

> **Elevate the write, not the flow.** A `screen` flow stays `runAs: 'user'`; a
> step that must write a `readonly` field moves into a dedicated `runAs: 'system'`
> flow called from a `subflow` node — raising the whole flow silently elevates
> every other write in it.
>
> **Elevation stops at identity assignment.** A `runAs: 'system'` flow's
> insert, update, delete, transfer, restore or purge of `sys_user_position`,
> `sys_user_permission_set`, `sys_invitation` or `sys_member` is refused with
> `PERMISSION_DENIED`, and moving that step into a dedicated `runAs: 'system'`
> subflow does not lift it: a governed identity write is judged by a door that
> judges a person. Grant positions and permission sets from a flow whose
> `runAs` is `'user'` — the delegated-administration gate then judges the user
> the run acts for and records them as the grant's `granted_by`. Invitations
> and memberships change through the organization endpoints (row 1b,
> https://objectstack.ai/docs/permissions/system-context#1-authorization-and-scoping).
>
> **A `runAs: 'system'` sweep must pin its organization.** System context has no
> trigger user, so a scan or rollup with no organization predicate reads and
> writes across every tenant; filter on the platform-injected tenant column, never
> re-declare it per object.

> **Who may START a flow: `requiredPermissions: ['…']` on the flow** (ADR-0066
> D4) — every door that starts it by name (trigger route, action of type `flow`,
> declared endpoint) refuses a non-system caller missing any named capability
> with `403 PERMISSION_DENIED`; an action starting it inherits the list, a
> `subflow` node is not a door. Gate an elevated `screen` / `api` flow here, never
> on `current_user.positions` inside it.

> **A hook elevates itself with `runAs`, never with `sudo`.** An object hook
> (objectstack-data) declares its own `runAs: 'system' | 'user' | 'inherit'` —
> default `'inherit'`, the context of the write that fired it — scoping that
> hook's `ctx.api` data operations only, on the in-process `handler` and the
> sandboxed `body` alike. A `'user'` hook whose trigger resolved no user has
> nothing to scope to: its `ctx.api` data operations are refused
> (`HOOK_UNSCOPED_DATA_ACCESS`, 403) rather than run unscoped — declare
> `runAs: 'system'` when the elevation is intended. `sudo` is not a hook key.

### Filter operands (`config.filter`)

- **Each operand is a value slot** — a literal or a CEL envelope evaluated
  before the query (`filter: { id: { dialect: 'cel', source: 'record.id' } }`).
  A whole-string **query placeholder** (`{current_user_id}`, `{today}`,
  `{current_year_start}`) passes through verbatim for the query engine; a flow
  variable never shadows it, and only `filter` gets this hand-off.
- **An operand that evaluates to `null` refuses the node** (not
  `fault`-routable): a dropped condition does not narrow a query, it widens
  it, so a routed `delete_record` would empty the object while the run reports
  success. Where the value may be absent, route around the node with a
  `decision`; to match an empty field, write the literal `null`. A relation
  hop (`record.owner.email`) needs the start node's `config.expand` to list
  the field — else the fault names the missing hop, not the remedy.

---

## Valid-but-silently-wrong (passes build, fails at runtime)

Legal metadata authors get wrong; most are caught by `objectstack build` —
write them right the first time:

1. **A value slot takes a literal or a CEL envelope — never a `{…}` token.**
   In `assignments.*`, `fields.*`, `subflow` / `map` `input.*`, `script`
   `inputs.*`, `loop` / `map` `collection`, notify `recipients` /
   `templateData.*` / `sourceId`, `http` `body` and every CRUD `filter`
   operand, a string is the literal text it spells, and a `{…}` token is
   **refused** — at `objectstack validate` (`expression-invalid`),
   `registerFlow` and the executor — naming its CEL spelling. Compute with
   `{ dialect: 'cel', source: '…' }`:
   - `'{record.owner}'` → `source: 'has(record.owner) ? record.owner : null'` —
     CEL refuses an absent key where the template wrote nothing, so nothing /
     `null` / a default is now YOUR call; `'{record.tags.0}'` → `'record.tags[0]'`;
     a deep path guards each step: `has(vars.source) && has(vars.source.id) ? vars.source.id : null`
   - money: `source: 'round(x * 100) / 100.0'` — CEL divides two integers as
     integers, so `/ 100` turns `123.46` into `123`
   - dates: `{TODAY()}` → `isoDate(today())`, `{TODAY() ± N}` →
     `isoDate(daysFromNow(N))` / `isoDate(daysAgo(N))`, `{NOW()}` →
     `isoDatetime(now())`, `{NOW() ± N}` → `isoDatetime(addDays(now(), N))`
   - run user: `{$User.Id}` → `current_user.id`; a flow that can run without a
     user guards it, `current_user != null ? current_user.id : null`.
     `current_user` holds `id`, `positions`, `organizationId`, `isPlatformAdmin`
     only — an email or a name is a `sys_user` read by that id

   Text slots (notify `title` / `message` / `actionUrl`, screen `title` /
   `description`, end `message`, `http` `url` / `headers`) render `{{ }}`
   holes — a variable path, optional formatter, no logic; a `{…}` token there
   is refused with its `{{ }}` spelling. A date or the run user has no hole:
   assign it first (`assignments: { v: { dialect: 'cel', source:
   'current_user.id' } }`), then write `{{ v }}`.

2. **`create_record`'s `outputVariable` holds the created RECORD, not its id.**
   Reference a field explicitly.
   ❌ `fields: { ref: { dialect: 'cel', source: 'newRec' } }` → writes the whole record object
   ✅ `source: 'newRec.id'`

3. **`script` nodes call a registered function — nothing else.** `config.function`
   (**required**: an empty node refuses at execute, an unregistered name fails
   loudly) names one registered via `defineStack({ functions: { my_fn: (ctx) => … } })`;
   `notify` delivers, `connector_action` reaches a vendor, a function computes.

   **A flow `function` is a PURE compute step — it does NOT read/write the
   database.** It receives `ctx.input` and **returns** a value; `config.outputVariable`
   exposes that value as a flow variable, and a later **declarative** node persists
   it. Keep data effects on the flow graph (visible, governed, build-checkable):

   ```ts
   // ✅ function returns values → outputVariable → update_record persists
   { id: 'ai', type: 'script', config: {
       function: 'helpdesk.aiTriageStub',     // returns { ai_category, ai_sentiment, … }
       inputs: { ticketId: { dialect: 'cel', source: 'record.id' } }, // CEL values or literals
       outputVariable: 'ai',
   } },
   { id: 'apply', type: 'update_record', config: {
       objectName: 'helpdesk_ticket',
       filter: { id: { dialect: 'cel', source: 'record.id' } },
       fields: { ai_category: { dialect: 'cel', source: 'ai.ai_category' } },
   } },
   ```

   Data-lifecycle **side effects** (read/write other records) are an L2 **hook**
   (objectstack-data) — hooks get `ctx.api`.

   A function that writes where the platform cannot see **declares** it, so the
   run reports "cannot say" rather than `acted: 0`:

   ```ts
   defineStack({ functions: {
     'helpdesk.aiTriageStub': (ctx) => ({ ai_category: 'other' }),  // pure — the default
     'billing.sync': { handler: syncBilling, effect: 'writes' },    // declared writer
   } });
   ```

4. **Conditions are bare CEL; only the stdlib (`CEL_STDLIB_FUNCTIONS`,
   **objectstack-formula**) is callable bare.** An unknown function (`PRIOR()`, a
   typo) and a `{…}`-wrapped field ref both **fail the build** — write `record.x`.

---

→ State Machines & Approvals: [references/state-machines-and-approvals.md](./references/state-machines-and-approvals.md) — its state-introspection route is `GET /api/v1/meta/object/:name/state/:field?from=:state`.

---

## Assignment rules — route a new record to a queue or a person

The third automation family: `assignmentRules` on the stack routes each inserted
row of an `ownership: 'user'` object whose `owner_id` and `queue` are both still
empty — once, after every `beforeInsert` hook, never on update, never refusing the
insert (ADR-0142 D5). Entries are ordered; the first whose `criteria` (CEL over
`record.*`) match decides:

<!-- os:check -->
```typescript
import { defineAssignmentRule } from '@objectstack/spec/automation';

export const caseIntake = defineAssignmentRule({
  name: 'case_intake',
  object: 'crm_case',
  entries: [
    { name: 'urgent', criteria: 'record.priority == "urgent"',
      assignTo: { type: 'queue', value: 'escalations' } },           // no strategy: parked for a claim
    { name: 'rest', assignTo: { type: 'queue', value: 'support_intake' },
      strategy: 'least_loaded', load: 'record.status != "closed"' }, // or 'round_robin'; `load` only with least_loaded
  ],
});
```

`strategy` is for a queue target only; `assignTo: { type: 'user', value: '<id>' }`
names one owner. Queues are declared in `queues` (objectstack-data); an approval
for the same people is `approvers: [{ type: 'queue', value: 'support_intake' }]`
([Approver Types](./references/state-machines-and-approvals.md#approver-types)).
⛔ Never a `beforeInsert` hook that picks an owner, nor a round-robin counter field.

---

## Triggers — Event-Driven Automation

A `record_change` flow fires on a data event; there is **no standalone trigger
object and no top-level `trigger` / `event` key** — the binding is the `start`
node's `config`.

### Prerequisite — declare the capabilities your nodes need

Metadata registers without its `defineStack({ requires })` token; the surface
just never runs. Two pairs are instead **refused** at `os validate` / `build` /
`dev` / `serve` (422); neither token implies the other:

| `requires` token | Turns on | Absent ⇒ |
|:--|:--|:--|
| `automation` | the flow engine + node executors | flows never execute |
| `triggers` + `automation` | `record-*` / schedule / `api` start bindings | auto-launched flow refused: `STACK_TRIGGER_CAPABILITY_REQUIRED` |
| `job` | cron cadence + the `timeRelative` sweep | scheduled flows never launch |
| `queue` | the inbound-webhook consumer | inbound POST answers **503** |
| `approvals` | `approval` / `approval_revise` (`plugin-approvals`) | no executor for the node type |
| `messaging` | `notify` delivery to inbox (`sys_inbox_message`) | **silent:** success with `skipped: true` |
| `webhooks` + `realtime` | `defineStack({ webhooks })` outbound dispatch | declared webhook refused: `STACK_WEBHOOK_CAPABILITY_REQUIRED` |

### Inbound webhook (`api`) triggers (ADR-0041 Tier 1)

An `api` flow is bound to an inbound HTTP endpoint:
`POST /api/v1/automation/hooks/:flowName/:hookId`. Configure it on the **start
node `config`**:

| `config` key | Purpose |
|:-------------|:--------|
| `hookId` | URL path token (default `'default'`). **Rotate it to revoke** a leaked endpoint |
| `secretRef` / `secret` | HMAC-SHA256 secret, **one required** (else refused at registration and `os validate`). Ship `secretRef: 'NAME'`: an env var the deployment fills, not `OS_*`; unfilled ⇒ `503`. Never a literal |

- **Signature:** `x-objectstack-signature: t=<unix seconds>,v1=<hex>` — `v1` = HMAC-SHA256 of `<t>.<raw body>` under the secret; refused when `t` is over 300 s from the server clock.
- **Idempotency:** `x-idempotency-key` dedupes retries — author the flow to be idempotent (delivery is at-least-once).
- **Queue-backed:** the endpoint ACKs `202` and enqueues; the flow runs on the consumer.
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

This is the start node alone, not a whole flow (a flow also
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

> `previous` (before the change) vs `record` (after) in an update trigger's
> condition: see [objectstack-formula](../objectstack-formula/SKILL.md) §5.

→ [references/examples-flows.md](./references/examples-flows.md) § Time-relative triggers — scheduled per-record date sweep.

---

## Integrations are declared, not coded

A vendor system reachable over HTTP (OpenAPI, remote MCP, plain REST) is a
`connectors:` entry inside the app — `provider: 'openapi' | 'mcp' | 'rest'`, a
packaged spec, `auth.credentialRef` (the customer's administrator supplies the
value) — dispatched by `connector_action`; an inbound vendor callback is an
`api` flow. Never a plugin, never an `http` node holding a credential. Recipes,
credential hand-off, loader limits: [references/integration-recipes.md](./references/integration-recipes.md).
Platform code only when one holds — and then it is the platform's, filed as a
card, the app still writing none: the protocol is not HTTP; the work writes
identity objects (users, units, positions); it processes files locally; one fixed
action contract spans several vendors; the callback's signature is outside the
`api` door's HMAC. A document the loader cannot take yet (YAML, Swagger 2.0,
`$ref`, OAuth, request signing) is a gap named against its platform card, never a
reason to write code.

---

## CRM Automation Blueprint

Model the business lifecycle in Flow / Approval metadata first (integrations:
above): flows in `src/flows/*.flow.ts` with explicit `variables`, `nodes` +
`edges` (approval config: the approvals reference), exported as `allFlows: Flow[]`
from `src/flows/index.ts` and registered centrally in `defineStack({ flows })`.

---

## Verify your work

A bare ref (`status == 'open'`) resolves (fields are flattened into scope), so
a typo there is only an advisory did-you-mean; `record.status` stays canonical
and `os validate` errors on an unknown `record.<field>`:

```bash
os validate     # CEL/predicate validation + schema
# or: os build  # the same gates, plus emits dist/
```

In a scaffolded project: `npm run validate`.

---

## References

See [references/_index.md](./references/_index.md) for pointers to the Zod
schemas in `node_modules/@objectstack/spec/src/` — `Read` the source for exact
field shapes; never rely on memory.

