---
"@objectstack/cli": minor
---

Clause-②: yes

`os build` reads package docs from **each package directory** of an ADR-0130 layout — `src/<pkg>/docs/*.md` — and attaches them to the **owning package's body** (`packages[i].manifest.docs`), linted against **that package's own `namespace`** (#18431).

A module can now ship its own docs. Before this, ADR-0046 collection was anchored at exactly one path, `<config dir>/src/docs`, so an ADR-0130 project that moved its docs into their packages lost all of them — loudly since #18428, but lost. The maintainer's ruling (batch #147 item 4) decided the two contract questions that blocked the widening, and both are implemented literally:

- **Where they attach**: to `packages[i]`, ⛔ never the artifact top level. The runtime already merges a package-owned collection back up for readers (`resolveArtifactCollections`, ADR-0130 D4), so a flattened copy would buy nothing and destroy the ownership D1 is about.
- **Whose namespace the lint uses**: the owning package's. A doc outside any package keeps `stack.manifest.namespace`. A multi-package artifact therefore has **one prefix rule per package** and ⛔ no single global prefix — and ⛔ no fallback between the two: a package doc that fails its own package's prefix is refused, never re-tried against the artifact's.

**What it costs, stated as the whole of it.** Exactly ONE class of input that `os build` accepted before is refused now, and it is the direct consequence of the ruled prefix rule: in a multi-package artifact (only `composeStacks(…, { manifest: 'preserve' })` produces one) whose packages declare namespaces DIFFERENT from the artifact manifest's, a doc owned by such a package used to be judged by the artifact's prefix and is now judged by its own package's.

```
FROM  packages[i] with namespace "sales" inside an artifact whose manifest.namespace is "crm"
      shipping a doc named  crm_orders_guide     -> accepted before, REFUSED now
TO    rename it to          sales_orders_guide   (and the file to sales_orders_guide.md)
```

The refusal is `docs/namespace-prefix`, an error, and it names that exact spelling. Nothing else that built green stops building: an artifact whose packages share one namespace — the ADR-0130 D1 shape, and the one `examples/app-multi-package` documents — sees no change at all, because the per-package rule and the artifact rule are then the same rule. In the other direction the same change is a widening, and the larger half: that package could not ship a doc under its OWN prefix at all before.

⚠️ Same-prefix LINKS and metadata-embed references are deliberately NOT partitioned with the naming rule — both resolve across the whole artifact. A doc's prefix says who judges its NAME; a link asks whether the target EXISTS, and ADR-0130 D1 exists so that N packages may share a namespace and cross-link inside it. Partitioning links too would have turned an ordinary cross-package link into `docs/broken-link` and stopped an artifact that built green from building; that was caught by this card's contract review and is pinned in the unit tier.

Also in this change:

- **The #18428 warning stays**, and now says *why* a directory was not read. Unchanged, word for word, for a stack that declares no `packages[]` — where "read from `src/docs/` only" is still the whole truth. For a directory that names **no** package it lists the declared packages and the three spellings a directory is matched against (`id`, the last dot-segment of `id`, `name`); for one that names **more than one** it names the candidates and refuses to guess. ⛔ `namespace` is not a matching spelling: ADR-0130 D1 exists so that N packages can share one, so matching on it would be ambiguous exactly where it matters.
- **A cross-owner duplicate doc name stays an error.** It PRESERVES a refusal rather than adding one: before the split every doc reached the lint in one flattened array, so two owners declaring one name already raised `docs/duplicate-name`. Splitting the set per package would have dropped that silently, and ADR-0130 D1 lets packages of one artifact share a namespace, so the prefix does not keep them apart. The rule is authoring hygiene — ⛔ not a claim that one registration overwrites the other, which ADR-0048 §3.3/§3.4 retired.
- **`os dev` mirrors `os build`.** The config-load path collects the same per-package directories onto the same bodies, so dev serves what a built artifact serves.
- **The step line counts the whole collection**, package sets included, and says how many came from package directories — a build that read four package docs no longer announces `0 collected`.

Single-package projects are untouched: with no `packages[]` there is nothing to attribute, the flat `src/docs/` keeps attaching exactly where it always did, and the emitted artifact is byte-identical.
