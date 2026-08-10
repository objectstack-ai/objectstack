# @objectstack/client

The official TypeScript client for ObjectStack.

## Features

- **Auto-Discovery**: Connects to your ObjectStack server and automatically configures API endpoints.
- **Typed Metadata**: Retrieve Object and View definitions with full type support.
- **Metadata Caching**: ETag-based conditional requests for efficient metadata caching.
- **Unified Data Access**: Simple CRUD operations for any object in your schema.
- **Batch Operations**: Efficient bulk create/update/delete with transaction support.
- **View Storage**: Save, load, and share custom UI view configurations.
- **Standardized Errors**: Machine-readable error codes with retry guidance.
- **Broad Protocol Coverage**: 20 top-level surfaces (~170 methods) over the ObjectStack HTTP API.
- **Audited Surface**: coverage against the server's routes is tracked by the #3563 route ledger (`@objectstack/runtime` `route-ledger.ts`), enforced in CI.

## 🤖 AI Development Context

**Role**: Browser/Node Client SDK
**Usage**:
- Use this in Frontend Apps (React, etc.) or external Node scripts.
- Interacts with `packages/runtime` over HTTP.

**Key namespaces**:
- `client.meta`: Metadata operations.
- `client.data`: Data operations.

## Installation

```bash
pnpm add @objectstack/client
```

## Usage

```typescript
import { ObjectStackClient } from '@objectstack/client';

// 1. Initialize
const client = new ObjectStackClient({
  baseUrl: 'http://localhost:3004', // Your ObjectStack Server URL
  token: 'optional-auth-token'
});

async function main() {
  // 2. Connect (Fetches system capabilities)
  await client.connect();

  // 3. Metadata Access
  const todoSchema = await client.meta.getItem('object', 'todo_task');
  console.log('Fields:', todoSchema.fields);
  
  // Save Metadata (New Feature)
  await client.meta.saveItem('object', 'my_custom_object', {
    label: 'My Object',
    fields: { name: { type: 'text' } }
  });

  // 4. Advanced Query
  const tasks = await client.data.find<{ subject: string; priority: number }>('todo_task', {
    select: ['subject', 'priority'], // Field Selection
    filters: ['priority', '>=', 2],  // ObjectStack Filter AST
    sort: ['-priority'],             // Sorting
    top: 10
  });
  
  // 5. Create Data
  const newTask = await client.data.create('todo_task', {
    subject: 'New Task',
    priority: 1
  });

  // 6. Batch Operations (New!)
  const batchResult = await client.data.batch('todo_task', {
    operation: 'update',
    records: [
      { id: '1', data: { status: 'active' } },
      { id: '2', data: { status: 'active' } }
    ],
    options: {
      atomic: true,        // Rollback on any failure
      returnRecords: true  // Include full records in response
    }
  });
  console.log(`Updated ${batchResult.succeeded} records`);

  // 7. Metadata Caching (New!)
  const cachedObject = await client.meta.getCached('todo_task', {
    ifNoneMatch: '"686897696a7c876b7e"'  // ETag from previous request
  });
  if (cachedObject.notModified) {
    console.log('Using cached metadata');
  }

}
```

## API Reference

### `client.connect()`
Initializes the client by fetching the system discovery manifest from `/api/v1`.

### `client.meta`
- `getTypes()` / `getItems(type)` / `getItem(type, name)`: Read metadata (e.g. `getItem('object', 'todo_task')`).
- `saveItem(type, name, data)` / `deleteItem(type, name)`: Write metadata.
- `getCached(name, options?)`: Get object schema with ETag-based caching.
- `getView(object, type?)`: Get rendered view configuration.

### `client.data`
- `find<T>(object, options)`: Advanced query with filtering, sorting, selection.
- `get<T>(object, id)`: Get single record by ID.
- `query<T>(object, ast)`: Execute complex query using full AST.
- `create<T>(object, data)`: Create record.
- `batch(object, request)`: **Recommended** - Execute batch operations (create/update/upsert/delete) with full control.
- `createMany<T>(object, data[])`: Batch create records (convenience method).
- `update<T>(object, id, data)`: Update record.
- `updateMany<T>(object, records[], options?)`: Batch update records (convenience method).
- `delete(object, id)`: Delete record.
- `deleteMany(object, ids[], options?)`: Batch delete records (convenience method).

### Query Options
The `find` method accepts an options object with canonical field names:
- `where`: Filter conditions (WHERE clause). Accepts object or FilterCondition AST.
- `fields`: Array of field names to retrieve (SELECT clause).
- `orderBy`: Sort definition — `'name'`, `['-created_at', 'name']`, or `SortNode[]`.
- `limit`: Maximum number of records to return (LIMIT).
- `offset`: Number of records to skip (OFFSET).
- `expand`: Relations to expand (JOIN / eager-load).

> **Deprecated aliases** (accepted for backward compatibility): `select` → `fields`, `filter`/`filters` → `where`, `sort` → `orderBy`, `top` → `limit`, `skip` → `offset`.

### Batch Options
Batch operations support the following options:
- `atomic`: If true, rollback entire batch on any failure (default: true).
- `returnRecords`: If true, return full record data in response (default: false).
- `continueOnError`: If true (and atomic=false), continue processing remaining records after errors.

> `validateOnly` was retired in #4052 — it was never implemented and batch surfaces persisted
> regardless, so there is no batch dry-run today. Drop the key; see
> `docs/protocol-upgrade-guide.md` (`batch-options-validate-only-retired`).

