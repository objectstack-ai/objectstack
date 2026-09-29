---
'@objectstack/spec': patch
---

Provenance comments in the rest of `data/` were re-anchored

Comment and docblock lines in `src/data/object.zod.ts`,
`src/data/filter-logic-conformance.ts` and `src/data/object.form.ts` that cited
tracker numbers which no longer resolve on GitHub now cite the commit in this
repository's history that decided the matter, and say in their own words what
was decided. Comments only: no type, schema, export or runtime behaviour
changes.
