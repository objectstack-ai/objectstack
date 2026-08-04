# @objectstack/service-automation

Automation Service for ObjectStack — implements `IAutomationService` with plugin-based DAG (Directed Acyclic Graph) flow execution engine.

## Features

- **Flow Execution Engine**: Execute multi-step automation flows with conditional logic
- **DAG-based Architecture**: Flows are represented as directed acyclic graphs for parallel execution
- **Trigger System**: Launch flows automatically on record changes, schedule, or manual invocation
- **Variable Management**: Pass data between flow steps with type-safe variables
- **Error Handling**: Built-in retry logic, error branches, and rollback support
- **Visual Flow Builder**: Compatible with Studio's visual flow designer
- **Type-Safe**: Full TypeScript support with flow definition validation

## Installation

```bash
pnpm add @objectstack/service-automation
```

## Basic Usage

```typescript
import { defineStack, defineFlow } from '@objectstack/spec';
import { ServiceAutomation } from '@objectstack/service-automation';

const stack = defineStack({
  services: [ServiceAutomation.configure()],
});
```

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
and error handling, see the maintained reference — **[Flows](/content/docs/automation/flows.mdx)**.
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

```typescript
// Get automation service
const automation = kernel.getService<IAutomationService>('automation');
```

### Execute Flow

```typescript
// Execute a flow manually
const result = await automation.executeFlow({
  flowName: 'create_opportunity',
  inputs: {
    account_id: '123',
    amount: 50000,
  },
});

// Check execution status
if (result.status === 'success') {
  console.log('Flow completed:', result.outputs);
} else {
  console.error('Flow failed:', result.error);
}
```

### Flow Management

```typescript
// Get flow definition
const flow = await automation.getFlow('welcome_email');

// List all flows
const flows = await automation.listFlows();

// Get flow execution history
const history = await automation.getFlowHistory({
  flowName: 'daily_report',
  limit: 100,
});
```

### Trigger Management

```typescript
// Register a custom trigger
automation.registerTrigger({
  name: 'on_payment_received',
  description: 'Triggered when a payment is received',
  async handler(context) {
    // Trigger logic
    return {
      record: context.payment,
      timestamp: new Date(),
    };
  },
});
```

## REST API Endpoints

```
POST   /api/v1/automation/flows/:name/execute     # Execute flow
GET    /api/v1/automation/flows                   # List flows
GET    /api/v1/automation/flows/:name             # Get flow definition
GET    /api/v1/automation/flows/:name/history     # Get execution history
POST   /api/v1/automation/triggers/:name          # Trigger a flow
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

## Contract Implementation

Implements `IAutomationService` from `@objectstack/spec/contracts`:

```typescript
interface IAutomationService {
  executeFlow(options: FlowExecutionOptions): Promise<FlowResult>;
  getFlow(name: string): Promise<Flow>;
  listFlows(filter?: FlowFilter): Promise<Flow[]>;
  getFlowHistory(options: FlowHistoryOptions): Promise<FlowExecution[]>;
  registerTrigger(trigger: TriggerDefinition): void;
}
```

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [@objectstack/spec/automation](../../spec/src/automation/)
- [Flow Builder Guide](/content/docs/automation/)
- [Trigger Reference](/content/docs/references/automation/)
