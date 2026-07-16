# ADR-0022: Connectors vs Messaging Channels — Where "Push to Slack" Lives

**Status**: Proposed (2026-05-31) — routing decision recorded; both substrates now exist independently (`connector-slack` built; `service-messaging` notify/outbox/preferences built), but the §3 shared-transport wiring — a Slack `MessagingChannel.send()` delegating to the Slack Connector — is unbuilt (no slack-channel in service-messaging). (2026-07-16 audit)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0012](./0012-notification-platform.md) (Messaging Platform — outbound `notify` on a generalized outbox), [ADR-0013](./0013-bidirectional-messaging.md) (Bidirectional Messaging — Slack first), [ADR-0015](./0015-external-datasource-federation.md) (open mechanism / enterprise lifecycle split), [ADR-0018](./0018-unified-node-action-registry.md) (`connector_action` as baseline generic dispatch)
**Consumers**: `@objectstack/spec` (`integration/`, future `messaging/`), `@objectstack/services/service-automation` (connector registry), future `@objectstack/service-messaging`, future `@objectstack/plugin-messaging-slack`, `@objectstack/connectors/*`

---

## TL;DR

The question "should pushing a message to Slack be a **connector**?" surfaces a real collision in the repo: **Slack now has two candidate homes.**

- **ADR-0012/0013** designate Slack as a **`MessagingChannel`** — a human-facing notification + conversation surface with a preference matrix, an inbox, an outbox, sessions/threads, and an inbound receiver. *Both ADRs are Draft; none of `service-messaging`, the `notify` transport, or `plugin-messaging-slack` is built yet.*
- **ADR-0015/0018 + the just-merged connector baseline** give us a **`Connector`** — a generic "call any external system's API" mechanism (`connector_action` node, `engine.registerConnector()`, `@objectstack/connector-rest`). *This is built and live.*

This ADR resolves the collision instead of letting two seams quietly grow a second Slack integration. The decision:

1. **A `Connector` is the transport/integration mechanism** — "talk to system X's API," no recipient semantics. A `MessagingChannel` is the **human-messaging semantic layer** — recipients, preferences, inbox, outbox, sessions, inbound. They are **different abstractions at different layers**, exactly as "SMTP transport" ≠ "send a notification" in ADR-0012.
2. **"Notify a human via Slack" is NOT a connector** — it is a `MessagingChannel` (ADR-0012/0013). Modeling it as a bare `connector_action` would silently drop preferences, the inbox, retry/dead-letter, and the reply-in-thread story, and would **duplicate ADR-0012**.
3. **"A flow makes a raw Slack API call" IS a connector action** — `connector_action(connectorId:'slack', actionId:'chat.postMessage', …)`. This is the generic-integration path and works on **today's** baseline with no new abstraction.
4. **The two share one transport.** A Slack `MessagingChannel.send()` should be **implemented on top of** a Slack `Connector` (auth, base URL, rate-limit, action set live once, in the connector); the channel adds the messaging semantics on top. Connector = mechanism; channel = policy. This generalizes ADR-0012's own "email becomes a transport sub-system" pattern.

Because ADR-0012/0013 are still Draft, folding the connector baseline in underneath them is a **cheap revision, not a migration**.

---

## Context

### The two seams, side by side

| Dimension | `Connector` (ADR-0015/0018, **built**) | `MessagingChannel` (ADR-0012/0013, **draft, unbuilt**) |
|:---|:---|:---|
| Purpose | call any external system's API | deliver to / converse with a **human** |
| Primitive | an **action** (a verb on a system) | a **channel** (a delivery medium for a person) |
| Recipient model | none — caller supplies explicit inputs | per-user preference matrix, mute, quiet hours, recipient resolver |
| Delivery guarantee | one call → success/fail | outbox, retry, dead-letter, cluster-lock |
| Threads / sessions | none | `sessionKey`, reply-to-thread, `sys_message_mirror` |
| Inbound | generic webhook trigger | verify+dedup+parse → `target-resolver` → flow / hook / AI tool |
| Multi-account | not modeled | `sys_channel_account`, first-class, multi-tenant |
| Identity mapping | none | `sys_channel_user_link` (Slack user ↔ `sys_user`) |
| Status today | **shipped** (`connector_action`, `@objectstack/connector-rest`) | **Draft** (`notify` is a no-op; `service-messaging` does not exist) |

