---
'@objectstack/runtime': minor
---

fix(runtime)!: `POST /api/v1/packages` with `overwrite` refuses a read-only package with `422 WRITABLE_PACKAGE_REQUIRED`, as disable, publish, revert and delete already do

ADR-0070 D2 makes a package the deployment ships read-only: one booted by code, one installed from the marketplace, and one whose manifest `scope` is `system` or `cloud`. `isWritablePackage` is that rule, and the four lifecycle doors that change a package (`PATCH /packages/:id/disable`, `POST /packages/:id/publish`, `POST /packages/:id/revert`, `DELETE /packages/:id`) refuse such a package with `422 WRITABLE_PACKAGE_REQUIRED`. The install door's `overwrite` option only bypassed the `409 … already exists` answer and never asked the rule. So an overwrite over a read-only package answered `201` and replaced its registry row with an authored one, and with a `protocol` service composed it also wrote that package's `sys_packages` row, while the server went on treating the package as read-only. The install door now asks the same rule, for the manifest's id, before either install path writes anything.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer one runtime REST door gives a caller who asks it to overwrite a package the deployment ships; the remedy is to install under an id the caller owns or to customise beside the shipped package, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (a REST door's accept set narrows), shipped as `minor` under the launch-window convention for breaking changes.

- **FROM:** `POST /api/v1/packages` with `overwrite: true` in the wrapped body, or `?overwrite=true`, and a manifest whose `id` names a read-only package, answered `201` and replaced that package's registry row.
- **TO:** the same request answers `422` with `error.code: 'WRITABLE_PACKAGE_REQUIRED'` and `error.details.packageId`, and writes nothing: no registry row, no `sys_packages` row. It is the refusal the four lifecycle doors give.
- **Unchanged:** an install of a new id, with or without `overwrite`, and an overwrite of a package an organization authored answer `201` as before. An install over an existing id without `overwrite` still answers `409`.
- **The fix for an integrator:** a package the deployment ships is managed by the deployment (its code release, or a new marketplace version), not over this API. Install the manifest under an id you own, or customise what the shipped package provides beside it as environment-level state (ADR-0131 D6).
