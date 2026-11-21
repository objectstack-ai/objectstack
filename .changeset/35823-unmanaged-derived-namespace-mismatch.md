---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: an unmanaged install renamed into a `targetNamespace` refuses an object that does not carry the namespace derived for a package that declares none, instead of copying it under a second prefix

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the answer the unmanaged install gives one request: a package body with no `namespace`, renamed into a `targetNamespace`, whose object names do not carry the namespace derived from its id. No stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller of the unmanaged install (`importUnmanagedPackage`, and `POST /api/v1/marketplace/install-local` with `installMode: 'unmanaged'`) that sends a `targetNamespace` with a package body that declares no `namespace`.

Such a body's namespace is derived from its id (`ai.objectstack.gallery.asset-lifecycle-b` derives `asset_lifecycle_b`), and the rename trusted it: an object named `demoasset_asset`, which carries its real prefix, was copied into `trialdemoasset` as `trialdemoasset_demoasset_asset`, while its view `demoasset_asset_all` kept its name, so one copy held three spellings and nothing said why. Now every object of such a body must carry the derived prefix; each one that does not is refused before the base exists, with `400 INVALID_REQUEST` and the rename refusal's `details.refused` entry naming the object, the derived namespace, the prefix it carries instead (or that it carries none) and the missing `namespace` key. Nothing is installed.

A body that declares `namespace` is renamed exactly as before, and so is a namespace-less body whose object names all carry the derived prefix. Without a `targetNamespace` nothing changes: the save door's prefix rule already refuses those names (`422 NAMESPACE_PREFIX`).

The fix is in the package: declare `namespace` on it, the prefix its object names carry (`namespace: 'demoasset'`), then install again.
