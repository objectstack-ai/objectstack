---
"@objectstack/cli": minor
---

Clause-②: yes

`os build` reads package docs from **each package directory** of an ADR-0130 layout — `src/<pkg>/docs/*.md` — and attaches them to the **owning package's body** (`packages[i].manifest.docs`), linted against **that package's own `namespace`** (#18431).

A module can now ship its own docs. Before this, ADR-0046 collection was anchored at exactly one path, `<config dir>/src/docs`, so an ADR-0130 project that moved its docs into their packages lost all of them — loudly since #18428, but lost. The maintainer's ruling (batch #147 item 4) decided the two contract questions that blocked the widening, and both are implemented literally:

- **Where they attach**: to `packages[i]`, ⛔ never the artifact top level. The runtime already merges a package-owned collection back up for readers (`resolveArtifactCollections`, ADR-0130 D4), so a flattened copy would buy nothing and destroy the ownership D1 is about.
- **Whose namespace the lint uses**: the owning package's. A doc outside any package keeps `stack.manifest.namespace`. A multi-package artifact therefore has **one prefix rule per package** and ⛔ no single global prefix — and ⛔ no fallback between the two: a package doc that fails its own package's prefix is refused, never re-tried against the artifact's.

What that costs, stated plainly: in a multi-package artifact whose packages declare namespaces different from the artifact manifest's, a doc owned by a package is now judged by the package's prefix. That shape could not ship docs at all before (the single global prefix refused it), which is why this lands as a widening; a doc that was named for the artifact's namespace while living inside a differently-namespaced package now asks to be renamed, and the refusal names the spelling.

Also in this change:

- **The #18428 warning stays**, and now says *why* a directory was not read. Unchanged, word for word, for a stack that declares no `packages[]` — where "read from `src/docs/` only" is still the whole truth. For a directory that names **no** package it lists the declared packages and the three spellings a directory is matched against (`id`, the last dot-segment of `id`, `name`); for one that names **more than one** it names the candidates and refuses to guess. ⛔ `namespace` is not a matching spelling: ADR-0130 D1 exists so that N packages can share one, so matching on it would be ambiguous exactly where it matters.
- **A cross-owner duplicate doc name is an error.** Doc uniqueness is logical — the metadata registry key carries no package coordinate — so once the prefix rule runs per package, two packages sharing a namespace can declare one name and silently overwrite each other at registration. Nothing else was looking across the sets.
- **`os dev` mirrors `os build`.** The config-load path collects the same per-package directories onto the same bodies, so dev serves what a built artifact serves.
- **The step line counts the whole collection**, package sets included, and says how many came from package directories — a build that read four package docs no longer announces `0 collected`.

Single-package projects are untouched: with no `packages[]` there is nothing to attribute, the flat `src/docs/` keeps attaching exactly where it always did, and the emitted artifact is byte-identical.
