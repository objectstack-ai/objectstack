# ADR-0012: Messaging Platform — Outbound Notifications on a Generalized Outbox

**Status**: Draft (2026-05-25 · scope-revised 2026-05-26) · **Superseded by [ADR-0030](./0030-notification-platform-convergence.md)** (2026-06-01) — the M1 implementation drifted (two conflated inbox objects); ADR-0030 records the correction and realizes this layered model. · **Amended (2026-11-03, #29041; extended the same day by #29817 on ruling objectstack-ai/cloud#3519 — 1C 2A 3A 4B 5A 6B 7B, 2026-11-03 — and the spec shape of #29816)**: push ships as `@objectstack/service-push` (the hosted relay, the default transport per cloud#3519, and the direct APNs and FCM transports, behind the kernel's `push` service; amended 2026-11-06, #29920 / PR #30749: this parenthesis read "the direct APNs and FCM transports, the kernel's `push` service; the hosted relay, the default transport per cloud#3519, is not yet served, #29920") with its channel shell `push-channel.ts` in `@objectstack/service-messaging`, which also owns `sys_user_device`; every `plugin-notification-push` below reads that way. The #29817 extension amends: the `push` backend in §4 (it read "APNs (HTTP/2, token auth) + FCM (HTTP v1)" alone; it is now `relay` (hosted, the default) or `direct` (APNs/FCM, white-label)); §6's domestic-vendor bullet (it read "alternate channel implementations"; `vendor` on `sys_user_device` is a token type the relay routes on, not a plugin boundary) and the new §6.1, which records the relay's privacy rule (ID-only, then end-to-end encryption with a device key) and the air-gap rule (no system push; the in-app inbox only); the TL;DR item 2 and the Goals bullet "Four built-in channels" (both read "`push` (APNs + FCM)"); the Goals bullet "Plugin extension" and the Non-Goals bullet "Domestic mobile push vendors" (both read "domestic push vendors ship as plugins / plugin transports"); the M3 milestone line; and risk 5. Each amended passage quotes the wording it replaces; three passages are new and replace nothing: the Non-Goals bullet "System push in an air-gapped deployment", §6.1 and the Decision bullet "Push transports". ADR-0030 is unchanged. · **Amended (2026-11-06, #30670, on ruling Q4 C of #29920)**: §6.1's privacy bullet chooses the generic visible line in the recipient's language (`sys_user.locale`, then the deployment default), where it read "in the device locale"; and §6.1's "What `main` serves" bullet names the tree its reading was taken against again (objectstack-ai/objectstack at 97e42498, the PR #30749 merge), as the heading PR #30749 replaced did ("at 6a4737ab, 2026-11-03").
**Authors**: Platform team — surfaced from GitHub Issue #1292 ("[P0] notification: no outbound notification channel")
**Consumers**: `@objectstack/spec` (new `messaging/` domain), `@objectstack/service-messaging` (new), `@objectstack/plugin-notification-inbox` (new), `@objectstack/plugin-notification-email` (replaces `plugin-email`), `@objectstack/plugin-notification-webhook` (extracted from `plugin-webhooks`), `@objectstack/plugin-notification-push` (new), every flow that has a `notify` node, every template that ships notification rules
**Sibling**: [ADR-0013 — Bidirectional Messaging & Conversational Channels](./0013-bidirectional-messaging.md)

---

## TL;DR

The `notify` node in every flow today resolves a recipient list and then drops the message on the floor — there is no transport. Issue #1292 documents this as a P0 gap across 7 templates (contracts / procurement / compliance / content / todo / hotcrm / helpdesk).

This ADR covers the **outbound half** of a broader Messaging Platform. We extract the outbox / retry / cluster-lock / signing machinery from `plugin-webhooks` into `@objectstack/service-messaging`, ship four built-in **outbound** channels (`inbox` / `email` / `webhook` / `push`), and define the `MessagingChannel` interface so the conversational channels in ADR-0013 (Slack, Lark, Telegram, …) plug in without re-architecting.

This ADR proposes:

1. **Extract** the outbox/retry/lock/signing machinery from `plugin-webhooks` into `@objectstack/service-messaging`.
2. **Ship four built-in channels**: `inbox` (always on), `email`, `webhook` (the existing one, now a channel implementation), `push` (the hosted push relay by default; direct APNs + FCM for a white-label build — amended 2026-11-03, cloud#3519, §6.1; this item read "`push` (APNs + FCM)").
3. **Email becomes a transport sub-system**: SMTP is mandatory baseline (required for air-gapped / on-prem); SendGrid / SES / Resend / Postmark / Aliyun / Tencent register as `EmailTransport` plugins.
4. **Absorb `plugin-email`** into `plugin-notification-email`. Keep `ctx.email.send(...)` as a low-level API for special cases (OTP, password reset) that must bypass user preferences; wrap it as a `MessagingChannel` so flow `notify` nodes get retry/outbox for free.
5. **Other channels (Feishu / DingTalk / WeCom / Slack / SMS / Telegram) ship as plugins**, all implementing the same `MessagingChannel` interface — no special casing. **Bidirectional behaviour (inbound + session) is covered by ADR-0013, not here.**

Net effect: the `notify` node stops being a no-op; users get a real Inbox; templates that already reference channels in their flow YAML start working without code changes; and the `MessagingChannel` seam stays stable when ADR-0013 lands the inbound half.

---

## Scope split with ADR-0013

This ADR is intentionally **outbound-only**. Anything bidirectional is in ADR-0013.

| Concern | This ADR (0012) | ADR-0013 |
|:---|:---|:---|
| `notify` flow node → user gets email/push/inbox/webhook | ✓ | — |
| Reliable delivery (outbox, retry, dead-letter, cluster-lock) | ✓ | reused |
| Per-user preference matrix, mute, quiet hours | ✓ | reused |
| Multi-account per channel | ✓ (schema in M1, single-account UX) | first-class UX |
| User sends a message in Slack/Lark → flow / object hook fires | — | ✓ |
| Session continuity (reply lands in original thread) | — | ✓ |
| `sessionKey` / inbound dedup / target resolver | — | ✓ |
| IM channels (Slack, Lark, Telegram, WeCom, DingTalk) | interface-compatible only | implementation here |

The interfaces below are deliberately shaped so 0013 only *fills in optional fields* — no breaking change to 0012's outbound implementations.

---

## Context

### What's broken (Issue #1292)

Every shipped template has a flow that ends with something like:

```yaml
- type: notify
  recipients: ['{{ approver.email }}']
  message: "Contract {{ contract.code }} needs approval"
```

The flow engine executes the `notify` node, the activity log records it, and **nothing leaves the box**. There is no SMTP call, no in-app inbox row, no webhook fire. Operators discover this only when an approval sits for days because no human was told.

This is a release-blocker for any template that relies on humans receiving signals (contracts, procurement, compliance, helpdesk, todo reminders, content publishing, CRM follow-ups).

### What `plugin-webhooks` already provides (~60% of the work)

`plugin-webhooks` v6.3.0 has, since 2026-Q1, implemented the hard parts of reliable delivery:

| Capability | Where | Notes |
|:---|:---|:---|
| Durable outbox | `sys_webhook_delivery.object.ts` | states: `pending → in_flight → success / failed / dead`; partitioned by `partition_key` |
| Exponential retry | `http-sender.ts` | backoff schedule `1s → 10s → 1m → 10m → 1h → 6h → 24h`, then dead-letter |
| HMAC signing | `http-sender.ts` | `X-Objectstack-Signature` (sha256), `X-Objectstack-Delivery` (uuid), `X-Objectstack-Timestamp` |
| Idempotency | `http-sender.ts` | delivery uuid as `Idempotency-Key`; receivers can dedupe |
| Cluster coordination | `dispatcher.ts` | `cluster.lock(partition_key, ttl=5×tick, default 1.25s)`; safe across replicas |
| Event subscription | `auto-enqueuer.ts` | `data.record.{created,updated,deleted,undeleted}` → enqueue |
| Receiver auth | `webhook-receiver.ts` | verifies inbound signatures; rotates secrets |

This is not a coincidence — it is the same shape any reliable delivery system needs. **The work is to generalize, not to rewrite.**

### What `plugin-email` lacks

`plugin-email` shipped earlier and is the inverse: it has the templates (`sys_email_template`) and a sent-log table (`sys_email`), supports Log / Resend / Postmark transports, and exposes `ctx.email.send(...)`. But it has **no outbox, no retry, no cluster lock, no dead-letter, no bounce/suppression, no preference matrix**. A transient SMTP error or a downed Resend dashboard drops the email permanently. There is also no SMTP transport, which is a hard blocker for on-prem and air-gapped deployments where SaaS providers are not reachable.

### Why "just route everything through webhook" doesn't work

We seriously considered shipping only `plugin-notification-webhook` and pointing email/push/inbox at it. It fails at four boundaries:

1. **Inbox is direction-reversed.** Inbox = "we write a row in our own DB, the user pulls it". There is no outbound HTTP call to make; routing it through webhook is a layer-violating round-trip through the network.
2. **Preferences must live on our side.** "Don't email Bob at night" is a platform decision, not a webhook receiver decision. If the matrix lives downstream, every receiver re-implements it.
3. **Push has a device-token lifecycle.** APNs/FCM tokens expire, get invalidated, and require an *async* feedback channel (token expiry callbacks). A generic webhook can't carry that semantics; the device registry must be in core.
4. **Email needs SMTP for private deploys + audit/compliance.** Air-gapped customers cannot reach SendGrid. A "webhook to SendGrid" approach is also unauditable for SOC2/GDPR — we need first-class sent-logs, bounce handling, and List-Unsubscribe headers under our control.

So: **four built-in channels, all other channels via plugin**.

### How peers solved it

| Platform | Built-in channels | Extension model |
|:---|:---|:---|
| Salesforce | Email, push, in-app, SMS (via Marketing Cloud) | "Notification Builder" + custom types |
| ServiceNow | Email, push, in-app, SMS | Notification preferences per topic; inbound email parsing |
| Jira | Email, in-app, mobile push | Per-user per-event matrix; smart batching |
| Linear | In-app, email, Slack, push | Slack/Discord as first-class integrations; topic-level toggles |
| Slack | In-app (own product), email digest, push | Channel routing rules; quiet hours; DND |
| PagerDuty | Voice, SMS, push, email | Escalation policies; on-call schedules |
| Stripe | Email, webhook, in-app | Webhook is the **primary** integration surface |
| Hasura | Webhook only | Punts to the application layer |

Pattern: the ones that ship to end-users (Salesforce, ServiceNow, Linear, Slack, Jira) all have in-app + email + push as built-ins, with webhook for B2B integration. The ones that target developers only (Stripe, Hasura) lean on webhooks. ObjectStack serves both audiences, so we need both: **built-in for human-facing channels, webhook for everything else, plugin escape hatch for the long tail**.

---

## Goals

* **Fix #1292** — `notify` nodes in shipped templates actually deliver to humans, without per-template wiring.
* **Four built-in channels**: `inbox` (always on, in-app), `email` (SMTP + SaaS transports), `webhook` (B2B integration), `push` (the hosted push relay by default; direct APNs + FCM for a white-label build — amended 2026-11-03, cloud#3519, §6.1; this bullet read "`push` (APNs + FCM)").
* **One delivery substrate** — outbox / retry / cluster-lock / dead-letter / signing live in `service-messaging`; every channel inherits them.
* **Topic + Preference matrix** — users opt out per topic per channel (Slack/Linear pattern); platform-default policies for system-critical topics that cannot be muted (e.g. password reset).
* **Renderer per channel** — same notification, channel-specific body (MJML for email, card JSON for Feishu, 4 KB JSON for push). Plain string is the fallback.
* **Plugin extension** — Feishu / DingTalk / WeCom / Slack / SMS / Telegram ship as `MessagingChannel` plugins with zero core change. *Amended 2026-11-03 (cloud#3519): this bullet read "… / Telegram / domestic push vendors ship as `MessagingChannel` plugins". The domestic push vendors (HMS / Honor / Xiaomi / OPPO / vivo) are not plugins: they are token types the hosted push relay routes on, §6.1.*
* **Email transport sub-system** — SMTP is mandatory and ships in core (private deploy unblock); SendGrid is the SaaS baseline; SES / Resend / Postmark / Aliyun / Tencent register as `EmailTransport` plugins.
* **Absorb `plugin-email`** — keep `ctx.email.send(...)` as a low-level escape hatch for system mail (OTP / password reset that must bypass preferences), but wrap it as a `MessagingChannel` so flow `notify` reuses outbox/retry.
* **Operational parity with webhook** — every channel exposes the same observability surface (`sys_*_delivery` table, dead-letter UI, retry button, metrics).

## Non-Goals

* **Digest / quiet-hours / dedup** as a finished feature in M1. We define the `DeliveryMiddleware` interface and a stub registry, but only ship a no-op middleware. Real digest engines (hourly rollups, "don't ping me again about this") are M2+.
* **Recipient resolver DSL** in M1. We define the interface (`role:approver`, `oncall:incident`, `owner_of:contract`) but only ship a trivial "explicit list + role lookup" resolver. Complex resolvers come from `service-permissions` / `service-oncall` later.
* **Domestic mobile push vendors** (HMS / Honor / Xiaomi / OPPO / vivo) **in phase 1**. `vendor` on `sys_user_device` is the token-type discriminator the push transport routes on; core ships `apns` and `fcm` (`packages/spec/src/system/push-config.zod.ts#PushVendorSchema`, closed on `main`). In phase 2 the hosted push relay fronts the domestic vendors too, and `PushVendorSchema` widens in the same change that routes them (§6.1). *Amended 2026-11-03 (cloud#3519): this bullet read "Schema reserves a `vendor` discriminator on `sys_user_device`, but only APNs and FCM ship in core. Domestic vendors are plugin transports." They are neither plugin transports nor alternate channels.*
* **System push in an air-gapped deployment** (amended 2026-11-03, cloud#3519). The push relay is hosted in objectstack-ai/cloud and there is no self-hosted relay; a deployment with no route to it has no system push, and the direct transport does not restore one, because it needs APNs and FCM. Its users read notifications in the in-app inbox only (§6.1).
* **Inbound email parsing** ("reply to this email to comment on the ticket"). The `EmailTransport` interface is send-only in M1. A parallel `EmailIngest` surface is a later ADR.
* **SMS as a built-in channel.** SMS routes through `plugin-notification-webhook` to Twilio / Aliyun SMS / Tencent SMS, or as a community `plugin-notification-sms` if demand justifies it. Carriers vary too much by region to bake in.
* **In-app real-time push to the browser.** Inbox writes rows; the existing `service-realtime` (websocket) layer decides when to ping the UI. That seam is unchanged.
* **Replacing `ToolRegistry`-style AI tool exposure for "send a notification".** ADR-0011 already covers exposing actions to LLMs; "send_notification" is just another action that opts in.

---

## Proposed Design

### 1. Five-layer architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1 — Event                                                 │
│   data.record.{created,updated,deleted}  /  flow.notify.emit    │
│   approval.requested  /  custom.app.event  /  ai.tool.call      │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 2 — Notification                                          │
│   sys_notification          (topic, payload, severity, dedupKey)│
│   sys_notification_template (per-topic per-channel renderers)   │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 3 — Subscription + Preference                             │
│   sys_notification_topic            (catalog; muteable: bool)   │
│   sys_notification_subscription     (who subscribes to what)    │
│   sys_notification_preference       (user × topic × channel)    │
│   RecipientResolver  (role:approver, owner_of:X, oncall:Y)      │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 4 — Delivery (the generalized outbox)                     │
│   sys_notification_delivery   (pending→in_flight→success/failed/│
│                                dead, partition_key, attempts)   │
│   DeliveryMiddleware chain    (digest, quiet-hours, dedup)      │
│   MessagingChannel impls   (inbox, email, webhook, push, …)  │
│   service-messaging dispatcher  (cluster.lock per partition) │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 5 — Inbox + Receipt                                       │
│   sys_inbox_message      (user-facing in-app rows)              │
│   sys_email              (sent log; ties to delivery)           │
│   sys_email_suppression  (bounce / unsubscribe list)            │
│   sys_user_device        (APNs/FCM tokens; lifecycle hooks)     │
│   sys_notification_receipt (read/clicked/dismissed per channel) │
└─────────────────────────────────────────────────────────────────┘
```

Every layer has a stable seam. A custom channel (e.g. `plugin-notification-feishu`) plugs in at Layer 4 by implementing `MessagingChannel`. A custom resolver plugs in at Layer 3. A custom renderer plugs in between Layer 2 and Layer 4.

### 2. The `MessagingChannel` interface

> **Transport delegation (ADR-0022).** Per [ADR-0022](./0022-connectors-vs-messaging-channels.md), a channel's *transport* — provider auth, base URL, rate-limit handling, the provider's action set — should be implemented on top of a `Connector` (ADR-0015/0018), not hand-rolled per channel. `MessagingChannel` adds only the messaging *semantics* (preferences, inbox, outbox, sessions) on that substrate. The interface below is unchanged; this is an implementation guideline for concrete channels.

```ts
// packages/spec/src/notification/channel.zod.ts
export interface MessagingChannel {
  /** Stable id: 'inbox' | 'email' | 'webhook' | 'push' | 'feishu' | ... */
  readonly id: string;

  /** Capabilities the dispatcher needs to know before scheduling. */
  readonly capabilities: {
    /** Channel accepts a list of recipients per delivery, or one each. */
    batching: 'per_recipient' | 'batch';
    /** Hard payload-size cap (push = 4 KB, email = ~10 MB, webhook = configurable). */
    maxPayloadBytes: number;
    /** Whether channel needs HMAC signing of outbound payloads. */
    signsPayload: boolean;
    /** Whether channel can report async failure (bounces, token-expiry). */
    asyncFeedback: boolean;
  };

  /**
   * Translate a Notification + recipient set into concrete addresses.
   * Returns one Address per delivery the dispatcher should enqueue.
   * For inbox: returns user_id. For email: email address. For push: device tokens.
   * For webhook: receiver URL + secret.
   */
  resolveAddresses(
    ctx: ChannelContext,
    notification: Notification,
    recipients: ResolvedRecipient[],
  ): Promise<Address[]>;

  /**
   * Perform a single delivery attempt. The dispatcher has already locked the
   * partition, checked preferences, applied middleware, and rendered the body.
   * Channel only does the I/O.
   */
  send(ctx: ChannelContext, delivery: Delivery): Promise<SendResult>;

  /**
   * Classify a thrown error so the dispatcher knows what to do:
   *   'retryable'         → backoff and retry
   *   'permanent'         → dead-letter immediately
   *   'invalid_recipient' → mark address as bad (suppress / invalidate device)
   *   'rate_limited'      → respect Retry-After header
   *   'duplicate'         → provider reported "already delivered" (idempotency hit); mark
   *                         success without writing a new external row. Used by IM
   *                         providers that dedupe on (channel, request_id).
   */
  classifyError(err: unknown): ErrorClass;

  // ─── Optional, filled in by ADR-0013 bidirectional channels ──────────────
  //
  // Outbound-only channels (email/inbox/webhook/push) leave these undefined.
  // Slack/Lark/Telegram/… set them so the same MessagingChannel registration
  // works for both directions. The dispatcher only invokes them when present;
  // adding them never breaks an outbound-only impl.

  /**
   * Inbound surface — see ADR-0013. The channel owns its own HTTP/WebSocket
   * route registration and signature verification; what it hands back to the
   * platform is a normalised `InboundMessage` envelope.
   */
  readonly inbound?: {
    verifyAndParse(req: HttpRequest, accountConfig: unknown): Promise<InboundMessage | null>;
    /** Optional: per-event-id dedup window override (default 24h). */
    dedupTtlSec?: number;
  };

  /**
   * Session continuity — see ADR-0013. Lets the channel encode a `sessionKey`
   * (e.g. `slack:T01:C0123:thread:1700000.123`) for replies to land in the
   * original thread / DM / room.
   */
  readonly sessions?: {
    buildSessionKey(msg: InboundMessage): string;
    decodeSessionKey(key: string): unknown;
  };
}
```

The four built-in channels each implement this; everything they do that is *not* in this interface (retry, lock, signing, outbox writes) is handled by `service-messaging`.

### 3. `service-messaging` — the extracted core

Created by lifting `dispatcher.ts` / outbox state machine / cluster lock from `plugin-webhooks` and rewriting them against the abstract `MessagingChannel`:

```
packages/services/service-messaging/
├── dispatcher.ts          (was plugin-webhooks/src/dispatcher.ts)
├── outbox.ts              (state machine for sys_notification_delivery)
├── channel-registry.ts    (DI registration point for MessagingChannel)
├── device-registry.ts     (sys_user_device CRUD + invalidation hooks)
├── transport-registry.ts  (for sub-channels like EmailTransport)
├── renderer-registry.ts   (per-channel renderer lookup)
├── recipient-resolver.ts  (stub resolver in M1; pluggable)
├── middleware/
│   ├── digest.stub.ts     (interface only; no-op in M1)
│   ├── quiet-hours.stub.ts
│   └── dedup.stub.ts
└── index.ts
```

The dispatcher is no longer webhook-aware. It pulls a `pending` delivery row, calls `channelRegistry.get(row.channel_id).send(...)`, applies `classifyError`, writes the next state. `plugin-webhooks` keeps only its HTTP-specific code (signing, receiver auth, the configurable URL list) and registers itself as the `webhook` channel.

### 3.1 Forward-compat seams for ADR-0013

Even though this ADR is outbound-only, we deliberately reserve three seams now so that ADR-0013's bidirectional channels (Slack, Lark, Telegram, …) plug in without any breaking change to the schema or to the four built-in channels. Adding them later would force a data migration.

| Seam | Where it lives in M1 | Used in M1? | Used by ADR-0013 |
|:---|:---|:---|:---|
| `sys_channel_account` table | service-messaging | One implicit "default" row per `(channel_id, environment_id)`. The email/webhook/push channels read/write transparently. | Multi-row per channel: one row per Slack workspace, one per Lark tenant, etc. Each row owns its own OAuth tokens and capability flags. |
| `Address.account_id` column | spec/messaging — present on every Address row | Always points at the default account. | Routes outbound replies back to the workspace the inbound message came from. |
| `Address.session_key` and `Address.reply_to_message_id` | spec/messaging — present, NULL for outbound-only channels | Always NULL. | Encodes "reply in the same thread"; the channel uses it in `send()`. |
| Optional `inbound` / `sessions` blocks on `MessagingChannel` | spec/messaging — declared, undefined for built-ins | Never invoked by M1 dispatcher. | The receiver process scans `channelRegistry` for channels where `inbound` is defined, mounts their HTTP route, and feeds `verifyAndParse` output to `emitInbound(...)`. |
| `messaging.inbound` flow trigger | flow engine — registered but never fired in M1 | None. | ADR-0013 fires it once an inbound message has been normalised, signature-verified, and deduped. |

These cost ~5 columns and one empty table in M1. They are non-negotiable: introducing them in 0013 instead would force every channel impl, every delivery row, and every account credential to be migrated atomically, which is the kind of change we should never need.

### 4. Built-in channel implementations

| Channel | Package | Backend | M1 status |
|:---|:---|:---|:---|
| `inbox` | `plugin-notification-inbox` | Writes to `sys_inbox_message`; fires `service-realtime` event for online users | **MUST ship M1** |
| `email` | `plugin-notification-email` (replaces `plugin-email`) | SMTP + transport plugins (SendGrid baseline) | **MUST ship M1** |
| `webhook` | `plugin-notification-webhook` (extracted from `plugin-webhooks`) | HTTP POST with HMAC | **MUST ship M1** (port existing) |
| `push` | `service-push` (transports) + `push-channel.ts` in `service-messaging` (channel); amended 2026-11-03, #29041 and #29817 | `relay` (hosted, **the default**): the server POSTs an ID-only `PushRelayRequestSchema` to the hosted push relay in objectstack-ai/cloud, authenticated by its cloud binding credential; the relay holds the store-published app's APNs and FCM credentials and forwards each delivery to its vendor. `direct` (APNs HTTP/2 with token auth + FCM HTTP v1, the operator's own credentials): for a white-label build only. The two are the `transport` union on `PushServiceConfigSchema` (#29816); §6.1 has the rules. Before 2026-11-03 this cell read "APNs (HTTP/2, token auth) + FCM (HTTP v1)" alone | `direct` shipped (#29041, PR #29794). `relay` shipped (#29920, PR #30749): the relay transport sends through the hosted relay with the server's cloud binding credential, and `PushServicePlugin` refuses a relay block only on a deployment that declared it has no control plane (§6.1). *Amended 2026-11-06 (#29920, PR #30749): this cell read "`relay` decided (cloud#3519), not yet served: `PushServicePlugin` refuses a relay block, the default `{}` included, at init until #29920 ships the sender".* |

All four bind into `channel-registry` during `onEnable`.


### 5. Email transport sub-system

Email is special because the wire protocol (SMTP) is mandatory for some customers and the SaaS providers (SendGrid, SES, Resend, Postmark, Aliyun DM, Tencent SES) have non-trivial differences in auth, bounce handling, and rate limits. Treating each provider as its own channel would multiply the matrix; treating them all as one `email` channel with pluggable transports keeps the user-facing surface clean.

```ts
// packages/spec/src/notification/transport.zod.ts
export interface EmailTransport {
  /** 'smtp' | 'sendgrid' | 'ses' | 'resend' | 'postmark' | 'aliyun_dm' | … */
  readonly id: string;

  /** Provider-specific Zod schema for sys_email_transport.config column. */
  readonly configSchema: ZodSchema;

  send(ctx: TransportContext, mail: EmailMessage): Promise<TransportResult>;

  /** Map provider error → ErrorClass for dispatcher; e.g. SES throttle → rate_limited. */
  classifyError(err: unknown): ErrorClass;

  /**
   * Optional: handle provider webhook callback (bounce / complaint).
   * If present, plugin registers a route; dispatcher consumes the parsed
   * BounceEvent and writes to sys_email_suppression.
   */
  ingestBounceWebhook?(ctx: TransportContext, payload: unknown): Promise<BounceEvent[]>;
}
```

**M1 ships `smtp` and `sendgrid` transports in core**. SMTP is non-negotiable for on-prem/air-gapped (`@nestjs/microservices`-style transport using `nodemailer`). SendGrid is the SaaS baseline because it covers 80% of cloud customers. Everything else (`ses`, `resend`, `postmark`, `aliyun_dm`, `tencent_ses`, `mailgun`) is a transport plugin published from the same monorepo or third-party.

Selection is per-environment, set in `sys_email_transport`:

```yaml
# default-env's manifest
email_transport:
  id: smtp
  config: { host: smtp.corp.example, port: 587, user: ..., from: 'no-reply@corp.example' }
```

The `email` channel does not know what transport is used; it asks `transport-registry.get(env.email_transport.id)`.

### 6. Push channel — device lifecycle

Push has two things the others don't: a **device registry** and an **invalidation feedback loop**.

```ts
// packages/spec/src/notification/device.zod.ts
export const UserDeviceSchema = z.object({
  user_id:    z.string(),
  device_id:  z.string(),              // client-generated, stable per app install
  vendor:     z.enum(['apns','fcm','hms','xiaomi','oppo','vivo','web_push']),
  token:      z.string(),              // APNs token / FCM token / VAPID endpoint
  app_id:     z.string(),              // bundle / sender id
  platform:   z.enum(['ios','android','web','macos','windows']),
  locale:     z.string().optional(),
  enabled:    z.boolean().default(true),
  invalidated_at: z.string().optional(),// when provider reported token dead
  last_seen_at:   z.string().optional(),
});
```

Lifecycle hooks:

* Client SDK calls `POST /api/v1/notifications/devices` on login → `device-registry.upsert(...)`.
* APNs / FCM `BadDeviceToken` / `Unregistered` response → channel returns `classifyError = 'invalid_recipient'` → dispatcher calls `device-registry.invalidate(token)` (sets `invalidated_at`, `enabled=false`) without dead-lettering the notification (it just routes around the dead token).
  > Amended (2026-11-03, #29041): the push channel (`push-channel.ts` in service-messaging) retires the dead token itself, through `INotificationService.invalidateDeviceToken`, because one delivery fans out to all of the recipient's devices and only the channel knows which token died; the other devices still get the push. The delivery is graded `invalid_recipient` (suppressed, not dead-lettered) only when every device was reported dead. The shipped device shape is `UserDeviceSchema` in `packages/spec/src/system/push-device.zod.ts`, narrowed to `apns` | `fcm` and `ios` | `android` | `web`. `service-push` ships the direct transport and the hosted relay, the default per cloud#3519; a relay `invalid` answer reaches the channel as a dead token and is retired the same way. *Amended 2026-11-06 (#29920, PR #30749): this sentence read "`service-push` ships the direct transport; the hosted relay, the default per cloud#3519, is not yet served (#29920), and `PushServicePlugin` refuses a relay configuration at init until it is."*
* **Domestic vendors are token types the hosted relay routes on, not a plugin boundary** (amended 2026-11-03, cloud#3519). `vendor` on `sys_user_device` says which vendor issued the token, so the sender knows where the delivery goes; it names no plugin and no channel. Core ships `apns` and `fcm` (`packages/spec/src/system/push-config.zod.ts#PushVendorSchema`, closed on `main` at this amendment; `packages/spec/src/system/push-device.zod.ts#UserDeviceSchema` narrows `vendor` to it). In phase 2 the relay fronts HMS / Honor / Xiaomi / OPPO / vivo as well: the server still sends one relay request and the relay routes each delivery by its `vendor`, and `PushVendorSchema` widens to those values in the same change that routes them (its docblock says a new value is a spec change made together with its transport, and #29816 kept it `apns | fcm` on purpose). No card tracks the phase-2 widening yet. *This bullet read: "Domestic vendors (HMS / Xiaomi / OPPO / VIVO) plug in as alternate channel implementations (`plugin-notification-push-hms` etc.), not as transports — their on-device SDKs and quotas are too different to share a code path."*

### 6.1 Push transports — the hosted relay and direct delivery (amended 2026-11-03, cloud#3519)

Ruling objectstack-ai/cloud#3519 (**1C 2A 3A 4B 5A 6B 7B**, 2026-11-03) decides how the push channel reaches a phone. The spec shape landed in #29816: `packages/spec/src/system/push-config.zod.ts#PushServiceConfigSchema` and `packages/spec/src/api/push-relay.zod.ts#PushRelayRequestSchema`. What `main` serves is the last bullet; everything else here is decided and planned.

* **Two transports, discriminated by `transport`; the hosted relay is the default.** The store-published ObjectOS app is signed with ObjectStack's own APNs key and Firebase project, and those credentials never leave ObjectStack. So a server — a private deployment included — delivers to that app through the hosted push relay in objectstack-ai/cloud: `transport: 'relay'` (`packages/spec/src/system/push-config.zod.ts#PushRelayTransportConfigSchema`; an empty block reads as it). The relay authenticates the server by its cloud binding credential (cloud ADR-0008), so the relay block carries no credential; beside `transport`, its only key is `endpoint`, for a staging relay, and the production relay's address is the cloud's to publish, never written into the spec. `transport: 'direct'` (`packages/spec/src/system/push-config.zod.ts#PushDirectTransportConfigSchema`) is for a white-label build: an app signed with the operator's own APNs key and Firebase project, which the relay cannot deliver to. It carries one block per vendor (`apns`, `fcm`), at least one, each naming its secret by `credentialRef`. The mixed shapes are refused when written: a credential inside a relay block, a direct block with no vendor block, `endpoint` on a direct block. A block without `transport` keeps parsing: no vendor block reads as the relay, a vendor block reads as direct.
* **The wire.** The server POSTs one `packages/spec/src/api/push-relay.zod.ts#PushRelayRequestSchema` — one delivery per device token: `token`, `vendor`, `payload`, `priority` — with the binding credential as its bearer and no credential in the body. The relay answers one result per delivery, in request order (`packages/spec/src/api/push-relay.zod.ts#PushRelayResponseSchema`): `ok`; `invalid`, the vendor reports the token dead, and the sender retires the device row exactly as the lifecycle bullets above do for a direct transport; or `retry`, a transient failure. It refuses a whole request with the house error envelope (`packages/spec/src/api/push-relay.zod.ts#PushRelayErrorResponseSchema`): 401 `UNAUTHENTICATED` for a bad or revoked binding, 429 `RATE_LIMIT_EXCEEDED` or `QUOTA_EXCEEDED`. One schema, pinned by both ends: the sender here and the relay in objectstack-ai/cloud.
* **Vendor is a token type the relay routes on.** `vendor` on the device row tells the sender, and through it the relay, which vendor the token belongs to, and nothing else. Phase 1 routes `apns` and `fcm`; phase 2 adds the domestic vendors (HMS / Honor / Xiaomi / OPPO / vivo) behind the same relay and widens `PushVendorSchema` with them. There is no per-vendor plugin and no per-vendor channel.
* **Privacy — the relay never receives plaintext content.** Phase 1 is ID-only: a relay delivery's payload (`packages/spec/src/api/push-relay.zod.ts#PushRelayPayloadSchema`) carries the push delivery data — the notification id, its same-server `route` and the sending server's `origin` — and one generic visible line (for example "You have a new notification", in the recipient's language (`sys_user.locale`, then the deployment default)), and nothing else. `title`, `body`, `subtitle`, `message` and `content` are refused by name; the shell reads the notification from the server after the tap, by its id; the relay treats the payload as opaque and puts it in the vendor message unchanged. Phase 2 is end-to-end encryption of the payload with a device key the app registers (the device registration gains a `pushKey` in that phase, which #29816 left out on purpose; no card yet). The direct transport is outside this rule: it reaches APNs and FCM under the operator's own credentials with no third party in between, and the push channel sends the notification's title and body through it today (PR #29794). *Amended 2026-11-06 (#30670, ruling Q4 C on #29920): the generic line's language read "in the device locale".*
* **Air-gap — no system push; the in-app inbox only.** The relay is hosted in objectstack-ai/cloud and there is no self-hosted relay. A deployment that cannot reach it has no system push, and the direct transport does not restore one, since it needs APNs and FCM. Its users read notifications in the in-app `inbox` channel, which needs no external service. (Email's own air-gap rule, SMTP in core, is §5 and is unchanged.)
* **What `main` serves** (objectstack-ai/objectstack at 97e42498, 2026-11-06; amended 2026-11-06, #29920 / PR #30749). Both transports are served by `@objectstack/service-push`, behind the kernel's `push` service. `direct`: `ApnsPushTransport` (HTTP/2, token auth) and `FcmPushTransport` (HTTP v1), built from the direct block (#29041, PR #29794). `relay`, the default: `packages/services/service-push/src/transports/relay.ts#RelayPushSender` POSTs one ID-only `PushRelayRequestSchema` per push to the relay endpoint (the relay block's `endpoint`, else the control-plane URL plus `packages/services/service-push/src/transports/relay.ts#PUSH_RELAY_PATH`), with the bearer read on every send from the `cloud-binding` service that `@objectstack/cloud-connection` registers (`packages/cloud-connection/src/cloud-binding.ts#createCloudBinding`, the interface `packages/spec/src/contracts/cloud-binding-service.ts#ICloudBindingService`). While the server is not bound, the relay transport lists no vendor, so the push channel is suppressed as `transport_not_configured` and notifications reach the in-app inbox; the bind takes effect without a restart. A deployment that declared it has no control plane (`OS_CLOUD_URL=off`, `none`, `local`, `disabled`) has its relay block refused at init with `packages/services/service-push/src/push-plugin.ts#PUSH_RELAY_AIR_GAPPED_MESSAGE`, the air-gap rule above. The `push` channel shell in `packages/services/service-messaging/src/push-channel.ts` fans one delivery out to the recipient's enabled devices and retires dead tokens. The relay schemas in `packages/spec/src/api/push-relay.zod.ts` no longer carry a `[PLANNED — not yet served]` marker. The phase-2 vendors and the end-to-end encryption are decided and planned, with no card yet. *Amended 2026-11-06 (#29920, PR #30749): this bullet was headed "What `main` serves at this amendment (objectstack-ai/objectstack at 6a4737ab, 2026-11-03)", and its relay half read "`relay` is decided and not served: `PushServicePlugin` refuses a relay block, the default `{}` included, at init with `PUSH_RELAY_NOT_SERVED_MESSAGE` (`push-plugin.ts`), so no server is left believing it pushes when nothing would deliver; the relay sender is #29920; until it ships, the relay transport block (`PushRelayTransportConfigSchema`) and the seven relay object schemas in `push-relay.zod.ts` … carry a `[PLANNED — not yet served]` marker". That export is retired by PR #30749, so the quotation names it without its anchor.*

### 7. Topic + Preference matrix

```ts
// packages/spec/src/notification/topic.zod.ts
export const NotificationTopicSchema = z.object({
  name:        z.string().regex(/^[a-z_][a-z0-9_]*$/),   // 'contract.approval_requested'
  label:       z.string(),
  description: z.string().optional(),
  category:    z.string().optional(),                    // 'contracts' for grouping in UI
  severity:    z.enum(['info','warning','critical']).default('info'),
  /** If true, users cannot mute this topic (password reset, security alerts). */
  mandatory:   z.boolean().default(false),
  /** Default channels for users who haven't set preferences. */
  default_channels: z.array(z.string()).default(['inbox']),
});

// packages/spec/src/notification/preference.zod.ts
export const NotificationPreferenceSchema = z.object({
  user_id:  z.string(),
  topic:    z.string(),
  channel:  z.string(),
  enabled:  z.boolean(),
  // Future: quiet_hours, digest_window — schema reserves the column, M1 ignores.
});
```

The dispatcher resolves recipients → fans out per channel → for each `(user, channel)` pair, checks `mandatory || preference.enabled || (no row && topic.default_channels.includes(channel))`. Anything that doesn't pass is dropped at this layer, *not* in the channel — so we get one place to audit "why didn't Bob get the email".

### 8. Renderer interface

```ts
// packages/spec/src/notification/renderer.zod.ts
export interface NotificationRenderer<TPayload, TBody> {
  readonly topic:   string;           // 'contract.approval_requested' or '*'
  readonly channel: string;           // 'email' | 'inbox' | 'push' | …
  render(payload: TPayload, ctx: RenderContext): Promise<TBody>;
}
```

Channel-specific body shapes:

| Channel | TBody |
|:---|:---|
| inbox  | `{ title, body_md, action_url, severity, icon }` |
| email  | `{ subject, html (from MJML compile), text, attachments?, headers? }` |
| webhook | `{ event, payload_json }` — same shape `plugin-webhooks` already uses |
| push   | `{ title, body, data, sound?, badge? }` ≤ 4 KB; channel enforces |

Templates live in `sys_notification_template (topic, channel, version, body, locale)`. Authors can ship per-template-per-channel; if a channel is missing a template, the dispatcher falls back to a generic renderer that uses `notification.title` / `notification.body_md`.

### 9. `plugin-email` absorption path

The existing `plugin-email` is **not** deleted in M1. It is renamed and refactored:

1. **Rename package** `@objectstack/plugin-email` → `@objectstack/plugin-notification-email`. Keep `@objectstack/plugin-email` as a deprecated alias that re-exports (M1 only; removed in next major).
2. **Keep `ctx.email.send(...)`** as the low-level API for system-critical mail (OTP, password reset, magic links). This bypasses the preference matrix because `mandatory:true` topics shouldn't even get there. Implementation routes through the same `service-messaging` outbox so retries are inherited.
3. **Wrap with `MessagingChannel`**: register a `'email'` channel that internally calls the same transport sub-system; `notify` nodes in flows go through topic/preference/render and then end up in the same outbox row.
4. **Migrate tables**: `sys_email` (sent log) and `sys_email_template` stay, with `sys_email.delivery_id` FK added to tie back to `sys_notification_delivery`. Add new `sys_email_suppression` and `sys_email_transport`.
5. **Existing transports** (`log`, `resend`, `postmark`) move into `transport-registry` unchanged; new `smtp` and `sendgrid` join them.

No app code that calls `ctx.email.send(...)` breaks. Anything that previously bypassed the outbox now silently inherits durability.


### 10. Schema list — `packages/spec/src/notification/`

Per CLAUDE.md Prime Directive 8 ("one Zod source per metadata type"), every concept gets exactly one Zod file:

| File | Purpose |
|:---|:---|
| `channel.zod.ts` | `MessagingChannelSchema` (channel descriptor + capabilities) |
| `transport.zod.ts` | `EmailTransportSchema` (and future per-channel transport descriptors) |
| `template.zod.ts` | `NotificationTemplateSchema` (per topic × channel × locale × version) |
| `topic.zod.ts` | `NotificationTopicSchema` (catalog + mandatory flag + default channels) |
| `preference.zod.ts` | `NotificationPreferenceSchema` (user × topic × channel matrix) |
| `notification.zod.ts` | `NotificationSchema` (the wire-level message: topic, payload, severity, dedup_key) |
| `delivery.zod.ts` | `NotificationDeliverySchema` (outbox row: state machine, attempts, partition_key) |
| `device.zod.ts` | `UserDeviceSchema` (push device registry with vendor discriminator) |
| `email-suppression.zod.ts` | `EmailSuppressionSchema` (bounce + unsubscribe list) |
| `renderer.zod.ts` | `RendererDescriptorSchema` (registry entry; runtime interface lives in `service-messaging`) |
| `recipient-resolver.zod.ts` | `RecipientResolverDescriptorSchema` (registry entry; resolver impl is runtime code) |
| `middleware.zod.ts` | `DeliveryMiddlewareDescriptorSchema` (digest/quiet-hours/dedup stubs) |
| `index.ts` | Re-exports under `Notification` namespace |

These join the existing namespace exports as `import { Notification } from '@objectstack/spec'`.

### 11. Object tables (singular metadata type, `sys_` prefix per Prime Directive 7)

| Table | Owner | Purpose |
|:---|:---|:---|
| `sys_notification` | service-messaging | One row per emitted notification (pre-fan-out). Holds payload, topic, severity, dedup_key. |
| `sys_notification_topic` | service-messaging | Catalog of known topics. Seeded from `defineTopic(...)` in plugins. |
| `sys_notification_template` | service-messaging | Per topic × channel × locale × version. MJML for email, JSON for others. |
| `sys_notification_subscription` | service-messaging | Who is subscribed to which topic (system-wide, role-based, or explicit). |
| `sys_notification_preference` | service-messaging | User × topic × channel toggles. |
| `sys_notification_delivery` | service-messaging | The outbox. State machine + partition_key + attempts. |
| `sys_notification_receipt` | service-messaging | Per-channel read/clicked/dismissed. Populated by inbox UI + webhook callbacks where supported. |
| `sys_inbox_message` | plugin-notification-inbox | User-facing in-app messages. Indexed by `(user_id, created_at desc)`. |
| `sys_user_device` | plugin-notification-push | Push device registry. |
| `sys_email` | plugin-notification-email | Sent-log (existed; gains `delivery_id` FK). |
| `sys_email_template` | plugin-notification-email | Existed; refactored to share schema with `sys_notification_template`. |
| `sys_email_suppression` | plugin-notification-email | Bounce / complaint / unsubscribe list. Address-keyed. |
| `sys_email_transport` | plugin-notification-email | Per-environment transport selection + provider config. |
| `sys_webhook` | plugin-notification-webhook | Existed (renamed seam unchanged). |
| `sys_webhook_delivery` | plugin-notification-webhook | Existed; transitions to using `sys_notification_delivery` view in M2. |
| `sys_channel_account` | service-messaging | **Forward-compat seam for ADR-0013.** Multi-account-per-channel descriptor: `(id, channel_id, environment_id, credentials_ref, capabilities_json)`. In M1 the email/webhook/push channels write exactly one row per env (the implicit "default account") so behaviour is unchanged. ADR-0013 channels (Slack workspace, Lark tenant, …) write N rows. The `Address` shape gains an `account_id` column from day 1 so we never need a data migration. |

> The `sys_channel_account` table is intentionally introduced in this ADR even though M1 only uses it in single-row "default account" mode. Introducing it later would force a data migration on every existing channel row. See §3.1.

### 12. Wire-up — how a `notify` node ends up delivered

```
flow.notify({ topic: 'contract.approval_requested', recipients: ['role:approver'], payload: {...} })
    │
    ▼
service-messaging.emit(notification)
    │  writes sys_notification row, sets dedup_key
    ▼
RecipientResolver.resolve('role:approver', ctx) → [user_42, user_57]
    │
    ▼
for each user × default-or-preferred channels:
    check preference matrix  →  build sys_notification_delivery row(s)
    │
    ▼
DeliveryMiddleware.before(delivery)  (M1: no-op; M2: digest/quiet-hours)
    │
    ▼
dispatcher loop:
    cluster.lock(partition_key)
    renderer.render(payload, channel)  →  body
    channel.send(delivery)
    on retryable → outbox.scheduleRetry(backoff[attempt])
    on permanent → outbox.deadLetter
    on invalid_recipient → suppression/device invalidation, drop without dead-lettering
```

### 13. Observability

Every channel gets the same Studio surface (built once in `service-messaging`):

* **Deliveries view** — filter by channel / topic / state / time range; columns: state, attempts, last_error, next_retry_at, partition_key.
* **Dead-letter inspector** — view payload, replay button, bulk-replay.
* **Metrics** — `notification.delivery.{enqueued,sent,failed,dead}` counters tagged by `channel` and `topic`; `notification.delivery.duration_ms` histogram.
* **Per-user audit** — "why didn't Bob get this?" answers: matched preference row, middleware drops, render errors, channel errors.


---

## Milestones

### M1 — close #1292 (target: this release)

* `packages/spec/src/notification/` with the 12 Zod files above.
* `packages/services/service-messaging/` extracted from `plugin-webhooks` dispatcher.
* `plugin-notification-inbox` — writes `sys_inbox_message`, fires realtime ping.
* `plugin-notification-email` — absorbs `plugin-email`; ships `smtp` + `sendgrid` transports + existing `log`/`resend`/`postmark` migrated.
* `plugin-notification-webhook` — `plugin-webhooks` becomes a channel implementation; no functional change for existing receivers.
* `plugin-notification-push` — APNs HTTP/2 + FCM HTTP v1; `sys_user_device` lifecycle.
* `notify` flow node wired to `service-messaging.emit(...)`.
* `defineTopic(...)` builder + seeded catalog for the 7 shipped templates.
* Recipient resolver: explicit list + `role:*` + `owner_of:*` (anything else falls back to `[]`).
* `DeliveryMiddleware` interface present, no-op middlewares registered.
* Studio "Deliveries" + "Dead-letter" page (built once, used by all 4 channels).
* Migration: `plugin-email` → `plugin-notification-email` alias re-export, `sys_email.delivery_id` FK populated for new mail; old `sys_email` rows untouched.

### M2 — make it pleasant

* Real digest middleware (per-user hourly/daily rollup, configurable).
* Real quiet-hours middleware (timezone-aware; mandatory topics bypass).
* Real dedup middleware (dedup_key + window).
* Studio UI for end-user preference matrix.
* Bounce ingestion endpoints for SES / Resend / Postmark / SendGrid → `sys_email_suppression`.
* List-Unsubscribe header + one-click unsubscribe endpoint.

### M3 — long-tail outbound channels

* `plugin-notification-sms` with Twilio / Aliyun-SMS / Tencent-SMS transports.
* Domestic push: HMS / Honor / Xiaomi / OPPO / vivo, fronted by the hosted push relay as token types (phase 2 of cloud#3519, §6.1). *Amended 2026-11-03: this line read "as channel plugins".*
* Inbound email parsing (`EmailIngest`) — separate ADR.
* Escalation policies + on-call schedules (depends on `service-oncall`).

> **IM channels moved to ADR-0013.** Slack / Feishu / Lark / DingTalk / WeCom / Telegram are inherently bidirectional — shipping them as outbound-only would force a redesign once we add chat. They are now covered in [ADR-0013](./0013-bidirectional-messaging.md), which targets Slack first.

---

## Acceptance criteria (mapping to #1292)

| #1292 checklist item | M1 deliverable |
|:---|:---|
| `notify` node emits a real delivery | `service-messaging.emit(...)` writes `sys_notification` + fans out `sys_notification_delivery` rows |
| Inbox channel works | `plugin-notification-inbox` + `sys_inbox_message` + `GET /api/v1/notifications/inbox` |
| Email channel works on private deploys | `smtp` transport ships in core; `email_transport: { id: 'smtp', ... }` in env manifest |
| Email channel works on cloud | `sendgrid` transport ships in core; SES/Resend/Postmark as transport plugins |
| Webhook channel keeps working | `plugin-notification-webhook` is the existing `plugin-webhooks` repackaged; receivers unchanged |
| Push channel works | APNs + FCM in `plugin-notification-push`; `sys_user_device` lifecycle |
| User can opt out | `sys_notification_preference` matrix; mandatory topics bypass |
| Failures don't disappear | Outbox + retry schedule + dead-letter + Studio inspector |
| Templates render per channel | `sys_notification_template (topic, channel, locale, version)` + `RendererRegistry` |
| Plugins can add channels | Public `MessagingChannel` interface + `channel-registry.register(...)` |
| Plugins can add email providers | Public `EmailTransport` interface + `transport-registry.register(...)` |

---

## Risks & open questions

1. **Plugin-webhooks → plugin-notification-webhook rename.** Existing apps import `@objectstack/plugin-webhooks`. M1 keeps it as a deprecated alias; M2 may break. Decision: **alias for one major, hard break after**.
2. **`sys_email` schema drift.** Existing `plugin-email` writes a sent-log row directly. After absorption, writes route through outbox. We add `delivery_id` nullable and backfill nothing — old rows stay readable, new rows tie to delivery.
3. **MJML compile at runtime vs. at template-save time.** Lean toward save-time (cache compiled HTML in `sys_notification_template.compiled_html`) to avoid CPU per send. M1 can compile on send; M2 caches.
4. **Inbox cardinality.** A noisy app could write millions of `sys_inbox_message` rows. We add retention config per topic (`retain_days`, default 90) and a daily cleanup job. M1 ships retention column; cleanup job is M2.
5. **Push payload encryption (Web Push VAPID).** Out of scope for M1; FCM and APNs only. *Amended 2026-11-03 (cloud#3519): the relay payload is ID-only in phase 1 and end-to-end encrypted with a device key in phase 2 (§6.1); Web Push stays out of scope.*
6. **Multi-environment fan-out.** A notification emitted in env A must not leak to a user in env B. Resolver MUST scope by `environment_id`; preference rows are environment-local. Cross-env notifications require a future federation ADR.
7. **GDPR / CAN-SPAM.** Email channel must include `List-Unsubscribe` + physical address footer hook in templates. M1 includes the header column; M2 builds the one-click endpoint.

---

## Decision

Adopt the design above. Specifically:

* **Four built-in outbound channels**: `inbox`, `email`, `webhook`, `push` — all implementing `MessagingChannel`.
* **Push transports (amended 2026-11-03, cloud#3519)**: the hosted push relay is the default push transport and direct APNs/FCM delivery is for white-label builds (`transport: relay | direct`); `vendor` on `sys_user_device` is a token type the relay routes on, and the domestic vendors arrive behind the relay in phase 2, never as plugins; the relay never receives plaintext content (ID-only, then end-to-end encrypted with a device key); an air-gapped deployment has no system push, the in-app inbox only. §4, §6 and §6.1.
* **One generalized dispatcher** in `@objectstack/service-messaging`, extracted from `plugin-webhooks`.
* **Email transport sub-system**: `smtp` and `sendgrid` in core; others as `EmailTransport` plugins.
* **`plugin-email` absorbed** into `plugin-notification-email` with a deprecated alias for one major.
* **All other outbound channels via plugin** implementing the same interface; no special casing.
* **Forward-compat seams reserved now** (`sys_channel_account`, `Address.account_id` / `session_key` / `reply_to_message_id`, optional `inbound`/`sessions` blocks on `MessagingChannel`, `messaging.inbound` flow trigger) so ADR-0013 lands without schema migrations.
* **Bidirectional / conversational channels deferred to [ADR-0013](./0013-bidirectional-messaging.md)** — including the M3 IM channels that earlier drafts of this ADR placed here.

This closes #1292 in M1 without locking us into ServiceNow-style monoliths or Stripe-style "punt to the client" minimalism. The seams are stable enough for the M2 enhancements and for ADR-0013 to land without re-architecting.

---

## 14. Relationship to ADR-0013 (Bidirectional Messaging)

ADR-0013 is the *inbound* and *conversational* half of the Messaging Platform. The split is:

```
                       ADR-0012 (this ADR)              ADR-0013
                       ─────────────────                ────────
  Owns interface       MessagingChannel (full)          MessagingChannel.inbound / sessions
  Owns service         service-messaging dispatcher     service-messaging receiver
  Owns DB              outbox + delivery + preference   sys_inbound_event + session registry
  Channels shipped     inbox, email, webhook, push      slack (first), then lark/telegram
  Direction            platform → user                  user → platform (and reply)
  Reuses from sibling  —                                outbox/retry/cluster-lock/dispatcher
```

Both ADRs share **one** `MessagingChannel` interface and **one** dispatcher. A channel may implement only `send()` (this ADR) or both `send()` and `inbound.verifyAndParse()` (ADR-0013). The dispatcher does not care.

If you read 0012 in isolation, treat the optional fields above as "do not implement, ignore on read". If you read 0013, treat 0012's outbox, retry, cluster-lock, preference matrix, and dead-letter as **prerequisites** — 0013 does not re-implement them.
