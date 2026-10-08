---
'@objectstack/metadata': patch
---

fix(metadata): reverting a code-shipped package no longer answers 404 "No metadata items found" for items every read serves

Clause-②: no

`MetadataManager.revertPackage` collected a package's members by an item's own `packageId` or `package` key. A code-shipped item carries only the private `_packageId` stamp: the artifact loader writes it through `applyProtection`, and the ObjectQL object bridge copies it onto every object it registers in the metadata service. So `POST /api/v1/packages/:id/revert` answered `404 RESOURCE_NOT_FOUND` "No metadata items found for package '…'" for a code-shipped package, for example `com.objectstack.platform-objects`, while every read served that package's items.

`revertPackage` now also counts an item stamped with `_packageId` as a member. A code-shipped package that nothing was ever published for now gets the declared `409 RESOURCE_CONFLICT` "Package '…' has never been published". A package that was published is restored exactly as before, and an id that nothing carries still answers `404`.

`publishPackage` still finds members by `packageId` and `package` only. If it also read the stamp, nothing in it would refuse a read-only code package: the package's objects would be snapshotted and re-registered as published, which ADR-0070 D2 rules out. So a code package's stamped items are still not published by it.

A package whose items the metadata service never holds still answers `404`. This covers a package that ships only apps, navigation or docs, such as `com.objectstack.setup`.
