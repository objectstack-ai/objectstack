---
"@objectstack/core": minor
"@objectstack/metadata": minor
"@objectstack/objectql": minor
---

feat(core,metadata,objectql): `IMetadataService.register` refuses ambiguous writes, and type stores key on the canonical type (#7378)

The maintainer's three-cell ruling of 2026-08-12 on #7378, implemented in every
shipped `IMetadataService` implementation — `createMemoryMetadata`
(`@objectstack/core`), `MetadataManager` (`@objectstack/metadata`) and
`MetadataFacade` (`@objectstack/objectql`) — through one shared guard,
`assertMetadataRegisterContract` / `canonicalMetadataServiceType`, newly
exported from `@objectstack/core`:

- **A `data.name` that disagrees with the `name` argument is refused** with a
  locating `VALIDATION_ERROR` (status 400), before anything is stored. The
  previous behaviours resolved the disagreement silently in opposite
  directions per implementation (argument-wins on the Map-backed stores,
  document-wins on the pre-#7511 facade), either of which can file an item
  under a key the author never wrote. A document carrying no `name` of its own
  still registers under the argument — absence is not a disagreement.
- **A non-object `data` (primitive, `null`, array) is refused** the same way.
  It was previously accepted-then-dropped by `MetadataFacade` (readable back
  through no member) and interim-fixed by boxing into `{ name, content }`; the
  ruling forbids both the drop and the coercion.
- **Type stores are keyed on the canonical (singular) type**: `'objects'` and
  `'object'` now address ONE store on every implementation, in both the write
  and the read direction, converging with the platform's enforced
  plural→singular normalization (`PLURAL_TO_SINGULAR`, `canonicalMetaType`
  #4432, `check:meta-type-normalized`).

Callers that register with a matching (or absent) `data.name` and plain-object
documents — every in-tree caller — are unaffected. A caller that relied on a
mismatched `data.name` being silently resolved must pass the intended key as
the argument and make `data.name` match it; a caller storing a bare value must
wrap it in a document whose shape its type's schema accepts.
