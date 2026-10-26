---
'@object-ui/console': patch
---

fix(console): the build's chunk-membership report attributes only objectui's own packages

Clause-②: no
Metadata-protocol: none

The Console build writes `dist/chunk-membership.json`, which the eager-closure gate reads to check that each budgeted chunk holds the packages it declares. Inside the objectstack monorepo the framework's own packages resolve to a second `packages/` directory, and four of their names are objectui package names too (`cli`, `core`, `sdui-parser`, `types`). The report matched any `packages/<name>/` segment, so `@objectstack/core`'s bundle file, which belongs in `vendor-objectstack`, was counted as a module of objectui's `packages/core`, and the gate reported `framework` as having lost one module to a vendor chunk. The report now counts only modules under objectui's own `packages/` directory. No chunk's contents change.
