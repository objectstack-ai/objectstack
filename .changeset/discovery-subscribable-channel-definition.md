---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
"@objectstack/runtime": minor
---

`/discovery` stops advertising a realtime service that has no mounted surface, and "what counts as a subscribable channel" becomes one explicit definition.

**A client that keyed on `services.realtime.enabled: true` to subscribe was subscribing to nothing; it now sees `false`.** On a stock boot the document reported that entry as `enabled: true` *and*, in the same entry, "In-process event bus only — no HTTP/WS realtime surface is mounted", with no `routes.realtime`. Both statements were true, because `enabled` meant "the slot is filled" — which for an in-process pub/sub bus says nothing about whether anything is listening on the wire. A client reading it as "a channel exists" lost its subscription silently: no error, no failed request, no signal at all. The open framework does not mount a realtime transport (maintainer ruling, 2026-09-04), so discovery now says so.

**The definition, written down once and computed once.** A subscribable channel exists only where discovery reports `handlerReady: true` together with a connectable `route`; `enabled` never means "there is a channel". That sentence is `isSubscribableChannel()` in `@objectstack/spec/api`, and both discovery producers — `HttpDispatcher.getDiscoveryInfo()` and `ObjectStackProtocolImplementation.getDiscovery()` — set `services.realtime.enabled` and `capabilities.websockets` to the value of that call, so the field a consumer reads and the predicate a consumer is told to use are one computation and cannot disagree. `capabilities.websockets` was previously a literal `false` in each producer; two constants that happen to agree are not agreement, they are two places to forget.

**Nothing else changes meaning.** The predicate is applied per slot, to the slots whose advertised capability *is* a channel (`CHANNEL_SURFACE_SLOTS` — `realtime` alone). `cache`, `queue` and `job` deliver their whole contract in-process, so they stay honestly `enabled: true` with no route; `status`, `message` and every other slot's `enabled` are untouched, and `realtime` keeps `status: 'degraded'` plus its message so a consumer can still tell "registered but no wire" from "not installed".

What to read instead, per case:

- deciding whether to open a subscription → `handlerReady === true && typeof route === 'string'`, i.e. `isSubscribableChannel(discovery.services.realtime)`, or the equivalent `capabilities.websockets.enabled`; poll or degrade otherwise;
- asking whether the slot is occupied at all → `status` (`'unavailable'` = nothing registered; `'degraded'` = registered, reduced) — this is what `enabled` answered for `realtime` before.

Testing note, recorded because it is a real limit rather than an implementation detail: the two producer pins drive a declared in-process-bus stand-in, not the shipped `InMemoryRealtimeAdapter` — `@objectstack/runtime` taking a source-level dependency on `@objectstack/service-realtime` for a test is refused by this repo's type-resolution ratchets. The claim about the shipped occupant is pinned against the real class in `@objectstack/service-realtime`'s own suite instead; a mutation giving that adapter a channel route reddens that pin and leaves the producer pins green, which is the division of labour stated at both sites.

New in `@objectstack/spec`: `isSubscribableChannel()`, `readChannelRoute()`, `CHANNEL_SURFACE_SLOTS` (`@objectstack/spec/api`) and the optional `IRealtimeService.getChannelRoute()` — the producer half, by which an occupant that really serves a transport names the path a host mounted it at. Additive; no existing member changed shape. `@objectstack/service-realtime` deliberately does not implement it.
