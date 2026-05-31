# ADR-0013: Bidirectional Messaging — Conversational Channels, Slack First

**Status**: Draft (2026-05-26)
**Authors**: Platform team
**Consumers**: `@objectstack/spec` (extensions to the `messaging/` domain introduced by ADR-0012), `@objectstack/service-messaging` (gains a receiver sub-system), `@objectstack/plugin-messaging-slack` (new, first reference implementation), future `plugin-messaging-lark` / `plugin-messaging-telegram` / `plugin-messaging-wecom` / `plugin-messaging-dingtalk`, the flow engine (new `messaging.inbound` trigger), ADR-0011 (Actions as AI Tools — inbound messages may become tool calls)
**Sibling**: [ADR-0012 — Messaging Platform (Outbound)](./0012-notification-platform.md)
**Related**: ADR-0011 (Actions as AI Tools), ADR-0010 (NL → Flow authoring)

---

## TL;DR

ADR-0012 ships the outbound half of the Messaging Platform: the platform can send a notification to a user's email / push / inbox / webhook. This ADR ships the **inbound and conversational half**: a user can send a message *into* ObjectStack from a chat product (Slack first), the platform routes it to a flow trigger / object hook / AI tool call, and any reply lands back in the same thread.

Concretely, this ADR proposes:

1. **A new `service-messaging` receiver sub-system** that mounts per-channel HTTP routes, verifies signatures, normalises payloads into an `InboundMessage` envelope, and emits a `messaging.inbound` event.
2. **Multi-account-per-channel as first-class** — `sys_channel_account` (introduced as a forward-compat seam in ADR-0012) becomes a real CRUD surface in Studio. One Slack workspace = one account row.
3. **A `sessionKey` grammar** so replies route back to the same thread / DM / room. Encoded into `Address.session_key`; consumed by `MessagingChannel.send()` on the reply path.
4. **A `target-resolver` registry** so messages of the form `@objectos create a contract for Acme` map to a flow / action / AI tool. First built-in: `mention` resolver (any message mentioning the bot) and `dm` resolver (any DM to the bot user).
5. **Slack as the first reference implementation** — Events API + Bot OAuth + signing-secret verification + thread-aware replies. Socket Mode supported as an alternative transport for behind-NAT installs.
6. **Integration with ADR-0011** — an inbound message can be dispatched as an LLM tool call via the AI Action Registry. The Slack thread becomes the conversation transcript.
7. **Borrow design from openclaw, not code from openclaw** — openclaw's `ChannelPlugin` interface shape and `sessionKey` grammar are the reference; the implementation is objectstack-native (sys_* tables, Zod, plugin DI, outbox-backed reply path). License (MIT) permits copying specific utilities verbatim (`safeEqualSecret`, text chunker) if useful.

Net effect: users get "chat with ObjectStack from Slack" — comments on objects become Slack threads, approvals can be granted in-thread, AI assistants are available without leaving Slack — without forking openclaw and without sacrificing the durability / multi-tenancy / metadata-driven model that the rest of ObjectStack stands on.

---

## Scope split with ADR-0012

| Concern | ADR-0012 | This ADR (0013) |
|:---|:---|:---|
| `notify` flow node → user gets email/push/inbox/webhook | ✓ | — |
| Outbox / retry / dead-letter / cluster-lock | ✓ owns | reuses |
| Preference matrix, mute, quiet hours | ✓ owns | reuses (Slack channel respects them) |
| `MessagingChannel.send()` | ✓ defined | reused for reply path |
| `MessagingChannel.inbound.verifyAndParse()` | seam reserved | ✓ implemented |
| `MessagingChannel.sessions.*` | seam reserved | ✓ implemented |
| `sys_channel_account` table | seam reserved (single default row) | ✓ multi-row, full Studio UX |
| `Address.session_key` / `reply_to_message_id` | columns reserved, NULL | ✓ populated |
| `messaging.inbound` flow trigger | registered, never fires | ✓ fires |
| `service-messaging` receiver (HTTP routes for inbound) | — | ✓ new sub-system |
| `target-resolver` registry (route inbound → flow/action/AI tool) | — | ✓ new |
| Slack channel implementation | — | ✓ first reference impl |
| Future IM channels (Lark/Telegram/WeCom/DingTalk) | — | M2/M3 of this ADR |

No schema migration is needed in ADR-0012 to land this ADR — the seams were paid for up front.

---

## Why we need this

### The user-visible gap

Today, an ObjectStack user who wants to:

* See contract-approval requests in Slack and approve them in-thread → **can't**, only email/inbox arrive.
* Ask "hey ObjectOS, create a contract for Acme" in Slack → **can't**, the platform never sees the message.
* Have a comment thread on a `sys_ticket` automatically mirror to a Slack channel where engineers actually live → **can't**, threads have no concept of an external transport.
* Continue an AI assistant conversation across Slack and the web Studio → **can't**, AI tool calls only exist inside the Studio chat panel.

Every one of these is "users live in chat products; ObjectStack does not meet them there". The closest comparable products (Linear, Height, Notion AI, Vanta) all ship Slack as a first-class bidirectional integration; not having it leaves us in a clear feature gap.

### Why ADR-0012 alone doesn't cover it

ADR-0012's `MessagingChannel.send()` is fire-and-forget. It can deliver a notification *to* Slack, but:

* There is no inbound seam — Slack's `events.api` POST has nowhere to land.
* There is no notion of session — a reply to "Approve PR #42?" would arrive into the outbox as a new notification, not as a reply on the same thread.
* The `sys_email_transport`-style "one transport per channel per env" model collapses for IM: one customer commonly has 1 Slack workspace + 3 Lark tenants + 2 Telegram bots simultaneously.
* There is no path from inbound text → flow trigger / object hook / AI tool call.

