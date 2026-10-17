---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: `installPackage` judges the whole manifest by the install door's declaration, so the primitive refuses a manifest `POST /api/v1/packages` refuses

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No stored metadata moves and nothing is converted: the refused values arrive in a call's manifest argument, and stored `sys_packages` rows are untouched and keep hydrating as stored (the boot hydration does not judge `type` / `scope`). The only conversion that could exist (rewrite `application` to `app`, `environment` to `project`) would be a silent rewrite of what an author declared, which this change refuses on purpose, so there is nothing for `objectstack migrate meta` to rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); the narrowing is the runtime accept set of a primitive that parses an existing published declaration, with no declaration or export changed (not type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`ObjectStackProtocolImplementation.installPackage` parsed only `manifest.id`, so an in-process caller stored manifests the install door answers `400 VALIDATION_ERROR` for. The primitive now parses the manifest through `PackageInstallManifestSchema` (`@objectstack/spec/api`, `ManifestSchema` with `scope` narrowed to `project`), the declaration the door parses, after its version default and before any write.

- **FROM:** `protocol.installPackage({ manifest })` with `type: 'application'`, `scope: 'environment'`, `scope: 'cloud'` / `'system'`, no `type`, or a key the manifest does not declare (such as a metadata collection, `pages`) registered the package and wrote its `sys_packages` row.
- **TO:** the call throws with `statusCode: 400` (an HTTP boundary answers `VALIDATION_ERROR`), the message names each refused key path (`manifest.type`, `manifest.scope`, …) with the declaration's own sentence, and neither the registry nor `sys_packages` is written. A malformed `manifest.id` still answers first, with its own sentence and repair.
- **Unchanged:** a manifest with no `version` still installs with `version: '0.1.0'`, a missing `namespace` is still derived from the id, and the manifest is stored as sent (the parse's `scope` / `defaultDatasource` defaults are not copied onto it).
- **Rows already stored** with `type: 'application'` / `scope: 'environment'` keep hydrating at boot, as stored. A new write of the same manifest, including a `duplicatePackage` of such a base, is refused.
- **The fix for a caller:** write a declared `type` (`app` for an application package) and leave `scope` out, or write `scope: 'project'`.
