---
"@objectstack/service-messaging": patch
---

`sms-channel` now declares `isAvailable()`, so fan-out can suppress it on an absent transport exactly as it already suppresses `email` (#18567 — #17732's unfinished half).

`email-channel` was the only implementation of the optional `MessagingChannel.isAvailable` member in the repository. Fan-out's `resolveChannelAvailability` treats a channel without that member as AVAILABLE — the deliberate default that keeps every third-party channel working — so one condition, "there is no transport", was answered two ways depending on which channel was asked: `email` was suppressed before any `sys_notification_delivery` row was written, while `sms` got a row per recipient that the pipeline could only dead-letter.

- **The answer is the token `send()` already refuses with**, read off the `TRANSPORT_NOT_CONFIGURED` constant rather than retyped: `{ available: false, reason: 'transport_not_configured' }`. ⛔ No new error code and no new reason token — the vocabulary stays the closed `CHANNEL_UNAVAILABLE_REASONS` set, so the refusal on the delivery row, the suppression record on `sys_notification.suppressed_channels` and the availability answer all name one condition.
- **The probe does no I/O.** It is a service-registry closure call, so fan-out consults it inline and holds no cache — the `sms` settings namespace is `scope: 'global'` and its transport is hot-swapped by the settings change bus, so a memo would save nothing and would keep answering "unavailable" straight through the settings save that fixed it.
- **⛔ It does not weaken #18424 / PR #18562.** `send()`'s refusal is unchanged; it now answers the residue a pre-write suppression cannot cover — a transport present at emit and gone by dispatch, where the delivery row already exists.

**What changes for a consumer:** if you compose the `sms` channel yourself through the public `createSmsChannel` export with a resolver that can answer `undefined`, an `emit()` targeting `sms` with no transport installed now writes **no** `sys_notification_delivery` rows for that channel and instead records `{ channel: 'sms', reason: 'transport_not_configured' }` on the `sys_notification` event's `suppressed_channels`, returned to the caller as `EmitResult.suppressed`. Those are the same rows that previously existed only to dead-letter, so `result.enqueued` drops and `result.suppressed` gains an entry. Deployments using `MessagingServicePlugin` are unaffected: there the mount gate refuses first and the channel is never registered, which is a composition fact and ⛔ not a suppression.

Clause-②: no
