---
"@objectstack/metadata-protocol": minor
---

feat(metadata-protocol): cache the `getMetaItems` overlay read, keyed on the engine write epoch (#11967)

Leg D (ship-second) of the accepted #11633 cross-request caching design
(maintainer acceptance 2026-08-25, forks 1A / 2B / 3A / TTL-0).

`getMetaItems` re-read `sys_metadata` on every authenticated request. On the hot
path — `enforceApiAccess` → `loadObjectItems` → `getMetaItems({ type: 'object' })`,
once per REST request — that costs **two** sequentially awaited engine queries
whenever the environment holds no overlay rows for the type, because the empty
first result fires the alt-type retry. An app whose objects are all code-authored
paid both on every request. That read is now cached behind invalidation that is
synchronous and in-process rather than TTL-bound.

- **Primary trigger — the #11968 engine write epoch**, read structurally rather
  than imported: `@objectstack/metadata-protocol` does not depend on
  `@objectstack/objectql`, and the substrate declared `WriteEpochLike` separately
  for exactly this kind of consumer. Every `sys_metadata` write reaches it, because
  `SysMetadataRepository` writes through `engine.insert/update/delete`.
- **Residual bound — `OS_METADATA_OVERLAY_CACHE_TTL_MS`**, default 30s, `0` = off
  and a real path. It bounds one thing only: a peer replica's write on a deployment
  with no `authz.invalidated` bridge attached.
- **A success is cached ONLY when the engine exposes the write epoch** — leg C's
  rule, re-measured and unchanged here. No seam means the cache declines rather
  than degrading to a TTL-only shape, which for this leg would make
  publish-visibility a timer. Every existing test double keeps its exact query
  multiset; only a real engine caches.

**Grade: `minor`, argued.** Not `patch`: this adds a supported deployment knob
(`OS_METADATA_OVERLAY_CACHE_TTL_MS`, registered in the canonical environment-variable
table) and introduces a bounded staleness window that a multi-node operator must be
able to read about before upgrading — a release note that said only "internal
performance" would under-describe it. Not `major`: no public API changes, no export
is added or removed, `getMetaItems`' request and response contracts are untouched,
and the pins assert the cached answer is identical to the uncached one, so no caller
can observe the difference except in query count. Same grade and same reasoning as
leg C (#11966), which shipped `minor` for the same knob-plus-window shape.

**The SchemaRegistry-hydration trap (#11633 §4 leg D) is resolved structurally, not
by care.** `getMetaItems` registers overlay rows back into the SchemaRegistry as a
side effect of the read, so a cache that skips the read would quietly stop populating
the registry. What is cached here is the overlay **row set** — the value *upstream* of
the hydration branch — never the merged answer downstream of it. Every consumer of
those rows still runs on every call, hit or miss: the overlay parse, the package-aware
merge, `hydrateOverlayIntoRegistry`, the MetadataService merge, the disabled-package
filter, the nav contributions and the decorations. That containment also keeps the
cache's reach co-extensive with what its key can validate — the SchemaRegistry, the
MetadataService and the artifact table are all mutable sources the write epoch cannot
observe, and none of them is being cached.