These are not 0012 bugs — they are out of scope. The seams 0012 reserves (`sys_channel_account`, `Address.session_key`, optional `inbound`/`sessions` blocks, `messaging.inbound` trigger) exist precisely so this ADR can fill them in without breaking anything.

### Why not just adopt openclaw wholesale

openclaw (MIT) has a polished bidirectional channel system covering 60+ providers. Adopting it as-is fails on six axes:

1. **It is a runtime, not a library.** Its `ChannelPlugin` interface is tightly bound to openclaw's Gateway/Monitor process model, its global config tree (`cfg.channels.<x>.accounts[<id>]`), and its rule-engine dispatch chain. Adopting the interface means adopting all of that infrastructure.
2. **Its message processing terminus is an AI agent.** openclaw assumes every inbound message goes through mention-gating → rule engine → AI agent. ObjectStack inbound must fan to flow triggers, object hooks, AI tool calls, *and* notification read-receipts. Splitting out the non-AI paths is a core-abstraction change, not a wrapper change.
3. **It has no outbox / dead-letter / cluster-lock.** openclaw is a single-machine desktop assistant; lost messages are acceptable. ObjectStack cannot drop a "contract approved" reply. ADR-0012 already owns this stack — borrowing openclaw forces us to either lose durability or run two delivery systems in parallel.
4. **Single-tenant config model.** openclaw's channel registry is a process-global singleton. ObjectStack runs N environments per kernel, each with its own Slack workspace and isolation requirements. Every interface signature would need an `environment_id` retrofit.
5. **Strategic dependency risk.** Core platform capability sitting on a third-party runtime's release cadence is the wrong trade for a long-lived B2B platform.
6. **Product boundary smear.** If our `MessagingChannel` is literally openclaw's `ChannelPlugin`, plugin authors must read openclaw docs to extend us, and customers ask "can I install openclaw plugins directly" — a question with no clean answer.

**What we do instead**: borrow the design (interface shape, sessionKey grammar, inbound envelope structure, multi-account layering, target resolver, delivery correlation) and re-implement it inside ObjectStack's own substrate. Where openclaw has a clean utility that solves a generic problem (signature constant-time equality, message text chunking, lazy provider-SDK loading), the MIT license lets us copy it verbatim. The shape is shared; the runtime is ours.

---

## Goals

* **Slack-first, ship in M1.** Events API + Bot OAuth + signing-secret verification + thread-aware replies; one workspace per account row; multiple workspaces per env.
* **One `MessagingChannel` interface, two directions.** A bidirectional channel implements `send()` (from 0012) plus the optional `inbound` and `sessions` blocks. The dispatcher and the receiver share one registry.
* **Inbound messages route to one of: flow trigger, object hook, AI tool call, or read-receipt.** No hard-coded AI path; dispatch is by `target-resolver`.
* **Session continuity.** A reply to a notification lands on the same Slack thread. A new comment on a `sys_ticket` whose Slack thread already exists appends to it.
* **Multi-account is first-class.** UX for "add Slack workspace" / "rotate token" / "remove account" / "transfer ownership" in Studio. Credentials never appear in plaintext outside `service-secrets`.
* **Inbound durability matches outbound.** Verified-and-deduped inbound rows live in `sys_inbound_event` and are processed by the same outbox-style state machine (`pending → handled / failed / dead`).
* **Replies inherit the outbox.** The reply path enqueues a `sys_notification_delivery` row exactly like a `notify` node would; nothing about retry/cluster-lock/dead-letter is special.
* **AI integration is opt-in.** A workspace can choose: (a) every mention → tool call to AI agent, (b) only DMs → AI, (c) no AI dispatch at all. The AI side uses ADR-0011's Action Registry — no new tool-exposure mechanism.
* **Borrow specific openclaw utilities under MIT.** `safeEqualSecret`, the message-chunking helpers, and the lazy provider-SDK loader are clean enough to import (with attribution). Everything else is rewritten against ObjectStack primitives.

## Non-Goals

* **Lark / Telegram / WeCom / DingTalk in M1.** Their channel plugins are M2/M3 — they reuse the same interface so adding them is mostly a Slack-shaped copy with provider-specific signing and payload mapping.
* **WhatsApp / iMessage / Matrix / Signal / IRC.** Out of scope; openclaw has reference implementations under MIT we can study when we get there.
* **Voice / phone-call channels.** PagerDuty-style voice escalation belongs in a future on-call ADR.
* **Replacing the Studio chat panel.** Studio chat continues to exist; this ADR adds a second surface, not a replacement.
* **Cross-channel session bridging.** "Continue the Slack conversation on Lark" is not a goal — each session is bound to one channel-account.
* **Slack Connect / shared-channel security model.** First version assumes single-workspace conversations. Cross-org shared channels are M3.
* **In-line interactive Block-Kit UX beyond approve/deny buttons.** First version ships approve/deny and "open in Studio" link. Richer modals (e.g. full form input) are M2.
* **Inbound email parsing.** Still owned by a separate future ADR; this ADR is IM-shaped.

---

## Proposed Design

### 1. Architecture overview

