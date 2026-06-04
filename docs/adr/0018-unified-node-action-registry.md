# ADR-0018: Unified Node/Action Registry across Flow, Workflow-Rule & Approval

**Status**: Accepted (2026-05-31) — M1–M3 implemented; M4 framework-side complete (designer config-forms tracked in `../objectui`); M5 **dropped** (Workflow-Rule→Flow compiler removed per [ADR-0019](./0019-approval-as-flow-node.md); approval execution converged via the approval Flow node, not a compiler). The `workflow_rule` authoring paradigm is retired.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (one Zod source of truth per metadata type), [ADR-0012](./0012-notification-platform.md) (generalized outbox in `service-messaging`)
**Consumers**: `@objectstack/spec` (`automation/`), `@objectstack/services/service-automation`, `@objectstack/plugins/plugin-approvals`, `@objectstack/plugins/plugin-webhooks` → `service-messaging`, every plugin that registers a node executor, `../objectui` (`plugin-workflow` designer)

---

## TL;DR

The platform ships **three authoring paradigms** for business logic — visual **Flow** (canvas), declarative **Workflow Rules**, and **Approval Processes** — plus a graphical **designer** in `../objectui`. Each one independently hardcodes a *closed* list of the node/action types it understands. The four lists do not agree, and none of them is the runtime's actual extension point.

The result: the same outbound concept ("call an HTTP endpoint" / "notify a human") appears under **five different names** across the codebase, the designer can paint nodes the engine cannot execute, and a plugin that registers a brand-new node type is silently rejected by spec validation and never appears in the palette — directly defeating the plugin mechanism this platform is built on.

This ADR proposes **one registry-backed node/action contract** that all three paradigms and the designer consume. The runtime registry is already open (`registerNodeExecutor(type: string)`); we make the **protocol** and the **designer** consumers of it instead of parallel closed enums. We also **consolidate the duplicated outbound verbs** onto two shared executors (`http` / `notify`) backed by the ADR-0012 outbox, which closes the reliability gap where `http_request` today is a bare `fetch()` with no retry.

---

## Context

### The platform has many processes, by design

This is not an accident to be "fixed" by collapsing everything into one engine. Salesforce ships Flow + Workflow Rules + Approval Processes + Process Builder as distinct paradigms for distinct personas, and ObjectStack mirrors that. Multiple **authoring** paradigms are correct. What is *not* correct is that each paradigm reinvents the **execution vocabulary** beneath it.

### The four divergent vocabularies (evidence)

| Subsystem | Protocol | Runtime | Node/action vocabulary | "outbound" verbs |
|:---|:---|:---|:---|:---|
| **Flow (canvas)** | `automation/flow.zod.ts` → `FlowNodeAction` (**closed `z.enum`**) | ✅ `service-automation` (partial) | start, end, decision, assignment, loop, get/create/update/delete_record, **http_request**, script, screen, wait, subflow, connector_action, parallel_gateway, join_gateway, boundary_event | `http_request` |
| **Workflow Rules** | `automation/workflow.zod.ts` → `WorkflowAction` (closed `discriminatedUnion`) | ❌ **none — spec-only** | field_update, email_alert, **http_call**, task_creation, push_notification, custom_script, connector_action | `http_call`, `email_alert`, `push_notification` |
| **Approval Process** | `automation/approval.zod.ts` → `ApprovalActionType` (closed `z.enum`) | ✅ `plugin-approvals` (partial) | field_update, email_alert, **webhook**, script, connector_action, **inbox_notify** | `webhook`, `inbox_notify`, `email_alert` |
| **Designer** | `../objectui` `types/workflow.ts` → `FlowNodeType` (closed union) | — (UI only) | task, user_task, service_task, script_task, approval, condition, parallel_gateway, join_gateway, boundary_event, delay, **notification**, **webhook** | `notification`, `webhook` |
| *(planned)* Notification | [ADR-0012](./0012-notification-platform.md) | `service-messaging` | — | `notify` |

The same "send something outbound" concept has **five names**: `http_request`, `http_call`, `webhook`, `notification`, `notify`. "Notify a human" has four: `inbox_notify`, `push_notification`, `notification`, `email_alert`.

### Three concrete failures this causes

