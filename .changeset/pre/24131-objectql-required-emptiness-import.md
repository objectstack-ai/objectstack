---
"@objectstack/objectql": patch
---

refactor(objectql): the record validator reads `isMissing` / `isEmptyForRequired` from `@objectstack/core` instead of private copies

Clause-②: no

- **No behaviour change.** The object-level `required` check, the `required_cleared` PATCH check, the blank-to-`null` normalisation of typed columns and the value-shape scan judge "missing" exactly as before; the private copies of the two predicates are deleted and `@objectstack/core`'s exports, moved there unchanged, are imported at every read site.
- **Why:** `@objectstack/rest`'s public-form submit route now judges a form's `required` by the same rule, and it cannot import the engine.
