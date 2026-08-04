---
"@objectstack/metadata": patch
---

fix(metadata): a known-partial `list()` result is cached as degraded, on a 2s TTL instead of 30s (#5184)

Since #5108 a loader that cannot read its store throws rather than answering
`[]`, so `MetadataManager.list()` catches, reports the outage once at `error`,
and keeps serving what the reachable loaders hold. That best-effort posture is
deliberate. What was not deliberate is what happened on the next line: the
known-short result went into `listCache` on the same 30s TTL as a complete read,
with nothing on the entry to say it was partial.

The consequences were all invisible from outside. That one `error` line covered a
**30s window in which the failing loader was never asked again** — no retry, no
second signal, the manager simply re-served a set it already knew was short. When
the store came back, nothing noticed for up to another 30s, so #5108's recovery
line (`reportLoaderReadRecovered`) arrived that late too. And because the entry
carried no marker, no consumer of the cache — including that once-only report —
could tell a partial answer from a complete one.

Not caching degraded reads at all was considered and rejected on evidence. The
`listCache` field comment records why the cache exists: security middleware
calling `list('permission')` from inside a user-initiated DB transaction, where
`DatabaseLoader`'s `engine.find('sys_metadata', …)` tries to take a second knex
connection while the transaction holds SQLite's only one, and knex waits out
`acquireConnectionTimeout` (60s). That hazard was re-verified against the current
driver stack and is still live — `DatabaseLoader._find()` still does not thread
the caller's transaction, `driver-sql` still models SQLite as a
single-connection pool (`activeTransactions`, `assertBareKnexSafe`, the latter a
dev/test guard that no-ops in production), and `plugin-audit` still threads the
transaction by hand for the same reason. Skipping the cache would have traded one
30s silent window for a fresh 60s stall per call.

So the entry is still cached, but as what it is:

- `listCache` entries carry a `degraded` flag, set when at least one loader threw
  while the result was being assembled. It lives on the entry rather than in a
  side table, so every reader can distinguish a complete answer from a partial
  one; entries are read through a single `readCachedList()` helper that applies
  the flag and its TTL in one place.
- A degraded entry expires after **2s** (`DEGRADED_LIST_CACHE_TTL_MS`) instead of
  30s. The burst of repeated lookups inside one transaction is still absorbed —
  those are milliseconds apart — while the window in which a known-short set is
  served without re-asking anyone shrinks 15×, and recovery is noticed (and
  logged) within seconds of the store healing.
- A complete read is unchanged: cached, not degraded, 30s TTL.
- The outage message now names the degraded TTL as the retry interval, since it
  previously promised the 30s one.

Also closes a `declared ≠ enforced` defect in the same field's comment: it claimed
the cache kept "only positive (non-empty) hits or repeated hits with a stable miss
signature". No such condition ever existed in `cacheListResult()`. The comment now
describes the policy the code actually implements, and the behaviour it claims
(an empty complete read *is* cached) is pinned by a test.

Internal caching policy only — no change to the `IMetadataService` contract or to
any public export.
