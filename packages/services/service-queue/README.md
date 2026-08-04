# @objectstack/service-queue

Queue Service for ObjectStack — implements `IQueueService` with an in-memory
adapter and a durable, database-backed adapter (`sys_job_queue`).

## Adapters

| Adapter | Durable | Multi-node | Use |
| --- | --- | --- | --- |
| `memory` | No (in-process) | No | dev / test / ephemeral work |
| `db` | Yes (`sys_job_queue`) | Yes (lease-based claim) | **production default** |
| `auto` *(default)* | — | — | `db` when an ObjectQL engine is present, else `memory` |

The `db` adapter persists messages, retries, and the dead-letter queue to the
`sys_job_queue` object. Multiple worker processes claim messages from the
shared table with a lease (`leaseMs`), so it works across a multi-node
deployment **without any external broker** — no Redis required. Studio can list
and replay the DLQ because `sys_job_queue` is a first-class object.

> A BullMQ/Redis adapter is **not** shipped. The durable path is the DB adapter;
> it rides on the same datasource the runtime already uses. If you genuinely
> need a Redis-backed broker, register a custom `IQueueService` via
> `ctx.registerService('queue', myAdapter)`.

## Installation

```bash
pnpm add @objectstack/service-queue
```

## Usage

```typescript
import { ObjectKernel } from '@objectstack/core';
import { QueueServicePlugin } from '@objectstack/service-queue';

const kernel = new ObjectKernel();
// 'auto' (default): durable DbQueueAdapter when ObjectQL is available, else memory
kernel.use(new QueueServicePlugin({ adapter: 'auto' }));
await kernel.bootstrap();

const queue = kernel.getService('queue'); // IQueueService

// Publish a message
await queue.subscribe('email', async (msg) => {
  await sendEmail(msg.data);
});

await queue.publish('email', { to: 'user@example.com', template: 'welcome' }, {
  // delay / priority / retries (see QueuePublishOptions)
  attempts: 3,
});
```

### Configuration

```typescript
// Force the durable DB adapter (requires an ObjectQL engine)
new QueueServicePlugin({
  adapter: 'db',
  db: {
    pollIntervalMs: 1000,   // worker poll cadence
    batchSize: 10,          // messages claimed per tick
    leaseMs: 30000,         // lease before another worker may reclaim
    idempotencyWindowMs: 24 * 60 * 60 * 1000,
  },
});

// In-process only (non-durable) — dev / test
new QueueServicePlugin({ adapter: 'memory' });
```

### Retention — how `sys_job_queue` stays bounded

Delivered messages are not kept forever. `sys_job_queue` declares an ADR-0057
lifecycle policy and the platform `LifecycleService` (shipped with
`@objectstack/objectql`, armed on every kernel that has data) enforces it — no
configuration, no extra scheduler:

| Row state | What happens |
|---|---|
| `completed` | deleted **7 days** after `created_at` |
| `pending` / `running` | never swept — live work |
| `failed` / `dlq` | never swept — the dead-letter queue waits for a human (`listFailed` / `replay` / `purgeFailed`) |

Two consequences worth knowing:

- **`idempotencyWindowMs` must not exceed the retention window.** Dedup against
  a terminal message compares its `created_at` to that window, so a longer
  setting would start accepting duplicates the moment the row was swept. The
  `db` adapter throws at construction instead of degrading quietly.
- **The window is overridable per environment** through the `lifecycle`
  settings namespace (`maxAge` per object), like every other ADR-0057 policy.
  Keep it ≥ your idempotency window.

## Service API

Implements `IQueueService` from `@objectstack/spec/contracts`:

```typescript
interface IQueueService {
  publish<T>(queue: string, data: T, options?: QueuePublishOptions): Promise<string>;
  subscribe<T>(queue: string, handler: QueueHandler<T>): Promise<void>;
  unsubscribe(queue: string): Promise<void>;
  getQueueSize?(queue: string): Promise<number>;
  purge?(queue: string): Promise<void>;
  // Dead-letter queue (db adapter)
  listFailed?(queue?: string, options?: { limit?: number; offset?: number }): Promise<QueueMessageRecord[]>;
  replay?(messageId: string): Promise<void>;
  purgeFailed?(messageId: string): Promise<void>;
}
```

## Best Practices

1. **Idempotent handlers** — messages may be re-delivered after a lease expires.
2. **Small payloads** — keep message data compact for fast serialization.
3. **Handle the DLQ** — monitor `listFailed()` and `replay()` poisoned messages.
4. **Use `db` in production** — `memory` loses in-flight work on restart and does
   not coordinate across nodes.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [@objectstack/spec/contracts](../../spec/src/contracts/queue-service.ts)
- [@objectstack/trigger-schedule](../../triggers/trigger-schedule) — cron/interval triggers on top of the job service
