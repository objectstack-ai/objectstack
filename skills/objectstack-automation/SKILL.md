---
name: objectstack-automation
description: >
  Automate an ObjectStack app, in a project or through MCP: act when a record is
  created or changes, on a schedule or from a webhook; approvals, notifications,
  assignment rules, and screen flows / wizards that branch between steps. Use
  when the request is "when X happens, do Y" or you are editing `*.flow.ts`. Not
  for validation rules or record hooks on an object (objectstack-data), or
  kernel / plugin events (objectstack-platform).
license: Apache-2.0
compatibility: Requires @objectstack/spec 18.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "18.6.0"
  domain: automation
  tags: flow, workflow, trigger, approval, state-machine, scheduled, webhook
---

# Automation Design — ObjectStack Automation Protocol

## First checks

1. **Version.** Read the installed `@objectstack/spec`
   (`node_modules/@objectstack/spec/package.json`); where it differs from this
   skill's `compatibility` line, the installed contract is right.
2. **Read what exists.** Read the object's fields and option `value`s, the
   flows already bound to it, and the functions, queues and connectors the
   stack declares.
3. **Read the type's contract.** [references/_index.md](./references/_index.md)
   points at each type's Zod source in `node_modules/@objectstack/spec/src/`.
   `Read` it for exact keys, never from memory.
   A running environment serves the parsed shape (`GET /api/v1/meta/types`):
   a defaulted key reads as required.
4. **Verify before reporting done.** `os validate`; CEL checks:
   **objectstack-formula** § Verify your work. Most traps below pass it.

## Where to go

Open the file for what you are writing before you write it.