1. **Plugin extensibility is broken at the protocol layer.** The runtime engine is *already* an open registry — `registerNodeExecutor(executor)` keys on a free `string` type, and `getRegisteredNodeTypes()` enumerates them (`service-automation/src/engine.ts`). But `registerFlow()` runs `FlowSchema.parse(definition)`, and `FlowNodeSchema.type` is the **closed** `FlowNodeAction` enum. A plugin that registers a new executor type produces flows that **fail spec validation**. The open runtime is locked shut by a closed protocol.

2. **The designer paints what the engine can't run.** `TOOLBAR_NODE_TYPES` in `plugin-workflow/src/FlowDesigner.tsx` is hardcoded, and its `FlowNodeType` vocabulary (BPMN-flavored: `task` / `service_task` / `notification` / `webhook`) matches *neither* `flow.zod.ts` *nor* the runtime executors (`decision`, `http_request`, `create_record`, …). A `notification` node dragged onto the canvas has **no executor** behind it. A plugin-registered node type **never appears in the palette**.

3. **The reliability machinery is built once and reused nowhere.** `plugin-webhooks` has the durable outbox / exponential retry / cluster-lock / dead-letter (per ADR-0012 §"What plugin-webhooks already provides"). Yet Flow's `http_request` executor is a bare `fetch()` with no retry, no idempotency, no outbox (`service-automation/src/builtin/http-nodes.ts`). Workflow Rules' `http_call` has no runtime at all. Approval's `webhook` action is a third implementation. Four would-be HTTP callers, zero sharing the one reliable substrate.

### The answer already half-exists and is unused

`automation/node-executor.zod.ts` already defines **`NodeExecutorDescriptor`** — `id`, `name`, `nodeTypes`, `version`, `supportsPause`, `supportsCancellation`, `supportsRetry`, `configSchemaRef`. This is exactly the "plugin contributes a node type, with metadata" shape. Today it is an orphan: nothing registers one, and the designer does not read it. The fix is largely to **promote and wire what is already specified**, not to invent a new abstraction.

---

## Decision

Adopt a single **registry-backed node/action contract**. The runtime executor registry is the source of truth; the protocol and the designer become its consumers. Concretely:

1. **Protocol stops hardcoding.** Promote `NodeExecutorDescriptor` to the canonical, cross-paradigm **Action descriptor**. Replace the three closed enums with "built-in descriptors + open extension". `FlowNodeSchema.type` becomes a validated `string` (checked against the registry at parse time), not a frozen enum.
2. **Runtime publishes descriptors and consolidates outbound verbs.** Each executor upgrades from `{ type, execute }` to also publish a descriptor. The five outbound names collapse onto **one `http` (callout) executor and one `notify` executor**, the latter backed by the ADR-0012 `service-messaging` outbox. Flow, Workflow Rules, and Approval all invoke the same two.
3. **Designer renders from the registry.** The palette is populated from descriptors (label / icon / category / config schema), not a hardcoded list. The BPMN shape vocabulary is demoted to a presentation/`bpmn-interop` concern, not the authoring vocabulary.
4. **Workflow Rules compile to Flow.** Do not build a fourth runtime. The declarative rule becomes a simplified authoring view that compiles down to Flow nodes over the same executor registry.

This is **not** "change the protocol *or* the frontend" — both change, in that order, because the deep fix is the contract. Fixing the frontend first would re-freeze today's wrong vocabulary.

---

## Proposed Design

### 1. The unified Action descriptor

Extend the existing `NodeExecutorDescriptor` (`automation/node-executor.zod.ts`) with the metadata a palette and a config form need, and the capability flags the dispatcher needs:

```ts
// automation/node-executor.zod.ts  (extended)
export const ActionDescriptorSchema = z.object({
  // ── identity ───────────────────────────────────────────────
  type:        z.string(),                 // 'http' | 'notify' | 'create_record' | plugin-defined
  version:     z.string(),                 // semver of the executor
  name:        z.string(),                 // human label (i18n key)
  description: z.string().optional(),

  // ── palette presentation (NEW — was missing) ──────────────
  icon:        z.string().optional(),      // icon id resolved by the designer
  category:    z.enum(['logic','data','io','human','control','custom']).default('custom'),
  paradigms:   z.array(z.enum(['flow','workflow_rule','approval']))
                 .default(['flow']),       // which authoring surfaces may offer this action

  // ── config contract (NEW — drives Studio form + parse validation) ──
  configSchema: z.unknown().optional(),    // JSON Schema (compiled from the executor's Zod)

  // ── capabilities (existing + reliability) ─────────────────
  supportsPause:        z.boolean().default(false),
  supportsCancellation: z.boolean().default(false),
  supportsRetry:        z.boolean().default(true),
  needsOutbox:          z.boolean().default(false),  // true → dispatch via service-messaging
  isAsync:              z.boolean().default(false),  // request/response that suspends the flow
});
```

