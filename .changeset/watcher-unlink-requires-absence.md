---
'@objectstack/metadata-fs': patch
---

The file watcher no longer publishes a `delete` for an item that is still on disk.

A watcher `unlink` is a claim of absence, not absence: chokidar reaches its removal path from failed stats as well as from real removals, so under filesystem pressure it can retire a file that is still there. `FileSystemRepository` published those claims straight through as `delete` events — appended to the change log and broadcast to every subscriber, which drops the item from the metadata registry and the `list()` cache — and the reconciliation sweep then republished the untouched file as a `create`. A failed stat therefore produced a durable delete/create pair for an item nobody removed, with a window in between where live metadata had disappeared.

The removal face now confirms the absence against the disk under the same per-key lock the reconciliation sweep already used for this, and an `unlink` for a path that still exists falls through to the content comparison — so a spurious unlink that arrived alongside a real external edit surfaces as the `update` it always was. Genuine external removals are unaffected and are still published on the first delivery.
