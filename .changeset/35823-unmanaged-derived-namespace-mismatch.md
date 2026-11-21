---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: an unmanaged install renamed into a `targetNamespace` refuses a package that declares no namespace when its object names all share a prefix other than the derived one, instead of copying them under a second prefix

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the answer the unmanaged install gives one request: a package body with no `namespace`, renamed into a `targetNamespace`, whose object names all begin with one first word that is not the namespace derived from its id. No stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller of the unmanaged install (`importUnmanagedPackage`, and `POST /api/v1/marketplace/install-local` with `installMode: 'unmanaged'`) that sends a `targetNamespace` with a package body that declares no `namespace`.

Such a body's namespace is derived from its id (`ai.objectstack.gallery.asset-lifecycle-b` derives `asset_lifecycle_b`), and the rename trusted it: an object named `demoasset_asset`, which carries its real prefix, was copied into `trialdemoasset` as `trialdemoasset_demoasset_asset`, while its view `demoasset_asset_all` kept its name, so one copy held three spellings and nothing said why. Now, when such a body has two or more objects, none carries the derived prefix, and every object name begins with the same first word (`demoasset_`), the copy is refused before the base exists: `400 INVALID_REQUEST`, with one rename-refusal `details.refused` entry per object naming the derived namespace, the common prefix and the missing `namespace` key. Nothing is installed. Two objects sharing a short first word (`purchase_order`, `purchase_item`) are refused the same way, and declaring `namespace` clears it.

A body that declares `namespace` is renamed exactly as before, whatever its names look like. In a namespace-less body, every other case keeps the rename: a single object, objects with no common first word (`purchase_order` beside `asset_owner`), or any object carrying the derived prefix each take the target prefix in front of a name that lacks it (`purchase_order` copies as `trialdemoasset_purchase_order`). Without a `targetNamespace` nothing changes: the save door's prefix rule already refuses those names (`422 NAMESPACE_PREFIX`).

The fix is in the package: declare `namespace` on it, the prefix its object names carry, then install again.
