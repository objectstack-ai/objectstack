---
"@objectstack/spec": minor
---

`IMetadataService` now states the #7378 three-cell register ruling (maintainer, 2026-08-12), superseding the 2026-08-11 option-(a) text the contract carried — including a "(c) PARKED — do not implement" paragraph pointed at behaviour that is now ruled and shipped.

- `register`/`get` TSDoc states the ruled contract: a `data.name` disagreeing with the `name` argument is refused loudly (`VALIDATION_ERROR`, status 400, locating message naming both spellings, nothing stored); a non-object (or array) `data` is refused, never accepted-and-dropped or coerced into storability; type stores key on the canonical singular type (plural spellings fold through `PLURAL_TO_SINGULAR` before any store decision).
- `MetadataRoundTripExpectation` gains a `refused` kind, and the five ruled `METADATA_ROUNDTRIP_CASES` rows now carry the ruled answers. Four rows were renamed to state the ruled propositions: `key-is-the-name-argument-object`/`-nonobject` → `data-name-mismatch-refused-object`/`-nonobject`, `primitive-data-roundtrips` → `primitive-data-refused`, `array-data-roundtrips` → `array-data-refused`, and `plural-objects-type-is-its-own-store` → `plural-type-folds-to-canonical-store` (now `readable` through the canonical fold).
- The contract's reference double refuses rows 1/3 and folds row 2, restating the semantics of `assertMetadataRegisterContract` / `canonicalMetadataServiceType` (`@objectstack/core`) locally, since spec is the dependency root and cannot import core.

The shipped implementations already behave this way (their half landed separately); this release makes the contract's declared text and executable table agree with them.
