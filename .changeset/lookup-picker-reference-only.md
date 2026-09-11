---
'@objectstack/rest': minor
---

**BREAKING (runtime behaviour on a published route).** The public-form lookup-picker route
`GET /forms/:slug/lookup/:field` resolves its target object from the canonical field key
`reference` alone. The three tolerant fallback arms it used to read after it — the
`referenceTo`, `target` and `options.objectName` spellings — are deleted.

Effect on the wire: a stored object-metadata row whose lookup field carries one of those
three spellings and no `reference` used to answer `200` with rows from the aliased object; it
now answers `500 LOOKUP_TARGET_MISSING`, and the data engine is never called. A field
carrying `reference` is unaffected, including a partially-migrated row carrying a legacy
spelling beside it. `publicPicker.object` on the form is still the explicit override and is
still read first.

No migration is prescribed, and none is owed. `FieldSchema` is a `strictObject` that refuses
`relatedTo`, `referenceTo`, `target`, `targetObject` and `lookupObject` by name, answering
with a rename hint naming the canonical key, so no authoring path can produce such a row; a
census across both trees found no producer and no relation field carrying any of them, with
positive controls; and the maintainer ruled on 2026-09-09 that no deployment holds rows to
preserve. The spec spelling is the contract, and a stored row spelling the target the old way
is a producer defect rather than a dialect this route accommodates.

<!-- adr-0087: not-required (no-migration-prescription) This narrows a REST route's runtime read, not a metadata surface: no Zod schema, spec declaration or stored representation changes here, and `objectstack migrate meta` has nothing to rewrite for it. The one at-rest spelling with a measured population is `reference_to`, already carried by the pre-existing ADR-0087 entry `field-reference-to-alias`, which is untouched by this change and disjoint from the three spellings it removes; those three have no at-rest population and are refused by name at the write door, so a new ledger entry would be scope invented at conversion time. -->
