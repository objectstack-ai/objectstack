---
'@objectstack/objectql': patch
'@objectstack/cloud-connection': patch
---

Clause-②: no

fix(objectql): withdrawing a package that extends another package's object puts the owner's definition back at `GET /api/v1/meta/object/NAME` at once, not at the next restart

- **What was wrong.** When a package whose content is an `objectExtensions` field on another package's object is registered on a started kernel, the ObjectQL bridge rewrites the OWNER's copy of that object in the `metadata` service with the merged body, extension included. `DELETE /api/v1/marketplace/install-local/:manifestId` of the extender withdrew its contribution from the registry, so the object listing and the data plane dropped the field, but nothing rewrote the owner's copy. The by-name read asks that copy first, so `GET /api/v1/meta/object/NAME` kept serving the withdrawn field until the runtime restarted.
- **What changes.** The ObjectQL bridge remembers which owners' copies each package's extensions rewrote, and the `manifest` service gains `restoreExtendedObjectCopies(packageId)`: once the registry no longer holds the package, it re-registers each such copy with the registry's current definition. The install-local DELETE calls it right after the registry withdrawal. The by-name read then serves the owner's body without the extension's fields, as the listing and the data plane already did.
- **Not touched.** Only a copy stamped with the registry owner's id is rewritten, the same rule the bridge overwrites by, so an authored copy stays. The DELETE answer is unchanged. A copy that cannot be restored is logged once at `error`, naming the objects and the remedy: restart the runtime.
