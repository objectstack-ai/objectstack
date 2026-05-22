---
'@objectstack/metadata': minor
'@objectstack/cli': patch
---

Server-side artifact-file watcher; CLI no longer posts to the HMR
endpoint on recompile (ADR-0008 M0 PR-8).

`MetadataPlugin.start()` now attaches a chokidar watcher on the
`artifactSource.path` when running in local-file mode with `watch !==
false`. On every artifact change it re-invokes `_loadFromLocalFile`
and broadcasts a `reload` event through the HMR hub. This replaces
the previous arrangement where `os dev`'s watch-recompile loop POSTed
`/api/v1/dev/metadata-events` to trigger a reload — the server is now
autonomous.

The CLI `dev` command's recompile loop drops the POST call; the
`/api/v1/dev/metadata-events` route remains available for external
trigger sources (cloud webhooks, git hooks, ad-hoc curl).

`MetadataPlugin.stop()` closes the artifact watcher cleanly.
