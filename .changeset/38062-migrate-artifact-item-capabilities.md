---
'@objectstack/cli': patch
---

fix(cli): `os migrate plan` / `apply` on an artifact-only stack compose the capability its shipped items mount, as `os serve` of the same artifact does

Clause-②: no
Metadata-protocol: none

A stack served from its compiled artifact alone (`dist/objectstack.json`, no `objectstack.config.ts`) that ships a `knowledge_source` and lists no `requires: ['knowledge']` is served KnowledgeServicePlugin by `os serve`, which lays the standalone stack's result over the empty config before it reads the tokens the stack's items mount. `os migrate plan` and `apply` read those tokens off the loaded config only, which is empty on that stack, so they composed no knowledge service, their "Composed what `os serve` mounts" note named none, and the boot warned that the source was unserved. They now hand the standalone result to the served-platform composition and read the items off `serve`'s own merge (`mergeBootConfig`), so both boots compose one set. A stack with no such item composes what it did before.
