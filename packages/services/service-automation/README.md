# @objectstack/service-automation

The shipped provider for the kernel's **`automation`** service slot — a DAG flow
execution engine implementing `IAutomationService`.

Slot criticality: `optional` (`ServiceRequirementDef` in `@objectstack/spec/system`).

## Installation

```bash
pnpm add @objectstack/service-automation
```

## Usage

The entry point is the kernel plugin `AutomationServicePlugin`. It seeds every
built-in node executor, so it is the only plugin an automation capability needs.

```typescript
import { LiteKernel } from '@objectstack/core';
import type { IAutomationService } from '@objectstack/spec/contracts';
import { AutomationServicePlugin } from '@objectstack/service-automation';

const kernel = new LiteKernel();
kernel.use(new AutomationServicePlugin());
await kernel.bootstrap();

const automation = kernel.getService<IAutomationService>('automation');
await automation.execute('escalate_high_priority_case', {
  object: 'crm_case',
  record: { id: 'case_1', priority: 'high' },
});
```

`LiteKernel.use()` is synchronous; `ObjectKernel.use()` returns a promise — await it there.

### Plugin options

Every field of `AutomationServicePluginOptions` is optional.

| Option | Type | Default | Purpose |
|:---|:---|:---|:---|
| `debug` | `boolean` | `false` | Debug logging for flow execution. |
| `armRuntime` | `boolean` | `true` | Bring up the runtime, not just the engine. `false` installs built-in nodes and fires `automation:ready`, then stops before anything is armed — no flow pull, no connector materialization, no wait-timer re-arm. |
| `suspendedRunStore` | `'auto' \| 'memory'` | `'auto'` | `'auto'` persists suspended runs to `sys_automation_run` when an ObjectQL engine is available; `'memory'` never persists. |
| `maxLogSize` | `number` | `DEFAULT_MAX_EXECUTION_LOG_SIZE` (1000) | In-memory execution-log ring buffer size. |
| `runSummaryLog` | `RunSummaryLogLevel` | `'info'` | Level for the one-line-per-terminal-run summary. Turning it down changes narration only — the summary is still computed, returned and persisted. |
| `runHistoryMaxPerFlow` | `number` | `DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW` (100) | Per-flow cap on terminal run-history rows; `0` disables the cap. |
| `credentialResolver` | `CredentialResolver` | env-var resolver | Resolves a declarative connector's `auth.credentialRef` at boot. |
| `packageRoot` | `string` | `process.cwd()` | Root that relative file refs in connector entries resolve against; reads are confined to it. |

The AGE half of run retention is declarative, not an option here: `sys_automation_run`
declares `retention: { maxAge: '30d', … }` and the platform LifecycleService enforces it.

## Flow Types

`type` declares how a flow starts:

| `type` | Starts when |
|:---|:---|
| `record_change` | a record is created / updated / deleted — bound on the `start` node |
| `schedule` | a cron schedule fires |
| `screen` | a user runs it interactively and supplies input |
| `autolaunched` | another flow, an action or an API call invokes it |
| `api` | it is exposed as an API-callable flow |

## Flow Structure

A flow is a **directed graph**: a flat list of `nodes` joined by a flat list of
`edges`. Nodes never contain child steps — branching, looping and error paths are
all expressed as edges between top-level nodes.

The record-change binding lives on the `start` node's `config`
(`{ objectName, triggerType, condition }`), not at the flow top level.

```typescript
const escalateCase = {
  name: 'escalate_high_priority_case',
  label: 'Escalate High Priority Case',
  type: 'record_change',
  version: 1,
  status: 'active',

  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'Start',
      config: {
        objectName: 'crm_case',
        triggerType: 'record-after-write', // created OR updated
      },
    },
    {
      id: 'check_priority',
      type: 'decision',
      label: 'Is High Priority?',
      // Conditions are bare CEL — no braces. Each `label` MUST match an
      // out-edge's `label` exactly, or the branch cannot route (#4414).
      config: {
        conditions: [
          { label: 'High', expression: "record.priority == 'high'" },
          { label: 'Otherwise', expression: 'true' },
        ],
      },
    },
    {
      id: 'load_owner',
      type: 'get_record',
      label: 'Load Owner',
      config: {
        objectName: 'sys_user',
        filter: { id: '{record.owner_id}' },
        fields: ['id', 'name', 'email'],
        outputVariable: 'owner',
      },
    },
    {
      id: 'flag_case',
      type: 'update_record',
      label: 'Flag Case',
      config: {
        objectName: 'crm_case',
        filter: { id: '{record.id}' },
        // Field values interpolate — braces required.
        fields: { escalated: true, escalation_note: 'Escalated to {owner.name}' },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],

  edges: [
    { id: 'e1', source: 'start', target: 'check_priority', type: 'default' },
    // Branching is an edge, not a nested step list. A decision routes by
    // matching its branch `label` to an out-edge `label`.
    { id: 'e2', source: 'check_priority', target: 'load_owner', label: 'High', type: 'conditional' },
    { id: 'e3', source: 'check_priority', target: 'end', label: 'Otherwise', type: 'conditional' },
    { id: 'e4', source: 'load_owner', target: 'flag_case', type: 'default' },
    { id: 'e5', source: 'flag_case', target: 'end', type: 'default' },
  ],
};
```