```
                           ┌────────────────────────────────────────┐
 Slack / Lark / Telegram   │                                        │
        │  events POST     │   service-messaging RECEIVER           │
        │                  │   (this ADR adds it)                   │
        │                  │                                        │
        ▼                  │   ┌──────────────────────────────────┐ │
 ┌─────────────────┐       │   │ HTTP route mounted per channel    │ │
 │ /api/v1/messaging│──────┼──▶│   POST /messaging/slack/events    │ │
 │ /<channel>/...   │      │   │   POST /messaging/lark/events     │ │
 └─────────────────┘       │   └────────────┬─────────────────────┘ │
                           │                ▼                        │
                           │   channel.inbound.verifyAndParse()      │
                           │   → InboundMessage envelope             │
                           │                ▼                        │
                           │   dedup (channel, account, event_id)    │
                           │   → write sys_inbound_event             │
                           │                ▼                        │
                           │   emit "messaging.inbound" event        │
                           └────────────────┬───────────────────────┘
                                            │
                  ┌─────────────────────────┼──────────────────────────┐
                  ▼                         ▼                          ▼
       ┌────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
       │ flow trigger        │   │ object hook         │    │ AI tool dispatch    │
       │ messaging.inbound   │   │ sys_comment         │    │ (via ADR-0011)      │
       │ → matches resolver  │   │ .beforeInsert       │    │ Action Registry     │
       └─────────┬───────────┘   └──────────┬──────────┘    └──────────┬──────────┘
                 │                          │                          │
                 └──────────────────────────┴──────────────────────────┘
                                            │
                                            ▼  (any handler can emit a reply)
                           ┌────────────────────────────────────────┐
                           │   service-messaging DISPATCHER         │
                           │   (existing from ADR-0012)             │
                           │                                        │
                           │   sys_notification → sys_notification_  │
                           │                       delivery (outbox) │
                           │                ▼                        │
                           │   channel.send() with                   │
                           │     Address.session_key = the thread    │
                           │     Address.reply_to_message_id = parent│
                           │     Address.account_id = same workspace │
                           │                ▼                        │
                           │   Slack chat.postMessage                │
                           │   (in same thread)                      │
                           └────────────────────────────────────────┘
```

Key points:

* **The receiver is new** (this ADR). The dispatcher already exists (ADR-0012).
* **They share the channel registry** — one `MessagingChannel` registration covers both directions for a given channel.
* **Inbound has its own outbox** (`sys_inbound_event`) so handler failures are retried independently of delivery failures.
* **Replies are normal `notify` calls** that happen to set `session_key`. The dispatcher already routes them; the channel uses `session_key` in `send()` to land the post in the right thread.

### 2. Extending `MessagingChannel` — the inbound and session blocks

The interface shape was reserved in ADR-0012 §2. Here is what ADR-0013 channels implement:

```ts
// packages/spec/src/messaging/inbound.zod.ts
export const InboundMessageSchema = z.object({
  /** Channel id, e.g. 'slack'. Matches the MessagingChannel.id. */
  channel_id: z.string(),

  /** Account row id (sys_channel_account). Identifies which Slack workspace. */
  account_id: z.string(),

  /** Provider-native event id. Used for dedup. e.g. Slack's `event_id`. */
  external_event_id: z.string(),

  /** Stable identifier for the conversation. See §3 for grammar. */
  session_key: z.string(),

  /** Provider message id (for "reply to this" semantics). */
  external_message_id: z.string(),

  /** Optional: provider's parent message id, if this is itself a reply. */
  external_parent_message_id: z.string().nullable(),

  /** Who sent it (provider-native id; we resolve to a sys_user via §6 mapping). */
  sender: z.object({
    external_user_id: z.string(),
    display_name: z.string().optional(),
    email: z.string().optional(),  // populated when channel supports it (Slack does)
  }),

  /** Where it landed (channel-native location: Slack channel id, Lark chat id, …). */
  conversation: z.object({
    external_id: z.string(),
    kind: z.enum(['dm', 'group', 'channel', 'thread']),
    name: z.string().optional(),
  }),

  /** Normalised content. Provider-specific rich content kept in `raw`. */
  body: z.object({
    text: z.string(),
    mentions: z.array(z.object({
      external_user_id: z.string(),
      offset: z.number().optional(),
      length: z.number().optional(),
    })).default([]),
    attachments: z.array(z.object({
      kind: z.enum(['file','image','audio','video','link']),
      url: z.string().url().optional(),
      mime_type: z.string().optional(),
      name: z.string().optional(),
      size_bytes: z.number().optional(),
    })).default([]),
  }),

  /** Provider-native payload, kept verbatim for debugging and forward-compat. */
  raw: z.unknown(),

  /** Wall-clock send time, provider-reported (best-effort). */
  sent_at: z.string().datetime(),
});

export type InboundMessage = z.infer<typeof InboundMessageSchema>;
```

The optional blocks on `MessagingChannel`:

```ts
readonly inbound?: {
  /**
   * Mount a route under /api/v1/messaging/<channel>/... — the receiver calls
   * back into this method for each request. The channel owns its own URL shape
   * because providers vary (Slack: one /events endpoint; Lark: separate URLs
   * per event class; Telegram: per-bot long-poll).
   */
  routes(accountConfig: AccountConfig): RouteDescriptor[];

  /**
   * Verify the signature (e.g. Slack X-Slack-Signature HMAC over body+timestamp)
   * and parse into the normalised envelope. Return null to drop silently
   * (URL verification handshakes, retries we already saw, etc.).
   */
  verifyAndParse(
    req: HttpRequest,
    accountConfig: AccountConfig,
  ): Promise<InboundMessage | null>;

  /** Per-channel dedup window override. Default 24h. */
  dedupTtlSec?: number;
};

readonly sessions?: {
  /**
   * Compose a sessionKey from an InboundMessage (consumed when the resolver
   * needs to write a reply). Slack: `slack:<account_id>:<channel>:thread:<ts>`.
   */
  buildSessionKey(msg: InboundMessage): string;

  /**
   * Inverse — decode a sessionKey into the channel-native parts needed to
   * call the provider API on the reply path. Returns an opaque object the
   * channel's own `send()` knows how to consume.
   */
  decodeSessionKey(key: string): unknown;
};
```

This is the full extension surface. Everything else (outbox, retry, preference matrix, dead-letter) is inherited from ADR-0012 unchanged.

### 3. `sessionKey` grammar

A `sessionKey` is an opaque-to-the-platform but channel-decodable string that uniquely identifies a conversation. The platform stores it in `Address.session_key`, `sys_inbound_event.session_key`, and on any `sys_*` row that wants to remember "the Slack thread this comment is mirrored to". The platform never parses it; only the originating channel decodes it.

