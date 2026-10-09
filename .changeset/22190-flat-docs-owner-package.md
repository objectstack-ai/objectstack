---
'@objectstack/cli': patch
---

`os build`: a multi-package artifact's flat `src/docs/` is now carried by the package that owns the artifact's manifest, so its boot no longer warns about them

Clause-②: no

A multi-package artifact (one that carries `packages[]`, ADR-0130 D4) keeps its metadata in its package bodies only. `os build` still wrote the stack's own flat `src/docs/*.md` to the artifact's top level. At every boot, the metadata service registered them under the artifact's `manifest.id` and logged `carries N top-level metadata item(s) that none of its N package bodies declare`. The warning told the author to rebuild the artifact, which did not help: in an ADR-0130 layout the app package's source directory (for example `src/sales/`) is not named after the package, so no docs directory the build reads belongs to it.

- **What changes.** When exactly one `packages[]` entry has the artifact's `manifest.id` as its id, `os build` writes the flat docs onto that entry's body, after any docs from that package's own `src/<pkg>/docs/`. The artifact's top level no longer carries them. `composeStacks(…, { manifest: 'preserve' })` always produces this case, because the artifact's `manifest` is one of its inputs' manifests.
- **What stays the same.** The docs are served under the same package id, the doc count is the same, and books resolve the same tree. The doc lint still checks their names against `manifest.namespace`, and the `Collecting package docs` step line prints the same count.
- **What a running instance now reports differently.** These docs are now part of the owning package's installed record (`GET /api/v1/packages`) and are protected like that package's other docs (`lock: 'full'`, resettable), the same as the flat docs of a single-package artifact. Before, they were registered outside any package record and read back as freely editable.
- **When nothing moves.** If no entry has the manifest id, if several do, or if the artifact declares no `manifest.id`, the flat docs stay on the top level as before. A single-package artifact (no `packages[]`) is byte-identical to before.
- **To pick it up.** Rebuild with `os build`. An artifact that was already built keeps its shape, and the warning, until it is rebuilt.
