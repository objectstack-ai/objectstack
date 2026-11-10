---
'@objectstack/metadata': minor
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
'@objectstack/plugin-security': minor
'@objectstack/runtime': minor
---

fix(metadata)!: permission sets are stored, read and removed by `(package, name)`, so each package's address serves its own grants (ADR-0150 D3/D4)

Clause-②: yes (narrowing)
Metadata-protocol: narrowed — a permission-set name is now held per package: the metadata service keeps one `permission` item per `(package, name)`, and the by-name read answers a name two packages hold with a refusal naming both, not with one of the two sets.

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped, and no stored row is rewritten: what moves is which permission set a by-name read answers and which in-memory slot holds it, so there is nothing for `objectstack migrate meta` to rewrite -->

`permission` joins `@objectstack/metadata`'s `PACKAGE_SLOTTED_STORE_TYPES` and `@objectstack/objectql`'s `PACKAGE_SCOPED_READ_TYPES`. Each package's set has its own slot in the metadata service, and removing one package's set (`unregister(type, name, { packageId })`, `unregisterPackage`) removes only that slot. `GET /api/v1/meta/permission/:name`, its qualified forms and `SchemaRegistry.resolveItem` go through the one package-scoped resolver. A name one package holds is served exactly as before at the bare address and at its holder's qualified addresses. `guest_portal`, which the platform requests by name, keeps one holder per deployment, resolved from any caller.

Three writers now carry the package:

- `@objectstack/runtime`'s `AppPlugin` stamps each permission set it registers with the stack's own package (`_packageId`, the id `registerApp` installs it under), the shape the artifact door already stamps; a body that wears another package's `_packageId` is filed under the stack's own package, never that package's. Without the stamp, two packages' sets of one name shared one slot on a non-artifact boot (`os serve`, `os dev`), and `?package=` of either was served the set registered last.
- `@objectstack/plugin-security`'s security-catalog echo reads the name's slots and drops a stale echo by its package, without announcing it to watchers, when a stored set's package binding moves (a binding it cannot read is not a move: nothing is dropped). Without that, the echo left two slots, and every later save of the name failed.
- `@objectstack/metadata-protocol`'s save door reads a set's already-held grants from the package the write lands in, through the exact qualifier.

**BREAKING** for the answers that served a set the reader did not name (first-party count: 0 — no first-party package ships a permission-set name another package also ships, and the install door still refuses a second holder until the one-holder rule narrows to the namespace):

1. A bare `GET /meta/permission/:name` of a name two packages hold served the first registered. It is now `409 RESOURCE_CONFLICT` naming both.
2. A qualified read that names a package not holding the name (`/meta/permission/<namespace>/:name`, `?package=<id>`, or `/meta/permission/_env/:name` when only a package holds it) answered `200` with the holder's set. It is now `409 RESOURCE_CONFLICT` naming the holder. This case is reachable today with one holder.
3. In-process readers:
   - A read of the metadata service naming no package (`metadata.get('permission', name)`) of a name two packages' slots hold is refused with `409 RESOURCE_CONFLICT`, where it served the set registered last. A package-less `unregister('permission', name)` of such a name is refused too, and removes nothing.
   - `metadata.get('permission', name, packageId)` and `getDiagnosed(…)` naming a package that holds no set of the name answer `undefined` (not found), where the package argument was ignored and the holder's set was served. This is reachable today with one holder.
   - ObjectQL's `MetadataFacade` readers resolve `permission` through the package-scoped resolver. `get(type, name, currentPackageId)` of a set held only outside the caller's declared closure, or held only by the environment when the caller's own package holds none, is refused with `409 RESOURCE_CONFLICT` naming the holders, where `getItem`'s prefer-local read served it. `getEntry` and `exists` read as a caller with no package: `getEntry` of a name two packages hold is refused, and `exists` answers `true` for it.
4. A permission-set save, publish or restore re-judges every grant on an object that does not exist when the set's own package holds no set of the name while another package does, or when the save names no package for a name two packages hold. Before, a grant the other holder's set held was exempt. A save by the holding package keeps its own held grants exempt, as before.
5. A permission set `AppPlugin` registers carries `_packageId` in the metadata service, as the artifact door's copy does: the stack's own package, also where the stack's body wore another package's `_packageId` (that stamp was kept).

The fix for each:

- FROM a bare read of a two-holder name TO `?package=<id>` or `/meta/permission/<namespace>/:name`.
- FROM a qualified read naming a non-holder TO the holder's own namespace (the refusal names it), or the bare address without a qualifier.
- FROM `metadata.get` / `metadata.unregister` of a two-holder name with no package TO the same call naming the package (`get(type, name, packageId)`, `unregister(type, name, { packageId })`).
- FROM `metadata.get` / `getDiagnosed` naming a package that does not hold the set TO naming the holder's package, or no package.
- FROM a `MetadataFacade.get` that leaned on reaching another package's or the environment's set TO declaring that package in the caller's closure, or reading with no package; FROM `getEntry` of a two-holder name TO `get(type, name, currentPackageId)` from a package that holds it.
- FROM a save that leaned on another package's held grant TO granting only on objects that exist, or saving from the package that holds the set.
- A reader of `AppPlugin`'s permission items that compared them field for field with the stack's declaration: `_packageId` is the one added key.