Grammar — channels are free to add segments after the first three:

```
<channel_id>:<account_id>:<conversation_kind>:<provider_specific>...
```

Examples:

| Channel | sessionKey | Meaning |
|:---|:---|:---|
| slack  | `slack:acc_01:dm:U07AB:1700123.456`                         | DM with Slack user U07AB, thread root ts |
| slack  | `slack:acc_01:thread:C0123:1700200.789`                     | Channel C0123, thread root ts |
| slack  | `slack:acc_01:channel:C0123`                                | Channel C0123 top-level (new top message) |
| lark   | `lark:acc_07:topic:oc_abc:6`                                | Lark chat oc_abc, topic 6 |
| telegram | `telegram:acc_12:chat:-1001234:reply:9876`                | Group chat reply to msg 9876 |

Design rules:

* Channel id and account id always come first — guarantees no cross-channel/cross-account collisions even if a buggy channel encodes weird segments.
* No URL escaping; segments containing `:` are channel-encoded (e.g. base64url).
* Total length capped at 512 bytes (column constraint).
* Channels MUST be able to encode a sessionKey for a brand-new conversation as well as for a thread continuation. "Start a new DM with user X" is `slack:acc_01:dm:U07AB` (no message ts segment) — the channel knows to omit the `thread_ts` parameter on `chat.postMessage`.
* sessionKey is **stable**: replying twice in the same thread produces the same key.
* sessionKey is **not a secret** — it appears in `sys_*` rows and may be logged. Authorization to write to a session is owned by the channel's outbound `send()`, which validates the account's permissions via the provider API.

### 4. Multi-account: `sys_channel_account`

Schema (the seam table from ADR-0012, now with full UX):

```ts
export const ChannelAccountSchema = z.object({
  id:             z.string(),
  environment_id: z.string(),
  channel_id:     z.string(),                          // 'slack' | 'lark' | …
  display_name:   z.string(),                          // user-visible "Acme Slack"
  external_id:    z.string(),                          // workspace id / tenant id
  external_url:   z.string().url().optional(),         // workspace URL for the UI
  status:         z.enum(['active','disabled','revoked']).default('active'),

  /** Reference into service-secrets; never the raw token. */
  credentials_ref: z.string(),

  /** Provider-reported capabilities (cached). Drives UI affordances. */
  capabilities: z.object({
    can_post_threads:    z.boolean().default(true),
    can_post_dms:        z.boolean().default(true),
    can_post_channels:   z.boolean().default(true),
    can_use_blocks:      z.boolean().default(true),
    bot_external_id:     z.string().optional(),        // for self-mention detection
    bot_display_name:    z.string().optional(),
  }).default({}),

  /** Per-account dispatch policy. */
  dispatch: z.object({
    /** What inbound events resolve to: 'flow' (default), 'ai_only', 'mixed'. */
    inbound_mode: z.enum(['flow','ai_only','mixed','none']).default('flow'),
    /** Bot only reacts to @mentions / DMs (true) vs. all messages (false). */
    mention_only: z.boolean().default(true),
  }).default({}),

  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
```

Behaviour:

* Adding an account = OAuth flow in Studio → returns tokens → `service-secrets.write(...)` → row written with `credentials_ref`.
* Removing = `status='revoked'` first (soft), credentials wiped, then deletable after a grace period. Existing `Address` rows pointing at it fail dispatch with `permanent` (so the outbox dead-letters cleanly).
* Account rotation: a new row supersedes the old (different `id`), with a Studio migration helper that rewrites pinned `account_id` on flows/templates.
* Per-environment isolation is enforced by `environment_id` on every read; cross-env account use is impossible by construction.

### 5. Inbound pipeline — receive, verify, dedup, route

```
HTTP POST /api/v1/messaging/slack/events
  │
  ├─ raw-body capture middleware (needed for HMAC signature)
  ├─ resolve account from URL or payload  (request → sys_channel_account row)
  ├─ channel.inbound.verifyAndParse(req, account.config)
  │     ├─ Slack URL-verification handshake → return { challenge } directly, no further work
  │     ├─ signature mismatch → return 401
  │     ├─ message is from our own bot user → drop (return null)
  │     └─ return InboundMessage envelope
  │
  ├─ dedup: (channel_id, account_id, external_event_id) seen in last dedupTtlSec?
  │     ├─ yes → ACK and stop (Slack will retry on 5xx; we are idempotent on the event_id)
  │     └─ no  → insert sys_inbound_event row (state=pending)
  │
  ├─ ACK provider with 200 within 3s  (provider deadline; Slack is 3s)
  │
  ▼ (asynchronous, runs in service-messaging worker loop)
target-resolver.resolve(inboundEvent) → list of TargetMatches
  │
  ▼
for each match:
   write sys_inbound_dispatch row (per-handler outbox)
   handler-loop picks up:
     │
     ├─ target='flow:<flow_id>'    → flow engine: trigger messaging.inbound
     ├─ target='hook:sys_comment'  → object hook: insert sys_comment row
     ├─ target='ai_tool:<agent_id>'→ ADR-0011 dispatch: tool-call run with sessionKey
     └─ target='ack_only'          → mark handled (used for read-receipts)
   on success → state=handled
   on retryable error → state=pending with backoff
   on permanent error → state=dead
```

Why a two-stage outbox (`sys_inbound_event` then `sys_inbound_dispatch`):

* Provider deadline forces us to ACK in 3s. The verify+dedup+insert must complete; the handler chain cannot.
* One inbound event may fan out to N handlers; each must succeed or retry independently.
* Replays on the inbound side mirror replays on the outbound side — same UX, same Studio surface, same operator muscle memory.

### 6. `target-resolver` — inbound → flow / hook / AI tool

