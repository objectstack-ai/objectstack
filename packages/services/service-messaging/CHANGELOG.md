# @objectstack/service-messaging

## 8.0.0

### Minor Changes

- 9f311f8: feat(messaging): digest batching for notifications (ADR-0030 P3b-2)

  Recipients can now batch a topic into a `daily` / `weekly` **digest** instead of
  receiving every notification immediately. Builds on P3b-1's deferral seam:

  - `PreferenceResolver` consumes the `digest` preference field and `digestDeferral()`
    defers a batched recipient to the next window (local midnight / Monday 00:00),
    tagging the target with a stable `window`. Digest takes precedence over
    quiet-hours; `critical` and mandatory topics bypass it.
  - `sys_notification_delivery` gains a `digest_key` (`recipient|channel|window`).
    Batched rows partition by that key so a window's rows co-locate, and the normal
    outbox `claim()` skips them while the new `claimDigest()` drains a window whole.
  - The dispatcher's digest pass collapses each `(recipient, channel, window)` group
    into one `renderDigest()` message under the existing per-partition cluster lock,
    then acks every row in the group with that single outcome.

  Additive: non-digest notifications are unchanged. Timezone-from-`sys_user`,
  configurable send-hour, and MJML digest emails are deferred follow-ups.

### Patch Changes

- c70eec1: fix(messaging): converge mark-read receipt on unique-index race

  `markRead`'s `upsertReadReceipt` did `findOne`-then-`insert` (check-then-act), so
  a concurrent mark-read — or the best-effort `delivered` receipt write still in
  flight — could win the `UNIQUE(notification_id, user_id, channel)` index between
  the read and the write. Clicking a notification then threw
  `UNIQUE constraint failed: sys_notification_receipt...`. The insert now catches a
  unique violation and falls back to flipping the now-present row to `read`, with a
  cross-driver `isUniqueViolation` helper (SQLite / Postgres `23505` /
  MySQL `ER_DUP_ENTRY`).

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Minor Changes

- 955d4c8: ADR-0018 M3: unified `http` / `notify` executors backed by a generic HTTP outbox.

  Promotes a reliable outbound-HTTP delivery outbox into `service-messaging` (the
  raw-callout counterpart to the notification outbox) and routes the Flow `http`
  node through it — closing the "`http_request` is a bare `fetch()` with no retry"
  gap. The five divergent outbound verbs collapse onto canonical `http` / `notify`.

  **`@objectstack/service-messaging` (additive):**

  - `IHttpOutbox` / `HttpDelivery` generic raw-callout shape
    (`source` / `refId` / `dedupKey` / `label` / `signingSecret`), `SqlHttpOutbox`
    over a new `sys_http_delivery` object, `MemoryHttpOutbox`, `HttpDispatcher`
    (per-partition cluster lock, claim/ack/retry/dead-letter), and a shared
    `sendOnce` + 7-step jittered retry schedule.
  - `MessagingService` gains `setHttpOutbox()` / `isHttpDeliveryReady()` /
    `enqueueHttp()`; the plugin wires the outbox + dispatcher at `kernel:ready`.

  **`@objectstack/service-automation`:**

  - Canonical `http` executor — `durable: true` enqueues onto the messaging HTTP
    outbox (retry/dead-letter); otherwise an inline `fetch()` preserving
    `http_request`'s request/response semantics.
  - `engine.registerNodeAlias()` — registers a delegating executor + a
    `deprecated` / `aliasOf` descriptor. `http_request` / `http_call` / `webhook`
    are now deprecated aliases of `http`; existing flows keep running.
  - `notify` descriptor marked `needsOutbox` (its delivery is outbox-backed).

  **`@objectstack/spec`:** `flow.zod` adds `http` to the builtin node-type seed set.

  `plugin-webhooks` cut-over to the shared outbox is a deliberate follow-up.

- 11905fa: ADR-0018 M3 (Phase 5): `plugin-webhooks` now delivers through the shared
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