### Error Handling
The client provides standardized error handling with machine-readable error codes:

```typescript
try {
  await client.data.create('todo_task', { subject: '' });
} catch (error) {
  console.error('Error code:', error.code);        // e.g., 'validation_error'
  console.error('Category:', error.category);      // e.g., 'validation'
  console.error('HTTP status:', error.httpStatus); // e.g., 400
  console.error('Retryable:', error.retryable);    // e.g., false
  console.error('Details:', error.details);        // Additional error info
}
```

### Error Code Reference

#### Client Errors (4xx)

| Error Code | HTTP Status | Retryable | Description |
|------------|-------------|-----------|-------------|
| `validation_error` | 400 | No | Input validation failed. Check error.details for field-specific errors |
| `unauthenticated` | 401 | No | Authentication required. Provide valid token |
| `permission_denied` | 403 | No | Insufficient permissions for this operation |
| `resource_not_found` | 404 | No | Resource does not exist. Verify object name or record ID |
| `conflict` | 409 | No | Resource conflict (e.g., duplicate unique field) |
| `rate_limit_exceeded` | 429 | Yes | Too many requests. Wait before retrying |

#### Server Errors (5xx)

| Error Code | HTTP Status | Retryable | Description |
|------------|-------------|-----------|-------------|
| `internal_error` | 500 | Yes | Server encountered an error. Retry with backoff |
| `service_unavailable` | 503 | Yes | Service temporarily unavailable. Retry later |
| `gateway_timeout` | 504 | Yes | Request timeout. Consider increasing timeout or retrying |

**Retry Strategy Example:**

```typescript
async function retryableRequest<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (!error.retryable || i === maxRetries - 1) {
        throw error;
      }
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
  throw new Error('Max retries exceeded');
}

// Usage
const data = await retryableRequest(() => 
  client.data.create('todo_task', { subject: 'Task' })
);
```

## Protocol Compliance

The SDK ships these top-level surfaces: `meta`, `data`, `auth`, `oauth`,
`organizations`, `projects`, `packages`, `keys`, `security`, `shareLinks`,
`approvals`, `analytics`, `automation`, `actions`, `storage`, `i18n`,
`notifications`, `ai`, and `events`. (The former `views`, `permissions`,
`workflow`, and `realtime` namespaces were removed in #3612 — no server
surface ever mounted their routes.)

Coverage against the server's actual route surface is no longer asserted by a
hand-written table — it is audited and CI-enforced by the route ledgers
(`packages/runtime/src/route-ledger.ts` for the dispatcher, #3563;
`packages/rest/src/rest-route-ledger.ts` for the REST surface, #3587 — each
with conformance tests, one half server-side, one half in this package). See
`docs/audits/2026-07-dispatcher-client-route-coverage.md` for the audit.

## Available Namespaces

### Complete API Coverage

```typescript
const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000' });
await client.connect();

// Discovery & Metadata
await client.meta.getTypes();                    // List metadata types
await client.meta.getItems('object');            // List all objects
await client.meta.getItem('object', 'contact');  // Get specific object

// Data Operations
await client.data.find('contact', { filters: { status: 'active' } });
await client.data.create('contact', { name: 'John' });
await client.data.update('contact', id, { status: 'inactive' });
await client.data.delete('contact', id);
await client.data.batch('contact', batchRequest);

// Authentication
await client.auth.login({ email: 'user@example.com', password: 'pass' });
await client.auth.register({ email: 'new@example.com', password: 'pass' });
await client.auth.me();
await client.auth.logout();
await client.auth.refreshToken('refresh-token-string');

// Package Management
await client.packages.list();
await client.packages.install({
  name: 'vendor_plugin',
  label: 'Vendor Plugin',
  version: '1.0.0',
});
await client.packages.enable('plugin-id');

// Approvals (approval is a flow node — decisions are keyed by request id)
await client.approvals.approve(requestId, 'LGTM');
await client.approvals.reject(requestId, 'Incomplete');

// Notifications
await client.notifications.list({ read: false }); // unread only
await client.notifications.markRead(['notif-1', 'notif-2']);

// AI Services
await client.ai.nlq({ query: 'Show me all active contacts' });
await client.ai.suggest({ object: 'contact', field: 'industry' });
await client.ai.insights({ object: 'sales', recordId: dealId });

// Internationalization
await client.i18n.getLocales();
await client.i18n.getTranslations('zh-CN');
await client.i18n.getFieldLabels('contact', 'zh-CN');

// Analytics
await client.analytics.query({ object: 'sales', aggregations: ['sum:amount'] });
await client.analytics.meta('sales');

// Automation
await client.automation.trigger('send_welcome_email', { userId });

// File Storage
await client.storage.upload(fileData, 'user');
await client.storage.getDownloadUrl('file-123');
```

## Testing

### Unit Tests

```bash
pnpm test
```

### Integration Tests

**Note:** Integration tests require a running ObjectStack server. The server is provided by a separate repository and must be set up independently.

```bash
# Start test server (in the ObjectStack server repository)
# Follow that project's documentation for test server setup
# Example: cd /path/to/objectstack-server && pnpm dev:test

# Run integration tests (in this repository)
cd packages/client
pnpm test:integration
```

See [`tests/integration/README.md`](./tests/integration/README.md) for what is covered today and what is still unwritten.