> One Zod source per metadata type (Prime Directive 8 / ADR-0005): this *is* that one source for "what a node/action is". `FlowNodeAction`, `WorkflowAction`, and `ApprovalActionType` stop being independent truths and become **seed descriptor sets** registered at boot.

### 2. Open the protocol's node type

```ts
// automation/flow.zod.ts
// BEFORE: type: FlowNodeAction  (closed enum — rejects plugin types)
// AFTER:
export const FlowNodeSchema = lazySchema(() => z.object({
  id:    z.string(),
  type:  z.string().describe('Action type — validated against the action registry at registerFlow()'),
  label: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
  // …unchanged…
}));
```

`FlowNodeAction` is **retained as an exported const array of built-in type ids** (documentation + the seed set), but it no longer gates `type`. Validation moves from "is it in this enum" to "is it a registered action type, and does `config` satisfy that action's `configSchema`" — performed in `registerFlow()` against the live registry. This is the only way a plugin-registered node can ever be a legal flow.

### 3. Runtime: descriptor-publishing executors + the registry as truth

`NodeExecutor` gains an optional `descriptor`:

```ts
export interface NodeExecutor {
  readonly type: string;
  readonly descriptor?: ActionDescriptor;   // NEW — published into the registry
  execute(node, variables, context): Promise<NodeExecutionResult>;
}
```

`AutomationEngine` already exposes `getRegisteredNodeTypes()`; add `getActionDescriptors(): ActionDescriptor[]`. This single method backs both **flow validation** (server side) and the **designer palette** (an API: `GET /api/v1/automation/actions`).

### 4. Consolidate the outbound verbs

Two executors replace the five names:

| New executor | Replaces | Backed by | Notes |
|:---|:---|:---|:---|
| `http` | Flow `http_request`, Workflow-Rule `http_call`, Approval `webhook` | `service-messaging` outbox (ADR-0012) | `needsOutbox: true`, `supportsRetry: true`. Sync request/response variant sets `isAsync: true` and suspends the flow via the existing `wait` pause/resume seam. |
| `notify` | Workflow-Rule `push_notification`, Approval `inbox_notify`, designer `notification`, ADR-0012 `notify` | `service-messaging` channels | Channel selection (inbox/email/push) handled by the notification platform, not by N node types. |

Both are registered once and offered to all three paradigms via `descriptor.paradigms`. **This is where the `http_request`-has-no-retry gap closes**: HTTP becomes an outbox-backed executor, so every paradigm inherits retry / idempotency / dead-letter for free, exactly as ADR-0012 intended for `notify`.

Migration aliases keep old flows valid: the registry registers `http_request` / `http_call` / `webhook` as **deprecated aliases** of `http` for one major version (same pattern ADR-0012 uses for `plugin-email`).

### 5. Designer: palette from the registry

In `../objectui` `plugin-workflow`:

* Delete the hardcoded `FlowNodeType` union and `TOOLBAR_NODE_TYPES`.
* Fetch `GET /api/v1/automation/actions`; render the palette grouped by `descriptor.category`, labeled by `name`/`icon`.
* Generate each node's config form from `descriptor.configSchema` (the platform already does JSON-Schema-driven form generation elsewhere).
* The BPMN node shapes (`task`/`service_task`/gateways/`boundary_event`) become a **rendering/export** concern owned by `bpmn-interop`, decoupled from the authoring action list. A plugin node renders with its declared icon; it does not need a bespoke BPMN shape.

### 6. Workflow Rules → Flow compiler

`WorkflowAction` (declarative) compiles to a small Flow graph over the shared executors:

```
on_update(condition) ──► [ http ] ──► [ notify ] ──► [ field_update→update_record ] ──► end
```

No fourth engine. Workflow Rules stays a **simplified authoring view** for business users; execution, reliability, and observability are Flow's. This matches the industry trajectory (Salesforce is retiring Workflow Rules in favor of Flow) and means every fix to the executor registry benefits all three surfaces at once.

