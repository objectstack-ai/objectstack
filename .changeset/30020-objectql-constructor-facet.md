---
'@objectstack/objectql': patch
---

refactor(objectql): the `ObjectQL` constructor body moves into the hooks-and-functions facet

Clause-②: no
Metadata-protocol: none

- The constructor's body moves out of `engine.ts` into `engine-hooks-and-functions.ts` as `HooksAndFunctionsFacet.construct`. The constructor keeps its signature and does two things: it assigns `logger` (a field the compiler requires the constructor itself to assign) from `HooksAndFunctionsFacet.constructLogger(hostContext)`, then calls `construct` with the facet's host. Where the body handed the engine itself on (the package-enable summary refresh, the two env hardening flags), it reads the same engine through the host's `facade` entry.
- No behaviour changes and nothing to do on upgrade: the same statements run in the same order. The built declaration files are unchanged; the source maps move.
