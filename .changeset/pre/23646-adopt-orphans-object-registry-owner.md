---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): an orphan adoption moves each adopted object's registry owner and definition to the target package in the same request (ADR-0070 D5)

Clause-②: no

`reassignOrphanedMetadata`, the method `POST /api/v1/packages/:id/adopt-orphans` calls, rebinds every package-less `sys_metadata` row to the target package. For an object, only the stored row moved. The registry kept the owner that the package-less row had registered (the `sys_metadata` sentinel) and the pre-adoption definition until the next restart. Until then, a save of the object naming the target package answered success and never went live: its new fields were not on the data plane.

Each adopted object row now goes through the same registry write-through a save uses, in the same request. The package-less row's own registration leaves the registry first (`SchemaRegistry.unregisterObject`, the verb the delete heal already uses), so the object keeps exactly one owner (ADR-0029 D3). Right after the adoption, the target package owns the object, the data plane serves its definition stamped with that package, and the package's object list includes it. A save naming the target package then goes live at once, and the next boot registers the same owner.

What stays as before:

- The adoption's request and response shapes, and which rows it rebinds.
- A package-less row of an object that another package's row owns is rebound in storage only, and the registry keeps that owner. The next boot judges the two rows, as before.
- If another package extends the object, the registry refuses to drop the old owner. The adoption then logs one `error` naming the object, and the registry keeps the old owner until the next restart.
- Views follow their rebound row as before. Other types are rebound in storage only.
