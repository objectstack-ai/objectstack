---
"@objectstack/plugin-webhooks": major
"@objectstack/service-messaging": minor
---

ADR-0018 M3 (Phase 5): `plugin-webhooks` now delivers through the shared
`service-messaging` HTTP outbox instead of its own.

The webhook delivery substrate — durable outbox, cluster-coordinated dispatcher,
retry/backoff/dead-letter, retention — is removed from `plugin-webhooks` and
replaced by the generic `sys_http_delivery` outbox + `HttpDispatcher` in
`@objectstack/service-messaging`. Webhooks keep only their domain concerns: the
`sys_webhook` config object, the `AutoEnqueuer` (now enqueues `source: 'webhook'`
rows via `messaging.enqueueHttp`), and the redeliver admin endpoint (now backed
by `messaging.redeliverHttp`).

**`@objectstack/service-messaging`:** `MessagingService` gains `redeliverHttp(id)`
and `listHttp(filter)` over the HTTP outbox.

**`@objectstack/plugin-webhooks` — BREAKING:**

- Now **requires** `MessagingServicePlugin` (declared as a plugin dependency).
- Removed exports: `WebhookDispatcher`, `MemoryWebhookOutbox`, `SqlWebhookOutbox`
  (and the `./sql` subpath), `DeliveryRetentionSweeper`, `hashPartition`,
  `sendOnce` / `classifyAttempt` / `nextRetryDelayMs`, and the `IWebhookOutbox` /
  `WebhookDelivery` / `EnqueueInput` / `AckResult` / `RedeliverError` types.
- Removed the `sys_webhook_delivery` object — webhook deliveries are now rows in
  `sys_http_delivery` (`source = 'webhook'`). The Setup nav points there.
- `AutoEnqueuer`'s constructor takes an `HttpEnqueueFn` instead of an
  `IWebhookOutbox`.
- `WebhookOutboxPluginOptions` reduced to `{ autoEnqueue }` (dispatcher / outbox /
  retention / nodeId options removed — those now live on `MessagingServicePlugin`).
