# @objectstack/metadata-fs

## 17.0.0

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- a1b66ef: `FileSystemRepository` no longer creates its root directory when it is attached — only when it first writes.

  `start()` used to `mkdir` both `<root>` and `<root>/.objectstack/.log` unconditionally, so merely attaching a repository was a write. Because `MetadataPlugin` attaches one at `<project>/.objectstack/metadata` during every boot, a command that never writes metadata still brought a directory skeleton into existence. The loudest case is `os migrate plan`, a declared dry run: on a project that had never been started it left

  ```
  .objectstack/metadata/.objectstack/.log
  ```

  behind, which also destroyed the one signal — does `.objectstack/` exist? — by which the next command can tell a fresh project from a started one. This is the filesystem half of the same property the database half already covers: a dry run leaves nothing behind.

  Attaching and reading a repository whose root does not exist is now explicitly supported and answers as an empty repository (`get`, `getByHash`, `list`, `history`, `watch`). The root, the type directories and the JSONL change log all appear on the first `put` / `delete`, and nothing about the boot's read-only character changes: no metadata is written that was not written before.

  One behavioural note for direct users of the package: when the root is absent at `start()`, the chokidar watcher is armed by the first write instead, because chokidar cannot watch a path that does not yet exist. A root brought into existence by a third party while the process runs — with this repository never writing — is therefore not picked up until the next `start()`.