```ts
export interface TargetResolver {
  readonly id: string;

  /**
   * Inspect an inbound event and return zero or more handler targets.
   * Resolvers run in registration order; all matches fire (a message can both
   * trigger a flow and create a sys_comment row).
   */
  resolve(
    ctx: ResolverContext,
    event: InboundMessage,
    account: ChannelAccount,
  ): Promise<TargetMatch[]>;
}

export type TargetMatch =
  | { kind: 'flow';    flow_id: string;    payload: unknown }
  | { kind: 'hook';    object: string;     payload: unknown }
  | { kind: 'ai_tool'; agent_id: string;   prompt: string; session_key: string }
  | { kind: 'ack_only' };
```

Built-in resolvers shipped in M1:

| Resolver | Match rule | Output |
|:---|:---|:---|
| `mention` | message mentions the bot user (`account.capabilities.bot_external_id`) | `ai_tool` if `dispatch.inbound_mode ∈ {ai_only, mixed}`, else `flow` triggered with topic `messaging.mention` |
| `dm`      | conversation kind is `dm`                       | `ai_tool` if `inbound_mode ∈ {ai_only, mixed}`, else `flow` (`messaging.dm`) |
| `mirror`  | conversation has a `sys_message_mirror` link to an ObjectStack object (e.g. a `sys_ticket`) | `hook` on the mirrored object's comment table |
| `keyword` | message text matches a configured prefix (e.g. `/approve`) | `flow` (`messaging.keyword`, with parsed args) |

Custom resolvers register via `defineTargetResolver(...)` in any plugin.

If `dispatch.mention_only=true` on the account and no resolver matches, the event is recorded (`sys_inbound_event` row) but produces no `sys_inbound_dispatch` rows — same outcome as `ack_only` for observability without invoking handlers.

### 7. Reply path — session-aware outbound

A handler that wants to reply calls the existing `service-messaging.emit(notification)` with a fully-populated session address:

```ts
await ctx.messaging.emit({
  topic: 'contract.approval_response',
  recipients: [{
    kind: 'session',
    channel_id: 'slack',
    account_id: inbound.account_id,
    session_key: inbound.session_key,             // ← lands in the same thread
    reply_to_message_id: inbound.external_message_id, // optional: provider-native reply chain
  }],
  payload: { approval_id, decision: 'approved' },
});
```

This flows through ADR-0012's pipeline unchanged:

1. Topic / preference check (Slack channel respects per-user mute just like email does).
2. Renderer produces Slack Block-Kit JSON (M1 includes a built-in renderer; templates can override).
3. `sys_notification_delivery` row written with `address.session_key` populated.
4. Dispatcher calls `slackChannel.send(delivery)`.
5. Slack channel decodes the session_key → picks `(channel_id, thread_ts)` → calls `chat.postMessage` with `thread_ts` set.
6. Provider message id stored on `sys_notification_delivery` for receipt correlation.

A reply to a *brand-new* DM (no prior session) sets `session_key = 'slack:<acc>:dm:<external_user_id>'` without a thread suffix; the channel handles "no thread, start one" by omitting `thread_ts`.

### 8. User mapping — Slack user ↔ `sys_user`

Inbound events arrive with a provider-native `external_user_id`. We need a `sys_user` to attribute actions to (who created the comment, who approved the contract).

Resolution order:

1. **Account-scoped mapping table** `sys_channel_user_link (account_id, external_user_id, sys_user_id)`. Populated by:
   * Studio "link account" flow — user clicks a deep link from a Slack DM, lands in Studio, signs in, link row written.
   * On-demand OAuth handshake when an unknown sender first interacts (configurable per-account).
2. **Email fallback** — if the channel reports the sender's email (Slack does, with `users:read.email` scope) and that email matches a unique `sys_user.email`, auto-create the link row (one-time, with audit log).
3. **Pseudonymous fallback** — if neither works, attribute to a per-account synthetic user `sys_user('slack:acc_01:U07AB')`. The flow trigger fires but actions requiring permission checks fail with a clear "link your Slack to your ObjectStack account" prompt sent back into the same thread.

The synthetic-user fallback is what keeps the system honest: nothing happens "as nobody". Every inbound action is attributable.

### 9. Slack channel — first reference implementation

> **Transport delegation (ADR-0022).** The Slack channel's outbound `send()` (and any Web-API calls below) should delegate to a Slack `Connector` (e.g. `@objectstack/connector-slack`) for auth / base URL / rate-limit / the `chat.*` action set, rather than hand-rolling `fetch`. The channel adds the messaging semantics on top. See [ADR-0022](./0022-connectors-vs-messaging-channels.md) — this lets the `connector_action`-direct path and the channel share one Slack transport.

`@objectstack/plugin-messaging-slack`. Package layout:

```
plugin-messaging-slack/
├── src/
│   ├── index.ts                       (defineMessagingChannel('slack', ...))
│   ├── outbound.ts                    (send(): chat.postMessage with thread_ts)
│   ├── outbound-blocks.ts             (Block-Kit body renderer)
│   ├── inbound-routes.ts              (POST /events; POST /interactions for buttons)
│   ├── inbound-verify.ts              (HMAC sha256 of `v0:<ts>:<body>` against signing secret)
│   ├── inbound-parse.ts               (event payload → InboundMessage)
│   ├── inbound-actions.ts             (button clicks → action_response InboundMessage)
│   ├── sessions.ts                    (buildSessionKey / decodeSessionKey)
│   ├── oauth.ts                       (V2 OAuth install flow; token exchange; scope set)
│   ├── socket-mode.ts                 (optional alt transport for behind-NAT installs)
│   └── caps.ts                        (capability advertisement)
├── package.json
└── README.md
```

Key choices:

