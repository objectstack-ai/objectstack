---
'@objectstack/runtime': minor
---

fix(runtime)!: `POST /api/v1/packages/:id/adopt-orphans` refuses a read-only package with `422 WRITABLE_PACKAGE_REQUIRED`, as the other package write doors already do

ADR-0070 D2 makes a package the deployment ships read-only: one booted by code, one installed from the marketplace, and one whose manifest `scope` is `system` or `cloud`. `isWritablePackage` is that rule, and every other door that changes a package (`POST /packages` with `overwrite`, `PATCH /packages/:id`, `PATCH /packages/:id/disable`, `POST /packages/:id/publish`, `POST /packages/:id/revert`, `DELETE /packages/:id`) refuses such a package with `422 WRITABLE_PACKAGE_REQUIRED`. The orphan-adoption door never asked the rule, and the protocol's `reassignOrphanedMetadata` asks none of its own: it rebinds every package-less `sys_metadata` row to whatever id it is handed. So a `manage_metadata` holder's adoption into such a package answered `200` and bound the environment's loose items into it. The door now asks the same rule after the capability gate and the walled refusal, and before the protocol is resolved.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer one runtime REST door gives a caller who asks it to adopt the environment's package-less items into a package the deployment ships; the remedy is to adopt them into a package the caller owns, never a rewrite of a package source or a stored row. Rows an earlier adoption already bound to a read-only package are not touched. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (a REST door's accept set narrows), shipped as `minor` under the launch-window convention for breaking changes.

- **FROM:** `POST /api/v1/packages/:id/adopt-orphans` naming a read-only package answered `200` with `{ success, reassignedCount, reassigned, targetPackageId }` and rebound every package-less `sys_metadata` row to that package.
- **TO:** the same request answers `422` with `error.code: 'WRITABLE_PACKAGE_REQUIRED'` and `error.details.packageId`, and rebinds nothing. Because the refusal comes before the protocol is resolved, a deployment whose protocol cannot adopt answers the same `422` for a read-only package where it answered `501`.
- **Unchanged:** a caller without `manage_metadata` is still refused `403` first, and under an `isolated` or `group` tenancy posture a caller below the operator rung is still refused `403 PERMISSION_DENIED` first. A package an organization owns adopts as before, and an id nothing installed still reaches the protocol, which binds the orphans to it as before.
- **The fix for an integrator:** a package the deployment ships is managed by the deployment, not over this API. Adopt the loose items into a package you own (create one with `POST /api/v1/packages` if none exists).
