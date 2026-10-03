---
'@objectstack/spec': patch
---

Six provenance comments in `src/data/` and `src/ui/` were re-anchored

Clause-②: no

Six comment and docblock lines in `src/data/datasource.zod.ts`, `src/data/filter.zod.ts`,
`src/data/value-roundtrip-conformance.ts` and `src/ui/component.zod.ts` cited tracker numbers
that no longer resolve on GitHub. Each now cites the commit in this repository's history that
decided the matter, and the datasource comment also says in words which refusal it means: a
credential written into mongo's `options` passthrough. The live numbers beside them stay.
Comments only: no type, schema, export or runtime behaviour changes.
