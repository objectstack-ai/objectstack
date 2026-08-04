---
"@objectstack/metadata": patch
---

fix(metadata): `list()` reads are single-flight, so the "one loader hit per TTL window" promise finally holds for concurrent callers too (#5253)

`MetadataManager.list()` was a bare "read the cache → walk the loaders → write
the cache" sequence. The cache is written only once a read has **finished**, so
it absorbed the caller that arrived second in *time* but never the caller that
arrived second in *flight*: every `list(type)` issued while the first read was
still walking the loaders missed, and each one walked every loader itself. The
`listCache` field comment states the guarantee the cache exists to provide —
"the loader is only hit once per TTL window" — and that guarantee held for
sequential callers only.

That is not a rounding error on the path the cache was built for. The comment
names it: security/permission middleware calling `list('permission')` on the
request path while `DatabaseLoader`'s read sits inside a transaction that holds
SQLite's only connection, waiting out knex's `acquireConnectionTimeout` (60s).
Every concurrent request arriving during those 60s used to burn its own 60s,
because nothing had been written to the cache yet. The everyday version is
milder but constant: cold start, and the small burst of concurrent `list()`
calls that follows every invalidation point — `register()` / `unregister()`, a
cluster peer's write (#5109), a filesystem change (#5218) — each repeated the
full loader walk.

Reads of one metadata type are now single-flight. A `list(type)` that finds a
read already running for that type joins it instead of starting a second
identical walk.

- **Sharers share the outcome — as an explicit contract, not an accident.**
  Every caller joining an in-flight read receives that read's exact result,
  including when a loader was unreadable and the answer is known-partial.
  `list()` is the best-effort listing seam and does not throw (the strict
  counterparts remain `listForIndex()` and `loadDiagnosed()`), so a lost loader
  is not an error to fail over from — it is the answer, and re-running the read
  privately for a joiner would walk the same loaders against the same outage in
  the same window.
- **#5184's degraded judgment is unchanged and is not bypassed.** A shared read
  that lost a loader is still memoized `degraded: true` on the 2s TTL, never
  laundered onto the 30s healthy TTL by having been shared, and every sharer
  received that same partial set.
- **A write landing mid-read wins.** `invalidateListCache()` now retracts the
  in-flight read as well as the finished entry. The retracted read keeps running
  for the callers already waiting on it — they asked before the write — but it
  loses the right to memoize its pre-write answer, so that answer cannot outlive
  the write it predates; and a caller arriving after the write starts a fresh
  read rather than joining a pre-write one. That second half is #5219 / #5229's
  ordering bar restated for concurrency: a consumer woken by a metadata change
  must not observe the event and pre-event state together.
- The in-flight map is self-cleaning — an entry is dropped when its read
  settles, by that read only, so a fresh read that replaced it keeps its slot.

Internal caching policy only — no change to the `IMetadataService` contract or to
any public export. Sequential callers behave exactly as before.