- 8e539cc: Implement the `/api/v1/notifications` REST surface (ADR-0030)

  The notification REST routes (`GET /notifications`, `POST /notifications/read`,
  `POST /notifications/read/all`) were declared in the spec but never had a
  server-side handler — no plugin registered the `notification` core service, so
  the routes were never advertised in discovery and `client.notifications.*`
  calls 404'd. (The Console bell works today only because it bypasses these
  endpoints and reads the inbox via the generic data API.)

  This wires the surface end-to-end against the ADR-0030 L5 model:

  - **`MessagingService`** gains an inbox read API: `listInbox(userId, opts)`
    reads `sys_inbox_message` joined with `sys_notification_receipt` for
    read-state (a message is unread until its event has a `read`/`clicked`/
    `dismissed` receipt); `markRead(userId, ids)` and `markAllRead(userId)`
    upsert the receipt to `read`, keyed `(notification_id, user_id,
channel:'inbox')` — updating the existing `delivered` receipt in place,
    inserting only when absent. No reliance on the re-modeled `sys_notification`
    L2 event (which carries no recipient/read columns).
  - **`MessagingServicePlugin`** now also registers the messaging service under
    the `notification` core service slot, so the dispatcher resolves + advertises
    the routes. The legacy `INotificationService.send()` abstraction is unused and
    unconsumed.
  - **`HttpDispatcher`** gains `handleNotification` + a `/notifications` dispatch
    branch: it takes the authenticated user from the execution context and maps
    list / mark-read / mark-all-read to the service. Responses match the spec
    schemas (`{ notifications, unreadCount }`, `{ success, readCount }`).

  Pairs with the objectui SDK consumer repoint (`useClientNotifications` →
  `markRead`/`registerDevice` signatures). Device registration and preference
  endpoints remain out of scope (unimplemented as before).

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1

## 7.4.0

### Minor Changes

- 13632b1: ADR-0030 P0 (framework) — converge notifications onto a single ingress and the
  layered model. Every producer now publishes through
  `NotificationService.emit(EmitInput)`; the in-app inbox is a materialization of
  delivery, not a row producers write.

  **Single ingress (`@objectstack/service-messaging`) — breaking**

  - `MessagingService.emit` takes the new `EmitInput` contract (`topic` /
    `audience` / `payload` / `severity` / `dedupKey` / `source` / `actorId` /
    `organizationId` / `channels`) instead of the flat `Notification` shape. It
    writes the L2 `sys_notification` event (idempotent on `dedupKey`), resolves the
    audience, then fans out; it returns `{ notificationId, deduped, deliveries,
delivered, failed }`.
  - New `sys_notification_receipt` object — the read-state spine
    (`delivered|read|clicked|dismissed`), keyed `(notification_id, user_id,
channel)`. The inbox channel writes a `delivered` receipt on materialization.
  - `sys_inbox_message`: adds `notification_id` / `delivery_id`, **drops `read`**
    (read-state moved to the receipt), adds the user `mine` list view.

  **Event re-model (`@objectstack/platform-objects`) — breaking**

  - `sys_notification` is re-modeled from a per-user inbox into the L2 **event**
    (`topic`, `payload`, `severity`, `dedup_key`, `source_*`, `actor_id`). Removes
    `recipient_id` / `is_read` / `read_at` / `type` / `title` / `body` / `url` /
    `actor_name` and the inbox actions/views. App-nav: the account inbox points at
    `sys_inbox_message`; Setup shows the notification event log.

  **Producers routed through `emit()`**

  - `@objectstack/service-automation`: the `notify` node maps its config to
    `EmitInput`.
  - `@objectstack/plugin-audit`: collaboration `@mention` → `collab.mention` and
    assignment → `collab.assignment` (both with a `dedupKey`); no more direct
    `sys_notification` writes. Collaboration notifications now require
    `MessagingServicePlugin` (they degrade to a warn otherwise).

  **Migration (`@objectstack/metadata`)**

  - Idempotent `migrateSysNotificationToEvent` splits legacy `sys_notification`
    inbox rows into `sys_inbox_message` + receipts and rewrites the event row.

  **Startup (`@objectstack/cli`, `@objectstack/runtime`)**

  - `messaging` is now a foundational capability. On `objectstack serve` it is
    added to `ALWAYS_ON_CAPABILITIES` (every non-`minimal` preset starts it); on
    cloud per-project kernels the capability loader expands `requires` to add
    `messaging` whenever `audit` is present. This keeps collaboration `@mention` /
    assignment notifications (which now flow through the pipeline) working out of
    the box on both paths. `--preset minimal` opts out.

  The Console bell repoint (objectui) and phases P1–P3 are tracked in
  `docs/handoff/adr-0030-notification-convergence.md`.

