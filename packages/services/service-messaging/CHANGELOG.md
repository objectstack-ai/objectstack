# @objectstack/service-messaging

## 14.8.0

### Minor Changes

- bb71321: i18n: translate the system account/messaging surfaces end to end.

  - **spec**: `ObjectTranslationDataSchema` / `ObjectTranslationNodeSchema` now
    accept `_views.<view>.emptyState.{title,message}` so list-view empty states
    are translatable (contract-first for the extractor below).
  - **cli**: `os i18n extract` emits `_views.<view>.emptyState` keys when a view
    declares an empty state.
  - **platform-objects**: fill every missing zh-CN/ja-JP/es-ES translation for
    `sys_user`, `sys_organization` and `sys_business_unit` (fields, options,
    views, actions); replace the hardcoded English tab/section/action labels in
    the `sys_user`, `sys_organization` and `sys_position` detail pages with
    inline i18n label objects, and route the user Security tab through
    `record:quick_actions` so object action labels localize.
  - **service-messaging**: new ADR-0029 D8 translation bundle
    (`MessagingTranslations`) covering the seven `sys_*` messaging objects
    (inbox message, receipts, deliveries, preferences, subscriptions, templates,
    HTTP deliveries), registered on `kernel:ready`; zh-CN is fully translated
    and ja-JP/es-ES cover `sys_inbox_message` (incl. the `mine` view empty
    state).

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0

## 14.5.0

### Minor Changes

