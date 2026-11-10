---
'@objectstack/objectql': patch
---

fix(objectql)!: the by-name picklist read answers by package — a bare read of a name two packages hold is refused naming both, and a qualified read reaches only its own holder (ADR-0150 D3)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is which picklist a by-name read answers, the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

The picklist joins the types whose by-name readers consult `(package, name)`, so `GET /api/v1/meta/picklist/:name`, its qualified forms, `SchemaRegistry.resolveItem` and objectql's exported `MetadataFacade.get` / `getEntry` / `exists` go through the one package-scoped resolver. (The in-tree `metadata` service, `MetadataManager`, reads a picklist exactly as before.) A select field's `picklist:` is unchanged: it already resolves in its own package. A name one package holds is served exactly as before at the bare address and at its holder's qualified addresses.

**BREAKING** for four answers that served a list the reader did not name or may not reach (first-party count: 0 — no first-party package ships a picklist name another package also ships, nothing first-party reads a picklist at a package that does not hold it, and nothing first-party constructs a `MetadataFacade` outside its tests or calls `resolveItem` with a package caller):

1. A bare `GET /meta/picklist/:name` of a name two packages hold served the first registered. It is now `409 RESOURCE_CONFLICT` naming both. Phase 1's install door already refuses the second holder, so only a deployment that booted with the clash (and was warned at boot) holds it.
2. A qualified read that names a package not holding the name — `/meta/picklist/<namespace>/:name`, `?package=<id>`, or `/meta/picklist/_env/:name` when only a package holds it — answered `200` with another package's list. It is now `409 RESOURCE_CONFLICT` naming the holder.
3. A package caller (`MetadataFacade.get('picklist', name, packageId)`, or `SchemaRegistry.resolveItem('picklist', name, packageId)`) reads a name that only the environment's own list holds. It was served the environment's list. It is now refused with `409 RESOURCE_CONFLICT` naming the environment.
4. A package caller reads a name whose one holder is a package it does not declare as a dependency. It was served that package's list. It is now refused with `409 RESOURCE_CONFLICT` naming the holder.

The fix for each:

- FROM a bare read of a two-holder name TO `?package=<id>` or `/meta/picklist/<namespace>/:name`.
- FROM a qualified read naming a non-holder TO the holder's own namespace (the refusal names it), or the bare address without a qualifier.
- FROM a package caller reading the environment's own list TO the list shipped in the reading package, or in a package it depends on.
- FROM a package caller reading a package it does not depend on TO that package declared in the reader's `dependencies`.
