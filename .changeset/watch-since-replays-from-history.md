---
"@objectstack/metadata-protocol": minor
"@objectstack/metadata-core": minor
---

`MetadataRepository.watch()` — a numeric `since` now replays from the durable
log, and what a bare `watch(filter)` owes is written into the contract.

**`SysMetadataRepository.watch(filter, since)`** read `since` only as a drop
filter on live events, so an event that had already committed was unreachable
through `watch()` however low `since` was set — even though the repository holds
a durable per-org `event_seq` log in `sys_metadata_history` and already reads it
org-wide in `nextEventSeq()`. Invariant 6 of the repository contract
("`watch(_, since)` MUST replay all events with `seq > since` before delivering
live events") was therefore unimplemented in the repository backing every
production metadata write. It now replays through that same query, using the
row-to-event mapping extracted out of `history()`. The live listener is
registered before the durable read is issued and a set of delivered `seq`
numbers closes the replay-to-live seam, so an event committing mid-read arrives
exactly once; a failed durable read is raised to the consumer rather than
degraded into a silent live-only tail.

**No behaviour change for a `watch()` with no `since`** — deliberately. Both
in-repo production subscribers (`MetadataManager.startRepositoryWatch()` and
`MetadataCache.start()`) attach that way, and replaying for them would push an
org's entire history through cache invalidation and HMR as "this just changed"
at every attach.

**Contract text (`@objectstack/metadata-core`, `repository.ts`).** Invariant 6
now states its own boundary: a `watch()` with no `since` is owed **live events
only**; an implementation MAY additionally deliver events that had already
committed, but a caller MUST NOT rely on it, and a caller that needs the
already-committed prefix passes a numeric `since` or reads `history()`. That
half was previously unwritten and load-bearing — "no `since` replays
everything" existed only as `InMemoryRepository`'s implementation, and the
shared contract suite silently depended on it.

**If you run `runRepositoryContractTests` from
`@objectstack/metadata-core/testing` against your own implementation**, one
clause changed shape. `watch filters by type and name` (which wrote twice, then
opened a watch and expected the match back) is replaced by `watch filters by
type and name — over the live stream`, which opens the subscription first and
writes after. FROM: an implementation passed by replaying its whole matching log
on a bare `watch(filter)`. TO: it passes by delivering, and filtering, the
events that commit after the subscription is established. An implementation that
replays as well still passes — the new clause asserts the floor, not the
maximum. If yours only replayed and never delivered live events, it was relying
on unspecified behaviour and now needs a live path.
