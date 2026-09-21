---
"@objectstack/cli": minor
---

**Clause-②: yes** — `os build` accepts a source layout it previously read nothing from, so what an author may write and have collected widens. ⛔ Nothing narrows: every tree that built green still builds green, with the same `docs[]` and the same warnings.

`os build` now derives **each package's docs directory from the packages the artifact registers**, not from a fixed depth under `src/` (maintainer ruling, decision batch #204 item 5, letter B).

Before this, the sweep asked one question per direct child of `src/`: does `src/CHILD/docs/` hold Markdown? So a project whose packages sit one level deeper — the shape this repo's own ADR-0130 D4 reference fixture `examples/app-multi-package` has, `src/packages/PKG/` — was invisible to it. A doc at `src/packages/orders/docs/ord_guide.md` was dropped **silently**: no `docs[]` entry, exit 0, and not even the `docs/uncollected-directory` warning, because the sweep never looked there. That is the #18170 defect verbatim, one level down, and after #18431 it was out of reach of both the diagnostic and the collection.

Both layouts are now one case rather than two:

```
src/orders/docs/sales_guide.md            -> packages[].manifest.docs  (unchanged)
src/packages/orders/docs/sales_guide.md   -> packages[].manifest.docs  (new)
```

**How the directory is found.** A registered package carries no source path — `ArtifactPackageSchema` is a `strictObject` whose only key is the assembled body — so the only thing that can locate one on disk is its NAME, and the two spellings a docs directory is matched against are unchanged: the package's `id`, and the last dot-separated segment of that `id`. ⛔ Never `name` (a display string, free to be re-worded) and ⛔ never `namespace` (ADR-0130 D1 exists so N packages may share one).

**No second depth was pinned.** The walk descends only in SEARCH of a registered package and stops at the first directory that names one — so a package's own subtree stays its source, and a `docs/` inside it is not a second docs directory. With no `packages[]` there is nothing to search for, so there is no descent at all: a single-package stack is walked exactly one level, its `docs[]` and its warning text byte-for-byte what they were. That is the fence the ruling preserved from batch #147 item 4, held by construction rather than by a branch guarding it.

**One new refusal.** Depth-free resolution makes one package able to answer to two doc-bearing directories (`src/core/docs` and `src/packages/core/docs` in one tree). Both are reported and neither is collected — the same answer this collector already gives when one directory names two packages. ⛔ It is not merged and ⛔ not silently halved: docs attach by package index, so collecting both would drop one without a word.

A directory that matches **no** package and one that matches **more than one** keep their existing, distinct diagnostics, now at whatever depth they are found.
