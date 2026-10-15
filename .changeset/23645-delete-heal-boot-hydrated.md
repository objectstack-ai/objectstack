---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): deleting a runtime object that was loaded at boot unregisters it at once, instead of leaving it registered and served until a restart

Clause-②: no

Before this fix, deleting such an object could leave it registered. This happened on a kernel whose ObjectQL plugin has no `environmentId`: the CLI's host-config boot, or a control plane. The object was a runtime object created before the server's last start. `DELETE /api/v1/meta/object/NAME` answered "it no longer exists" and removed the stored row, but the object stayed registered. Until a restart, data CRUD kept serving its table's records. `GET /api/v1/meta/object/NAME`, the object list and the layered read kept serving the deleted definition.

The cause: at boot the ObjectQL plugin copies every registered object into the `metadata` service. The delete's registry heal read that copy as the code baseline and registered it again. An object created in the same process was never copied, so its delete already worked.

Now an object body in the `metadata` service stamped tenant-authored (`_provenance: 'org'`) is never read as the object's code layer. What changes on those kernels:

- After the delete, the object is unregistered, as one created in the same process is. Data CRUD answers `404 OBJECT_NOT_FOUND`. The by-name read and the object list no longer serve it. Its table and records are kept: a delete without `dropStorage` drops nothing. This holds whether or not the row was bound to a package.
- A save afterwards that names a package makes that package the object's owner at once, over the kept table.
- The layered read's `code` layer for a runtime object is `null`, as it already was on a kernel with an `environmentId`. Before, it was the boot copy.

Unchanged: an object a code package ships keeps its baseline through the same delete. The `metadata` service itself still holds its boot copy. Other types are not affected: the security catalog's `permission` and `position` entries in the `metadata` service are still read as before.