- c7e7900: fix(metadata-core,metadata-fs): hash the serialized form, so `put().version` identifies the bytes actually stored (#7856)

  `hashSpec` canonicalised a `Date` to `{}`, because `canonicalize` walked a
  value's own enumerable keys and a `Date` has none. `JSON.stringify` — what every
  repository actually writes — turns the same `Date` into an ISO string. So the
  hash of the in-memory spec and the hash of the bytes on disk were **different
  hashes for the same item**, and the version handed back to a caller did not
  identify what had been stored.

  Measured on `main`, one spec carrying one `Date`:

  ```
  canonicalize(in-memory) : {"createdAt":{},"label":"Home"}
  JSON.stringify (bytes)  : {"label":"Home","createdAt":"2024-01-01T00:00:00.000Z"}
  ```

  `canonicalize` now honours `toJSON` exactly as `JSON.stringify` does —
  consulted once per position, its result serialised as-is and never
  re-consulted — which makes a new guarantee true by construction:

  ```
  canonicalize(x) === canonicalize(JSON.parse(JSON.stringify(x)))
  ```

  **Both repository implementations were wrong, in different places**, which is
  why the fix is one function rather than two patches. `FileSystemRepository`
  broke `put().version === get().hash`: it hashed the spec it was handed, wrote
  `JSON.stringify` of it, and re-hashed the parse on the way back out.
  `InMemoryRepository` broke the repository contract's invariant 4
  (`item.hash === hashSpec(item.body)`): it stores `body` already serialised
  (`clonePlain`) while hashing the in-memory spec, so the item it returns
  disagreed with its own hash. `SysMetadataRepository` inherits the fix through
  the same function.

  Downstream, an incoherent version meant a repository could report an
  `{op:'update', actor:'fs'}` for a file nothing outside the process had touched:
  the head index held a hash the disk could never reproduce, so re-reading one's
  own write looked like somebody else's edit. That surfaces without any watcher —
  a restart rebuilds the index from disk and the version the caller was handed no
  longer matches it.

  **Ordinary specs hash exactly as before, and this is not a migration.** The new
  path diverges only at a position carrying a callable `toJSON`; a graph without
  one is byte-identical through `canonicalize`. Verified against this repository's
  entire checked-in JSON corpus — 1973 files hashed under both the old and the new
  implementation, **0 hashes changed** — and the `hashSpec({})` regression guard
  in `metadata-core` is unmoved. Stored versions for ordinary specs keep their
  meaning. Versions for `toJSON`-carrying specs do change, and those are exactly
  the versions that never identified their stored bytes in the first place.

  Also supported as a consequence: a class instance with a `toJSON` now hashes as
  whatever it serialises to, rather than as its private fields. One without a
  `toJSON` still hashes as its own enumerable keys — which is what
  `JSON.stringify` writes for it.

  The pin is table-driven and lives in the shared repository contract suite, so
  every `MetadataRepository` implementation is held to it: `Date` at a key, `Date`
  under an array index, a class whose `toJSON` yields a string, an object literal
  carrying its own `toJSON`, a nested case, and a plain-JSON control row that
  proves the fix did not simply change every hash.

- a1686f9: fix(metadata-fs): stop suppressing self-writes on a wall clock, so a poll tick can no longer swallow an external edit (#7335)

  `FileSystemRepository` suppressed the watcher event its own `put()`/`delete()`
  was about to produce by adding the path to a `selfWrites` Set and clearing it on
  a fixed `setTimeout(…, 200)`. `handleFsChange` then dropped **any** event for a
  path in that Set, without ever reading what the watcher had observed.

  Under `usePolling: true, interval: 1000` chokidar compares state once per tick,
  so our own write and an external edit landing between two ticks are delivered as
  a **single** event carrying the _external_ content. Dropping that on a timer
  destroyed the only notification the external edit would ever produce — the edit
  was silently lost, and nothing later recovered it. The realistic trigger is a
  `git checkout` or an editor save arriving while the process writes the same item:
  the dev-mode authoring loop.

  **Measured.** The filing recorded 0/360 instrumented iterations reaching the
  window and called it derived rather than observed. That was a sampling artefact:
  the delivery lag of a self-write event is
  `(interval - (writeTime mod interval)) + awaitWriteFinish`, so a _fixed_
  pre-edit sleep phase-locks the poll and pins the lag outside the window
  (measured: 519–585 ms across 25 runs). Randomising the sleep so the lag samples
  `[0, interval)` uniformly, 40 runs:

  | delivery lag | runs | external edit |
  | ------------ | ---- | ------------- |
  | < 200 ms     | 7    | **swallowed** |
  | > 200 ms     | 33   | delivered     |

  A perfect split on the wall-clock boundary — the mechanism, observed.

  **The fix removes the pre-check rather than re-keying it**, because the
  content-keyed suppression it was shadowing already existed one step further
  down and needs no timer:

  - `add`/`change` — `currentHead === hash` drops the event when the bytes on disk
    are the bytes we last published. `put()` sets that head in the same
    continuation as its `rename`, and `awaitWriteFinish` holds any event for a
    further `stabilityThreshold`, so the index is never late.
  - `unlink` — `!currentHead` drops the event when the index already agrees the
    item is gone.

  `delete()` additionally now retires the head **before** it unlinks rather than
  after. `awaitWriteFinish` debounces only `add`/`change`, so that face gets no
  stability cushion between the disk mutation and the event it produces; ordering
  the index update first makes the downstream check a total suppression rather
  than a race against the poll callback. A failed `unlink` restores the head
  before rethrowing, so the error path is unchanged.

  No API or configuration change; the repository publishes strictly more of the
  external edits it was always meant to report.

  One pre-existing limit is now documented rather than altered: identity is judged
  on what round-trips through the file, so a spec whose in-memory form does not
  (a `Date`, which canonicalises to `{}` in memory but to an ISO string once
  written and re-read) is republished as an external `update`. Such a spec already
  fails `put().version === get().hash` independently of the watcher, and the
  200 ms window never covered it either — it expired some 360 ms before the event
  it would have had to catch.

- ab07b53: fix(metadata-fs): register every written path with the watcher, so an item created while chokidar is still scanning is not invisible forever (#7282)

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

- 684ab22: fix(metadata-fs): the `FileSystemRepository` watcher now sees external edits in the production layout

  `MetadataPlugin` attaches the repository at `<project>/.objectstack/metadata`, and the
  watcher's `ignored` matcher was a bare dotfile regex. chokidar applies that matcher to the
  watched root path itself, not only to entries found underneath it, so the `.objectstack`
  segment of the root matched and the entire watch was inert — `getWatched()` returned `{}`
  and no event ever fired. Hand edits, a `git checkout` that brings metadata JSON in, and any
  other out-of-process writer under `.objectstack/metadata/` were invisible until the next
  `start()`, even though `MetadataManager.setRepository()` is wired to those events and uses
  them to invalidate the registry and the `list()` cache.

  The matcher is now evaluated against the path _relative_ to the watch root, so dot segments
  belonging to the root itself are never considered while dotfiles under the root — including
  the repository's own `.objectstack/` bookkeeping subtree — stay ignored as before.

- Updated dependencies [f5a4ef0]
- Updated dependencies [2e836de]
- Updated dependencies [121852d]
- Updated dependencies [db0d53c]
- Updated dependencies [c7e7900]
- Updated dependencies [72c3c86]
- Updated dependencies [3670cf9]
- Updated dependencies [2d8dba3]
- Updated dependencies [7372d46]
- Updated dependencies [5e247fd]
- Updated dependencies [1a53a02]
- Updated dependencies [a954634]
- Updated dependencies [fda61e4]
- Updated dependencies [db48ad5]
- Updated dependencies [65f184b]
- Updated dependencies [51a587d]
- Updated dependencies [c073b8c]
- Updated dependencies [946a131]
- Updated dependencies [ce92674]
- Updated dependencies [3d4c545]
- Updated dependencies [bb7cb41]
  - @objectstack/metadata-core@17.0.0

## 17.0.0-rc.6

### Patch Changes

- a1b66ef: `FileSystemRepository` no longer creates its root directory when it is attached — only when it first writes.

  `start()` used to `mkdir` both `<root>` and `<root>/.objectstack/.log` unconditionally, so merely attaching a repository was a write. Because `MetadataPlugin` attaches one at `<project>/.objectstack/metadata` during every boot, a command that never writes metadata still brought a directory skeleton into existence. The loudest case is `os migrate plan`, a declared dry run: on a project that had never been started it left

  ```
  .objectstack/metadata/.objectstack/.log
  ```

  behind, which also destroyed the one signal — does `.objectstack/` exist? — by which the next command can tell a fresh project from a started one. This is the filesystem half of the same property the database half already covers: a dry run leaves nothing behind.

  Attaching and reading a repository whose root does not exist is now explicitly supported and answers as an empty repository (`get`, `getByHash`, `list`, `history`, `watch`). The root, the type directories and the JSONL change log all appear on the first `put` / `delete`, and nothing about the boot's read-only character changes: no metadata is written that was not written before.

  One behavioural note for direct users of the package: when the root is absent at `start()`, the chokidar watcher is armed by the first write instead, because chokidar cannot watch a path that does not yet exist. A root brought into existence by a third party while the process runs — with this repository never writing — is therefore not picked up until the next `start()`.

- ab07b53: fix(metadata-fs): register every written path with the watcher, so an item created while chokidar is still scanning is not invisible forever (#7282)

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

- 684ab22: fix(metadata-fs): the `FileSystemRepository` watcher now sees external edits in the production layout

  `MetadataPlugin` attaches the repository at `<project>/.objectstack/metadata`, and the
  watcher's `ignored` matcher was a bare dotfile regex. chokidar applies that matcher to the
  watched root path itself, not only to entries found underneath it, so the `.objectstack`
  segment of the root matched and the entire watch was inert — `getWatched()` returned `{}`
  and no event ever fired. Hand edits, a `git checkout` that brings metadata JSON in, and any
  other out-of-process writer under `.objectstack/metadata/` were invisible until the next
  `start()`, even though `MetadataManager.setRepository()` is wired to those events and uses
  them to invalidate the registry and the `list()` cache.

  The matcher is now evaluated against the path _relative_ to the watch root, so dot segments
  belonging to the root itself are never considered while dotfiles under the root — including
  the repository's own `.objectstack/` bookkeeping subtree — stay ignored as before.

- Updated dependencies [121852d]
- Updated dependencies [5e247fd]
- Updated dependencies [1a53a02]
- Updated dependencies [a954634]
- Updated dependencies [3d4c545]
- Updated dependencies [bb7cb41]
  - @objectstack/metadata-core@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- @objectstack/metadata-core@17.0.0-rc.5

## 17.0.0-rc.4

### Patch Changes

- Updated dependencies [db0d53c]
- Updated dependencies [72c3c86]
- Updated dependencies [51a587d]
- Updated dependencies [946a131]
  - @objectstack/metadata-core@17.0.0-rc.4

## 17.0.0-rc.2

### Patch Changes

- Updated dependencies [65f184b]
- Updated dependencies [ce92674]
  - @objectstack/metadata-core@17.0.0-rc.2

## 17.0.0-rc.1

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- Updated dependencies [f5a4ef0]
- Updated dependencies [2e836de]
  - @objectstack/metadata-core@17.0.0-rc.1

## 17.0.0-rc.0

### Patch Changes

- Updated dependencies [db48ad5]
- Updated dependencies [c073b8c]
  - @objectstack/metadata-core@17.0.0-rc.0

## 16.1.0

### Patch Changes

- @objectstack/metadata-core@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [62a2117]
- Updated dependencies [06cb319]
  - @objectstack/metadata-core@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [62a2117]
  - @objectstack/metadata-core@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- Updated dependencies [06cb319]
  - @objectstack/metadata-core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/metadata-core@15.1.1

## 15.1.0

### Patch Changes

- @objectstack/metadata-core@15.1.0

## 15.0.0

### Patch Changes

- @objectstack/metadata-core@15.0.0

## 14.8.0

### Patch Changes

- @objectstack/metadata-core@14.8.0

## 14.7.0

### Patch Changes

- @objectstack/metadata-core@14.7.0

## 14.6.0

### Patch Changes

- @objectstack/metadata-core@14.6.0

## 14.5.0

### Patch Changes

- @objectstack/metadata-core@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
  - @objectstack/metadata-core@14.4.0

## 14.3.0

### Patch Changes

- @objectstack/metadata-core@14.3.0

## 14.2.0

### Patch Changes

- @objectstack/metadata-core@14.2.0

## 14.1.0

### Patch Changes

- @objectstack/metadata-core@14.1.0

## 14.0.0

### Patch Changes

- @objectstack/metadata-core@14.0.0

## 13.0.0

### Patch Changes

- @objectstack/metadata-core@13.0.0

## 12.6.0

### Patch Changes

- @objectstack/metadata-core@12.6.0

## 12.5.0

### Patch Changes

- @objectstack/metadata-core@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/metadata-core@12.4.0

## 12.3.0

### Patch Changes

- @objectstack/metadata-core@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [da807f7]
  - @objectstack/metadata-core@12.2.0

## 12.1.0

### Patch Changes

- @objectstack/metadata-core@12.1.0

## 12.0.0

### Patch Changes

- @objectstack/metadata-core@12.0.0

## 11.10.0

### Patch Changes

- @objectstack/metadata-core@11.10.0

## 11.9.0

### Patch Changes

- @objectstack/metadata-core@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/metadata-core@11.8.0

## 11.7.0

### Patch Changes

- @objectstack/metadata-core@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/metadata-core@11.6.0

## 11.5.0

### Patch Changes

- @objectstack/metadata-core@11.5.0

## 11.4.0

### Patch Changes

- @objectstack/metadata-core@11.4.0

## 11.3.0

### Patch Changes

- @objectstack/metadata-core@11.3.0

## 11.2.0

### Patch Changes

- @objectstack/metadata-core@11.2.0

## 11.1.0

### Patch Changes

- @objectstack/metadata-core@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [4d99a5c]
  - @objectstack/metadata-core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/metadata-core@10.3.0

## 10.2.0

### Patch Changes

- @objectstack/metadata-core@10.2.0

## 10.1.0

### Patch Changes

- @objectstack/metadata-core@10.1.0

## 10.0.0

### Patch Changes

- @objectstack/metadata-core@10.0.0

## 9.11.0

### Patch Changes

- @objectstack/metadata-core@9.11.0

## 9.10.0

### Patch Changes

- @objectstack/metadata-core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/metadata-core@9.9.1

## 9.9.0

### Patch Changes

- @objectstack/metadata-core@9.9.0

## 9.8.0

### Patch Changes

- @objectstack/metadata-core@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/metadata-core@9.7.0

## 9.6.0

### Patch Changes

- @objectstack/metadata-core@9.6.0

## 9.5.1

### Patch Changes

- @objectstack/metadata-core@9.5.1

## 9.5.0

### Patch Changes

- @objectstack/metadata-core@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [fef38ec]
  - @objectstack/metadata-core@9.4.0

## 9.3.0

### Patch Changes

- @objectstack/metadata-core@9.3.0

## 9.2.0

### Patch Changes

- @objectstack/metadata-core@9.2.0

## 9.1.0

### Patch Changes

- @objectstack/metadata-core@9.1.0

## 9.0.1

### Patch Changes

- @objectstack/metadata-core@9.0.1

## 9.0.0

### Patch Changes

- @objectstack/metadata-core@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/metadata-core@8.0.1

## 8.0.0

### Patch Changes

- @objectstack/metadata-core@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/metadata-core@7.9.0

## 7.8.0

### Patch Changes

- @objectstack/metadata-core@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [764c747]
  - @objectstack/metadata-core@7.7.0

## 7.6.0

### Patch Changes

- @objectstack/metadata-core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/metadata-core@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/metadata-core@7.4.1

## 7.4.0

### Patch Changes

- @objectstack/metadata-core@7.4.0

## 7.3.0

### Patch Changes

- @objectstack/metadata-core@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/metadata-core@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/metadata-core@7.2.0

## 7.1.0

### Patch Changes

- @objectstack/metadata-core@7.1.0

## 7.0.0

### Patch Changes

- @objectstack/metadata-core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/metadata-core@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/metadata-core@6.8.1

## 6.8.0

### Patch Changes

- @objectstack/metadata-core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/metadata-core@6.7.1

## 6.7.0

### Patch Changes

- @objectstack/metadata-core@6.7.0

## 6.6.0

### Patch Changes

- @objectstack/metadata-core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/metadata-core@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/metadata-core@6.5.0

## 6.4.0

### Patch Changes

- @objectstack/metadata-core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/metadata-core@6.3.0

## 6.2.0

### Patch Changes

- @objectstack/metadata-core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/metadata-core@6.1.1

## 6.1.0

### Patch Changes

- @objectstack/metadata-core@6.1.0

## 6.0.0

### Patch Changes

- @objectstack/metadata-core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
  - @objectstack/metadata-core@5.2.0

## 5.1.0

### Patch Changes

- 75f4ee6: feat(metadata): introduce `executionPinned` capability for runtime version pinning (ADR-0009)

  Adds a new capability flag on the metadata type registry so that types whose runtime
  transaction rows reference a specific historical version (flow, workflow, approval)
  get unified pinning behavior — instead of every business table re-implementing its
  own snapshot column.

  - `MetadataTypeRegistryEntrySchema` gains `executionPinned: boolean`, enforced
    invariant `executionPinned ⇒ supportsVersioning`.
  - `flow`, `workflow`, `approval` flipped to `executionPinned: true`. `approval`
    also corrected to `supportsVersioning: true` (it was wrongly `false`).
  - `MetadataRepository.getByHash(ref, hash)` added to the interface. Production
    implementation in `SysMetadataRepository` resolves historical bodies through
    `sys_metadata_history` keyed by `(organization_id, type, name, checksum)`.
    In-memory and FS repositories serve HEAD-only matches.
  - `sys_metadata_history` gains an index on `(organization_id, type, name, checksum)`
    to keep hash lookups O(log n).
  - `HistoryCleanupManager` skips pinned types entirely (both age-based and
    count-based retention) — pinned-type history must never be GC'd.

  See `docs/adr/0009-execution-pinned-metadata.md` for full rationale and the
  list of rejected alternatives (no shared snapshot table, no inlined snapshot column).

- Updated dependencies [75f4ee6]
  - @objectstack/metadata-core@5.1.0

## 5.0.0

### Minor Changes

- 5e9dcb4: **BREAKING — metadata: remove `project` and `branch` from `MetaRef`**

  The metadata layer no longer models project or branch. Customisation is now
  scoped purely to **organisation**. Project remains exclusively as an artifact
  packaging concept (the `objectstack.json` bundle envelope); branching is left
  to Git.

  What changed:

  - `MetaRef` is now `{ org, type, name, version? }` (was
    `{ org, project, branch, type, name, version? }`). `refKey()` is the two
    segment string `${org}/${type}/${name}` (was five segments).
  - `MetadataItem.seq` is monotonic **per org** (was per branch).
  - `BranchRef`, `MergeStrategy`, `MergeResult` types and the optional
    `fork`/`merge` methods on `MetadataRepository` are removed.
  - `ListFilter` / `WatchFilter` / `HistoryOptions` no longer accept `project`
    or `branch`.
  - `FileSystemRepository` disk layout simplified to
    `<root>/<type>/<name>.json` (was `<root>/<project>/<branch>/<type>/<name>.json`);
    change-log path is now `.objectstack/.log/main.jsonl` regardless of any
    branch concept. Constructor no longer accepts `project` / `branch`.
  - `SysMetadataRepository`: removed `projectLabel` / `branchLabel` options;
    the `sys_metadata` schema's `project_id` / `branch` columns (if present)
    are ignored. A future major release will `DROP` them.
  - `MetadataManager.setRepository(repo, opts)` no longer takes an opts object
    with `branch`.

  Migration:

  ```diff
  -const ref = { org: 'acme', project: 'crm', branch: 'main', type: 'view', name: 'home' };
  +const ref = { org: 'acme', type: 'view', name: 'home' };

  -new FileSystemRepository({ root, org: 'acme', project: 'crm', branch: 'main' });
  +new FileSystemRepository({ root, org: 'acme' });
  ```

  Existing `sys_metadata` rows continue to load; the deprecated columns are
  ignored at read time.

- 32ce912: Add `@objectstack/metadata-fs` — Node-only `FileSystemRepository`
  implementation of the M0 Repository contract.

  Layout:

  ```
  <root>/
    <type>/<name>.json          # canonical body (atomic rename writes)
    .objectstack/.log/<branch>.jsonl   # append-only change log
  ```

  Features:

  - All 17 contract tests pass (`singleBranch: true`).
  - Per-key serialization via `KeyedMutex`.
  - Atomic writes via tmpfile + rename.
  - Heads and `seq` recovered from the JSONL log on `start()` — survives
    process restart.
  - chokidar watcher translates external edits (e.g. VSCode saves) into
    `MetadataEvent`s with `source: 'fs'`.
  - Self-write suppression: 200ms window prevents the watcher from
    re-emitting events for files we wrote ourselves.
  - Manual `AsyncIterator` for `watch()` to mirror the in-memory pattern.

  Also (`metadata-core`):

  - Add `singleBranch` option to `runRepositoryContractTests` so
    single-branch backends (like the FS one) skip the cross-branch test.
  - Switch tsup `splitting: true` so `index.js` and `testing.js` share a
    single `ConflictError` class identity (was double-bundled before).

  See ADR-0008 §10 PR-4.

### Patch Changes

- 96ad4df: Fix dev-mode HMR data-reload for `*.view.ts` / `*.flow.ts` source-file edits.

  Three coordinated fixes close the long-standing gap where editing a
  declarative-metadata source file in dev (e.g. `case.view.ts`) would
  recompile `dist/objectstack.json` but the running server kept serving
  the stale boot-time value:

  1. **`@objectstack/objectql`** — `ObjectStackProtocolImplementation.getMetaItem`
     now consults `MetadataService` (HMR-aware) **before** the in-memory
     `SchemaRegistry` (boot-time cache). Previously the registry shadowed
     freshly-registered values: `manager.register('view','case',newDef)`
     updated MetadataManager but `getMetaItem` returned the stale registry
     copy because step 2 (registry) ran before step 3 (service). Reordered
     to "1. sys_metadata overlay → 2. MetadataService → 3. SchemaRegistry".

  2. **`@objectstack/runtime`** — `createStandaloneStack` now enables the
     `MetadataPlugin` artifact-file watcher in non-production environments
     (`NODE_ENV !== 'production'`). Previously hard-coded to `watch: false`,
     leaving nothing watching `dist/objectstack.json` when the CLI dev mode
     recompiled it.

  3. **`@objectstack/metadata`** & **`@objectstack/metadata-fs`** — Both
     chokidar watchers now use `usePolling: true` to avoid `fs.watch`
     EMFILE on macOS / busy dev hosts where the native file-descriptor
     pool can be exhausted by other long-running node processes.

  With these three changes:

  - CLI edits source → recompile artifact (~400ms)
  - Server's polling chokidar detects artifact change → `_loadFromLocalFile`
  - `_loadFromLocalFile` calls `manager.register(type, name, item)`
  - MetadataService now has the fresh value
  - Read path returns the fresh value via the new step-2 lookup
  - Studio SSE listeners re-render

- Updated dependencies [5e9dcb4]
- Updated dependencies [4150fe4]
- Updated dependencies [8337cdb]
- Updated dependencies [58835a6]
- Updated dependencies [8cc30b4]
- Updated dependencies [32ce912]
  - @objectstack/metadata-core@5.0.0