They overlap on exactly one thing: the bytes on the wire eventually hit Slack's `chat.postMessage`. Everything *around* that call is different — and that difference is the whole reason ADR-0012/0013 exist.

### Why this is live now

The connector baseline landed *after* ADR-0012/0013 were drafted. When 0013 was written, a Slack channel plugin was expected to hand-roll its own `fetch`, auth, base URL, and rate-limit handling ([0013 §9](./0013-bidirectional-messaging.md)). We now have a baseline that provides exactly those things generically. So the honest re-evaluation is twofold:

1. **Routing question** — when a builder wants to "push to Slack," which seam do they reach for?
2. **Substrate question** — now that connectors are baseline, should the (still-unbuilt) Slack channel be re-specified to *sit on top of* a connector rather than hand-roll transport?

### The precedent: this is the email split, generalized

ADR-0012 already drew this exact line for email: SMTP/Resend/Postmark are **transports** (`EmailTransport`), and "send a notification" is a **channel** (`MessagingChannel`) that *uses* a transport and adds preferences + outbox + suppression on top. `Connector` is simply the *general* form of "transport": a uniform way to talk to any external API. So the reconciliation is not a new idea — it is applying ADR-0012's own layering to every channel, with `Connector` as the shared transport substrate.

---

## Decision

### 1. Three concerns, three homes — do not collapse them