## Node Types

The built-in node type ids (`FLOW_BUILTIN_NODE_TYPES`, from `FlowNodeAction` in
`@objectstack/spec`):

`start` · `end` · `decision` · `assignment` · `loop` · `create_record` ·
`update_record` · `delete_record` · `get_record` · `http` · `notify` · `script` ·
`screen` · `wait` · `subflow` · `map` · `connector_action` · `parallel_gateway` ·
`join_gateway` · `boundary_event`

`type` is validated against the **live action registry** at `registerFlow()`, not
against a closed enum, so plugin-registered node types are equally legal.

The registry is also why `FlowNodeAction` is not the whole list: the ADR-0031
structured constructs **`parallel`** and **`try_catch`** ship built-in executors
(`builtin/parallel-node.ts`, `builtin/try-catch-node.ts`) without appearing in
that enum. See [Advanced Features](#advanced-features) below.

The CRUD quartet's `config` — the shape most often written from memory, and the
one this README used to get wrong:

| Node | `config` keys |
|:---|:---|
| `get_record` | `objectName`, `filter`, `fields`, `limit`, `outputVariable` |
| `create_record` | `objectName`, `fields`, `outputVariable` |
| `update_record` | `objectName`, `filter`, `fields` — **no** `outputVariable`; the executor does not read one |
| `delete_record` | `objectName`, `filter` |

`filter` is an **object** of field/value pairs (`{ id: '{record.id}' }`), not an
array of `{ field, operator, value }` triples; operator objects such as
`{ "$ne": null }` are legal values. There is no `recordId` key — select by id
through `filter`. Unknown keys are rejected at `registerFlow()`.

For every other node's `config`, and for loops, parallel blocks, subflows, waits
and error handling, see the maintained reference — **[Flows](https://docs.objectstack.ai/docs/automation/flows)**.
This README deliberately does not keep a second copy of that per-node reference.

## Expressions

A flow mixes **two dialects**, and the rule is short: **every condition is CEL;
braces are for values.**

| Where | Dialect | Write it like |
|:---|:---|:---|
| Start-node `condition` | CEL — bare, no braces | `record.amount > 500` |
| Edge `condition` | CEL — bare, no braces | `record.status == 'open'` |
| Decision `conditions[].expression` | CEL — bare, no braces | `order_amount > 10000` |
| Field values in `create_record` / `update_record` | Interpolation — braces required | `'Follow up on {record.name}'`, `'{TODAY() + 7}'` |

Value bindings: `{var}`, `{var.path}`, `{$User.Id}`, `{$User.Email}`, `{NOW()}`,
`{TODAY()}`, `{TODAY() + 90}`.

The two failure modes to memorize:

1. **Braces missing in a field value** — `due_date: 'TODAY() + 7'` writes the
   literal text into the field. Write `'{TODAY() + 7}'`.
2. **Braces put *into* a condition** — `'{record.amount} > 500'`. Since #4336
   conditions reject this loudly: `registerFlow()` / `objectstack validate`
   refuse the flow with a CEL error naming the reference. Before that they were
   compared as text and were silently always-true or always-false.

There is no `{!…}` dialect. That is Salesforce syntax; the platform has never
parsed it.

## Service API

`IAutomationService` (from `@objectstack/spec/contracts`) declares two required members
and a set of optional ones; this package implements them all.

```typescript
import type { IAutomationService } from '@objectstack/spec/contracts';

// required
//   execute(flowName, context?)          -> Promise<AutomationResult>
//   listFlows()                          -> Promise<string[]>
// optional
//   registerFlow?(name, definition)      -> void
//   unregisterFlow?(name)                -> void
//   getFlow?(name)                       -> Promise<FlowParsed | null>
//   toggleFlow?(name, enabled)           -> Promise<void>
//   listRuns?(...)                       -> run history
//   getRun?(runId)                       -> Promise<ExecutionLog | null>
//   resume?(runId, signal?)              -> Promise<AutomationResult>
//   listSuspendedRuns?()                 -> suspended-run summaries
//   getSuspendedScreen?(runId)           -> Promise<ScreenSpec | null>
//   getActionDescriptors?()              -> ActionDescriptor[]
//   getConnectorDescriptors?()           -> ConnectorDescriptor[]
//   getFlowRuntimeStates?()              -> FlowRuntimeState[]
//   canonicalizeStoredFlow?(name, definition)
```

### Execute a flow

`execute` takes the flow's **machine name** and an optional `AutomationContext` — it
does not take an options object, and there is no `inputs` key.

```typescript
const result = await automation.execute('escalate_high_priority_case', {
  record: { id: 'case_1', priority: 'high' },
  object: 'crm_case',
  event: 'on_update',
  userId: 'usr_123',
});

if (result.success) {
  console.log('output:', result.output, 'in', result.durationMs, 'ms');
} else {
  console.error('failed:', result.error, result.code);
}
```

`AutomationResult` fields: `success`, `output?`, `error?`, `durationMs?`, `code?`,
`status?`, `runId?`, `screen?`, `successMessage?`, `errorMessage?`, `summary?`. The
machine-readable classification is `code` (not `errorCode`) — resume refusals such as
`RUN_NOT_FOUND`, `STORE_UNAVAILABLE`, `RESUME_IN_PROGRESS`, plus the trigger-time
`FLOW_DISABLED` / `FLOW_NO_START_NODE`.

⚠️ `runAs` on `AutomationContext` is derived by the engine from the flow definition —
callers do not set it.

### Register and inspect flows

```typescript
automation.registerFlow?.('escalate_high_priority_case', escalateCase);

const names = await automation.listFlows();     // string[] of machine names
const parsed = await automation.getFlow?.('escalate_high_priority_case');
await automation.toggleFlow?.('escalate_high_priority_case', false);
```

`registerFlow` validates against the live action registry and rejects unknown `config`
keys. There is no `registerTrigger` method — a flow's trigger is declared on its `start`
node (`record_change`) or by its `type`, and arming happens at registration.

## REST API

Served by the runtime dispatcher's `/automation` domain when this service occupies the
slot (paths shown with the `/api/v1` wire prefix):

```
GET    /api/v1/automation                              # list flows
POST   /api/v1/automation                              # create a flow
GET    /api/v1/automation/actions                      # action descriptors
GET    /api/v1/automation/connectors                   # connector descriptors
GET    /api/v1/automation/_status                      # runtime status
GET    /api/v1/automation/:name                        # get one flow
PUT    /api/v1/automation/:name                        # update a flow
DELETE /api/v1/automation/:name                        # delete a flow
POST   /api/v1/automation/:name/trigger                # execute a flow
POST   /api/v1/automation/:name/toggle                 # enable / disable
GET    /api/v1/automation/:name/runs                   # list runs
GET    /api/v1/automation/:name/runs/:runId            # run detail
GET    /api/v1/automation/:name/runs/:runId/screen     # screen spec of a parked run
POST   /api/v1/automation/:name/runs/:runId/resume     # resume a parked run
POST   /api/v1/automation/trigger/:name                # legacy execute shape
```

## Advanced Features

`loop`, `parallel` and `try_catch` are **structured control-flow constructs**
(ADR-0031). Each owns its body as a single-entry/single-exit **region** carried in
`config` — a nested `{ nodes, edges }` sub-graph, *not* a `steps` array — so the
outer graph stays acyclic. A region runs in the enclosing variable scope; the
container's ordinary out-edges are the continuation.

### Loop

```typescript
{
  id: 'notify_each',
  type: 'loop',
  label: 'For each task',
  config: {
    collection: '{tasks}',      // template/variable resolving to an array
    iteratorVariable: 'task',   // current item, visible inside the body
    indexVariable: 'i',         // optional zero-based index
    maxIterations: 500,         // hard cap (clamped to the engine ceiling)
    body: {
      nodes: [{ id: 'send', type: 'notify', label: 'Notify', config: { /* … */ } }],
      edges: [],
    },
  },
}
```

### Parallel Execution

Branches run concurrently and join implicitly when all complete — there is no
author-visible split/join gateway.

```typescript
{
  id: 'fan_out',
  type: 'parallel',
  label: 'Notify in parallel',
  config: {
    branches: [ // ≥ 2 regions
      { name: 'Email', nodes: [{ id: 'email', type: 'notify', label: 'Email', config: { /* … */ } }], edges: [] },
      { name: 'Slack', nodes: [{ id: 'slack', type: 'notify', label: 'Slack', config: { /* … */ } }], edges: [] },
    ],
  },
}
```

### Error Handling

```typescript
{
  id: 'guarded',
  type: 'try_catch',
  label: 'Charge with fallback',
  config: {
    try: { nodes: [{ id: 'charge', type: 'http', label: 'Charge', config: { /* … */ } }], edges: [] },
    catch: { nodes: [{ id: 'flag', type: 'update_record', label: 'Flag failure', config: { /* … */ } }], edges: [] },
    errorVariable: '$error',
    retry: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
  },
}
```

### Subflows

```typescript
{
  id: 'validate',
  type: 'subflow',
  label: 'Validate Address',
  config: {
    flowName: 'validate_address',
    input: { street: '{input.street}', city: '{input.city}' },
    outputVariable: 'validated_address',
  },
}
```

### Wait

`wait` suspends the run durably. Its contract is the node-level
`waitEventConfig` block — **not** `config`:

```typescript
{
  id: 'hold',
  type: 'wait',
  label: 'Wait 24h',
  waitEventConfig: {
    eventType: 'timer',          // 'timer' | 'signal' | 'webhook' | 'manual' | 'condition'
    timerDuration: 'PT24H',      // ISO 8601 duration
  },
}
```

The node resumes down its ordinary out-edges; there is no `nextSteps` key.

> BPMN `parallel_gateway` / `join_gateway` / `boundary_event` remain in the
> protocol as the **interop** representation and map onto these constructs on
> import/export — they are not the native authoring model.

## Best Practices

1. **Keep Flows Simple**: Break complex logic into multiple flows
2. **Use Descriptive Names**: Name flows and steps clearly
3. **Handle Errors**: Always include error handling for critical operations
4. **Test Thoroughly**: Test flows with various input scenarios
5. **Monitor Performance**: Track flow execution times and optimize slow flows
6. **Version Control**: Store flow definitions in version control
7. **Document Intent**: Add descriptions to flows and steps

## Performance Considerations

- **Parallel Execution**: DAG engine automatically parallelizes independent steps
- **Batch Processing**: Use loop steps efficiently for large collections
- **Query Optimization**: Filter queries early to reduce data volume
- **Async Execution**: Long-running flows execute asynchronously

## Exports

```typescript
import {
  AutomationEngine, AutomationServicePlugin, createPackageFileLoader,
  InMemorySuspendedRunStore, ObjectStoreSuspendedRunStore, SysAutomationRun,
  installBuiltinNodes, registerLogicNodes, registerCrudNodes,
  registerScreenNodes, registerHttpNodes, registerConnectorNodes,
  resolveRunDataContext, stampSystemInsertOwner, UnscopedRunDataAccessError,
  summarizeRun, formatRunSummaryLine,
  DEFAULT_MAX_EXECUTION_LOG_SIZE, DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW,
  MAX_PERSISTED_HISTORY_STEPS,
} from '@objectstack/service-automation';
```

Types: `AutomationEngineOptions`, `AutomationServicePluginOptions`, `RunSummaryLogLevel`,
`NodeExecutor`, `NodeExecutionResult`, `SuspensionRelease`, `SuspensionReleaseReason`,
`FlowTrigger`, `FlowTriggerBinding`, `RegisteredConnector`, `SuspendedRun`,
`SuspendedRunStore`, `SuspendedRunStoreEngine`, `ObjectStoreSuspendedRunStoreOptions`,
`RunRecord`, `StepLogEntry`, `UnknownNodeTypeAuditEntry`, `RunDataContext`,
`RunIdentityContext`, `RunProvenanceContext`, `ConnectorProviderFactory`,
`ConnectorProviderContext`, `ConnectorMaterialization`, `ConnectorMaterializationHandler`,
`ConnectorOrigin`, `ConnectorState`, `ConnectorDescriptor`, `ConnectorActionDescriptor`,
`ConnectorActionHandler`, `ConnectorActionContext`.

The connector types are re-exports from `@objectstack/spec/integration` — connector
plugins should import them from there rather than coupling to this engine.

`AutomationEngine` is the engine underneath the plugin, exported for hosts that build
their own kernel integration; `AutomationServicePlugin` is the entry point for everyone
else. The built-in node installers are functions, not plugins — the platform's
foundational nodes are built in, not installed.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [@objectstack/spec/automation](../../spec/src/automation/)
- [Automation](https://docs.objectstack.ai/docs/automation) — the automation docs section: hooks, flows,
  workflows, approvals, webhooks, connectors
- [Automation Protocol](https://docs.objectstack.ai/docs/references/automation) — the complete schema
  reference for the automation protocol
