---
"@objectstack/spec": patch
---

fix(spec): the generated docs root sidebar lists categories from the same declared page list `meta.json` and the category index already agree on (#11482)

`build-docs.ts` writes the docs tree from what should be one answer to "which
categories/pages exist", but the ROOT `content/docs/references/meta.json` (§3
— the sidebar's top-level category list) was still answering it a third way:

- a category's own `meta.json` (§2) is built from the pages the run
  **emitted**;
- that category's `index.mdx` card grid (§2.5) reads the SAME declared list
  (#11260) — no longer a second, independently-derived enumeration;
- the root `meta.json` (§3), until now, filtered on `categoryZodFiles` — the
  `.zod.ts` files found **on disk** — a third, independent enumeration.

A category whose published pages all come from plain `.ts` files rather than
`.zod.ts` ones (the `misc` catch-all class `security/misc` proves is real) has
zero `.zod.ts` files while still publishing a page, a `meta.json` and an
`index.mdx`. The old filter would drop such a category from the sidebar even
though it is fully generated and routed everywhere else — a folder complete on
disk and unreachable from the nav.

**No category is in that state today** — all 14 have at least one `.zod.ts`
file — so this was a latent defect with no live instance, and the regenerated
root `meta.json` is byte-identical. The filter now reads `categoryMetaPages`,
the same map §2.5 already reads, so all three files answer from one list
instead of three that happen to agree today. The rule moved into
`scripts/lib/root-meta.ts` (`rootCategoryDirs`), pinned directly with the
all-`misc`-category shape that has no instance in the repo — the same move
#11260 made for the category card grid, for the same reason: the defect's
output is an ABSENT sidebar entry, which `check:docs` cannot see any more than
it could see an absent card, and the edge that has no live instance cannot be
pinned from emitted output at all.
