# Handoff — ADR-0030 Notification Convergence (P0 framework side)

**ADR**: [0030 — Notification Platform Convergence](../adr/0030-notification-platform-convergence.md)
**Build spec**: [notification-platform-convergence.md](../design/notification-platform-convergence.md)
**Status of this handoff**: P0 **framework side** shipped. The **objectui** (Console bell) cut-over and phases P1–P3 remain. Date: 2026-06-01.

---

## What shipped in this repo (framework)

The single-ingress seam and the correct layered model are now in place. Every
producer goes through `NotificationService.emit(EmitInput)`; no producer writes
a per-user inbox row directly.

### Single ingress — `MessagingService.emit(EmitInput)`
`packages/services/service-messaging/src/messaging-service.ts`
- New public contract `EmitInput` (`topic`, `audience`, `payload`, `severity`,
  `dedupKey`, `source`, `actorId`, `organizationId`, `channels`).
- `emit()` now: (1) writes the **L2 `sys_notification` event** (idempotent on
  `dedupKey`), (2) resolves the audience to recipients (inline for explicit
  ids/emails; `role:`/`team:`/`owner_of:` are forwarded but **deferred to P1**),
  (3) fans out `(channel × recipient)` deliveries. Returns
  `{ notificationId, deduped, deliveries, delivered, failed }`.
- The service now takes a `getData()` so it can persist the event.

### L2 event — `sys_notification` re-modeled (destructive)
`packages/platform-objects/src/audit/sys-notification.object.ts`
- Now the **event**: `topic`, `payload` (json), `severity`, `dedup_key`,
  `source_object`, `source_id`, `actor_id`, `created_at`. Indexes on
  `(topic, created_at)`, `(dedup_key)`, `(source_object, source_id)`.
- **Removed**: `recipient_id`, `is_read`, `read_at`, `type`, `title`, `body`,
  `url`, `actor_name`, plus the `mark_read`/`mark_unread` actions and the
  recipient-filtered list views. New admin views: `recent`, `by_topic`.

### L5 materialization + receipt
- `sys_inbox_message` (`.../objects/inbox-message.object.ts`): added
  `notification_id` + `delivery_id` FKs; **dropped `read`** (read-state lives in
  the receipt now); added a `mine` list view (the user inbox).
- **New** `sys_notification_receipt` (`.../objects/notification-receipt.object.ts`):
  the read-state spine, keyed `(notification_id, user_id, channel)`, state
  `delivered|read|clicked|dismissed`. The inbox channel writes a `delivered`
  receipt on materialization (best-effort).
- `inbox-channel.ts`: writes `notification_id` + `organization_id`, no `read`
  flag, and the `delivered` receipt. Email→id fallback kept (moves up to the
  `RecipientResolver` in P1).

### Producers re-routed through `emit()`
- **Flow `notify` node** (`service-automation/.../notify-node.ts`): maps config →
  `EmitInput` (title/body/url ride in `payload`).
- **Collaboration** (`plugin-audit/src/audit-writers.ts`): `@mention` →
  `emit('collab.mention')`, assignment → `emit('collab.assignment')`, both with
  a `dedupKey`. No more direct `sys_notification` writes. The plugin resolves the
  `messaging` service lazily at hook time (`audit-plugin.ts`).

### Data migration (not auto-run)
`packages/metadata/src/migrations/migrate-sys-notification-to-event.ts`
(exported from `@objectstack/metadata/migrations`). Splits each legacy
`sys_notification` inbox row into `sys_inbox_message` + a receipt, rewrites the
row to the event shape, and clears the legacy columns. **Idempotent**; reports
`not_applicable` on fresh installs.

### Tests
`messaging-service`, `inbox-channel`, `messaging-service-plugin`, `notify-node`,
and the migration all have updated/added coverage. All green.

---

## ⚠️ Breaking change — Console bell (objectui, separate repo)

The bell read `sys_notification.{recipient_id, is_read, title, body, …}`. Those
fields **no longer exist**. Until objectui is updated, the bell will be empty /
error. **Do the objectui cut-over and the data migration together.**

### objectui changes required (`app-shell`)
1. **`AppHeader.tsx` / `InboxPopover.tsx`**: poll **`sys_inbox_message`** filtered
   by `user_id = {current_user}` (the `mine` list view), ordered by `created_at`
   desc — instead of `sys_notification`.
2. **Read-state**: join/read `sys_notification_receipt` for the row's state
   (`read` vs `delivered`). The unread badge = inbox rows with no `read`/`clicked`
   receipt.
3. **Mark-read**: PATCH the **receipt** (`state: 'read'`, `at`) keyed by
   `(notification_id, user_id, channel:'inbox')` — not the inbox row. (A small
   REST/endpoint to upsert a receipt may be needed; see P0 follow-up below.)
4. **"View all" / notification center route**: point at `sys_inbox_message`
   (`mine`) instead of `sys_notification`.
5. `RecordDetailView` and any other `sys_notification` readers: same repoint.

### Cut-over sequence (avoid a blank bell)
1. Deploy this framework change (objects + emit + producers). New notifications
   now land in `sys_inbox_message` + receipts.
2. Run `migrateSysNotificationToEvent({ driver, data })` to carry existing
   notifications into `sys_inbox_message` + receipts.
3. Deploy the objectui bell repoint.

(Step order tolerates a brief window where new rows exist but the UI hasn't
flipped — the inbox is being populated the whole time.)

---

## Behavior notes / watch-outs