- 526805e: ADR-0057 data-lifecycle follow-ups (#2834): the per-plugin retention sweepers are retired, telemetry separation goes live in dev, and the lifecycle contract reaches the Studio.

  - **BREAKING (ships as minor per the launch-window convention)**: `JobRunRetention` / `NotificationRetention` and the `retentionDays` / `retentionSweepMs` options on `JobServicePlugin` / `MessagingServicePlugin` are removed. The platform LifecycleService enforces the same windows from the `lifecycle` declarations (`sys_job_run` 30d, notification pipeline 90d); tune them at runtime via the `lifecycle` settings namespace (`retention_overrides`, tenant-scoped).
  - **Fix**: `sys_automation_run` no longer declares a blanket 30d lifecycle retention — that table interleaves live SUSPENDED runs (an approval may stay paused for months) with terminal history, and a blanket age reap could strand in-flight approvals. Bounding stays with the automation store's terminal-only sweep.
  - **CLI**: `objectstack dev` now provisions a dedicated `telemetry` datasource (`<primary>.telemetry.db`) for file-backed SQLite primaries, so lifecycle-classed system data stops sharing the business dev DB (`OS_TELEMETRY_DB=0` opts out; `OS_TELEMETRY_DB=<path>` opts in anywhere). New `os db clean` runs the one-time `VACUUM` that lets legacy files adopt `auto_vacuum=INCREMENTAL` and reports reclaimed bytes.
  - **Studio**: the object metadata form exposes the `lifecycle` block (class + retention/TTL/rotation/archive/reclaim); metadata-forms i18n bundles regenerated with curated zh-CN translations.

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0

## 14.4.0

### Minor Changes

- 7953832: ADR-0057 data lifecycle P1–P4 (#2786): platform-generated data is now bounded by construction.

  - **P1 — contract**: new `lifecycle` object property (`class: record | audit | telemetry | transient | event` + `retention` / `ttl` / `storage(rotation)` / `archive` / `reclaim`), enforced by the platform-owned **LifecycleService** registered by `ObjectQLPlugin` (default-on; disable via `OS_LIFECYCLE_DISABLED=1` or plugin `lifecycle.enabled=false`). The Reaper batch-deletes rows past `retention.maxAge` / `ttl` under a system context and reclaims space (`SqlDriver.reclaimSpace()` → SQLite `PRAGMA incremental_vacuum`). Non-`record` classes must declare a bounding policy (parse-time invariant + spec-liveness gate + dogfood storage-growth gate).
  - **P2 — rotation**: `storage: { strategy: 'rotation', shards, unit }` physically time-shards the table on SQLite — writes land in the current shard, reads go through a UNION-ALL view under the base name, expiry is an O(1) `DROP` of shards past the window. A legacy table is adopted as the first shard on upgrade. Other dialects fall back to an equivalent age-based reap.
  - **P3 — separation + Archiver**: registering a datasource named `telemetry` routes telemetry/event/audit objects to it (opt-in by existence; `transient` deliberately stays on the primary). Audit objects with `archive` declared get retain → archive → delete once the archive datasource exists; without it rows are retained, never dropped unarchived.
  - **P4 — governance**: new `lifecycle` settings namespace — runtime enable switch, per-object retention overrides (tenant-scoped: regulated tenants set years, dev sets days), per-object/per-class row quotas and growth alerts (observe-and-alert only).

  **Behavior change**: 11 platform objects now carry lifecycle declarations and their telemetry is bounded by default — `sys_activity` 14d (rotated), `sys_audit_log` 90d hot → archive (retained forever until an `archive` datasource is registered), `sys_metadata_audit` 365d → archive, `sys_job_run` / `sys_automation_run` / `sys_http_delivery` 30d, notification pipeline (`sys_notification`, delivery, receipt, inbox) 90d, `sys_device_code` expires_at + 1d. Extend windows per environment/tenant via the `lifecycle.retention_overrides` setting.

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/core@14.4.0

## 14.3.0

### Minor Changes

- c1064f1: feat(messaging/auth): SMS infrastructure + phone-number OTP first-login/reset (#2780)

  #2766 shipped phone+password sign-in but no OTP — the platform had no SMS
  delivery capability. This adds the missing infrastructure end to end:

  - **New `@objectstack/plugin-sms`** — `ISmsService`/`ISmsTransport` contracts
    (spec) with Aliyun SMS (ACS3-HMAC-SHA256, template-based) and Twilio
    transports plus a dev log fallback. Configured through the new `sms`
    settings namespace (live provider rebind, encrypted secrets, send-test
    action; `OS_SMS_*` env keys win at the resolver). Deliberately NO message
    persistence and NO body logging — SMS bodies carry OTP codes.
  - **Messaging `sms` channel** — registered at kernel:ready when an `sms`
    service is present; `notify(channels:['sms'])` resolves
    `sys_user.phone_number`, renders `(topic,'sms',locale)` templates, and
    inherits outbox retry/dead-letter.
  - **Phone OTP flows open** — the phoneNumber plugin's `sendOTP` /
    `sendPasswordResetOTP` now deliver via SMS, enabling
    `/phone-number/send-otp` + `/verify` (OTP sign-in/verification) and
    `/phone-number/request-password-reset` + `/reset-password` (self-service
    reset). Without a deliverable SMS service they keep failing loudly
    (NOT_SUPPORTED); `features.phoneNumberOtp` advertises real availability.
    Shipped with the abuse hardening: explicit `allowedAttempts: 3`, always-on
    per-number cooldown (60s) + rolling-hour cap (5, secondaryStorage-shared
    across nodes), `/phone-number/*` in the settings-bound per-IP rate-limit
    rules, and OTP codes never reach logs or error messages.
  - **Import SMS invites** — `/admin/import-users`'s `invite` policy now
    supports phone-only rows: a credential-free invitation SMS points the
    employee at phone-OTP first sign-in followed by self-set password; mixed
    files validate the reachable channel per row.

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0
  - @objectstack/core@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/core@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/core@12.0.0

## 11.10.0

### Patch Changes

- 6a9397e: Retire the deprecated `compactLayout` alias for `highlightFields` (framework#2536, closes the ADR-0085 deprecation window).

  - `ObjectSchema` no longer declares `compactLayout`: `create()` rejects it like any unknown key; lenient `parse()` strips it (no silent aliasing).
  - The parse-time alias AND the `highlightFields → compactLayout` back-fill transition mirror are removed from `normalizeSemanticRoleAliases`. Served metadata now carries the canonical key only.
  - All remaining first-party authors (27 system objects across plugin-audit / approvals / security / sharing / webhooks / service-storage / automation / messaging / realtime — missed by the #2521 sweep, caught by the type gate) renamed to `highlightFields`.
  - The downstream smoke pin moves to hotcrm v1.2.2 (hotcrm#424: same rename + deps ^11.7.0).
  - Consumers were switched in objectui#2168 and shipped via the console pin bump (#2526); this closes the window scheduled there. The dogfood mirror assertion (#2528) flips to `compactLayout: undefined` in this same change, per the plan it carried.

  Version note: minor, not major — the key was deprecated-with-alias for a full release window, all first-party consumers/authors are migrated, and the spec api-surface gate reports no export changes (same documented-exception path as the ADR-0085 removals in 11.7.0). External metadata still authoring `compactLayout` will now fail `create()` loudly with the standard unknown-key error naming the key.

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- 6d3bf54: fix(messaging): store outbox audit timestamps as datetime so Postgres retention works

  `created_at`/`updated_at` are builtin audit columns that the SQL driver always
  provisions as native `TIMESTAMP` columns, regardless of the declared field type.
  The notification and HTTP outboxes declared them as `Field.number` and wrote
  epoch-ms via `Date.now()`, so on Postgres both the `enqueue` insert and the
  retention sweep failed with `date/time field value out of range` (a bigint
  compared to a timestamp column). SQLite's lenient column affinity hid the bug
  until the multi-node Postgres E2E.

  The outbox objects now declare these as `Field.datetime` and write `Date`s; the
  retention sweep uses one ISO-8601 cutoff for every target (dropping the
  `format: 'epoch'` special case); `toRecord` normalises read-back to epoch ms so
  the record contract is unchanged. `sys_job_run` retention was already ISO.

  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/core@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/core@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1

## 9.5.0

### Minor Changes

- f19caef: feat(P1-2): messaging retention default-on; automation log cap configurable

  Closes the remaining two P1-2 unbounded-growth items (launch-readiness):

  - **service-messaging** — notification-pipeline retention is now **default-on**.
    `MessagingServicePlugin`'s `retentionDays` defaults to
    `DEFAULT_NOTIFICATION_RETENTION_DAYS` (90) instead of `0`; the
    already-built/tested sweeper now prunes `sys_notification` (+ delivery / inbox /
    receipt) older than 90 days by default. **Behaviour change:** notification
    history auto-prunes at 90d — set `retentionDays: 0` to keep it forever.
  - **service-automation** — the in-memory execution-log ring buffer (already
    bounded; no OOM risk) gets a tunable window via
    `AutomationServicePluginOptions.maxLogSize`, defaulting to
    `DEFAULT_MAX_EXECUTION_LOG_SIZE` (1000, unchanged). Durable
    `sys_automation_run`-style persistence remains a post-GA HA item.

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1

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
