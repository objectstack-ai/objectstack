---
"@objectstack/objectql": minor
---

feat(objectql): ADR-0048 Phase 1+2 — namespace install gate + package-scoped resolution

Phase 1 — install-time namespace gate. `SchemaRegistry.installPackage` refuses a
package whose `manifest.namespace` is already owned by a DIFFERENT installed
package (new `NamespaceConflictError`), making explicit and early the constraint
the table layer already enforces implicitly. Same-package reinstall and
shareable platform namespaces (`base`/`system`/`sys`) are exempt;
`OS_METADATA_COLLISION=warn` downgrades to a warning.

Phase 2 — prefer-local resolution, pivoted to ADR-0048 option A (package id as
the routing key). `getItem(type, name, currentPackageId?)` prefers
`${currentPackageId}:${name}` before any cross-package fallback (ADR-0005 overlay
precedence and backward compatibility unchanged); `getApp(name,
currentPackageId?)` resolves prefer-local by package id. Because package ids are
globally unique, package-scoped resolution always disambiguates two distinct
packages — so the old per-item CROSS-package throw (and the now-dead
`MetadataCollisionError`, `findOtherPackageOwner`, `SYS_METADATA_OWNER`, …) is
retired; two different-namespace packages legitimately coexist on the same bare
name. `collisionPolicy` now governs only the Phase 1 namespace gate.