```
┌────────────────────────────────────────────────────────────────────────┐
│ CONVERSATION / INBOUND            ADR-0013                               │
│   receiver · verify · sessions · target-resolver → flow/hook/AI tool     │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ reuses
┌───────────────────────────────▼──────────────────────────────────────────┐
│ HUMAN NOTIFICATION                ADR-0012                                 │
│   notify node · recipient resolve · preference matrix · inbox · outbox    │
│   MessagingChannel.send()                                                 │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ delegates transport to
┌───────────────────────────────▼──────────────────────────────────────────┐
│ INTEGRATION MECHANISM             ADR-0015 / 0018  (BUILT)                 │
│   Connector · connector_action · auth · base URL · rate-limit · actions   │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Integration mechanism** (`Connector`, `connector_action`): "talk to any external API." Baseline, shipped. Slack-as-an-API-target is a legitimate connector.
- **Human notification** (`MessagingChannel`, `notify`): "tell a person, honoring their preferences, with durable delivery." ADR-0012. **A connector is not a substitute** for this layer.
- **Conversation/inbound** (sessions, resolvers, AI): ADR-0013. Built on the notification layer.

### 2. Routing rule — answer to "should push-to-Slack be a connector?"

| What the builder wants | Seam | Available |
|:---|:---|:---|
| "Notify the deal **owner** that the deal closed" (respect their channel preference, write the inbox, retry on failure, reply in the same thread) | **`MessagingChannel` + `notify` node** | when ADR-0012 ships |
| "Post **this exact text** to **#ops**" / "look up a Slack user" / "create a channel" — a raw API step with no recipient/preference semantics | **`connector_action` on a Slack `Connector`** | **today** (needs a `connector-slack` plugin) |

The litmus test: **does a *person's preference* decide whether and where this message lands?** If yes → `MessagingChannel`. If the flow author has already decided the exact destination and just needs the API called → `connector_action`.

### 3. One transport — the channel delegates to the connector

A Slack `MessagingChannel.send()` SHOULD be implemented on top of a Slack `Connector`'s outbound action(s), so Slack auth, base URL, rate-limit handling, and the action set live in **one** place (the connector) and the channel adds only the messaging semantics (preference check, render, outbox row, session/thread decoding). This:

- removes the hand-rolled `fetch` that [0013 §9](./0013-bidirectional-messaging.md) currently assumes;
- gives the connector path and the channel path a **single** Slack-auth/rate-limit implementation;
- lets the same Slack `Connector` serve raw `connector_action` flow steps *and* back the channel.

This is the ADR-0012 "email = transport sub-system behind a channel" pattern, with `Connector` as the universal transport.

### 4. Open-source / enterprise boundary (consistent with ADR-0015)

| Capability | Tier |
|:---|:---|
| `Connector` contract + `connector_action` dispatch + in-process registry | **open** (shipped) |
| Static-auth REST connector (`@objectstack/connector-rest`) | **open** (shipped) |
| `MessagingChannel` interface + outbox + inbox + preference matrix + `notify` | **open baseline** — this is the #1292 P0 fix; it must be in the open framework |
| A community Slack connector / channel using a **static bot token** (bearer) | **open** |
| Managed OAuth2 **install + token refresh**, credential vault (`service-secrets`), multi-tenant `sys_channel_account` lifecycle, premium connectors, marketplace | **enterprise** (per ADR-0015; ADR-0013 leans on `service-secrets` + OAuth — those are the enterprise bits) |

A static Slack bot token is just a bearer credential, so a basic open-source Slack connector + channel is shippable in the framework; the managed-credential / OAuth-refresh / multi-tenant lifecycle is the enterprise line — the same split ADR-0015 drew for datasources and ADR-0018's addendum drew for connectors.

### 5. Anti-patterns this rules out

- ❌ **A generic "notification connector."** Notification is a *semantic layer above* connectors, not a connector. Do not invent one.
- ❌ **Growing preference/inbox/outbox/session logic onto `Connector`.** That re-implements ADR-0012 in the wrong layer. The connector stays a dumb, generic API caller.
- ❌ **A Slack channel plugin that hand-rolls its own `fetch`/auth** when a Slack connector already encapsulates it. One transport implementation, reused.
- ❌ **Forcing `plugin-email` to become a connector right now.** It predates this, has its own template/transport story, and ADR-0012 already folds it in as `plugin-notification-email`. Leave it; revisit only if a generic transport buys something concrete.

---

## Consequences

**Positive**
- One unambiguous answer to "where does push-to-Slack live," with a one-line litmus test builders can apply.
- The unbuilt messaging stack gets a free, uniform transport substrate (the connector baseline) instead of N hand-rolled HTTP clients.
- The open/enterprise line stays identical across datasources, connectors, and channels — one mental model.
- No migration: ADR-0012/0013 are Draft, so this is a spec revision before code exists.

**Negative / costs**
- ADR-0012/0013 need a small revision to say "the Slack channel's `send()` delegates to a Slack connector" (this ADR records the intent; the prose edits to 0012/0013 are follow-ups).
- A Slack `Connector` and a Slack `MessagingChannel` both exist — two artifacts for one product. Mitigated by the strict layering (mechanism vs semantic) and the shared transport, so there is no duplicated Slack-auth code.
- The `connector_action`-direct path can post to Slack *without* preference/inbox semantics. That is intended (it is the "raw API call" escape hatch), but docs must steer "notify a human" toward `notify`, not `connector_action`, so authors don't accidentally bypass mute/quiet-hours.

---

## Status of the surrounding ADRs (so scope is clear)

- **Built**: connector mechanism — `connector_action` baseline node, `engine.registerConnector()`, `@objectstack/connector-rest` (ADR-0018 addendum, merged 2026-05-31).
- **Draft, unbuilt**: `service-messaging`, the `notify` transport, the preference matrix, the inbox, `plugin-messaging-slack` (ADR-0012/0013). The `notify` node is still a no-op.
- **This ADR changes no code.** It records the layering decision and the routing rule so that when ADR-0012/0013 are implemented, the Slack channel is built *on* the connector substrate rather than beside it.

## Follow-ups (not in this ADR)

- Add a back-reference note to [ADR-0012 §2](./0012-notification-platform.md) and [ADR-0013 §9](./0013-bidirectional-messaging.md): "channel transport delegates to a `Connector` per ADR-0022."
- A `connector-slack` plugin (open, static-token) — would validate the registry with a second connector and immediately enable the `connector_action`-direct path; lands independently of the messaging stack.
- Revisit whether `plugin-email`'s transports should re-express as connectors once a second transport-heavy channel exists.
