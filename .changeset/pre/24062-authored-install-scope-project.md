---
'@objectstack/spec': minor
'@objectstack/runtime': patch
---

feat(spec)!: an install through `POST /api/v1/packages` may declare `manifest.scope` `project` only; `cloud` and `system` are refused, so an authored install can no longer lock itself

`cloud` and `system` are the scopes of packages the platform ships, and the ADR-0070 D2 read-only rule (`isWritablePackage`) judges a registered package by its stored `manifest.scope`. An install through `POST /api/v1/packages` authors the package, yet the install declaration admitted all three scopes. So a manifest that copied `scope: 'cloud'` or `'system'` from a shipped package answered `201` and produced an authored package that `DELETE /packages/:id`, `PATCH /packages/:id/disable` and `POST /packages?overwrite=true` then refused with `422 WRITABLE_PACKAGE_REQUIRED`, and the stored row came back on every restart. The install declaration now narrows the install manifest's `scope` to `project` (new export `PackageInstallManifestSchema`, `ManifestSchema` with that one key narrowed), on both body forms of `PackageInstallBodySchema` and on `PackageInstallRequestSchema.manifest`. `ManifestSchema` itself is unchanged: platform packages still declare all three scopes, and they reach the registry by code boot, not over this door. The door already parses its body through that declaration, so it answers the refusal with no rule of its own; its bare-form refusal sentence now re-reads the union's own bare branch, so it carries the prescription too.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No stored metadata moves and nothing is converted: the refused value is one a caller sends in a request body, and the only conversion that could exist for it (rewrite `cloud` / `system` to `project`) is the silent rewrite this change refuses on purpose, so there is nothing for `objectstack migrate meta` to rewrite. Stored `sys_packages` rows are untouched. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); the narrowed declaration is a Zod schema in packages/spec (not runtime-interface-only or type-surface-only); and nothing exported is removed (not runtime-export-retired). -->

**BREAKING** (a published request declaration's accept set narrows), shipped as `minor` under the launch-window convention for breaking changes.

- **FROM:** `POST /api/v1/packages` with a manifest declaring `scope: 'cloud'` or `scope: 'system'`, in the wrapped body `{ manifest }` or as a bare manifest, with or without `overwrite`, answered `201`; `PackageInstallBodySchema` and `PackageInstallRequestSchema` parsed it green.
- **TO:** the same request answers `400` with `error.code: 'VALIDATION_ERROR'`, names `scope` and the value sent, and installs nothing; both schemas refuse it with an `invalid_value` issue at `manifest.scope` (wrapped) or `scope` (bare).
- **Unchanged:** a manifest with `scope: 'project'` or no `scope` installs as before (`201`), and the door still stores the manifest as sent, so an absent `scope` stays absent. `ManifestSchema` and every other producer of it keep `cloud` / `system`.
- **The fix for an integrator:** remove `scope` from the manifest you install (it defaults to `project`), or write `scope: 'project'`.
- **A package that already locked itself this way** (an authored `sys_packages` row whose manifest declares `cloud` or `system`) stays read-only after this change, because the read-only rule reads the stored scope. No API door removes it; an operator deletes its row from the environment's database (`DELETE FROM sys_packages WHERE id = 'PACKAGE_ID'`) and restarts the server.
