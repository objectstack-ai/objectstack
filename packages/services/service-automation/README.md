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

ObjectStack supports three types of flows:

### 1. Autolaunched Flows
Triggered automatically by record changes:

```typescript
const autoFlow = defineFlow({
  name: 'welcome_email',
  type: 'autolaunched',
  trigger: {
    object: 'user',
    when: 'after_insert',
  },
  steps: [
    {
      type: 'action',
      action: 'send_email',
      inputs: {
        to: '{!trigger.record.email}',
        subject: 'Welcome to ObjectStack!',
        body: 'Hello {!trigger.record.name}...',
      },
    },
  ],
});
```

### 2. Screen Flows
Interactive flows with user input:

```typescript
const screenFlow = defineFlow({
  name: 'create_opportunity',
  type: 'screen',
  steps: [
    {
      type: 'screen',
      fields: [
        { name: 'account_id', label: 'Account', type: 'lookup', object: 'account' },
        { name: 'amount', label: 'Amount', type: 'currency' },
        { name: 'close_date', label: 'Close Date', type: 'date' },
      ],
    },
    {
      type: 'record_create',
      object: 'opportunity',
      fields: {
        account_id: '{!screen.account_id}',
        amount: '{!screen.amount}',
        close_date: '{!screen.close_date}',
        stage: 'prospecting',
      },
    },
  ],
});
```

### 3. Scheduled Flows
Run on a schedule (cron syntax):

```typescript
const scheduledFlow = defineFlow({
  name: 'daily_report',
  type: 'scheduled',
  schedule: '0 9 * * *', // Every day at 9 AM
  steps: [
    {
      type: 'query',
      object: 'order',
      filters: [
        { field: 'created_at', operator: 'yesterday' },
      ],
      output: 'orders',
    },
    {
      type: 'action',
      action: 'send_email',
      inputs: {
        to: 'admin@company.com',
        subject: 'Daily Orders Report',
        body: 'Total orders: {!orders.length}',
      },
    },
  ],
});
```

## Flow Steps

### Record Operations

```typescript
// Create record
{
  type: 'record_create',
  object: 'contact',
  fields: {
    name: '{!input.name}',
    email: '{!input.email}',
  },
  output: 'new_contact',
}

// Update record
{
  type: 'record_update',
  object: 'account',
  recordId: '{!trigger.recordId}',
  fields: {
    status: 'active',
  },
}

// Delete record
{
  type: 'record_delete',
  object: 'task',
  recordId: '{!input.taskId}',
}
```

### Query Step

```typescript
{
  type: 'query',
  object: 'opportunity',
  filters: [
    { field: 'account_id', operator: 'eq', value: '{!trigger.record.account_id}' },
    { field: 'stage', operator: 'eq', value: 'closed_won' },
  ],
  sort: [{ field: 'amount', direction: 'desc' }],
  limit: 10,
  output: 'opportunities',
}
```

### Decision (Conditional) Step

```typescript
{
  type: 'decision',
  conditions: [
    {
      label: 'High Value',
      expression: '{!trigger.record.amount} > 10000',
      steps: [
        { type: 'action', action: 'notify_sales_manager' },
      ],
    },
    {
      label: 'Medium Value',
      expression: '{!trigger.record.amount} > 1000',
      steps: [
        { type: 'action', action: 'assign_to_sales_rep' },
      ],
    },
  ],
  defaultSteps: [
    { type: 'action', action: 'auto_approve' },
  ],
}
```

### Loop Step

```typescript
{
  type: 'loop',
  collection: '{!query_results}',
  variable: 'item',
  steps: [
    {
      type: 'record_update',
      object: 'task',
      recordId: '{!item.id}',
      fields: {
        status: 'completed',
      },
    },
  ],
}
```

### Custom Action Step

```typescript
{
  type: 'action',
  action: 'calculate_tax',
  inputs: {
    amount: '{!opportunity.amount}',
    region: '{!account.billing_region}',
  },
  output: 'tax_amount',
}
```

## Variable Expressions

Access variables in flow steps using `{!variable.path}` syntax:

```typescript
// Trigger record fields
'{!trigger.record.name}'
'{!trigger.record.account.industry}'

// Screen input
'{!screen.fieldName}'

// Query results
'{!query_results[0].name}'
'{!query_results.length}'

// Step outputs
'{!step_name.output_field}'

// System variables
'{!now}'
'{!today}'
'{!currentUser.id}'
```

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

### Parallel Execution

```typescript
const flow = defineFlow({
  name: 'parallel_processing',
  steps: [
    {
      type: 'parallel',
      branches: [
        {
          name: 'branch1',
          steps: [{ type: 'action', action: 'process_a' }],
        },
        {
          name: 'branch2',
          steps: [{ type: 'action', action: 'process_b' }],
        },
      ],
    },
  ],
});
```

### Error Handling

```typescript
{
  type: 'try_catch',
  trySteps: [
    { type: 'action', action: 'risky_operation' },
  ],
  catchSteps: [
    {
      type: 'action',
      action: 'send_error_notification',
      inputs: {
        error: '{!error.message}',
      },
    },
  ],
}
```

### Subflows

```typescript
{
  type: 'subflow',
  flowName: 'validate_address',
  inputs: {
    street: '{!input.street}',
    city: '{!input.city}',
  },
  output: 'validated_address',
}
```

### Wait Step

```typescript
{
  type: 'wait',
  duration: { hours: 24 },
  nextSteps: [
    { type: 'action', action: 'send_reminder' },
  ],
}
```

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
