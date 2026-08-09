---
"@objectstack/client": patch
---

fix(client): `QueryOptionsV2`'s JSDoc no longer calls itself "the recommended interface" for a deprecated method

`packages/client/src/index.ts`'s `data.find()` carries `@deprecated Use
data.query() with standard QueryAST parameters instead` (#986: deprecate the
legacy-parameter entries, promote `data.query(AST)`), but the `QueryOptionsV2`
interface — one of the two options shapes `find()` accepts — described itself
as *"the recommended interface for `data.find()` queries"*. A recommended
vocabulary for a method the same file marks deprecated is a self-contradiction
in the published type declarations: `dist/index.d.ts` ships both claims to
every consumer's editor.

Maintainer ruling on #6795 (2026-08-09, upholding #986): keep the
`@deprecated` tag — `find` is implemented product direction and both the CLI
and objectui's data adapter already call `data.query()` — and reword only the
self-description. `QueryOptionsV2`'s JSDoc now says it is the vocabulary
`data.find()` still accepts, not a recommendation, and points at
`data.query()` for new code.

No behavior change: `QueryOptionsV2`'s fields, `find()`'s normalization, and
the `@deprecated` tag are all unchanged. JSDoc/`.d.ts` wording only.
