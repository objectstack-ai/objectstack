---
'@objectstack/runtime': patch
'@objectstack/client': patch
---

fix(runtime): the package doors record the signed-in caller in metadata history, never a name the request body supplies

Clause-②: no
Metadata-protocol: none

Metadata history and package commits are what an administrator reads to decide what to roll back and whom to ask. Five package doors — `POST /packages/:id/discard-drafts`, `POST /packages/:id/commits/:commitId/revert`, `POST /packages/:id/rollback`, `POST /packages/:id/adopt-orphans` and `POST /packages/:id/duplicate` — and the app re-save that `POST /packages/:id/publish-drafts` performs to unhide a package's apps used to record whatever `actor` the request body named, so any caller allowed to manage metadata could make a change look as if someone else made it.

They now record the request's authenticated user, the same identity the single-item metadata doors record. A body `actor` is ignored, not refused: a client that still sends one keeps working and is recorded as itself. A system call with no user keeps recording no actor (`null`), as before.

In `@objectstack/client`, the `actor` option of `packages.discardDrafts`, `packages.revertCommit`, `packages.rollback`, `packages.adoptOrphans` and `packages.duplicate` is marked deprecated: the server ignores it. Drop it from your calls; nothing else changes.
