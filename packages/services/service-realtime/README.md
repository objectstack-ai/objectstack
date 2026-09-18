# @objectstack/service-realtime

In-process pub/sub for ObjectStack — the production `IRealtimeService` implementation,
backed by an in-memory adapter.

> ⚠️ **Server-internal only — no client transport.** This service delivers events to
> **trusted, in-process subscribers** (today: the webhook auto-enqueuer and knowledge
> sync). There is **no WebSocket/SSE endpoint, no REST subscribe route, and no working
> client transport** — `IRealtimeService.handleUpgrade` is deliberately unimplemented
> platform-wide, and the `@objectstack/client` `RealtimeAPI` is a placeholder.
> See [Security posture](#security-posture-2992--adr-0096-d4) before changing that.

## What this package actually provides

- **`InMemoryRealtimeAdapter`** — a Map-backed pub/sub implementing `IRealtimeService`
  (`publish` / `subscribe` / `unsubscribe`), with:
  - channel-based routing and per-subscription filtering by **object name** and
    **event types** (`RealtimeSubscriptionOptions.object` / `eventTypes`;
    `options.filter` is declared in the contract but **not evaluated**);
  - a `maxSubscriptions` safety cap (default 50 000; `0` = unbounded, tests only) so a
    subscription leak can't grow the map until the pod OOMs;
  - handler errors swallowed per-delivery so one bad subscriber can't break the
    publish loop.
- **`RealtimeServicePlugin`** — registers the adapter as the kernel `realtime` service,
  registers the `sys_presence` system object, and contributes its translations.

**v1 deployment contract (launch-readiness P0-5): single-instance only.** The adapter is
process-local — events published on node A are not delivered to subscribers on node B.
An HA adapter (Redis-backed, over `service-cluster-redis`) is a post-GA fast-follow.

## Usage (server-side, trusted code only)

```typescript
import { ObjectKernel } from '@objectstack/core';
import type { IRealtimeService } from '@objectstack/spec/contracts';
import { RealtimeServicePlugin } from '@objectstack/service-realtime';

const kernel = new ObjectKernel();
await kernel.use(new RealtimeServicePlugin());
await kernel.bootstrap();

const realtime = kernel.getService<IRealtimeService>('realtime');

const subId = await realtime.subscribe('records', (event) => {
  console.log(event.type, event.payload);
}, { object: 'account', eventTypes: ['record.created'] });

await realtime.publish({
  type: 'record.created',
  object: 'account',
  payload: { id: 'acc-1', name: 'Acme' },
  timestamp: new Date().toISOString(),
});

await realtime.unsubscribe(subId);
```

Configuration:

```typescript
new RealtimeServicePlugin({
  adapter: 'memory',                    // only supported adapter today
  memory: { maxSubscriptions: 50_000 }, // 0 = unbounded (tests only)
});
```

## Security posture (#2992 / ADR-0096 D4)

Delivery is a **pure fan-out with no per-recipient authorization seam**:

- subscriptions carry **no principal** — there is nothing to check a row against;
- `matchesSubscription` filters only by object name + event type;
- the ObjectQL engine publishes `record.created` / `record.updated` events with the
  **full record body** (the `after` row) — rows and fields a subscriber's own `find`
  would hide under RLS/FLS/tenant scoping.

That is safe **only while every subscriber is trusted server-internal code**. Before any
end-user transport ships (WebSocket `handleUpgrade`, SSE, a REST subscribe route, or a
real client transport), the delivery path MUST gain one of:

1. **a per-recipient re-check on delivery** — the subscription carries the subscriber's
   `ExecutionContext`, and every event is re-authorized (RLS/FLS/tenant) against it
   before the handler fires; **or**
2. **id-only payloads** — the client re-fetches the record under its own authority.

This posture is registered in the authz conformance matrix
(`packages/qa/dogfood/test/authz-conformance.matrix.ts`, row `realtime-delivery-authz`),
and transport **tripwire probes** in `authz-conformance.test.ts` fail CI if a transport
is wired without upgrading that row with a real enforcement site.

## Contract

Implements `IRealtimeService` from `@objectstack/spec/contracts`:

```typescript
import type {
  RealtimeEventHandler,
  RealtimeEventPayload,
  RealtimeSubscriptionFilter,
  RealtimeSubscriptionOptions,
} from '@objectstack/spec/contracts';

interface IRealtimeService {
  publish(event: RealtimeEventPayload): Promise<void>;
  subscribe(channel: string, handler: RealtimeEventHandler, options?: RealtimeSubscriptionOptions): Promise<string>;
  unsubscribe(subscriptionId: string): Promise<void>;
  handleUpgrade?(request: Request): Promise<Response>;   // deliberately unimplemented — see above
  // optional convenience methods — not implemented here
  subscribeMetadata?(filter: RealtimeSubscriptionFilter, handler: RealtimeEventHandler): Promise<string>;
  subscribeData?(filter: RealtimeSubscriptionFilter, handler: RealtimeEventHandler): Promise<string>;
}
```

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [@objectstack/spec — realtime contract](../../spec/src/contracts/realtime-service.ts)
- framework#2992 — the identity-admission tracking issue for this surface
- [ADR-0096 — Execution-Surface Identity Admission](../../../docs/adr/0096-execution-surface-identity-admission.md)