---

## Migration

| Step | Change | Compatibility |
|:---|:---|:---|
| M1 ✅ | Add canonical `ActionDescriptorSchema` (+ `defineActionDescriptor`) alongside the legacy `NodeExecutorDescriptor`; `FlowNodeSchema.type` → validated `string` (with `FlowNodeAction`/`FLOW_BUILTIN_NODE_TYPES` retained as the seed set); `registerFlow()` soft-validates node types against the live registry (warn, don't hard-fail). | **Shipped.** Existing flows keep validating (built-in types seed-registered); plugin-registered node types are now legal flow nodes. |
| M2 (partial ✅) | Built-in nodes (logic/crud/http/screen) publish descriptors and are **folded into the core `AutomationServicePlugin`** (seeded via `installBuiltinNodes()`), so `automation` is a self-contained capability — no companion node-pack plugins, no `extras` in the capability loader. `connector_action` dropped from the baseline (an integration concern needing a connector registry the platform doesn't ship; left to the integration layer / marketplace plugins via the still-open `registerNodeExecutor()`). Descriptors tagged `source: 'builtin'` vs `'plugin'`. `AutomationEngine.getActionDescriptors()`/`getActionDescriptor()` + optional `IAutomationService.getActionDescriptors()`. `GET /api/v1/automation/actions` shipped via `HttpDispatcher.handleAutomation` (`?paradigm`/`?source`/`?category` filters; `AutomationActionsResponseSchema` in spec; declarative entry in `DEFAULT_AUTOMATION_ROUTES`). | Additive; built-in flows keep working from the core plugin alone. Hosts that hand-assembled the four `*NodesPlugin` classes drop them (the classes are gone). |
| M3 ✅ | Canonical `http` + `notify` executors backed by `service-messaging` (HTTP outbox `sys_http_delivery` / notification outbox); `http_request`/`http_call`/`webhook` registered as **deprecated aliases** (`registerNodeAlias`, `needsOutbox`). | **Shipped.** Old node types keep running via alias; degrade to inline when no outbox is wired. |
| M4 (framework ✅) | Hardcoded `FlowNodeType` removed (M1 turned `FlowNodeSchema.type` into a validated string seeded from `FLOW_BUILTIN_NODE_TYPES`); `GET /automation/actions` drives the palette. Remaining: designer config-forms rendered from `descriptor.configSchema` — tracked in `../objectui`. | Framework carries no closed node enum; old saved graphs still load. |
| ~~M5~~ **Dropped** | Workflow-Rule → Flow compiler **removed** — there is no declarative Workflow-Rule authoring type to compile (Workflow Rules removed in #1398; `workflow` reclaimed for state machines, ADR-0020). The `workflow_rule` paradigm tag is retired from `ActionParadigmSchema` and all descriptors. Approval execution convergence is delivered by [ADR-0019](./0019-approval-as-flow-node.md) (approval is a durable-pause Flow node; side-effects run on the shared `http`/`notify` executors), not a compiler. | No legacy to migrate (greenfield). |

---

## Consequences

**Positive**
* A plugin that registers an executor is *automatically* a legal flow node **and** appears in the designer palette — the plugin mechanism finally works end to end.
* One reliable HTTP path and one notify path; retry/outbox/dead-letter built once, inherited everywhere (closes the `http_request` reliability gap and folds in ADR-0012's `notify`).
* The four vocabularies converge to one registry; "five names for one concept" goes away.
* Studio observability (ADR-0012 §13 Deliveries/Dead-letter) automatically covers Flow and Approval HTTP/notify, not just notifications.

**Negative / risks**
1. **Parse-time validation now depends on the live registry.** A flow authored against a plugin that is later disabled fails validation. Mitigation: validate with a "known types" snapshot + warn (not hard-fail) on unknown types, mirroring `flow.form.ts` errorHandling (`fail | retry | continue`).
2. **Designer rewrite touches `../objectui`** (separate repo / release train). Phased: registry API ships first; the palette can read it before the hardcoded list is deleted.
3. **Async HTTP (request/response) needs the pause/resume seam.** The `wait` executor / `node-executor.zod.ts` resume payload already exists; the `http` executor's `isAsync` path reuses it rather than inventing suspension.
4. **JSON Schema ⇆ Zod round-trip** for `configSchema`. Compile Zod → JSON Schema at descriptor publish time (build step), don't hand-maintain both.

---

## Open questions

1. Does `connector_action` (the one verb already present in all three paradigms) become the *general* extension action, with `http`/`notify` as well-known specializations — or stay peer-level? Leaning: keep peer-level; `connector_action` targets a registered connector, `http` is raw.
2. Should `screen` / `user_task` (human-input nodes) carry their own descriptor category (`human`) that the runtime treats as always-`isAsync`? Likely yes.
3. Where does the action registry live for **cross-environment** consistency — is it per-environment (a plugin enabled in env A but not B yields different palettes)? Tie to the package/environment model (ADR-0006).

---

## Addendum (2026-05-31): `connector_action` is baseline generic dispatch

> Status of this addendum: **implemented.** This re-scopes the §Migration M2 note and resolves §Open-questions #1. The baseline registry + `connector_action` executor ship in `service-automation`, with `@objectstack/connector-rest` as the first concrete connector plugin.

### Decision

`connector_action` is promoted to a **built-in (`source: 'builtin'`) baseline node**, the generic-dispatch counterpart to `http_request`:

- where `http_request` calls **any raw URL**, `connector_action` invokes **any registered connector's declared action**;
- the engine ships the dispatch node **plus an initially-empty connector registry** (`registerConnector` / `resolveConnectorAction` / `getRegisteredConnectors`);
- **concrete** connectors (`@objectstack/connector-rest`, `connector-slack`, `connector-salesforce`, …) remain **plugins** that populate the registry at runtime.

This is the **mechanism/policy split**: the *mechanism* (registry + dispatch node) is baseline; the *concrete integrations* (and their credentials/lifecycle) are not. It mirrors the ADR-0015 datasource split — federation contract is in the open framework, managed connection lifecycle lives outside it.

### Why this reverses M2's "connector_action dropped from baseline"

M2 dropped `connector_action` because it would need "a connector registry the platform doesn't ship." That is circular: the registry is the missing piece, and an **empty** registry is zero-dependency and zero-cost. The protocol already commits to the node — `connector_action` is in `FLOW_BUILTIN_NODE_TYPES` and `connectorConfig {connectorId, actionId, input}` is already a `FlowNode` field — but ships **no executor**, so any flow referencing it fails at execution. Shipping the empty registry + dispatch executor closes that spec/runtime gap without pulling any concrete integration into the core.

### Resolves Open-question #1

The leaning ("keep peer-level") is **overturned for the dispatch direction, kept for the verbs**: `connector_action` *does* become the general connector-extension action, while `http`/`notify` stay **peer-level raw verbs** (not specializations of it). `http_request` calls a URL with no registration; `connector_action` calls a registered, named capability. Both are baseline; neither is implemented in terms of the other.

### Graceful degradation

Because the registry starts empty, a flow that references a connector no plugin has registered **fails that step with a clear error** (`no handler for '<id>.<action>' — is the connector plugin registered?`) rather than failing to register the flow — the same fail-soft posture `http_request` takes on a bad URL.

### Out of scope (deliberately not baseline)

Managed credentials/secret vault, OAuth2 token refresh, multi-tenant connection lifecycle, and a connector marketplace are **not** part of this mechanism — they are the enterprise tier, on the ADR-0015 precedent. The open framework ships the contract + dispatch + an in-process registry only.

### Implementation checklist

- [x] `AutomationEngine`: connector registry (`registerConnector` / `unregisterConnector` / `resolveConnectorAction` / `getRegisteredConnectors`) + `ConnectorActionHandler` / `ConnectorActionContext` types.
- [x] `builtin/connector-nodes.ts`: `connector_action` executor + descriptor (`category: 'io'`, `source: 'builtin'`, `paradigms: ['flow','approval']`), wired into `installBuiltinNodes()`. The core plugin now seeds 11 baseline node types (was 10).
- [x] First concrete plugin `@objectstack/connector-rest` (the reference connector) validating the registry — `request` action, static auth (`none`/`api-key`/`basic`/`bearer`), no OAuth2 refresh.
- [x] Tests: baseline dispatch (fake connector) + REST plugin auth-header injection + end-to-end kernel boot (both plugins → `connector_action` flow → REST handler).
