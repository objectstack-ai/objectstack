---
'@objectstack/runtime': minor
---

fix(runtime)!: `PATCH /api/v1/packages/:id` refuses a read-only package with `422 WRITABLE_PACKAGE_REQUIRED`, as install-overwrite, disable, publish, revert and delete already do

ADR-0070 D2 makes a package the deployment ships read-only: one booted by code, one installed from the marketplace, and one whose manifest `scope` is `system` or `cloud`. `isWritablePackage` is that rule, and every other door that changes a package (`POST /packages` with `overwrite`, `PATCH /packages/:id/disable`, `POST /packages/:id/publish`, `POST /packages/:id/revert`, `DELETE /packages/:id`) refuses such a package with `422 WRITABLE_PACKAGE_REQUIRED`. The manifest-edit door never asked the rule. So a `manage_metadata` holder's edit of such a package's `name`, `description` or `version` answered `200` and changed its manifest, and with a `package` service composed it also re-persisted that manifest to the package's `sys_packages` row. The door now asks the same rule before it reads the body, so the answer is the same whatever keys the body carries.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer one runtime REST door gives a caller who asks it to edit the manifest of a package the deployment ships; the remedy is to edit a package the caller owns or to customise beside the shipped package, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (a REST door's accept set narrows), shipped as `minor` under the launch-window convention for breaking changes.

- **FROM:** `PATCH /api/v1/packages/:id` naming a read-only package, with `name`, `description` or `version` in the body (flat, or under `manifest`), answered `200` and edited that package's manifest, and its `sys_packages` row when a `package` service is composed.
- **TO:** the same request answers `422` with `error.code: 'WRITABLE_PACKAGE_REQUIRED'` and `error.details.packageId`, and writes nothing: no registry edit, no `sys_packages` row. It is the refusal the other package write doors give. Because the refusal comes before the body is read, a body this door would otherwise answer `400` (an empty patch, a version that is not SemVer) is answered the same `422` for a read-only package.
- **Unchanged:** a package an organization owns edits as before, its body checks still answer `400`, and an id nothing installed still answers `404`.
- **The fix for an integrator:** a package the deployment ships is managed by the deployment (its code release, or a new marketplace version), not over this API. Edit the manifest of a package you own, or customise what the shipped package provides beside it as environment-level state (ADR-0131 D6).
