---
'@objectstack/metadata': patch
'@objectstack/runtime': patch
---

fix(runtime,metadata): publishing or reverting a read-only package is refused with `422 WRITABLE_PACKAGE_REQUIRED`, and package membership reads the `_packageId` stamp

Clause-②: no

ADR-0070 D2 makes a code or installed package read-only. `POST /api/v1/packages/:id/publish` and `POST /api/v1/packages/:id/revert` did not check this. These two answers change:

- **Publish of a code or installed package: 200 → 422.** Before, the publish door answered 200. For a package whose items carry an authored `packageId`, for example `com.example.showcase`'s two capabilities, it answered `success: true` and wrote `publishedDefinition`, `state` and `version` onto those read-only items. For every other code package it answered `success: false`, "No metadata items found". It now answers `422 WRITABLE_PACKAGE_REQUIRED` before anything is written, the same refusal that `PATCH /packages/:id/disable` and `DELETE /packages/:id` already give.
- **Revert of a code or installed package: 404 or 409 → 422.** Before, the revert door answered `404 RESOURCE_NOT_FOUND` "No metadata items found" (for example `com.objectstack.setup` and the platform packages that ship objects) or `409 RESOURCE_CONFLICT` "Package '…' has never been published" (for example `com.example.showcase`). It now answers `422 WRITABLE_PACKAGE_REQUIRED`. The check runs after the protocol's stored-row answer, so a revert of a code package that has a stored row bound to it, such as an organization overlay draft, keeps its answer.

To customise what a code package provides, use an ADR-0005 organization overlay. Overlay drafts publish through `POST /api/v1/packages/:id/publish-drafts` and the per-item publish door, and this change leaves both alone.

**Unchanged:** a writable package's publish and revert, and an id that nothing carries (revert 404; publish 200 with `success: false`).

`MetadataManager.publishPackage` and `revertPackage` now find a package's members by `packageId`, `package` or the private `_packageId` stamp. The artifact loader writes that stamp through `applyProtection`, and the ObjectQL object bridge copies it onto every object it registers. Before, an item that carried only the stamp was not a member. `MetadataManager` has no notion of package kind; the refusal of read-only packages lives at the two doors above.
