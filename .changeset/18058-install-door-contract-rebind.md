---
"@objectstack/spec": minor
"@objectstack/runtime": minor
"@objectstack/client": patch
---

The package-install request contract now names the door that actually serves it, declares the two body forms that door accepts, and the door honours `enableOnInstall` instead of ignoring it (#18058).

`PackageInstallRequestSchema` was declared, published and bound to `POST /api/v1/packages/install` — a path the composed runtime mounts nowhere: the dispatcher answers `handled=false` and `@objectstack/rest`'s registrar mounts only `POST /api/v1/packages/publish`. Meanwhile `POST /api/v1/packages`, the door that answers `201`, had no declared request contract at all, so the read contract was strictly more truthful than the write contract producing the rows it describes.

Clause-②: yes (widening)

**What moved on the published surface**

- `PackageApiContracts.installPackage.path` — `'/api/v1/packages/install'` → `'/api/v1/packages'`. A caller that read the constant to build a URL was building one nothing serves; a caller that hard-coded the old string gets a `404` today and should send `POST /api/v1/packages`. The method (`POST`) is unchanged and is what distinguishes this entry from `listPackages`.
- `PackageApiContracts.installPackage.input` — `PackageInstallRequestSchema` → the new `PackageInstallBodySchema`. The wrapped schema is still exported and still parses the wrapped form; the new export is a union that also parses a bare manifest.
- `PackageInstallRequestSchema` gains **`overwrite?: boolean`**. This is a declaration of behaviour that already shipped: the door reads `overwrite` from the body (or `?overwrite=true`) to opt back in to replacing an already-installed id instead of answering `409 Conflict`, the first-party SDK sends it, and no schema declared it — so any parse at that door would have silently stripped it and turned a deliberate re-install into a conflict.
- **`PackageInstallBodySchema`** / `PackageInstallBody` / `PackageInstallBodyParsed` are new. The door reads `body.manifest || body`, and first-party callers really do post a bare manifest as the whole body, so the contract declares both forms as a union of two whole closed declarations — never a tolerant shape. The bare form carries no install options: `settings`, `enableOnInstall` and `overwrite` are not manifest keys and the manifest surface is closed, so a bare-form caller reaches `overwrite` through the query string alone.

**What moved at the runtime**

`POST /api/v1/packages` now honours `enableOnInstall: false` in the wrapped body: the package installs `disabled`, through the same registry flip and durable state write `PATCH /packages/:id/disable` uses, so a restart does not re-enable what the caller switched off. `true` and absent install enabled, which is the declared default. Previously the key was declared in three schemas, sent by the SDK, and read by no handler at all.

**Documentation**

`packages/client`'s README install example could not parse against the manifest contract — no `id`, no `type`, and a `label` key the closed manifest surface refuses by name — and the live door answered it `400 Package id is required`. It is now a manifest that parses, and the example names the `overwrite` opt-in beside it.
