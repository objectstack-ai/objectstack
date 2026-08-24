---
"@objectstack/spec": patch
---

fix(spec): the generated docs category index cards the pages its `meta.json` declares (#11260)

`content/docs/references/security/index.mdx` carded four of the five pages the
`meta.json` beside it declares. The fifth, `misc`, was generated and routed in
the sidebar — and unreachable from the one page whose job is to reach it.

Both files come out of one `gen:docs` run, from two enumerations of "the pages
of this category" that disagreed about exactly one bucket:

- `meta.json` was built from the pages the run **emitted**, which is where a
  published schema that no `.zod.ts` accounts for lands (`security/` declares
  two in plain `.ts` files, so they fall to the `misc` catch-all);
- the card grid was built from the `.zod.ts` files **on disk**.

`misc` has no `.zod.ts` behind it by definition — the generator says so twice,
and `sourcePathFor` returns nothing for it precisely so the page prints no
invented "Source:" line — so it was *structurally* absent from the second
enumeration. The card loop never considered it, which also means the
`wasEmitted` guard that the loop's own comment leaned on ("This aligns the
index with `meta.json`") never ran for it. The comment was wrong in the shape
that reads as verified: it named the invariant while the code held it by
coincidence, for the 13 categories where two independent enumerations happen to
agree.

The grid now iterates the list `meta.json` was built from, and keeps the
`wasEmitted` guard — a `.zod.ts` whose schemas are all unrepresentable in JSON
Schema still cannot be carded into a dangling 404. Because both files now read
one list, that guard can no longer thin the grid silently: a declared page the
run did not emit stops the build naming it. The stated invariant is true by
construction rather than by coincidence, which closes the class instead of
special-casing `misc`.

The regenerated output is one line: `security/index.mdx` gains its `misc` card
(with no "Source:" line, correctly). The other 13 category grids are
byte-identical.

An all-`misc` category — every published schema in the catch-all — would have
rendered an **empty** `<Cards>` grid under the old loop, with every zod-derived
slug filtered out and `misc` never considered. No such category exists in the
repo, so no emitted file can pin it; the rule moved into
`scripts/lib/category-index.ts` so it can be asserted directly, and an empty
grid is now unreachable from a non-empty declaration.
