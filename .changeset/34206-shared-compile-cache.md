---
'@objectstack/metadata-protocol': patch
'@objectstack/metadata': patch
'@objectstack/objectql': patch
---

perf(metadata-protocol): the served item read caches its caller-independent compiled answer (ADR-0156)

Clause-②: yes
Metadata-protocol: none

`getMetaItem` (the served face of `GET /api/v1/meta/:type/:name`, and the per-item read an app bundle makes for every app, object, view, page and dashboard it names) no longer recompiles an item whose sources have not changed. Every caller gets the same answer it got before, the response body and ETag included: only the server's work per request moves.

- **What is cached.** The compiled envelope of a by-name read of `app`, `object`, `view`, `page` and `dashboard` items, per engine. A read for a package, a state, a member or a draft preview is never cached. The per-caller gate, field mask, translation and ETag stay computed on every request, and the live trailers (`registration`, `disabledActions`, `cascadeDeleteObjects`) are read on every hit.
- **What retires it.** Each source counts its own changes at its own mutation point: the `sys_metadata` overlay generation, the schema registry's `objectRevision` and a new `revision` that every public write of `SchemaRegistry` moves (the classification of its public methods is exhaustive by type), and a new `revision` on `MetadataManager`. Any move drops every entry. A source without its counter makes the cache decline.
- **What another process can change.** After a bound (`OS_METADATA_COMPILE_CACHE_TTL_MS`, default 30000 ms) the cache confirms before it recompiles: a digest of every stored row's content (so a write that leaves `updated_at` alone, or stamps it from a clock that is behind, still moves it) and each loader's reading of its backing store (`FilesystemLoader` stats the type directories and files its reads touched). If nothing moved, the entries stand for another bound, up to 10 bounds from when each was compiled. Every confirmation also retires the overlay row cache, so a recompile reads rows at least as new as the reading, and a read in flight across a confirmation is not stored. A loader that keeps no change mark makes every entry recompile at its bound, never renewed.
- **New public members (additive).** `SchemaRegistry#revision`, `MetadataManager#revision`, `MetadataManager#loaderChangeMark()`, the optional `MetadataLoader#changeMark()` and `FilesystemLoader#changeMark()`.
- `OS_METADATA_COMPILE_CACHE_TTL_MS=0` is the uncached read, the same reads in the same order.

On a showcase Setup bundle, an immediate repeat made 213 database reads before and 9 after.