- a40d010: ADR-0030 P2 — subscription + preference. Adds the Layer-3 preference filter so
  users can mute notification topics/channels, with admin-global defaults and
  mandatory-topic bypass.

  - **`sys_notification_preference`** — per `(user_id, topic, channel)` toggle
    (`enabled`, plus `digest`/`quiet_hours` for P3). `user_id='*'` rows are the
    admin-global default; a real-user row overrides it; `topic`/`channel` support
    `*` wildcards. Unique `(user_id, topic, channel)`.
  - **`sys_notification_subscription`** — standing subscription of a principal
    (`role:`/`team:`/`user:`/id) to a topic (the opt-in counterpart to explicit
    audience; object + schema land now, subscription-driven fan-out is a follow-up).
  - **`PreferenceResolver`** — wired into `MessagingService.emit()` between
    recipient resolution and fan-out/enqueue. Most-specific-wins resolution
    (user→`*`, topic→`*`, channel→`*`; default ON). Two safety rules: **mandatory
    topics bypass** (configurable via `mandatoryTopics`, exact or `prefix.`), and
    **fail-open** (no data engine or a lookup error delivers all, never silently
    drops). `emit()` now filters the `(recipient × channel)` matrix per user.
  - Both objects are registered by `MessagingServicePlugin` and contributed to the
    Setup app's Configuration nav slot (ADR-0029 D7), so they appear in
    REST/Studio only when messaging is installed.

  Acceptance: a user muting a topic/channel stops receiving it on that channel;
  mandatory topics still deliver. service-messaging suite: 66 passing
  (adds `preference-resolver.test.ts` + an emit-level mute/bypass test).

- f3424fc: ADR-0030 P3a — email channel + notification templates. The same `emit()` now
  reaches inbox **and** email per the user's preferences, rendered from a
  template.

  - **`email` channel** (`createEmailChannel`) — a thin `MessagingChannel` that
    delegates transport to the existing `email` service (ADR-0022: channel adds
    messaging semantics, the email sub-system stays the transport). It resolves the
    recipient user id → address (`sys_user.email`, or an email-shaped recipient
    verbatim), renders, and sends. Retry/backoff/dead-letter come free from the P1
    outbox dispatcher. Registered at `kernel:ready` only when an `email` service is
    present; absent ⇒ no channel (an explicit `channels:['email']` then reports
    "not registered" rather than silently no-opping). No-ops gracefully like the
    inbox channel when the capability isn't installed.
  - **`sys_notification_template`** (topic × channel × locale) + a renderer:
    declarative `{{ payload.x }}` interpolation (no logic — auditable metadata),
    HTML/markdown/text bodies, locale fallback (`en-US` → `en` → default), and a
    **generic fallback to `payload.title`/`body`** when no template matches (so
    templates are purely additive). Contributed to the Setup → Configuration nav.
  - Channels are now keyed per recipient (from P2), so a notification reaches each
    user on exactly the channels they accept, rendered by that channel's template.

  Scope note (ADR-0022): **Slack stays a connector** (`connector-slack` already
  ships the raw API path); a Slack _notification channel_ needs per-user identity
  mapping + OAuth and is enterprise-tier — deferred. push/webhook channels and the
  digest / quiet-hours middleware (P3b) are follow-ups on the same seam.

  Tests: service-messaging **85 passing** — adds `template-renderer.test.ts` and
  `email-channel.test.ts` (address resolution, template vs fallback rendering,
  no-service no-op, unresolved-address failure, transport-failure retry).