- **Messaging is now foundational (auto-on).** Collaboration notifications
  require the messaging pipeline (with no `messaging` service registered,
  `@mention`/assignment are skipped + warned, like the `notify` node). Two seams
  guarantee it loads:
  - `objectstack serve`: `messaging` is in `Serve.ALWAYS_ON_CAPABILITIES`
    (`packages/cli/src/commands/serve.ts`) — every non-`minimal` preset starts it.
  - Cloud / per-project kernels (`capability-loader.ts`): no always-on slate, so
    the loader now expands `requires` to add `messaging` whenever `audit` is
    present. Artifacts requiring `audit` therefore get the pipeline automatically.

  `--preset minimal` (CLI) and artifacts that require neither `audit` nor
  `messaging` opt out — collaboration notifications then no-op by design.

- **Dedup is best-effort in P0.** `emit()` idempotency is a non-transactional
  check-then-insert and `sys_notification.dedup_key` is a non-unique index, so a
  concurrent duplicate `emit` with the same `dedupKey` can still produce two
  events. Robust, race-safe dedup is part of the **P1 outbox** (durable spine +
  unique dedup). Assignment `dedupKey`s are scoped by the record's write-version
  (`updated_at`) so re-assignments aren't permanently suppressed.

- **Event-log growth.** Every `emit()` writes one `sys_notification` event row.
  High-frequency periodic `notify` flows accumulate rows unbounded; retention /
  pruning is a P1+ concern (the event log is the durable audit of what was sent).
- **No mark-read write path yet — required for the objectui cut-over.** P0 added
  the receipt object + `delivered` writes, but nothing transitions a receipt to
  `read`/`clicked`/`dismissed`. The bell's mark-read therefore needs a small
  write ingress (a receipt-upsert REST route or an `sys_inbox_message` action
  keyed on `(notification_id, user_id, channel)`), landed **together with** the
  objectui bell repoint. The SDK `client.notifications.markRead/list({read})`
  helpers target the old `sys_notification` read-state and must be repointed to
  the receipt at the same time. Until then read-state is write-less (every row
  shows as unread). Decide: tail of P0 (with objectui) vs P1.
- **Translations**: `packages/platform-objects/src/apps/translations/*.generated.ts`
  still carry the old `sys_notification` field labels (`is_read`, etc.). Harmless
  (unused) but should be regenerated.
- **Audience selectors** `role:`/`team:`/`owner_of:` are accepted by `emit()` but
  not yet expanded — they resolve to zero recipients until the P1
  `RecipientResolver`. Today's producers only pass explicit ids/emails, so this is
  latent, not active.

---

## Phase status (from the build spec)

- **P0 — Seams**: ✅ shipped (#1434). Single ingress, event re-model, receipt,
  producers routed through `emit()`. (objectui bell cut-over + mark-read write
  path still pending — see above.)
- **P1 — Reliable delivery**: ✅ shipped (#1441). `sys_notification_delivery`
  outbox + `NotificationDispatcher` (state machine, retry/backoff, dead-letter);
  `RecipientResolver` owns `role:`/`owner_of:`/`team:`/email→id (the inbox
  channel's email→id fallback moved up). So the audience-selector caveat above is
  now resolved when a data engine is present.
- **P2 — Subscription + preference**: ✅ shipped. `sys_notification_preference`
  (per user×topic×channel toggle, admin-global `*` defaults + per-user override,
  wildcards) + `sys_notification_subscription`; `PreferenceResolver` wired into
  `emit()` (most-specific-wins, **mandatory-topic bypass**, **fail-open**); both
  objects contributed to the Setup Configuration nav.
  - *Follow-ups*: subscription-driven fan-out (expand a topic's subscribers when
    a producer emits without an explicit audience) is schema-only so far;
    `digest`/`quiet_hours` fields exist but the batching middleware is P3.
- **P3 — Channels + templates + digest**: split into slices.
  - **P3a — email channel + templates**: ✅ shipped. `createEmailChannel`
    (delegates transport to the `email` service per ADR-0022) +
    `sys_notification_template` (topic×channel×locale) + `{{ payload.x }}`
    renderer with generic `payload.title`/`body` fallback. Same `emit` now
    reaches inbox + email per prefs.
  - **P3b-1 — quiet-hours**: ✅ shipped. Deferred dispatch on the P1 outbox —
    `EnqueueDeliveryInput.notBefore` → the row's initial `nextAttemptAt`; the
    dispatcher already skips not-yet-due pending rows. `PreferenceResolver` reads
    `quiet_hours` off a channel-wildcard row and computes the window end
    (`quietHoursDeferral`, HH:MM in tz, overnight-aware). critical bypasses.
    (tz currently from `quiet_hours.tz` → UTC; `sys_user` tz fallback is a
    follow-up.)
  - **P3b-2 — digest**: pending. Builds on the same deferral: enqueue digest
    items to the next window, then a **collapse** step merges same-`(user,
    channel, window)` rows into one materialization at window time (needs a
    `digest_key` on the delivery row + a digest assembler in/beside the
    dispatcher + a digest render template). critical/mandatory bypass. Consumes
    P2's `digest` field.
  - **Deferred (same seam, incremental)**: **Slack** stays a *connector*
    (`connector-slack` ships the raw API path today); a Slack notification
    *channel* needs identity mapping (`sys_channel_user_link`) + OAuth and is
    enterprise-tier (ADR-0022). **push** needs `sys_user_device` + APNs/FCM.
    **webhook** should reuse the existing `plugin-webhooks` outbox rather than a
    redundant channel. **MJML** compilation for email (P3a treats `mjml` format
    as raw HTML). **`defineTopic()`** declarative topic catalog (Studio
    discoverability for topics/templates/preferences).
