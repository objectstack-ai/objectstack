---
"@objectstack/metadata-fs": patch
---

fix(metadata-fs): register every written path with the watcher, so an item created while chokidar is still scanning is not invisible forever (#7282)

`FileSystemRepository`'s watcher could go **permanently blind to a single
item** — external edits to that file produced no `MetadataEvent` for the whole
life of the process, and nothing recovered short of a restart. The window is a
race between chokidar's asynchronous initial scan and the repository's own
first write, and both `start()` (which arms the watcher, after which the caller
may `put()` on the next tick) and `ensureRoot()` (which arms it in the middle
of the very first write, #7000) can open it.

Measured on chokidar 5 with this repository's options (`usePolling`,
`interval: 1000`):

1. chokidar reads `<root>/<type>/` and finds it EMPTY — the atomic `rename` in
   `writeJsonAtomic` has not landed yet;
2. the rename lands, changing the directory's mtime;
3. chokidar calls `watchFile()` on that directory and libuv takes its polling
   baseline stat, which already reflects step 2.

The directory's stat then never changes again, so no poll ever fires for it,
the directory is never re-read, the item file is never added to the watched
set, and no per-file watcher is created. `getWatched()` reports the type
directory as `[]` while the file sits in it, and neither `add` nor `change` is
ever emitted for that path.

The fix does not widen any timer. The only writer that can be inside that
window is the repository itself, so `put()` now tells the watcher explicitly
about the path it created instead of depending on a directory scan that may
never notice it. Registration is idempotent and emits nothing.

User-visible effect: `MetadataManager.subscribe()` (and every consumer of
`repo.watch()`) now reliably sees out-of-process edits — a hand edit, or a
`git checkout` bringing metadata JSON in — to items written earlier in the same
process. This was also the cause of four merge-queue ejections across three
PRs; the two time-based mitigations tried before it (a 20s/25s event deadline
and a wider pre-edit sleep) could not have worked, because the event was never
delivered rather than late.
