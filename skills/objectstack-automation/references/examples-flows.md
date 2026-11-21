# Automation — flows, triggers and assignment rules

- [Flow Types](#flow-types) · [A flow an installed package ships](#a-flow-an-installed-package-ships) · [Flow Node Types](#flow-node-types)
- [`notify` in full](#notify-in-full) · [Flow Variables](#flow-variables) · [Failure routing & `runAs` in full](#failure-routing--runas-in-full)
- [Filter operands in full](#filter-operands-in-full) · [Value slots and the other silent traps](#value-slots-and-the-other-silent-traps)
- [Triggers](#triggers--event-driven-automation) · [Assignment rules](#assignment-rules) · [Long examples](#long-examples)

> **Predicates and conditions are CEL** — every `condition` / `guard` /
> `entryCondition` / filter `value` is an **Expression** envelope: a plain CEL
> string, or the `P\`...\`` / `cel\`...\`` tag (author-time validation); pick one
> per file.

## Flow Types

| Type | When to Use |
|:-----|:------------|
| `autolaunched` | Runs without user interaction — triggered by events, APIs, or other flows |
| `screen` | Interactive — presents UI screens |
| `schedule` | Runs on a cron/interval cadence declared on the **start node's `config.schedule`** — or a **per-record date sweep** via `config.timeRelative` |
| `record_change` | Fires automatically on record create/update/delete. `autolaunched` + the same `record-*` binding behaves identically; `record_change` also opts into the trigger-readiness lint |
| `api` | Inbound **webhook** (*Inbound webhook triggers*); a flow only ever started explicitly is `autolaunched` |

**A stepped form over one object that never branches** is no flow: an **objectstack-ui** form view, `type: 'wizard'`.

## A flow an installed package ships

**A flow an installed package ships** is read-only. To change what it does, save
a same-named flow in the base's paired `.custom` package declaring
`overrides: { package: '<base>', basedOn: '<base version>' }`
(**objectstack-platform** § Customizing an installed package): it is armed in the
base's place, keeps the base's name and its one activation switch
(`POST /api/v1/automation/:name/toggle`, `{ enabled: false }` = off for this
deployment), and a run suspended on the old body finishes on that body. An
undeclared same-named flow in the pair or in a dependent is refused at publish.
A flow *beside* it is "new similar": `POST /api/v1/automation/:name/clone`
`{ name, label, package? }` lands the copy switched off in the pair, never
package-less; a flow holding a `secret` / `signingSecret` is refused (`409`): author
it anew.

A package ships a flow **switched off** with `defaultActive: false` (beside
`status: 'active'`): unarmed (`_status` `enabled: false`) until an administrator
turns that switch on, which then outlives restart, upgrade and reinstall.
`status: 'obsolete'` disarms past the switch; a flow authored in the deployment
is refused the key (its switch is `status`).

## Flow Node Types

Built-in (plugins register more; a `type` none runs is refused at a server's publish, `flow-node-type-no-executor`):

### Control Flow

| Node | Purpose |
|:-----|:--------|
| `start` | Entry point — every flow has exactly one |
| `end` | Exit point — can have multiple |
| `decision` | Conditional branching — routed by **edge `condition` predicates**, not node config |
| `loop` | Iterate a **nested `config.body` region** once per item of `config.collection` — a CEL value envelope or an inline list, never a string; `iteratorVariable` (default `item`) and optional `indexVariable` bind inside it, `maxIterations` caps it |
| `parallel` | Fan out into `config.branches[]` (≥ 2 regions) run concurrently, **joined implicitly** at block end |
| `try_catch` | Run `config.try`; on failure run `config.catch` with the error in `errorVariable` (default `$error`); `config.retry` re-runs `try` with backoff first; in a `record-after-*` flow it (or `errorHandling.strategy: 'retry'`) may not reach an inline `http` / `connector_action`: the save would wait out every attempt. Inside a `subflow` / `map` child, retried by either flow, that is **silent**: the flow saves but never arms (`GET /api/v1/automation/_status`: `bound: false`, `unboundCause: retried_callout_in_subflow`) until the child's `http` is `durable: true` or nothing retries the call. **No `finally`** — the container's ordinary out-edges are the continuation |
| `map` | Sequential multi-instance — invoke the `config.flowName` flow (named as `subflow`'s) per item of `config.collection` (shaped as `loop`'s); each may pause (batch approvals); a refused name fails it at the first item |
| `wait` | Pause until a timer elapses or a named signal arrives |
| `subflow` | Invoke the flow bare `config.flowName` names: a package's flow gets its own, else the one holder in its `dependencies` closure plus `sys`; a package-less flow, the environment's, else the one package holder. Else `os validate` passes and the node fails at run time (`subflow 'X' failed: …` naming every candidate; no `code`): `outside-closure` — held only by an undeclared package (declare it) or the environment; `ambiguous-in-closure` / `ambiguous-in-environment` — two packages hold it (package / package-less caller) |
| `parallel_gateway` / `join_gateway` / `boundary_event` | BPMN-interop forms a `parallel` / `try_catch` container lowers into; author the container |

### External Integration nodes in full

| Node | Purpose |
|:-----|:--------|
| `http` | Call an HTTP API — set `timeoutMs`, or it has no timeout and warns (`flow-http-timeout-missing`). `url` and `headers` are served as written with the definition to every member who can read flows — only `signingSecret` and a start node's `secret` are withheld — so never a credential there: use a declared connector via `connector_action`. Retried after a record change: `durable: true` (outbox-queued, else sent once in the background, unretried; no response) |
| `notify` | Send a notification (below) |
| `connector_action` | Dispatch an action of a declared connector (§ *Integrations are declared, not coded*) or a plugin's. `connectorConfig.input` is a value-slot map like `subflow` `input`. Once evaluated, it is judged against the action's `inputSchema` (`required`, `type`, `properties`, `items`) before dispatch: a breach fails the step `VALIDATION_ERROR` (`fault`-routable); `os validate` does not judge the `inputSchema` fit yet. Retried after a record change: drop the retry, or run the flow on demand / on a schedule |
| `script` | Call a **registered** function (*Valid-but-silently-wrong* #3) |
| `screen` | Display a UI form (screen flows only). `config.fields[]`: `{ name, label, type, required, options, defaultValue }`, `type` an open widget hint; `'file'` renders the upload widget and resumes with the `sys_file` id bound to `name` — a later `create_record` / `update_record` writes it into a `file` field, which claims the file: collect first, write after the last screen. `'record_link'` (never `'record'`, an object field type) takes no input — it shows the `reference` record whose id `defaultValue` evaluates to, by display name, as a link to its record page: the result screen of a flow that created records, `{ name: 'account_link', type: 'record_link', reference: 'crm_account', defaultValue: { dialect: 'cel', source: 'account.id' } }` over a `create_record` `outputVariable: 'account'`. Both keys required; `required` / `options` / `placeholder` / `min` / `max` refused; a resume value under its name refused (`400 INVALID_SCREEN_INPUT`). A completed `end` `message` is refused and a markdown link in a screen `description` renders literally. Next / Submit and "Step N of M" are not authored: the engine reads the graph when the screen pauses and serves `progress`, which alone labels the button and draws the counter. A `decision`, `fault` edge, loop back, non-screen pause (`approval`, `wait`) or `subflow` after a screen means "Next", no count. `progress` in a node `config` is refused |

### Human Decision

| Node | Purpose |
|:-----|:--------|
| `approval` | Route a record for human sign-off |

The data-operation nodes: `SKILL.md` § Data Operations.

## `notify` in full

The node as JSON: `SKILL.md` § `notify`. An undeclared key is a named parse
error. **RAW** keys are read as written: a `{token}` in one is refused.

- `recipients` — REQUIRED: id, list, or envelope; a CSV is ONE id. 4th form
  `{ "emailField": "applicant_email" }`: an `email` field of the trigger record,
  for a non-user — then `channels: 'email'` alone. An envelope must yield USER
  ids: an address no user holds fails the node.
- `title` — inline; XOR `template` (RAW, localizable). `message` — body; only
  with inline `title`.
- RAW: `topic` (default `'notify'`), `severity` (CLOSED enum
  `info` | `warning` | `critical`), `channels` (default inbox).
- `sourceObject` + `sourceId` — the link: a PAIR, else dropped; none of the 3 ⇒
  the trigger record (not on delete/before-create), if any. `actionUrl`
  overrides the pair.

A recipient string, written or evaluated, may be an audience selector:

- `team:ID` — that team's members.
- `owner_of:OBJECT:ID` — that record's owner; a computed id: `source: "'owner_of:crm_case:' + record.case_id"`.
- `org:members` — every member of the run's organization, else that of the record the notification is about, else nobody (`single` posture: a `schedule` flow declaring no `organization`, no record). Any other `org:` value reaches nobody too. Each warns in the server log only; the node succeeds.

An option label in a notice: `{{ stage | option:opportunity.stage }}` in the mail
`template` (each recipient's language; mail-only, refused in inline `title` /
`message`) — never `label()` in `templateData`, evaluated once per run, before
fan-out.

## Flow Variables

`variables` is an **array**; a variable has no `label`: `variables: [{ name: 'case_id',
type: 'text', isInput: true }, { name: 'approval_result', type: 'boolean', isOutput: true }]`.

## Failure routing & `runAs` in full

> **Handling a failed node: a `fault` edge.** `{ source, target, type: 'fault' }`
> routes a failed node to a handler instead of ending the run. **A
> `label: 'error'` alone does nothing:** an ordinary edge
> traverses on SUCCESS (`objectstack validate` reports `flow-error-label-not-fault`).
> A handled failure does not consume the flow-level retry
> (`errorHandling.strategy: 'retry'`), which replays from the start — prefer a fault edge for a local failure. The handler
> reads `{{ <nodeId>.error }}` (run-wide `{{ $error.message }}`; in CEL,
> `vars["$error"]`); the run then reports success and the failed step stays in the trace.

| ROUTES (runtime failure) | Does NOT route (fatal either way) |
|:--|:--|
| 404, rate-limit, rejected write, failed subflow | missing required config key (`objectName`, `url`, `flowName`, `connectorId`/`actionId`); filter operand that evaluated to `null` or a non-value; graph past the nesting ceiling; unscoped run |

> **Writing a `readonly` field? Set `runAs: 'system'`** (approval stamps, SLA
> markers, rollups). Under the default
> `runAs: 'user'` the engine **strips** it from `create_record` / `update_record`
> — the step succeeds, the drop is named in the step's
> warnings; `os validate` / `os build` fail a `runAs:'user'`
> `update_record` writing one (`readonlyWhen`: a warning).
> A button, an action, an endpoint or the trigger route does not let a user
> start an `autolaunched`, `record_change` or `schedule` flow declared
> `runAs: 'system'` (403 `PERMISSION_DENIED`), so for a flow a user starts from a
> button the elevated routes are a `screen` or `api` flow declared
> `runAs: 'system'`, or a user-run flow whose `subflow` node calls the elevated flow.

> **Elevate the write, not the flow.** Prefer the `subflow` route — raising a
> whole `screen` flow silently elevates every other write in it, and an `api`
> flow adds a webhook secret and an inbound endpoint a button never uses.
>
> **Elevation stops at identity assignment.** A `runAs: 'system'` write (insert
> through purge) of `sys_user_position`, `sys_user_permission_set`,
> `sys_invitation` or `sys_member` is refused `PERMISSION_DENIED`, a system
> subflow included. Grant positions and permission sets from a `runAs: 'user'`
> flow — the delegated-administration gate judges that user and records them as
> `granted_by`; invitations and memberships change through the organization
> endpoints (row 1b, https://objectstack.ai/docs/permissions/system-context#1-authorization-and-scoping).
>
> **A `runAs: 'system'` sweep must pin its organization.** System context has no
> trigger user, so a scan or rollup with no organization predicate reads and
> writes across every tenant; filter on the platform-injected tenant column, never
> re-declare it per object.

> **Who may START a flow: `requiredPermissions: ['…']` on the flow** — the
> four entrances above refuse a non-system caller missing any named capability
> with `403 PERMISSION_DENIED`; an action starting it inherits the list, a
> `subflow` node is not an entrance. Gate an elevated `screen` / `api` flow
> here, never on `current_user.positions` inside it.

> **A hook elevates itself with `runAs`, never with `sudo`.** An object hook
> (objectstack-data) declares its own `runAs: 'system' | 'user' | 'inherit'` —
> default `'inherit'`, the context of the write that fired it — scoping that
> hook's `ctx.api` data operations only, on the in-process `handler` and the
> sandboxed `body` alike. A `'user'` hook whose trigger resolved no user has
> nothing to scope to: its `ctx.api` data operations are refused
> (`HOOK_UNSCOPED_DATA_ACCESS`, 403) rather than run unscoped.

## Filter operands in full

- **Each operand is a value slot**, evaluated
  before the query.
  A whole-string **query placeholder** (`{current_user_id}`, `{today}`,
  `{current_year_start}`) passes through verbatim for the query engine; a flow
  variable never shadows it, and only `filter` gets this hand-off.
- **An operand that evaluates to `null` refuses the node**: a dropped condition
  does not narrow a query, it widens it, so a routed `delete_record` would empty
  the object while the run reports success. Where the value may be absent,
  route around the node with a `decision`; to match an empty field, write the
  literal `null`. A relation hop (`record.owner.email`) needs the start node's
  `config.expand` to list the field — else the fault names the missing hop, not
  the remedy.
- **A computed operand is a value, never a query operator**: a string, number,
  bigint, boolean or date, or at an `$in` / `$nin` / `$between` comparand a list
  of them with no empty entry. Anything else fails the node as a guard.
  Make the expression evaluate to the compared value (for a record,
  its `id`), and write conditions in the filter itself.

## Value slots and the other silent traps

Most are caught by `objectstack build`:

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
   - run user: `{$User.Id}` → `current_user.id`; a flow that can run without a
     user guards it, `current_user != null ? current_user.id : null`.
     `current_user` holds `id`, `positions`, `organizationId`, `isPlatformAdmin`
     only — an email or a name is a `sys_user` read by that id

   Text slots (notify `title` / `message` / `actionUrl`, screen `title` /
   `description`, end `message`, `http` `url` / `headers`) render `{{ }}`
   holes — a variable path, optional formatter (a `default:` argument is
   literal text, never a path), no logic; a `{…}` token there
   is refused with its `{{ }}` spelling. A date or the run user has no hole:
   assign it first (`assignments: { v: { dialect: 'cel', source:
   'current_user.id' } }`), then write `{{ v }}`.
   `create_record` / `update_record` `fields` also take a text slot, marked
   `{ dialect: 'template', source }`, for a sentence people read. It is written
   in the organization's language (Localization setting if set, else
   `i18n.defaultLocale`; key: **objectstack-i18n**), never the run starter's;
   untranslated, the authored text; an unreadable setting fails the node. A
   bare string stays a literal, never translated.

2. **`create_record`'s `outputVariable` holds the created RECORD, not its id.**
   ❌ `fields: { ref: { dialect: 'cel', source: 'newRec' } }`
   ✅ `source: 'newRec.id'`

3. **`script` nodes call a registered function — nothing else.** `config.function`
   (**required**: an empty node refuses at execute, an unregistered name fails
   loudly) names one registered in `defineStack({ functions })`.

   **The name resolves from the flow's package, as `subflow`'s `flowName`
   does**, the platform's ownerless function in every flow's reach; a
   `.custom` override reads as a package-less flow. Packages of two
   `namespace`s each run their own `normalize_phone`. One namespace (or
   none): both held at boot warn `Bare-name conflict at boot`; a later one
   installs but binds NONE of its functions or hooks (error `Failed to bind
   declarative hooks`): rename, or another namespace. If the flow's package
   holds none, two holders in reach or one only outside its `dependencies`
   closure fail the step as a guard (no `fault` edge; `$error.code:
   'RESOURCE_CONFLICT'` in a `try_catch`); a flow door's `innerRefusal` names
   each holder. Fix: declare the dependency, or rename.

   **A flow `function` is a PURE compute step — it does NOT read/write the
   database.** It receives `ctx.input` and **returns** a value; a later
   **declarative** node persists its `outputVariable` (the two nodes: `SKILL.md`
   § Valid-but-silently-wrong, item 3).

   A function that writes where the platform cannot see **declares** it with
   `effect: 'writes'` on its `defineStack({ functions })` entry, so the run
   reports "cannot say" rather than `acted: 0` (project code — a function has no
   JSON form).

4. **A `select` is compared and written by its option `value`, never its label.**
   The request speaks the label ("Lost"); the row stores the `value` (`lost`).
   `condition: "record.status == 'Lost'"` parses, matches no row: the flow
   stages clean and never fires; `fields: { status: 'Lost' }` / a `filter`
   fails the run (`invalid_option`). Read the field's `options`.

## Triggers — Event-Driven Automation

There is **no standalone trigger
object and no top-level `trigger` / `event` key**.

### Prerequisite — declare the capabilities your nodes need

Metadata registers without its `defineStack({ requires })` token. Two pairs are
instead **refused** at `os validate` / `build` / `dev` / `serve` (422); neither
token implies the other:

| `requires` token | Turns on | Absent ⇒ |
|:--|:--|:--|
| `automation` | the flow engine + node executors | flows never execute |
| `triggers` + `automation` | `record-*` / schedule / `api` start bindings | auto-launched flow refused: `STACK_TRIGGER_CAPABILITY_REQUIRED` |
| `job`° | cron cadence + the `timeRelative` sweep | scheduled flows never launch |
| `queue`° | the inbound-webhook consumer | inbound POST answers **503** |
| `approvals` | `approval` / `approval_revise` (`plugin-approvals`) | no executor for the node type |
| `messaging`° | `notify` delivery to inbox (`sys_inbox_message`) | **silent:** success with `skipped: true` |
| `webhooks` + `realtime` | `defineStack({ webhooks })` outbound dispatch | declared webhook refused: `STACK_WEBHOOK_CAPABILITY_REQUIRED` |

° Always-on, so list it only under `--preset minimal` (**objectstack-platform** § `requires:`).

### Trigger Types (start-node `config.triggerType`)

| `triggerType` | ObjectQL hook |
|:------|:------|
| `record-before-create` (can modify/reject) | `beforeInsert` |
| `record-after-create` | `afterInsert` |
| `record-before-update` | `beforeUpdate` |
| `record-after-update` | `afterUpdate` |
| `record-before-delete` | `beforeDelete` |
| `record-after-delete` | `afterDelete` |
| `record-before-write` / `record-after-write` — one flow, both events | insert + update hooks |

### Trigger Configuration — on the `start` node

```typescript
{
  id: 'start',
  type: 'start',
  label: 'On Case Escalated',
  config: {
    objectName: 'support_case',
    triggerType: 'record-after-update',
    condition: "previous.status != 'escalated' && record.status == 'escalated'",
  },
}
```

> **Prefer `record-after-*`**; **guard** one that writes its own object, or it re-triggers itself. A
> `record-before-*` flow that throws silently blocks the write — give it a
> user-facing message.

A date sweep: [Time-relative triggers](#time-relative-triggers--scheduled-per-record-date-sweep). An inbound webhook: [integration-recipes.md](./integration-recipes.md#inbound-webhook-api-triggers-adr-0041-tier-1).

## Assignment rules

`assignmentRules` on the stack routes each inserted
row of an `ownership: 'user'` object whose `owner_id` and `queue` are both still
empty — once, after every `beforeInsert` hook, never on update, never refusing the
insert. Entries are ordered; the first whose `criteria` (CEL over
`record.*`) match decides:

<!-- os:check -->
```typescript
import { defineAssignmentRule } from '@objectstack/spec/automation';

export const caseIntake = defineAssignmentRule({
  name: 'crm_case_intake',
  object: 'crm_case',
  entries: [
    { name: 'urgent', criteria: 'record.priority == "urgent"',
      assignTo: { type: 'queue', value: 'crm_escalations' } },       // no strategy: parked for a claim
    { name: 'rest', assignTo: { type: 'queue', value: 'crm_support_intake' },
      strategy: 'least_loaded', load: 'record.status != "closed"' }, // or 'round_robin'; `load` only with least_loaded
  ],
});
```

`strategy` is for a queue target only; `assignTo: { type: 'user', value: '<id>' }`
names one owner, who holds the row only while an active member of its organization
(else ownerless). Queues are declared in `queues` (objectstack-data); an approval
for the same people is a `queue` approver ([Approver Types](./state-machines-and-approvals.md#approver-types)).
⛔ Never a `beforeInsert` hook that picks an owner, nor a round-robin counter field.

**A packaged rule's queue** is its package's own, else the one holder
in its `dependencies` closure plus `sys`: `acme.helpdesk` naming `acme.crm`'s queue
declares `dependencies: { 'acme.crm': '^1.0.0' }`. Else refused — `outside-closure`
(an undeclared package's or environment-only queue), `ambiguous-in-closure` (two
in it) — the row is written ownerless, in no queue, and the server log warns once
(`… does not resolve … from the rule's package`). An organization's
`sys_assignment_rule` row and a rule no package ships read environment-wide (two
package holders: `ambiguous-in-environment`). A name no `queues` entry declares
reads the organization's `sys_queue` row.

## Long examples

### Flow Example — Auto-Escalate Overdue Cases

> **Nodes connect via `edges`, not a `next` property.** The engine traverses
> `flow.edges` (`{ source, target }`); a bare `next:` on a node is refused.
> `update_record` selects rows with **`filter`** — an ObjectQL `where` **map**
> of `field → value` / `field → { $operator: value }`, NOT the UI view-filter
> `[{ field, operator, value }]` triples — and writes with **`fields`**
> (a single call updates *every* matching row — no per-row loop needed).
> `label` is **required** on the flow and on every node, and every path through
> the graph must reach an `end` node.

<!-- os:check -->
```typescript
import { defineFlow } from '@objectstack/spec';

export const EscalateOverdueCasesFlow = defineFlow({
  name: 'crm_escalate_overdue_cases',
  label: 'Escalate Overdue Cases',
  type: 'schedule',
  status: 'active',
  runAs: 'system',   // a scheduled run has no trigger user — elevate explicitly
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'Daily at 09:00 Shanghai time',
      // The cadence lives HERE — FlowSchema has NO top-level `schedule` key (a
      // named parse error). A bare cron string also works; a cron`…` tag does not.
      // A bare expression runs in UTC. A wall-clock hour the request names is
      // written AS SAID with its IANA `timezone` — never converted to UTC by hand:
      // the arithmetic may be right, but nothing then records which zone was meant.
      config: { schedule: { type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' } },
    },
    {
      id: 'escalate_overdue',
      type: 'update_record',
      label: 'Escalate Overdue Cases',
      config: {
        objectName: 'support_case',
        filter: {
          status: { $in: ['new', 'open'] },
          due_date: { $lt: '{today}' },   // query placeholder → today's date at run time
        },
        // what to write — `fields`, not `values`
        fields: { status: 'escalated' },
      },
    },
    {
      id: 'notify_manager',
      type: 'connector_action',
      label: 'Notify Manager',
      // NOT an `http` node with a Slack webhook url: the definition (`url` and
      // `headers` included) is served to every member who can read flows. The
      // `slack` connector (@objectstack/connector-slack) holds the bot token.
      connectorConfig: {
        connectorId: 'slack',
        actionId: 'chat.postMessage',
        input: { channel: '#support-leads', text: 'Escalated overdue support cases.' },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start',            target: 'escalate_overdue' },
    { id: 'e2', source: 'escalate_overdue', target: 'notify_manager' },
    { id: 'e3', source: 'notify_manager',   target: 'end' },
  ],
});
```

### Time-relative triggers — scheduled per-record date sweep

**Don't** express "act N days before/after a date" (renewal reminders, "expiring
soon", overdue sweeps) as a `record_change` flow gated on date-equality
(`end_date == daysFromNow(60)`) — that predicate is only evaluated when the
record *happens to change*, so unattended it almost never fires. Use a
**declarative time-relative trigger**: a `schedule`-type flow whose `start` node
carries a **`timeRelative`** descriptor is swept on a schedule (daily by default)
and launched **once per record** whose date field falls in the window. The record
is on the context, so the start `condition` and a `record.*` CEL value envelope work
exactly as for a record-change flow.

<!-- os:check -->
```typescript
import { defineFlow } from '@objectstack/spec';
defineFlow({
  name: 'crm_renewal_alert',
  label: 'Renewal Alert',
  type: 'schedule',
  runAs: 'system',
  nodes: [
    {
      id: 'start', type: 'start', label: 'Daily Sweep',
      config: {
        timeRelative: {
          object: 'contracts',
          dateField: 'end_date',
          offsetDays: [60, 30, 7],   // fire exactly at T-60 / T-30 / T-7
          // — or (exactly one) — withinDays: 30   // "expiring within 30 days" (negative = overdue lookback)
          filter: { status: 'active' },  // optional, ANDed with the date window
          // maxRecords: 1000            // optional per-sweep cap (default 1000)
        },
        // Optional sweep cadence; omit for daily 08:00 UTC. Plain shape only, a
        // named hour with its zone: schedule: { type: 'cron', expression: '0 8 * * *', timezone: 'Asia/Shanghai' }
      },
    },
    // …downstream nodes (notify, update_record, …)
  ],
  edges: [ /* start → downstream */ ],
});
```

As JSON the flow is that literal without `defineFlow(...)`; its start node:

```json
{ "id": "start", "type": "start", "label": "Daily Sweep", "config": { "timeRelative": {
    "object": "contracts", "dateField": "end_date", "offsetDays": [60, 30, 7],
    "filter": { "status": "active" } } } }
```

**Date EQUALITY never matches**, so a hand-rolled sweep filters windows, not
days: a `date` field carries a time component, so `field == daysFromNow(N)` (or
`{ $in: [...] }`) compares two differently-timed timestamps and silently returns
nothing (build warns `flow-date-equality-filter`). Tier each threshold as a
one-day **window** (`$gte`/`$lt`) — this `filter`, plus the same window at
30 / 31 and at 60 / 61 as further `$or` entries:

```json
{ "status": "active", "$or": [
  { "end_date": { "$gte": { "dialect": "cel", "source": "isoDate(daysFromNow(7))" },
                  "$lt":  { "dialect": "cel", "source": "isoDate(daysFromNow(8))" } } }
] }
```

Abutting windows tile the timeline, so each record matches exactly one tier —
fires once, idempotent, no guard field. Each bound is evaluated before the
query; any `{…}` token but a
query placeholder such as `{today}` is refused there (`expression-invalid`).
For "days remaining" in a message, use `daysBetween(today(), record.end_date)`.

`timeRelative` ships in `@objectstack/trigger-schedule` (its `requires` tokens:
SKILL.md § Prerequisite). Full descriptor schema:
`node_modules/@objectstack/spec/src/automation/time-relative-trigger.zod.ts`.
