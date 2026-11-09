---
'@objectstack/objectql': patch
'@objectstack/spec': patch
---

refactor(objectql): the `ObjectQL#find` and `ObjectQL#findOne` bodies move into the find facet

Clause-②: no
Metadata-protocol: none

- The bodies of `find` and `findOne` move out of `engine.ts` into `engine-find.ts`, the facet that already holds their read helpers. Each method stays on the class as a one-call stub with its signature and its docblock. Where a body handed the engine itself on (`ql: this` in the before/after hook context), it reads the same engine through the host's `facade` entry.
- No behaviour changes and nothing to do on upgrade. The built declaration files keep every member and every docblock; the source maps move.
- The `query.fields` and `query.top` liveness rows in `@objectstack/spec` now cite `engine-top-level.ts`, where `planFormulaProjection` and `ENGINE_QUERY_SLOTS` are declared, and `engine-find.ts`, where the `find` / `findOne` bodies fold the `top` alias, since `engine.ts` no longer imports those names; the evidence they cite is unchanged.
