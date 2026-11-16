---
'@objectstack/objectql': patch
---

refactor(objectql): `registry.ts` is split into section modules by codemod; a move only, with the public exports unchanged

Clause-②: no
Metadata-protocol: none

`packages/objectql/src/registry.ts` (12,548 lines) is split by `scripts/codemod-split-registry.mjs`, the first pass of the `engine.ts` codemod, as ruled on #33949 (item 1, split 1 of 8). `SchemaRegistry` keeps every member's signature and docblock, and each moved method forwards in one call to a facet module (`registry-SECTION.ts`). The top-level declarations ahead of the class move whole into `registry-top-level.ts`, and `registry.ts` re-exports every one it exported by name. The script proves that every moved body and declaration is byte-identical to the base, and that `registry.ts` still exports the same names, each a value or a type as before. No behaviour changes, and nothing an importer of `@objectstack/objectql` reads changes.
