---
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

feat(runtime)!: the runtime package doors refuse to change packages when the deployment declares several replicas on the Redis cluster driver, instead of changing the one replica that served the request

Clause-②: yes (narrowing) — narrowed: `POST /api/v1/packages`, `PATCH /api/v1/packages/:id/enable`, `PATCH /api/v1/packages/:id/disable`, `POST /api/v1/packages/:id/duplicate`, `POST /api/v1/packages/:id/ensure-customization`, `PATCH /api/v1/packages/:id` and `DELETE /api/v1/packages/:id` now answer `409 MULTI_REPLICA_PACKAGE_CHANGE_REFUSED`, right after the caller is admitted (the `manage_metadata` gate and the walled-catalog refusal still answer first) and before the body is judged or anything is written, when the deployment declares several replicas (`OS_CLUSTER_REPLICAS` greater than 1, or `OS_EXPECT_MULTI_NODE=true`) and the composed cluster service runs the `redis` driver; `POST /api/v1/automation/:name/clone` and `POST /api/v1/security/permission-sets/:name/clone` answer the same `409` under the same condition only when their default landing would create the source's paired customization package on this replica. Nothing is written: no package, no package-state file, no metadata row. On a single node, on the in-process driver or with no cluster service composed, every door answers exactly as before. Widened: `ERROR_CODE_LEDGER` (`@objectstack/spec`) registers `MULTI_REPLICA_PACKAGE_CHANGE_REFUSED` under `@objectstack/runtime` too (one row per emitting package; the code itself is unchanged); nothing is removed or renamed.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no export is removed: a request that changed one replica's package registry or enable/disable state is now refused, with an already registered error code, only on a deployment that declares replicas on the Redis driver. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a multi-replica deployment on the Redis cluster driver that installs, enables, disables, duplicates, edits or deletes packages at runtime (Studio's package pages, the Console, the SDK or the HTTP doors), or clones a packaged flow or permission set whose customization package does not exist yet.

- **Before.** The package registry is read from the database at boot only, so a package created, installed, edited or deleted at runtime was seen by the serving replica alone until every other replica restarted; the enable/disable choice was written to the serving replica's own package-state store (a file under its own `OS_HOME` when the host registers none), so restarted replicas could serve different packages for good.
- **Now.** Those doors refuse with `MULTI_REPLICA_PACKAGE_CHANGE_REFUSED` (409), the code the marketplace install-local doors already answer under the same condition, and name the maintenance-window recipe: make the change on a single replica or through the CLI, then restart every replica. A clone whose customization package already exists on the replica, or which names a writable target, still lands, since it creates no package.
- **Unchanged.** A single node, or replicas declared on any driver other than `redis`, change packages as before. The metadata write doors (publish, publish-drafts, discard-drafts, revert, rollback, commit revert, adopt-orphans) write the shared store and are not refused. The split-brain guard is untouched.
- **Who sees it.** An administrator of a multi-replica deployment on the Redis cluster driver who changes packages at runtime, or who clones a packaged flow or permission set before its customization package exists.

The condition is `@objectstack/service-cluster`'s `declaresMultiReplicaOnRedis`, read per request from the composed `cluster` service's driver.
