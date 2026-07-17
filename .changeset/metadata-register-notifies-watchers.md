---
"@objectstack/spec": patch
"@objectstack/metadata": patch
"@objectstack/objectql": patch
---

**`MetadataManager.register()` / `unregister()` now announce to `subscribe()` watchers.** Both updated the registry, persisted to writable loaders and published to realtime, but never fired the watch callbacks — so `subscribe()` looked like it covered every write while silently missing all of them. Only the `saveMetaItem` path (via the repository watch stream) and the filesystem watcher ever reached a subscriber. Runtime consumers that cache metadata — notably ObjectQL's SchemaRegistry bridge, the component that decides what is queryable — went stale on every other write until the process restarted.

Announcing is now the **default**, so a new call site is correct without knowing this contract exists. This is a contract fix rather than a bug fix: the one live behavior change is that runtime datasource writes (`datasource-admin`) now reach the HMR SSE stream, which subscribes to every registered type. `unregisterPackage()` / `bulkUnregister()` also announce their deletes now — correct, but latent, since neither has a production caller today.

Bulk ingest opts out explicitly with the new `MetadataWriteOptions` (`{ notify: false }`) — boot-time filesystem priming, artifact ingest, and ObjectQL's registry bridge, each of which either runs before consumers cache anything or announces the whole batch once (as the artifact reload path does via `metadata:reloaded`). The bridge in particular MUST stay silent: it copies objects out of the SchemaRegistry, and announcing would feed them back through a handler that re-registers under `_packageId ?? 'metadata-service'`, overwriting the true package provenance of every object whose body carries no `_packageId`.

Additive only — `register(type, name, data)` and `unregister(type, name)` keep working unchanged.

Fixes #3112.
