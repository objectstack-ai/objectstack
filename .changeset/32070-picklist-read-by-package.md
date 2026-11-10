---
'@objectstack/objectql': patch
---

fix(objectql)!: the by-name picklist read answers by package — a bare read of a name two packages hold is refused naming both, and a qualified read reaches only its own holder (ADR-0150 D3)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is which picklist a by-name read answers, the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

The picklist joins the types whose by-name readers consult `(package, name)`, so `GET /api/v1/meta/picklist/:name`, its qualified forms and the metadata service's by-name read go through the one package-scoped resolver. A select field's `picklist:` is unchanged: it already resolves in its own package. A name one package holds is served exactly as before at the bare address and at its holder's qualified addresses.

**BREAKING** for answers that served one package's list for an address that does not name it (first-party count: 0 — no first-party package ships a picklist name another package also ships, and nothing first-party reads a picklist at a package that does not hold it):

1. A bare `GET /meta/picklist/:name` of a name two packages hold served the first registered. It is now `409 RESOURCE_CONFLICT` naming both. Phase 1's install door already refuses the second holder, so only a deployment that booted with the clash (and was warned at boot) holds it.
2. A qualified read that names a package not holding the name — `/meta/picklist/<namespace>/:name`, `?package=<id>`, or `/meta/picklist/_env/:name` when only a package holds it — answered `200` with another package's list. It is now `409 RESOURCE_CONFLICT` naming the holder.

The fix for each:

- FROM a bare read of a two-holder name TO `?package=<id>` or `/meta/picklist/<namespace>/:name`.
- FROM a qualified read naming a non-holder TO the holder's own namespace (the refusal names it), or the bare address without a qualifier.
