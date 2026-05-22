---
'@objectstack/metadata': minor
---

Attach an `@objectstack/metadata-core` `MetadataRepository` as a
supplementary event source on `MetadataManager` (ADR-0008 M0 PR-6).

When a repository is configured via `manager.setRepository(repo)`:

- the manager subscribes to `repo.watch({ branch: 'main' })` and re-emits
  each event through the legacy `MetadataWatchEvent` channel that
  `manager.subscribe(type, cb)` already exposes, so existing HMR / SSE
  pipelines pick up changes from the new layer automatically;
- each event also invalidates the in-memory registry entry and the
  `list()` cache for the affected type, so subsequent reads fall
  through to the repository / loaders instead of returning stale data;
- a new `manager.dispose()` method drains the watch loop and the FS
  watcher cleanly. `MetadataPlugin.stop()` calls it.

`MetadataPlugin.start()` now instantiates a `FileSystemRepository`
rooted at `<rootDir>/.objectstack/metadata/` (separate from user source
files) and attaches it automatically when not in `artifact-only` mode.

No write-mirroring yet — `register()` / `unregister()` / `save()` keep
their existing semantics; the canonical write path migrates in PR-10.
