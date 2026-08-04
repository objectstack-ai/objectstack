---
"@objectstack/metadata": patch
---

fix(metadata): `unregister()` invalidates the list cache AFTER the storage delete lands (#5259)

`MetadataManager.unregister()` dropped the registry entry and called
`invalidateListCache(type)` **before** awaiting `loader.delete()`. Those two steps
are separated by a real await window — one DB round-trip per writable loader — and
inside it the manager held a state that exists nowhere else: **registry already
empty, loader not yet empty**. `list()` merges the two, so a read arriving in that
window missed the just-cleared cache, assembled the still-stored row into its
answer, and memoized it as a *complete* read — the full 30s healthy TTL, because no
loader threw and #5184's 2s degraded TTL therefore never applied.

Nothing invalidated again once the delete landed (`notifyWatchers()` does not touch
`listCache`), so an item that was gone from storage kept being enumerated for up to
half a minute. `list()` is the enumeration seam behind `GET /api/v1/metadata/:type`,
the Studio left rail, sync/export and every consumer that decides existence from a
declared set — and `get()`, which never reads that cache, said the item was gone the
whole time. For a gating type (`permission`, `api`) the two faces of one manager
answered opposite questions about whether a declaration exists.

**Fixed by ordering, not by an extra invalidation.** `register()` never had this
defect because it writes the registry *first* and the registry outranks every loader
in the merge, so its own save window already shows the post-write state. The
invariant is therefore not "invalidate early" but *invalidate last, once every store
already holds the announced state*. `unregister()` now deletes from storage first,
then drops the registry entry and invalidates with **nothing awaited between them**,
then publishes and announces — #5219's invalidate-before-notify discipline unchanged.
A `list()` racing the delete now either sees a coherent pre-delete state (the delete
has not landed and has not been announced — that answer is the truth) or the
post-delete state; it can no longer cache the pre-delete answer past the delete.

This composes with #5253's single-flight rather than duplicating it: a read still
*in flight* when the delete lands cannot be reached by dropping `listCache` — it has
not written its entry yet and would write the pre-delete answer afterwards.
`invalidateListCache()` also retracts that read's `inflightListReads` registration,
so it resolves for the callers already waiting on it but loses the right to memoize,
while a caller arriving later starts a fresh read.

**A storage delete that fails is now loud.** It used to `logger.warn('Failed to
delete …')` and continue. Per AGENTS.md "Degradation log levels" this is
durability/consistency degradation, not functional: `unregister()` resolves
normally, the caller is told the delete succeeded, and the surviving row is read
straight back out of storage by the very next `list()`/`get()` — permanently, since
nothing retries it. It now logs at `error`, once per un-deleted item, naming the
consequence and the fix. The registry entry is still dropped in that case,
deliberately: the loader still holds the row so the item is served either way, and
keeping the entry would only pin an in-memory copy on top of a stored row nobody
maintains — dropping it makes the next read fall through to storage, which is the
actual truth after a failed delete, and makes it visible immediately instead of at
the next restart.

No API change. `unregister()` still resolves rather than throwing when a loader
refuses the delete.