| Authoring | Open first |
|:--|:--|
| A flow's `type` and variables, control-flow nodes, an installed package's flow | [examples-flows.md](./references/examples-flows.md) |
| Triggers (record change, schedule, date sweep, inbound webhook), `requires` capabilities | [Triggers](./references/examples-flows.md#triggers--event-driven-automation) |
| Routing a new record to a queue or a person | [Assignment rules](./references/examples-flows.md#assignment-rules) |
| An approval, a send-back, an escalation, a state machine | [state-machines-and-approvals.md](./references/state-machines-and-approvals.md) — its state-introspection route is `GET /api/v1/meta/object/:name/state/:field?from=:state` |
| A vendor integration or callback | [integration-recipes.md](./references/integration-recipes.md) |

## Flows

**A trigger is the start node's `config`**; there is no top-level `trigger`,
`event` or `schedule` key. A record change:
`{ objectName: 'support_case', triggerType: 'record-after-update', condition: "previous.status != 'escalated' && record.status == 'escalated'" }`;
a cadence is `config.schedule`. Guard a flow that writes its own object, or
it re-triggers itself. `defineStack({ requires })`
lists `automation` and `triggers`.

### Flow Node Types

Control flow, `approval` and every node's `config`:
[Flow Node Types](./references/examples-flows.md#flow-node-types).

#### Data Operations

| Node | Purpose |
|:-----|:--------|
| `assignment` | Set variable values |
| `create_record` | Insert a record |
| `update_record` | Modify records |
| `delete_record` | Remove records |
| `get_record` | Fetch records with filters (**no `query_record`**) |
| `save_notice` | Tell the saver what this create/update started — record create/update trigger only, not after a pause: **objectstack-data** `rules/lifecycle.md` § Save Notice |

#### External Integration

| Node | Purpose |
|:-----|:--------|
| `http` | Call an HTTP API. Set `timeoutMs`. `url` and `headers` are served to every member who can read flows: never a credential there, use a declared connector. Retried after a record change: `durable: true` |
| `notify` | Send a notification (below) |
| `connector_action` | Dispatch an action of a declared connector (§ *Integrations are declared, not coded*). `connectorConfig.input` is a value-slot map, judged against the action's `inputSchema` only at dispatch |
| `script` | Call a **registered** function (*Valid-but-silently-wrong* #3) |
| `screen` | Display a UI form (screen flows only): `config.fields[]`. An upload is `type: 'file'`, a link to a created record `type: 'record_link'`; Next / Submit is never authored |

### `notify`

The node as JSON (TypeScript: the same literal, a `FlowNode`):

```json
{ "id": "tell_owner", "type": "notify", "label": "Notify Owner", "config": {
    "recipients": { "dialect": "cel", "source": "record.owner_id" },
    "title": "Done: {{ record.title }}",
    "message": "Closed {{ record.closed_at | date:long }}",
    "channels": ["inbox"],
    "sourceObject": "task",
    "sourceId": { "dialect": "cel", "source": "record.id" },
    "actionUrl": "/tasks/{{ record.id }}"
} }
```

- `recipients` — REQUIRED: id, list, or envelope yielding USER ids. A non-user
  is `{ "emailField": "applicant_email" }` with `channels: 'email'` alone; an
  audience is a selector string (`team:ID`, `owner_of:OBJECT:ID`,
  `org:members`).
- `title` is inline XOR `template`. `sourceObject` + `sourceId` are a PAIR;
  with neither and no `actionUrl` the notice links to the trigger record.

### Failure routing & `runAs`

- **A failed node is routed by a `fault` edge**, `{ source, target, type: 'fault' }`.
  A `label: 'error'` alone does nothing: an ordinary edge traverses on SUCCESS.
- **Writing a `readonly` field? Set `runAs: 'system'`.** Under the default
  `runAs: 'user'` the engine **strips** it and the step succeeds. A button
  cannot start a `runAs: 'system'` `autolaunched`, `record_change` or
  `schedule` flow (403): elevate the write, not the flow, through a
  `subflow` node.
- **Elevation stops at identity assignment**: a `runAs: 'system'` write of
  `sys_user_position`, `sys_user_permission_set`, `sys_invitation` or
  `sys_member` is refused `PERMISSION_DENIED`: grant from a `runAs: 'user'`
  flow.
- **A `runAs: 'system'` sweep must pin its organization**, or it reads and
  writes across every tenant.
- **Who may START a flow** is `requiredPermissions: ['…']` on the flow, never
  a `current_user.positions` check inside it.

### Filter operands (`config.filter`)

Each operand is a value slot, evaluated before the query; a whole-string query
placeholder (`{current_user_id}`, `{today}`) passes through verbatim. **An
operand that evaluates to `null` refuses the node** (a dropped condition
widens a query). Route around the node with a `decision`; to match an empty
field, write the literal `null`. A computed operand is a value, never a query
operator.

## Valid-but-silently-wrong (passes build, fails at runtime)

Most are caught by `objectstack build`:

1. **A value slot takes a literal or a CEL envelope — never a `{…}` token.**
   In `assignments.*`, `fields.*`, `input.*`, `inputs.*`, `collection`, notify
   `recipients`, `http` `body` and every `filter` operand a string is the
   literal text it spells. Compute with `{ dialect: 'cel', source: '…' }`
   (`'{record.owner}'` → `'has(record.owner) ? record.owner : null'`; the run
   user is `current_user.id`). Text slots (notify `title` / `message`, `http`
   `url`) render `{{ }}` holes.
2. **`create_record`'s `outputVariable` holds the created RECORD, not its id.**
   ✅ `source: 'newRec.id'`
3. **`script` nodes call a registered function — nothing else.**
   `config.function` names one registered in `defineStack({ functions })`: a
   PURE compute step that receives `ctx.input` and **returns** a value. A
   later **declarative** node persists its `outputVariable`:

   ```json
   [
     { "id": "ai", "type": "script", "label": "AI Triage", "config": {
         "function": "helpdesk.aiTriageStub", "outputVariable": "ai",
         "inputs": { "ticketId": { "dialect": "cel", "source": "record.id" } } } },
     { "id": "apply", "type": "update_record", "label": "Apply Category", "config": {
         "objectName": "helpdesk_ticket",
         "filter": { "id": { "dialect": "cel", "source": "record.id" } },
         "fields": { "ai_category": { "dialect": "cel", "source": "ai.ai_category" } } } }
   ]
   ```

   A function that writes where the platform cannot see declares it (project
   code, no JSON form):

   ```ts
   defineStack({ functions: { 'billing.sync': { handler: syncBilling, effect: 'writes' } } });
   ```

4. **A `select` is compared and written by its option `value`, never its
   label.** `condition: "record.status == 'Lost'"` parses, matches no row and
   never fires.

## Integrations are declared, not coded

A vendor system reachable over HTTP is a `connectors:` entry inside the app
(`provider: 'openapi' | 'mcp' | 'rest'`, a packaged spec,
`auth.credentialRef`), dispatched by `connector_action`. Never a plugin.
Recipes, credential hand-off, loader limits and the few cases that are
platform code: [references/integration-recipes.md](./references/integration-recipes.md).
