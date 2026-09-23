# ADR-0030 — Notification Platform Convergence (single ingress, layered pipeline)

**Status**: Accepted (2026-06-01) — **P0–P3b2 shipped** (P3b-2 digest collapse landed); cross-repo objectui cut-over remains. See [§ Implementation status & remaining work](#implementation-status--remaining-work). · **Amended** (2026-09-20, #16194 — P0's idempotent data migration `migrateSysNotificationToEvent` is **retired**: it had zero production callers and no way to be run, and both ways of giving it one — an `os migrate` sub-command and a boot-time invoker — were refused. Pre-ADR-0030 `sys_notification` rows are therefore **not** carried by the platform on this line. ⛔ Nothing else moves: single ingress, the layered object model and the remaining objectui cut-over read exactly as accepted.)
**Supersedes / refines**: [ADR-0012 — Notification Platform](./0012-notification-platform.md) (Draft)
**Related**: [ADR-0019 — Approval as a Flow Node](./0019-approval-as-flow-node.md), [ADR-0022 — Connectors vs Messaging Channels](./0022-connectors-vs-messaging-channels.md)
**Build spec**: [docs/design/notification-platform-convergence.md](../design/notification-platform-convergence.md)

## Context — the drift

ADR-0012 proposed a correct 5-layer notification platform (Event → Notification → Subscription/Preference → Delivery/Outbox → Inbox/Receipt). Only **M1-minimal** shipped, and it **drifted** from the design. Verified state (2026-06-01):

- **Two objects both act as a per-user in-app inbox, and they don't connect.**
  - `sys_notification` (platform-objects): `recipient_id` (lookup user), `type`, `title`, `body`, `source_object/id`, `url`, `actor_id/name`, `is_read`, `read_at`. **Written directly** by the collaboration/audit plugin (`@mention`, assignment). **Read** by the Console bell / notification center (objectui `AppHeader`, `InboxPopover`). This is the *de-facto* inbox — but it is **not** ADR-0012's Layer-2 event (it has no `topic`/`payload`/`dedup_key`/`severity`).
  - `sys_inbox_message` (service-messaging): `user_id`, `topic`, `title`, `body_md`, `severity`, `action_url`, `read`. **Written** by the `notify` flow node → `MessagingService.emit` → inbox channel. **Read by nothing** — zero readers across framework and objectui (confirmed by grep).
- Net effect: `notify`-based flows (and any future channel) never reach the UI bell; collaboration notifications never flow through any pipeline.
- The ADR's middle layers (delivery outbox, subscription/preference, templates, receipts) were **never built**.

Root principle that was violated: **producers write per-user inbox rows directly, with no single ingress and no pipeline.**

## Decision

Do **not** merge the two tables into one. **Un-conflate** them back into the ADR-0012 layered model and realize the pipeline, governed by one rule:

> **Single ingress.** Every notification producer — the flow `notify` node, collaboration `@mention`, record assignment, approval requests, system alerts — calls exactly one API: `NotificationService.emit({ topic, audience, payload, severity, dedupKey, source, actor })`. **No producer writes an inbox/materialization row directly.** The in-app inbox is a *materialization of delivery*, not a thing producers write.

### Target object model

| Layer | Object | Role |
|---|---|---|
| L2 Event | `sys_notification` *(re-modeled to event)* | one row per `emit`: `topic`, `payload`(json), `severity`, **`dedup_key`** (idempotency), `source_object/id`, `actor_id`, `created_at`. **No recipient, no read-state.** |
| L3 Resolve + Preference | `sys_notification_subscription`, `sys_notification_preference` | audience expansion (`role:` / `owner_of:record` / `team:` / explicit ids; **email→id resolved here**), user×topic×channel toggles, quiet-hours, digest; mandatory topics bypass |
| L4 Delivery (outbox) | `sys_notification_delivery` | one row per (event × recipient × channel); state machine `pending→sent→failed/dead`; retry/backoff/dedup; the durable spine |
| L5 Materialize + Receipt | `sys_inbox_message` (in-app), `sys_email`, `sys_user_device` (push), connector dispatch (webhook/Slack); `sys_notification_receipt` | each channel renders delivery into a consumable artifact; **the bell reads `sys_inbox_message`**; read/clicked/dismissed live in `sys_notification_receipt` |
| Cross-cutting | `sys_notification_template` (topic×channel×locale) | rendering, with generic fallback to `title`/`body` |

The in-app inbox is **one channel among peers** (email/push/webhook). The architecture treats channels as plugins on connectors (ADR-0022) from day one, even when only the inbox channel is implemented, so the seams don't grow crooked again.

### Resolved design decisions (per architect recommendation — confirm before P0)

1. **`sys_notification` → rename/re-model to the event in place, with data migration** (one-step, no lingering deprecated table) rather than introducing a parallel `sys_notification_event`. Its inbox semantics move down: recipient/read → `sys_inbox_message` + receipt; `actor`/`source` → event columns/payload.
2. **Read-state lives in `sys_notification_receipt`** (per recipient×channel), not on `sys_inbox_message` — so cross-channel read semantics ("clicked the email → mark inbox read") are reachable later.
3. **Audience resolution reuses the platform's existing expression/sharing resolver** (`role:` / `owner_of:` …) rather than a bespoke notifications resolver.
4. **Preference model**: admin-set global defaults + per-user override + mandatory topics that bypass preferences.
5. **`sys_inbox_message` is retained** as the L5 in-app materialization (it is already correct for that role).

### Low-code platform requirements this unlocks

- Declarative topic catalog via `defineTopic()` — app builders register notification types as **metadata**.
- Per-user notification **preferences UI** (user×topic×channel) and **templates** become first-class, Studio-configurable objects.
- Reliable delivery (outbox + retry + `dedup_key`) survives record-change storms.
- Multi-channel (in-app, email, push, webhook, Slack/Teams) without re-plumbing.

## Phased delivery (each phase is correct-by-construction, not a stopgap)

P0 establishes the correct seams; later phases only add layers — no rework.

- **P0 — Seams**: extract `emit()` single ingress; route `notify` + collaboration through it; UI bell reads `sys_inbox_message`; re-model `sys_notification` to the event (with migration). *Outcome: the bell lights up for all sources and the model is correct.*
- **P1 — Reliable delivery**: `sys_notification_delivery` outbox + retry/dedup; `RecipientResolver` owns recipient/email resolution (move the channel-level email→id fallback up here).
- **P2 — Subscription + preference**: preference objects + Studio config UI + mandatory topics.
- **P3 — Channels + templates + digest**: email/push/webhook channels, `sys_notification_template`, digest / quiet-hours middleware.

Acceptance criteria per phase live in the build spec.

## Consequences

- **Positive**: one governed ingress; the bell reflects every producer; reliability, preferences, multi-channel, templates all become reachable incrementally; matches mature notification platforms and low-code expectations.
- **Cost**: P0 spans framework + objectui (UI bell re-points to `sys_inbox_message`) and requires a `sys_notification` data migration. This is a multi-phase investment (ADR-0012 already flagged the full platform as such).
- **ADR-0012** is marked superseded by this ADR; its 5-layer model is retained and realized, not discarded.

## Implementation status & remaining work

As of 2026-06-01 the framework side of the pipeline is largely built and merged.
The detailed cut-over runbook and per-item notes live in
[docs/handoff/adr-0030-notification-convergence.md](../handoff/adr-0030-notification-convergence.md).

### Shipped (merged to `main`)

| Phase | What landed | PR |
|---|---|---|
| **P0 — Seams** | Single ingress `MessagingService.emit(EmitInput)`; `sys_notification` re-modeled to the L2 event; `sys_notification_receipt`; `sys_inbox_message` materialization (+`notification_id`, read-state moved to receipt); `notify` node + collaboration `@mention`/assignment routed through `emit()`; idempotent `migrateSysNotificationToEvent`. | #1434 |
| **P1 — Reliable delivery** | `sys_notification_delivery` outbox + `NotificationDispatcher` (claim/retry/backoff/dead-letter, partitioned, cluster-lock); `RecipientResolver` (`role:`/`team:`/`owner_of:`/email→id). | #1441 |
| **P2 — Subscription + preference** | `sys_notification_preference` (user×topic×channel, admin-global `*` defaults + per-user override, wildcards) + `sys_notification_subscription`; `PreferenceResolver` wired into `emit()` (most-specific-wins, mandatory bypass, fail-open). | #1444 |
| **P3a — email channel + templates** | `createEmailChannel` (delegates transport to the `email` service per ADR-0022); `sys_notification_template` (topic×channel×locale) + declarative `{{ payload.x }}` renderer with `payload.title`/`body` fallback. | #1449 |
| **P3b-1 — quiet-hours** | Deferred dispatch on the outbox (`EnqueueDeliveryInput.notBefore` → `nextAttemptAt`); `quietHoursDeferral()` (tz/HH:MM, overnight-aware); `critical` bypass. | #1453 |
| **P3b-2 — digest** | `PreferenceResolver` consumes the `digest` field (`daily`/`weekly`) → `digestDeferral()` defers to the next window and tags the target; `digest_key` on `sys_notification_delivery` (partition-keyed so a window's rows co-locate); `INotificationOutbox.claimDigest()` drains batched rows whole while normal `claim()` skips them; the dispatcher's digest pass collapses each `(recipient, channel, window)` group into one `renderDigest()` message under the partition lock. `critical`/mandatory bypass. | this PR |
| Startup | `messaging` is foundational: in `ALWAYS_ON_CAPABILITIES` (CLI) and auto-loaded when `audit` is required (cloud capability-loader). | (in #1434) |

### Remaining work (handed off to a follow-up agent)

**1. ~~P3b-2 — Digest~~ — done (this PR).** `PreferenceResolver` batches digest
recipients to the next window; deliveries carry `digest_key`; the dispatcher
collapses same-`(recipient, channel, window)` rows into one rendered message.
Deferred sub-items not in this cut: timezone fallback to a `sys_user` field
(digest windows currently use `quiet_hours.tz` → UTC), MJML digest emails, and a
configurable daily send-hour (windows flush at local midnight / Monday 00:00).

**2. Cross-repo objectui cut-over (the user-facing delivery — separate `objectui` repo).**
- Repoint the Console bell (`AppHeader`/`InboxPopover`/record views) from
  `sys_notification` to **`sys_inbox_message`** (the `mine` view), joining
  `sys_notification_receipt` for read-state.
- Add the **mark-read write path**: a receipt-upsert REST route / action keyed on
  `(notification_id, user_id, channel)` (the framework has the receipt object +
  `delivered` writes, but nothing flips it to `read` yet). Repoint the SDK
  `client.notifications.*` helpers to the receipt.
- ~~Run `migrateSysNotificationToEvent` during the cut-over so historical bell rows
  carry over.~~ **Withdrawn (#16194)** — that runner is retired, so pre-ADR-0030
  `sys_notification` rows are **not** carried by the platform on this line: after the
  cut-over the bell shows rows emitted from the new pipeline onward, and older
  per-user inbox rows stay where they are, unread by the new UI. The reasoning, the
  unmeasured-deployment caveat and the reversal path are in the handoff doc's
  [Data migration — RETIRED](../handoff/adr-0030-notification-convergence.md#-data-migration--retired-there-is-none)
  tombstone. **Sequence:** ship back-end → flip UI (runbook in the handoff doc).

**3. Incremental channels & low-code surface (same `MessagingChannel` seam — each gets retry/outbox for free).**
- **push** (`sys_user_device` + APNs/FCM), **webhook** (reuse the `plugin-webhooks`
  outbox rather than a redundant channel), **Slack notification channel**
  (enterprise-tier: identity mapping `sys_channel_user_link` + OAuth; `send()`
  delegates to the existing `connector-slack` per ADR-0022 — the raw
  `connector_action` Slack path already works today).
- **`defineTopic()`** declarative topic catalog (Studio discoverability for topics /
  templates / preferences) — the low-code backbone.
- **Subscription-driven fan-out**: expand a topic's `sys_notification_subscription`
  principals when a producer emits without an explicit audience (object exists;
  expansion not wired).
- **MJML** compilation for email (P3a treats `mjml` format as raw HTML).
- Quiet-hours **tz fallback** to a `sys_user` timezone field (currently
  `quiet_hours.tz` → UTC).

**4. Hardening / hygiene.**
- Make event dedup race-safe: a **unique index on `sys_notification.dedup_key`** +
  graceful conflict handling (today it's a non-transactional check-then-insert on a
  non-unique index — best-effort).
- **Retention/pruning** for the `sys_notification` event log (every `emit` writes a
  row; high-frequency periodic flows grow it unbounded).
- **Regenerate** `packages/platform-objects/src/apps/translations/*.generated.ts`
  (stale `sys_notification` field labels from before the re-model — harmless but
  drifted).
- **CI infra:** the intermittent `@objectstack/spec` subpath **build-order race**
  (`pnpm -r build` dependents typecheck before spec's dist DTS is flushed) flakes
  Build/Test Core; tightening the build-dependency ordering would stop the repeated
  re-kicks.
