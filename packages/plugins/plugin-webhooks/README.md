# @objectstack/plugin-webhooks

Webhooks on top of the shared outbound HTTP delivery of `@objectstack/service-messaging` (ADR-0018 M3): the `sys_webhook` configuration object, the enqueuer that turns record events into delivery rows, and the redeliver admin endpoint. The durable outbox, the cluster-coordinated dispatcher and retries live in the messaging service, which this plugin requires. `WebhookOutboxPlugin` registers it with the kernel.

```typescript
import { WebhookOutboxPlugin } from '@objectstack/plugin-webhooks';
```

Documentation: [Webhooks](https://objectstack.ai/docs/automation/webhooks)