* **Events API by default**, Socket Mode as an opt-in transport for installs that cannot expose a public URL. Both paths produce the same `InboundMessage` envelope; the receiver doesn't care.
* **One Slack app per workspace** is the simplest model; the channel also supports "one Slack app, N workspaces installed" by storing workspace tokens keyed by team id.
* **Signing-secret verification is mandatory.** No bypass. The implementation uses a constant-time compare (`safeEqualSecret`, copied verbatim from openclaw under MIT).
* **Block-Kit renderer M1** ships templates for: notification card (title/body/action link), approval card (approve/deny buttons), AI tool call response (markdown + "open in Studio" link), error card.
* **Interactive payloads** (button clicks) are normalised back into an `InboundMessage` with a synthetic `body.text` like `[action] approve:approval_123` so resolvers don't need a separate event kind.
* **Rate limits** — Slack's Web API tier rate limits are tracked per `(account, method)` via a token-bucket; on 429, channel returns `rate_limited` with `Retry-After`, dispatcher backs off without dead-lettering.
* **Idempotency** on outbound: every `chat.postMessage` call carries a delivery uuid as `metadata.event_payload`; if Slack returns a duplicate-detected error (rare; mostly defensive), channel returns `duplicate` and the dispatcher marks success.

OAuth scopes required for M1:

| Scope | Purpose |
|:---|:---|
| `chat:write`            | post messages |
| `chat:write.public`     | post to channels the bot isn't in |
| `commands`              | slash commands (M2 — reserved during install) |
| `users:read`            | resolve sender display names |
| `users:read.email`      | enable email-based user mapping |
| `app_mentions:read`     | receive `@bot` mentions |
| `im:history`            | receive DMs |
| `channels:history`      | mention resolver in channels (only mention events delivered if `mention_only=true`) |
| `groups:history`        | same for private channels |

### 10. AI integration — Slack messages as ADR-0011 tool calls

When an account's `dispatch.inbound_mode ∈ {ai_only, mixed}`, the `mention` and `dm` resolvers produce an `ai_tool` target. The handler:

