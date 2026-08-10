---
'@objectstack/metadata-fs': patch
---

fix(metadata-fs): the `FileSystemRepository` watcher now sees external edits in the production layout

`MetadataPlugin` attaches the repository at `<project>/.objectstack/metadata`, and the
watcher's `ignored` matcher was a bare dotfile regex. chokidar applies that matcher to the
watched root path itself, not only to entries found underneath it, so the `.objectstack`
segment of the root matched and the entire watch was inert — `getWatched()` returned `{}`
and no event ever fired. Hand edits, a `git checkout` that brings metadata JSON in, and any
other out-of-process writer under `.objectstack/metadata/` were invisible until the next
`start()`, even though `MetadataManager.setRepository()` is wired to those events and uses
them to invalidate the registry and the `list()` cache.

The matcher is now evaluated against the path *relative* to the watch root, so dot segments
belonging to the root itself are never considered while dotfiles under the root — including
the repository's own `.objectstack/` bookkeeping subtree — stay ignored as before.
