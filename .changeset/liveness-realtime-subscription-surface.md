---
"@objectstack/spec": patch
---

chore(spec): govern the realtime `SubscriptionSchema` surface in the liveness ledger (#14446)

The `liveness/` ledgers ship inside this package's npm tarball (they are named in
`files`), so this is a published-data change even though no runtime behaviour moves,
no schema key changes spelling, and `packages/spec/src/api/realtime.zod.ts` is not
edited at all.

A new ledger file — `realtime_subscription.json` — classifies all six authorable
properties of `SubscriptionSchema`, what a client declares to open a realtime
subscription: the item type of `RealtimeConfigSchema.subscriptions` and the
`Subscription` the generated API reference publishes. It is enrolled through the
gate's `SPEC_ONLY_SCHEMAS` override, the route `query` / `qa` / `manifest` and the
four `RestServerConfig` sub-objects already take. A transport-protocol surface is
neither a metadata item nor stored metadata nor a manifest, so no registry has ever
held it and no ratchet rooted in one could ask who reads it — and
`RealtimeConfigSchema` is `.passthrough()`, so nothing downstream even refuses an
unknown key.

All six are `dead`, and the container is the finding: nothing outside
`packages/spec` imports `SubscriptionSchema`, `SubscriptionEventSchema` or
`RealtimeConfigSchema` at all, so no key beneath them can be read. The two the
census filed with this card measured are the sharp ones. `events[].type` accepts
`RealtimeEventType`, whose four members (`record.created` / `record.updated` /
`record.deleted` / `field.changed`) are disjoint from what the engine publishes —
`DataEventType`'s `data.record.*`, with a live emitter in `service-knowledge` — so
an author who writes the enum's own `record.created` gets a subscription that
silently never fires, and the enum is what the API reference shows them.
`events[].filters` is `z.unknown().optional()`: an authorable key with no shape and
no consumer, failing in the permissive direction, since the only payload matching
the platform performs compares object name and event type.

What this records, and what it deliberately does not. The enum's direction is
settled and the row carries the 2026-09-02 triage ruling verbatim so the next reader
does not re-open it: if the verdict is enforce it means repointing the enum, never
changing what the runtime publishes, which would break a live event contract to
satisfy a member nothing has ever used. `field.changed` is the same spelling the
sibling `DataEventType` removed in 17.0.0 under ADR-0049 (#4673, PR #4685) for
having no producer; it survives here only because this enum was never in a ratchet's
denominator. No key is removed, enforced, deprecated or re-described here — the
enforce-or-remove call per dead key is a follow-up on the human floor.

Rooted on `SubscriptionSchema` rather than on `RealtimeConfigSchema`, which is
measurement rather than taste: the ledger walk drills exactly one level, so with the
config as the root `subscriptions` would be the drilled level and `events[].type` /
`events[].filters` would have no row of their own, inheriting a container verdict —
the same reasoning that rooted the four `RestServerConfig` sub-objects separately.
`RealtimeConfigSchema`'s own three keys are not enrolled: whether enabling realtime
does anything is a different question with no census behind it yet.

One correction the ledger records because the next reader will hit it too. The card
and its triage both name the two keys on `SubscriptionSchema`; they are declared on
`SubscriptionEventSchema` (`realtime.zod.ts:46-50`), reached from this root as
`events[].type` and `events[].filters`. The cited lines and quoted shapes are exact;
only the owning symbol was misattributed, and this package's own authorable-surface
census (`authorable-surface/api.json`) already spells the two schemas apart.
