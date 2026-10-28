---
'@objectstack/cli': patch
---

fix(cli)!: `docs/metadata-embed-ref` judges a package's doc against that package and the packages it declares as dependencies (#27090)

Clause-②: yes (narrowing) — a multi-package artifact's package docs may now embed their own package's `state_machine`, `flow` and `permission` items, and those of the packages they declare in `manifest.dependencies`, which `os build`, `os validate` and `os lint` refused before. Two shapes that built before are refused: a package's inline body doc with a dead embed (no pass judged it), and, in an artifact that keeps a flattened top level, a package doc embedding an item of a sibling it does not declare.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of the package's public surface changes: the build-time docs lint resolves a metadata embed in the scope ADR-0051 already gives it (the doc's own package, then its dependencies). A refused embed is fixed in the doc, or by declaring the dependency; there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing in the build-time docs lint (`os build`, `os validate`, `os lint`), beside a widening.

- **Before.** Every embed was judged against the artifact's top level. A composed multi-package artifact (`composeStacks(…, { manifest: 'preserve' })`) carries its definitions under `packages[]` and nothing at the top level, so a package doc embedding its own package's object was refused with "does not exist in this package", and a package's inline `defineStack({ docs })` doc was never judged at all. An artifact that keeps a flattened top level (a reconciled composition) resolved every package doc's embeds against the whole artifact.
- **Now.** A package's docs (directory and inline alike) resolve against that package's body plus the packages of this artifact its `manifest.dependencies` names. The stack-level docs (`src/docs/`, unclaimed inline docs) resolve against the stack's top level plus the package the artifact's `manifest.id` names, which is the package they ship on, and its declared dependencies. A declaration is one-way. A refusal names the scope it judged: "does not exist in this package", or "in this package or its declared dependencies (IDS)".
- **Unchanged.** A stack with no `packages[]` is judged against its own collections, as before. Links between docs still resolve across the whole artifact.

**The remedy.** A refused embed of a sibling package's item: declare that package in the embedding package's `manifest.dependencies`, or move the doc to the package that owns the item. A dead reference: fix the name.
