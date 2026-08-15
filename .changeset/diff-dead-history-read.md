---
"@objectstack/metadata-protocol": patch
---

perf(metadata-protocol): `diffMetaItem` stops awaiting a `historyMetaItem` read it discarded, halving the history round trips on the live diff endpoint (#8798)

`diffMetaItem` opened by awaiting a full `historyMetaItem` read, mapped it into a
`versions` array, and threw it away (`const _used = versions; void _used;`) while
the read it actually uses ran a few lines below through the engine. Every request
to the routed `GET /api/v1/meta/:type/:name/diff` paid for two reads of
`sys_metadata_history` where one is used.

Diff bodies are unchanged. The authorization gate the discarded call passed
through never reached this function's output: `historyMetaItem`'s early return
answers `{ events: [] }` for a type that is neither `isOverlayAllowed` nor
`isRuntimeCreateAllowed`, without throwing and without touching the engine, and
`diffMetaItem` reads the history rows directly — so the five gated-shut types
(`field`, `job`, `api`, `capability`, `agent`) were already served a full diff
regardless.

One behaviour change, on the outage path only. The discarded call was unguarded,
so an unavailable `sys_metadata_history` was fatal for gated-open types while
gated-shut types fell into the `try`/`catch` below it and answered an empty diff
— one outage, two answers, decided by an authorization gate unrelated to reading
history. Every type now takes the `catch`, which is the function's only stated
intent for that failure. Whether swallowing that outage is the right answer at
all is tracked in #8833.
