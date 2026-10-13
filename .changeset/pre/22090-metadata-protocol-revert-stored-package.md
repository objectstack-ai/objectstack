---
"@objectstack/metadata-protocol": minor
---

`ObjectStackProtocolImplementation.revertStoredPackage({ packageId, organizationId?, actor? })` reverts a package's stored members to their published version

Clause-②: yes (widening)

- A Studio-authored package's members are `sys_metadata` rows bound by `package_id`. The method reads them through the same predicate `listDrafts` uses, which now has one statement shared by both reads.
- No stored row bound to the package: it answers `{ stored: false, discarded: [] }` and touches nothing. The package's members, if it has any, belong to the metadata service. An unprovisioned `sys_metadata` answers the same way.
- Stored rows, none of them published: it refuses with `RESOURCE_CONFLICT` / 409, "Package '…' has never been published, so there is no published version to revert to." Nothing is touched.
- Otherwise it removes every draft of the package, each in the scope it lives in, through the same per-draft step `discardPackageDrafts` takes. Each item then serves its published (active) row again. An item created after the last publish has no published row and is removed. A refused draft fails the call with that refusal's own code and status.
- The only change to the public surface is this one added method. `discardPackageDrafts` and `listDrafts` answer as before.
