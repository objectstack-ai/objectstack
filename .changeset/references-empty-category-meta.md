---
"@objectstack/spec": patch
---

fix(spec): stop emitting a `meta.json` for a reference category that publishes no page (#7303)

`gen:docs` wrote `content/docs/references/<category>/meta.json` for every category
it iterated, including one whose page list came out empty. The result was a
directory holding a single `{ "title": …, "pages": [] }` and nothing else: no
reference page, no `index.mdx` (§2.5 already skipped that), and no entry in the
root `meta.json`, so the route could not resolve and the link checker never saw
it. Its one measurable effect was on whoever enumerated the tree — human or
agent — who counted one category more than the docs actually publish.

`contracts/` was the standing case. It holds TypeScript service interfaces
rather than `.zod.ts` schemas, so `gen:schema` creates `json-schema/contracts/`
and leaves it empty; `conversions`/`migrations` have no schema directory at all
and are skipped outright, while `contracts` reached the emit with zero pages.
The `meta.json` emit is now guarded on the page list being non-empty, mirroring
the guard the category `index.mdx` emit already carries, so all three behave
alike. `content/docs/references/` goes from 15 category directories to 14.

The guard is on the page count, not on that schema-directory asymmetry, so a
future category in either shape lands the same way.

No published page changes: the emitted file count goes 231 → 230, and the one
file that stops being written is the empty `meta.json`. The Contracts Protocol
prose documentation is unaffected — it lives at `content/docs/kernel/contracts/`
and is not generated from this tree. `contracts` also remains a declared
category in `scripts/lib/category-title.ts`; `resolveCategoryTitles` is total
over the directories in `packages/spec/src/`, so that declaration is mandatory
while the module exists.
