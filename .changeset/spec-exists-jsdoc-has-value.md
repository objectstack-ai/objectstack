---
'@objectstack/spec': patch
---

docs(spec): `$exists` JSDoc said key-presence, which has been false since protocol alignment (#13709)

`SpecialOperatorSchema.$exists` carried `Field exists check (primarily for NoSQL) -
MongoDB: $exists`. That describes key-presence, and key-presence stopped being what
`$exists` means when the has-value alignment landed (PR #13529 / `9dac1ae017`). The
line was not stale phrasing — it was false, and it is the last of the six sites that
carried the old claim; the other five were corrected by PR #13581 / PR #13577.

The corrected wording is the one recorded on #13539 and already shipped on those five
sites: `$exists` asks whether the field HAS A VALUE (`!= null`), the exact inverse of
`$null`, never key presence — lowered to `IS NOT NULL` / `IS NULL` on SQL and to
`{$ne: null}` / `{$eq: null}` on MongoDB. Verified against all three evaluators before
rewriting: `formula`'s `matchesFilterCondition` (`v === true ? actual != null : actual == null`),
`objectql`'s `having` face, and the `filter-logic-conformance.ts` table, which enrolls
`$exists` in both directions.

Prose only. No accept/reject change: `$exists` was and stays `z.boolean().optional()`,
and the JSDoc is a comment, not a `.describe()` — the schema, its JSON-Schema
projection and all 15 generated artifacts are byte-identical (`check:generated` green
on a freshly built `dist`).

Where the corrected line does and does not surface, measured rather than assumed:

- **Published source — yes.** This package's `files` array ships `src/**/*.zod.ts`, so
  `filter.zod.ts` is in the npm tarball and the comment reaches consumers verbatim.
  That is the surface this patch is for.
- **Emitted `.d.ts` — no.** Zero of the emitted `.d.ts`/`.d.mts` carry the text; the
  property's type is inferred from Zod, so no declaration comment is written. It
  appears in `dist` only inside `.js.map` sourcemaps.
- **Generated reference page — no.** `content/docs/references/data/filter.mdx` renders
  its Description column from `prop.description`, i.e. a Zod `.describe()`; `$exists`
  carries none, so that cell is empty before and after. Regenerating all 230 pages
  produces no diff. See #13709 for the follow-up on that empty cell.