- c8753ef: ADR-0030 P3b-1 — quiet-hours. A notification that lands inside a recipient's
  quiet-hours window is **deferred to the window's end** instead of disturbing
  them; it then delivers normally.

  - Implemented as a **deferred dispatch** on the P1 outbox — no parallel
    scheduler: `EnqueueDeliveryInput.notBefore` sets the delivery row's initial
    `nextAttemptAt`, and the existing dispatcher already skips pending rows whose
    `nextAttemptAt` is in the future. One delivery spine, reusing claim/retry/
    observability.
  - `PreferenceResolver` reads `quiet_hours` (`{ tz, start, end }`, P2's field) off
    a channel-wildcard preference row (quiet hours are a per-person, channel-
    agnostic setting), computes the deferral with `quietHoursDeferral()` (HH:MM in
    the row's `tz`, default UTC; supports overnight windows that wrap midnight),
    and stamps `notBefore` on the target. `emit()` passes it through to the outbox.
  - **critical** severity bypasses quiet hours (delivers immediately), like
    mandatory topics bypass muting. Honored on the durable outbox path; inline
    best-effort fan-out ignores it.

  Tests: service-messaging **92 passing** — adds `quietHoursDeferral` unit cases
  (same-day / overnight / outside / degenerate) and resolver cases (notBefore
  stamped, critical bypass, JSON-string `quiet_hours`).

  Follow-up: **P3b-2 — digest** (batch same-`(user, channel, window)` deliveries
  into one) builds on this same deferral foundation, adding the window collapse.

- 406fda5: ADR-0030 P1 — reliable delivery + RecipientResolver.

  **RecipientResolver** — the single home for audience → user-id expansion, wired
  into `MessagingService.emit()`. Queries the same identity/membership model
  `plugin-sharing` uses (directly via the data engine, no backward plugin
  dependency):

  - `role:<name>` → `sys_member` rows (tenant-scoped)
  - `team:<id>` → `sys_team_member` rows
  - `owner_of:<obj>:<id>` / `{ ownerOf }` → the record's owner/assignee field
  - `<email>` → `sys_user` (verbatim fallback on miss); `user:<id>` / bare id → id

  Best-effort: a failed directory lookup yields 0 recipients for that spec rather
  than throwing. The inbox channel's email→id fallback moved here — the channel
  now keys rows by the already-resolved recipient.

  **Reliable delivery outbox + dispatcher** (mirrors `plugin-webhooks`):

  - New `sys_notification_delivery` outbox object (L4) — one row per
    `(event × recipient × channel)`; `pending|in_flight|success|failed|dead|suppressed`
    state machine; unique `(notification_id, recipient_id, channel)` enqueue dedup.
  - `INotificationOutbox` with `SqlNotificationOutbox` + `MemoryNotificationOutbox`
    backends; atomic claim (`pending → in_flight`) + stale-in_flight reaping.
  - `NotificationDispatcher` — interval loop over partitions, each guarded by a
    per-partition cluster lock (single-node always-grant fallback when no cluster
    service); sends via the channel and acks with exponential backoff + jitter;
    dead-letters once the retry budget is exhausted.
  - `emit()` enqueues `pending` deliveries when an outbox is attached; otherwise it
    fans out inline (the P0 behavior). `MessagingServicePlugin` wires the outbox +
    dispatcher at `kernel:ready` and registers the new object.

  A failed channel send now retries and is observable on the delivery row;
  duplicate enqueue is idempotent. Backoff/classification and clocks are injectable
  for deterministic tests.

- 394d34f: Messaging + triggers capability tokens, and notify-by-email recipient resolution.

  Make the `notify` flow node and auto-firing flows usable from a plain
  `defineStack({ requires: [...] })` — no hand-wired plugin instances.

  - **CLI / runtime — new capability tokens.** `messaging` →
    `MessagingServicePlugin` (the `notify` node delivers to the inbox channel
    instead of degrading to a logged no-op); `triggers` →
    `RecordChangeTriggerPlugin` + `ScheduleTriggerPlugin` (autolaunched / schedule
    flows actually fire — pair `triggers` with `job` for cron/interval). Wired
    identically in the CLI `CAPABILITY_PROVIDERS` table and the runtime
    `capability-loader`.
  - **Inbox channel — notify-by-email.** Flows commonly address recipients by
    email (e.g. `{record.assignee}`), but `sys_inbox_message` is keyed by user id.
    The inbox channel now resolves an email-shaped recipient to its `sys_user.id`
    (configurable via `InboxChannelOptions.userObject`), with a verbatim fallback
    when the recipient is not email-shaped, no user matches, or the lookup fails —
    so a failed resolution can never drop the row.

- 3a45780: Synthesize the inbox `action_url` from the event `source` (ADR-0030 L5).

  The Console bell reads `sys_inbox_message` (the L5 in-app materialization),
  which carries only `action_url` — not the L2 `sys_notification` event's
  `source_object`/`source_id`. Producers that pass a `source` but no explicit
  `payload.url` (collaboration `@mention`, record assignment) therefore
  materialized inbox rows with no navigable link, so the bell entry couldn't
  deep-link to the originating record.

  `emit()` now synthesizes an app-relative `/{object}/{id}` link from `source`
  when no explicit `payload.url`/`payload.actionUrl` is supplied — in both the
  inline fan-out and the durable-outbox enqueue paths (`actionUrlFor()`).
  Precedence: explicit url → source-derived link → `undefined`. Keeps the L5
  materialization self-sufficient for navigation (the objectui bell consumes
  `action_url`).

  Tests: 3 new `messaging-service.test.ts` cases (source→link, explicit-url
  precedence, neither→undefined); all 95 service-messaging tests green.

- c381977: Harden the notification pipeline: race-safe dedup + opt-in retention (ADR-0030).

  **Race-safe dedup.** `sys_notification.dedup_key` is now declared a **UNIQUE**
  index (was a plain index), and `emit()` **converges on a unique-key conflict**:
  the pre-insert `dedup_key` check is a fast-path, but if a concurrent `emit`
  raced past it and inserted first, our insert hits the violation — we catch it
  and converge to the winner's event (a dedup hit) instead of throwing or
  double-emitting. This mirrors the delivery outbox's enqueue convergence and
  stops a record-change storm from producing duplicate bell notifications. SQL
  treats NULLs as distinct, so the common events with no `dedup_key` are
  unconstrained. (Enforcement is per-driver: where declared indexes are
  materialized the conflict path activates; drivers that don't materialize them
  fall back to the best-effort fast-path — the catch is simply never taken. Note
  the SQL driver currently doesn't sync declared object indexes, which already
  affects the delivery/receipt unique indexes — tracked separately.)

  **Opt-in retention.** New `NotificationRetention` sweeper + plugin options
  `retentionDays` / `retentionSweepMs`. Every `emit()` writes a `sys_notification`
  event (plus delivery/materialization/receipt rows), so a high-frequency
  periodic flow grows the tables unbounded. When `retentionDays > 0`, a
  low-frequency sweep (default hourly, timer `unref`'d) bulk-deletes events,
  deliveries, inbox messages and receipts older than the cutoff — a notification
  ages out wholesale, keeping the model consistent (no dangling `notification_id`)
  and the bell (recent-only) unaffected. The delivery row's epoch-ms `created_at`
  vs the others' ISO `created_at` is handled per target. **Default off** — no
  notification data is deleted without explicit operator policy. Each target is
  isolated (one object's failure doesn't abort the sweep), and the sweep runs
  under a system context (retention is a cross-tenant operator policy).

  Tests: +7 `service-messaging` cases (converge-on-conflict, non-conflict
  rethrow, retention cutoff-formatting per target, no-engine / non-positive
  no-ops, failure isolation, missing-count) — 102 passing.

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/core@7.4.0
