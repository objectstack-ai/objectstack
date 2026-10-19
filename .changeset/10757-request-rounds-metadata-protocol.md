---
'@objectstack/metadata-protocol': patch
---

perf(metadata-protocol): the served by-name read takes its stored rows from the overlay cache, and only a `sys_metadata` write retires that cache

Clause-②: no (no accept set, served body or authz answer moves: fewer queries and rounds for the same answer; owes the seat's review of record before the queue, at `CONTRACT_REVIEW_TIER` by the seat's choice, since it changes when authz and localization caches are trusted)

- **`getMetaItem` reads the item's active `sys_metadata` rows through the overlay cache.** The list read already used that cache. The REST API-exposure gate reads the object by name on every `/data` request, and that read was its one uncached `sys_metadata` round trip. The cached value is the raw row set. Parsing, merging and registry hydration still run on every call, hit or miss. Only the served face reads through the cache. The protocol's own authoring checks, such as the destructive-change check before an object save, still read the store on every call.
- **Only a write to `sys_metadata` retires the cache.** The write is observed by an engine middleware after it settles. Every non-`write` epoch reason also retires it, including the metadata cluster bridge's `remote` bump, and `OS_METADATA_OVERLAY_CACHE_TTL_MS` still bounds it. Before, any engine write to any object retired it. A row set is cached only on an engine that has both the write epoch and `registerMiddleware`. With the TTL set to `0`, nothing is registered on the engine.
