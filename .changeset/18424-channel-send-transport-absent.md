---
"@objectstack/service-messaging": patch
---

`email-channel` and `sms-channel` — `send()` now REFUSES when its transport is not installed, instead of returning `{ ok: true }` for a delivery nothing was sent for (#18424).

Two members of one object answered one condition differently, and the one a caller acts on said success: `isAvailable()` correctly returned `{ available: false, reason: 'transport_not_configured' }` while `send()` returned `{ ok: true }` — "capability not installed — no-op". The `sys_notification_delivery` row reached `status: 'success'`, nothing went red, no row dead-lettered, and a deployment with an unconfigured email or SMS transport reported every notification as delivered.

- **`send()` now answers with the reason `isAvailable()` already returns.** `{ ok: false, error: "transport_not_configured: no 'email' service is registered; nothing was sent to '<recipient>'" }`. The token is the declared `CHANNEL_UNAVAILABLE_REASONS` member, held inside that closed set by its type annotation — ⛔ no new error code, so nothing new to aggregate on.
- **`classifyError()` grades it `permanent`**, so the row dead-letters on attempt one rather than burning the retry ladder against a transport no attempt can install. Driven, ⛔ not assumed: in the composition `MessagingServicePlugin` ships, the mount gate (`lazyChannelMount`, #18050) already answers this same condition by unmounting the channel, and the dispatcher acks such a row `dead` with `attempts: 1`. Both compositions now end one condition the same way.
- **⛔ Not a suppression.** A suppression is fan-out's pre-write answer on `sys_notification.suppressed_channels`; by the time `send()` runs the delivery row exists and `SendResult` has no suppression arm. `channel-availability.test.ts`'s boundary — an unmounted channel is REFUSED, ⛔ not suppressed (#18041) — is unmoved, and this change lands on its refusal side.

**What changes for a consumer:** a delivery attempted with no transport now reports failure. If you compose these channels yourself through the public `createEmailChannel` / `createSmsChannel` exports with a resolver that can answer `undefined`, deliveries that silently "succeeded" will now appear as `dead` rows carrying `transport_not_configured` — register the transport, or drop the channel from the notify's channel list. Deployments using `MessagingServicePlugin` are unaffected: there the channel is not mounted at all while its transport is absent, and fan-out already refused it.

Clause-②: no
