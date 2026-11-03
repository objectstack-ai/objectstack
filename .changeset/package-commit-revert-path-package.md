---
'@objectstack/runtime': patch
'@objectstack/metadata-protocol': patch
---

fix(runtime)!: package commit revert and rollback act only on a commit of the package their path names

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata key, schema, accepted value, export or error code is removed or renamed. Two REST doors now refuse a request whose path package does not own the commit it names, with the existing COMMIT_NOT_FOUND code and the package-not-found 404 the sibling package doors already give, so no stored metadata changes and there is nothing for objectstack migrate meta to rewrite. The protocol's two request types gain an OPTIONAL member, which no existing caller has to send. -->

**BREAKING** for one call shape only: a request that named one package in the path and a commit of another. `POST /api/v1/packages/:id/commits/:commitId/revert` and `POST /api/v1/packages/:id/rollback` (body `{ commitId }`) used to ignore `:id`: a commit of package A, sent through package B's path, answered 200, reverted A's items and recorded a revert commit in A's history, even after A was uninstalled. Such a request now answers `404 COMMIT_NOT_FOUND` ("No commit 'ID' in package 'B'.") and writes nothing. An unknown `:id`, which includes a package that has been uninstalled, answers `404 Package 'ID' not found`, as the draft doors do, so an uninstalled package's history no longer takes new revert commits through its own path either. A commit sent through its own package's path reverts and rolls back exactly as before, with the same response body.

- **`@objectstack/runtime`**: both doors hand the path's package to the protocol, after the `manage_metadata`, walled-catalog and query refusals, which keep their order.
- **`@objectstack/metadata-protocol`**: `revertCommit` and `rollbackToPackageCommit` take an optional `packageId`. When it is sent, a commit of any other package is refused `COMMIT_NOT_FOUND` (404) before anything is written. An in-process caller that sends none reads any commit, as before.

A read-only package keeps its commit revert. Its only commits are the publishes of its environment overlays (ADR-0131 D6), and `POST /packages/:id/revert` answers a read-only package's stored rows too.

What to do: nothing, unless a script sends commit ids through another package's path. Send each commit through the package that `GET /packages/:id/commits` lists it under.