1. Looks up the agent bound to the account (`sys_channel_account.dispatch.agent_id`, defaulting to the environment's default agent).
2. Reconstructs a conversation transcript from `sys_inbound_event` rows sharing the same `session_key` (so the AI remembers what came before in the thread).
3. Invokes the agent runner from ADR-0011 with the transcript + the Action Registry as available tools.
4. Streams the agent's reply back to the same thread via the reply path in §7.

What this means concretely:

* "@objectos create a contract for Acme worth 50k" → mention resolver → AI dispatch → agent calls the `contract.create` action → action returns a `sys_contract` row → reply card posted in-thread with a link to the contract.
* The agent's tool calls are subject to the same per-action permission checks as the Studio AI panel. The acting user is the mapped `sys_user` from §8.
* Long-running actions (>3s, e.g. document generation) are dispatched async; the agent posts a "working on it…" reply, then a follow-up when done. The two replies share the same `session_key`.

No new ADR-0011 surface is needed. The Action Registry, agent runtime, and tool-call schema are reused as-is. ADR-0013 adds **one transport surface** (Slack) that produces tool invocations.

### 11. Borrowed openclaw artifacts (MIT, with attribution)

The following are clean enough to copy verbatim; each goes into `packages/messaging-utils/` with a NOTICE entry:

| openclaw source | Our path | Why borrowed |
|:---|:---|:---|
| `plugin-sdk/security-runtime.ts::safeEqualSecret` | `packages/messaging-utils/src/safe-equal.ts` | Constant-time secret compare; well-tested, no objectstack-specific shape needed |
| `plugin-sdk/text-runtime.ts::createTextChunker` | `packages/messaging-utils/src/chunk-text.ts` | Slack message bodies must be < 40 KB; multi-line code blocks need careful splitting |
| `plugin-sdk/channel-core.ts::createLazyRuntimeModule` | `packages/messaging-utils/src/lazy-module.ts` | Provider SDKs are large; loading only on first use cuts boot time |
| `extensions/slack/inbound-event/url-verification.ts` | `plugin-messaging-slack/src/inbound-routes.ts` (adapted) | Slack's URL-verification handshake is fully standardised; the function is reusable |

Everything else (channel registry, session registry, target resolver, account model, dispatcher integration, schemas, tables) is rewritten against ObjectStack primitives. The borrowed files retain their original copyright header and SPDX-License-Identifier: MIT.

We do not pull in the openclaw plugin-sdk as a runtime dependency; cherry-picking individual files keeps our dependency graph clean and our schema control absolute.

### 12. Schemas — additions to `packages/spec/src/messaging/`

| File | Purpose |
|:---|:---|
| `inbound.zod.ts`            | `InboundMessageSchema` — the normalised envelope (shown in §2) |
| `inbound-event.zod.ts`      | `InboundEventSchema` — the persisted row in `sys_inbound_event` (envelope + state) |
| `inbound-dispatch.zod.ts`   | `InboundDispatchSchema` — per-handler outbox row (target + state + attempts) |
| `channel-account.zod.ts`    | `ChannelAccountSchema` — full schema (shown in §4); replaces the M1 minimal stub from ADR-0012 |
| `channel-user-link.zod.ts`  | `ChannelUserLinkSchema` — provider user ↔ `sys_user` mapping (shown in §8) |
| `session-address.zod.ts`    | `SessionAddressSchema` — the `kind: 'session'` variant of `Address`, including `account_id` / `session_key` / `reply_to_message_id` |
| `target-resolver.zod.ts`    | `TargetResolverDescriptorSchema` — registry entry (resolver impl is runtime code) |
| `message-mirror.zod.ts`     | `MessageMirrorSchema` — links a `sys_*` object to a channel conversation (for the `mirror` resolver) |

These extend the `Messaging` namespace introduced in ADR-0012; no rename, no breaking change.

### 13. Tables (singular metadata type, `sys_` prefix per Prime Directive 7)

| Table | Owner | Purpose |
|:---|:---|:---|
| `sys_channel_account` | service-messaging | Multi-row from this ADR. Inbox/email/webhook/push continue using the implicit default row. |
| `sys_channel_user_link` | service-messaging | Per-account mapping `(account_id, external_user_id) → sys_user_id`. |
| `sys_inbound_event` | service-messaging | Verified + deduped inbound envelopes. State: `pending → handled / failed / dead`. Indexed by `(account_id, external_event_id)` for dedup, `(session_key, sent_at)` for transcript reconstruction. |
| `sys_inbound_dispatch` | service-messaging | Per-handler outbox derived from `sys_inbound_event`. One row per resolver match. State independent of the parent event. |
| `sys_message_mirror` | service-messaging | `(object_table, object_id, channel_id, account_id, session_key)` — links business objects to channel conversations. Used by the `mirror` resolver and by templates that want "post a notification AND remember the thread for future updates". |
| `sys_notification_delivery` | service-messaging | **Existing**. Address now carries `account_id` / `session_key` / `reply_to_message_id` (columns reserved in ADR-0012; populated by this ADR). |

Retention policy: `sys_inbound_event.raw` is the largest column (full provider payload). Default retention 90 days, per-account override. Cleanup job piggybacks on the M2 `sys_inbox_message` cleanup.

### 14. Wire-up — full inbound + reply round trip

```
1. Slack user types "@objectos approve contract 42" in #procurement
2. Slack POSTs /api/v1/messaging/slack/events with the message_event payload
3. service-messaging receiver:
     - resolves account from team_id → sys_channel_account row 'acc_01'
     - calls slackChannel.inbound.verifyAndParse(req, acc_01.config)
     - HMAC OK; not from our bot; produces InboundMessage envelope
     - dedup: (slack, acc_01, Ev0XXXX) unseen → INSERT sys_inbound_event(state=pending)
     - returns 200 to Slack within 50ms
4. service-messaging worker picks up the pending event:
     - target-resolver.resolve(...) returns [{kind:'ai_tool', agent_id:'default', prompt:'approve contract 42', session_key:'slack:acc_01:thread:C09:170...'}]
     - INSERT sys_inbound_dispatch(target_kind=ai_tool, state=pending)
5. service-messaging handler picks up the pending dispatch:
     - looks up sys_user via sys_channel_user_link → user_77
     - reconstructs transcript from sys_inbound_event WHERE session_key=...
     - invokes ADR-0011 agent runner as user_77
     - agent calls 'contract.approve' action with id=42
     - action returns ok; agent produces a Markdown reply
6. handler emits a reply:
     ctx.messaging.emit({
       topic: 'ai.tool.response',
       recipients: [{kind:'session', channel_id:'slack', account_id:'acc_01',
                     session_key:'slack:acc_01:thread:C09:170...',
                     reply_to_message_id:'170...124'}],
       payload: { markdown: "Approved contract #42. View: ..." }
     });
7. ADR-0012 dispatcher does its thing:
     - preference check: user opted in to ai.tool.response in slack channel ✓
     - renderer produces Block-Kit JSON
     - INSERT sys_notification_delivery
     - dispatcher loop calls slackChannel.send(delivery)
     - Slack channel decodes session_key → chat.postMessage(channel=C09, thread_ts=170...)
     - delivery state → success; sys_inbound_dispatch.state → handled
8. Slack user sees the reply on the same thread.
```

End-to-end: one new event, two state machines, zero special cases. The reply path is indistinguishable from a flow `notify` node firing — which is exactly what we want.

### 15. Observability

Every inbound and reply gets the same Studio surface as ADR-0012 deliveries:

* **Inbound events view** — filter by channel / account / session_key / state / time range; columns: state, attempts, last_error, conversation, sender.
* **Inbound dispatch inspector** — drill from an event to its handler matches; replay individual dispatches; bulk replay by resolver.
* **Conversation viewer** — given a `session_key`, show the merged transcript of inbound events + outbound deliveries in chronological order. The "what did the AI say in that Slack thread last Tuesday" answer.
* **Account health** — per `sys_channel_account` row: OAuth token expiry, last successful inbound, last successful outbound, capability mismatches (e.g. lost `chat:write` scope after a Slack policy change).
* **Metrics** —
  * `messaging.inbound.{received,verified,deduped,handled,failed,dead}` counters tagged by `channel` and `account`.
  * `messaging.inbound.duration_ms` histogram (provider-ack to handler-complete).
  * `messaging.outbound.session.{posted,thread_lost,rate_limited}` — thread_lost = session_key decoded but Slack rejected the thread_ts (typical sign of channel archive / user uninstall).

---

## Milestones

### M1 — Slack ships (target: next minor)

* `packages/spec/src/messaging/` additions (the 8 new Zod files from §12).
* `service-messaging` receiver sub-system with route-mounting, signature verification harness, dedup, two-stage outbox.
* `sys_channel_account` upgraded from M1-stub to full CRUD; Studio "Add Slack workspace" OAuth flow.
* `sys_channel_user_link`, `sys_inbound_event`, `sys_inbound_dispatch`, `sys_message_mirror` tables.
* `plugin-messaging-slack` (full §9 surface; Events API only).
* Built-in resolvers: `mention`, `dm`, `mirror`, `keyword`.
* `messaging.inbound` flow trigger fires; sample template demonstrates "Slack `/contract create Acme` → flow".
* ADR-0011 integration: `ai_tool` resolver path with transcript reconstruction.
* Conversation viewer in Studio.
* Per-channel preference rows for Slack (respects mute / quiet hours from ADR-0012).
* `messaging-utils` package with borrowed openclaw helpers + NOTICE.

### M2 — make it richer & add a second channel

* Slack Socket Mode transport (behind-NAT installs).
* Slack slash commands + interactive shortcuts.
* Block-Kit modal forms (e.g. "approve with comment" modal).
* `plugin-messaging-lark` — second reference implementation; reuses 100% of the substrate.
* Inbound throttling per account (per-user rate limits to avoid AI abuse).
* Conversation summarisation for long threads (transcript pruning before AI dispatch).
* Slack-Connect / shared-channel support (cross-org).

### M3 — long tail

* `plugin-messaging-telegram` (HTTP webhook + long-poll variants).
* `plugin-messaging-wecom`, `plugin-messaging-dingtalk` — domestic IM.
* `plugin-messaging-discord` — gaming / community use cases.
* Cross-account session bridging (out-of-scope for M1, may stay deferred).
* Optional federation: subscribe one workspace's inbound to another env's resolvers (multi-tenant scenarios).

---

## Acceptance criteria

| Capability | M1 deliverable |
|:---|:---|
| Add a Slack workspace via Studio OAuth | `sys_channel_account` row created with tokens in `service-secrets`, capabilities cached |
| `@objectos hello` in any channel → bot replies | mention resolver + AI dispatch + reply in-thread |
| `/contract approve 42` slash command (M2) | keyword resolver → flow `contract.approve` (M1 supports message-text keywords; slash commands are M2) |
| Comment on `sys_ticket #7` in Studio → mirrored to Slack thread | `sys_message_mirror` populated; outbound delivery posts to mirrored thread |
| Slack reply in that thread → new `sys_comment` row | `mirror` resolver → object hook → `sys_comment` insert with sender attribution |
| Notification respects user mute | preference matrix lookup unchanged from ADR-0012 |
| Slack workspace token revoked → graceful failure | account `status='revoked'`, deliveries dead-letter, replay button in Studio |
| Replay a failed inbound dispatch | Studio button → reset state to pending, handler picks up |
| Per-account audit: who handled what | `sys_inbound_event` + `sys_inbound_dispatch` joined with `sys_channel_user_link` |
| Multiple Slack workspaces in one env | N rows in `sys_channel_account`, isolated by `account_id` in every flow / template / delivery row |

---

## Risks & open questions

1. **3-second provider deadline.** Slack expects 200 within 3s; verify + dedup + insert must complete inside that. We assume the receiver runs on a process that does not cold-start per request. If kernels are deployed serverlessly (rare), we would need a thin always-warm receiver in front. M1 documents the requirement.
2. **Session continuity across bot redeploys.** sessionKey decoding is channel code; if a channel changes its grammar in a major release, old keys break. Mitigation: grammar versioning (`slack:v1:acc:…`) reserved from M1, only `v1` used now.
3. **AI cost runaway.** A noisy public channel with `mention_only=false` could blast the agent with thousands of messages. M1 ships per-account per-day call quotas with hard cap; over-quota events are recorded as `ack_only`.
4. **User mapping ambiguity.** Two `sys_user`s with the same email collapse onto the same Slack user. Mitigation: when ambiguity is detected, refuse the auto-link and send a clarifying DM. Pseudonymous fallback prevents data attribution to the wrong account.
5. **Slack-Connect / external user identity.** Cross-org shared channels can deliver messages from users outside the workspace. M1 treats all such messages as anonymous (synthetic user, no actions allowed). M2 / M3 adds proper handling.
6. **Plaintext token leakage.** Tokens live in `service-secrets`; nothing in `sys_channel_account` is plaintext. Studio surfaces show "•••" with a copy-to-clipboard via signed redirect (token never crosses HTTP). Audit logs record every token read.
7. **Replay safety.** Replaying an inbound dispatch may re-execute side-effects (e.g. create a second comment). M1 adds an opt-in dedup key per dispatch handler (defaults to `(inbound_event_id, resolver_id)`); replay clears the dedup row.
8. **Transcript privacy for AI.** Reconstructing a thread for AI dispatch could surface earlier sensitive messages. M1 limits transcript reconstruction to messages where the sender's `sys_user` has read permission on the AI agent's context object. M2 adds per-message redaction.
9. **Webhook ingress security.** Routes are public by definition. Per-account allowlist of source IPs (Slack publishes a range) is M2; signature verification is the M1 baseline.
10. **Plugin extension contract stability.** The `MessagingChannel.inbound` / `sessions` shape is exposed to plugin authors. Once published we cannot break it lightly — a breaking change forces every third-party channel plugin to upgrade. Mitigation: marked `@experimental` in M1, frozen at M2.
11. **License hygiene for borrowed openclaw code.** Each copied file must keep its MIT header and an explicit attribution in `messaging-utils/NOTICE`. CI gate (`pnpm check:notices`) enforces presence.

---

## Decision

Adopt the design above. Specifically:

* **Receiver sub-system added to `service-messaging`** — mounts per-channel routes, verifies signatures, normalises payloads, dedups, persists to `sys_inbound_event`.
* **`MessagingChannel` interface extended with optional `inbound` and `sessions` blocks** — same registration covers send + receive; outbound-only channels (email/inbox/webhook/push) are unaffected.
* **`sys_channel_account` becomes multi-row with full Studio CRUD**, replacing the M1 stub from ADR-0012.
* **`target-resolver` registry routes inbound to flow / hook / AI tool / ack** — four built-in resolvers in M1.
* **Slack is the first reference implementation** — Events API in M1, Socket Mode in M2.
* **AI tool dispatch reuses ADR-0011 unchanged** — Slack becomes one more transport surface for tool calls.
* **Replies go through ADR-0012's dispatcher** — `Address.session_key` populated; nothing about retry / outbox / dead-letter is special.
* **Specific openclaw utilities borrowed under MIT with attribution**; everything else rewritten against ObjectStack primitives.
* **Two-stage outbox** (`sys_inbound_event` → `sys_inbound_dispatch`) to honour provider ack deadlines while keeping per-handler durability.
* **Multi-tenant by construction** — every read scoped by `environment_id`; cross-env account access impossible.

This delivers "chat with ObjectOS from Slack" without forking openclaw, without sacrificing the durability and metadata-driven model that ADR-0012 owns, and without re-architecting in a future ADR. The seams ADR-0012 reserved make this a non-breaking add.
