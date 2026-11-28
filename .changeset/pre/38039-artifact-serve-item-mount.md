---
'@objectstack/runtime': patch
---

**Shipped in 19.0.0-next.2**, whose CHANGELOG missed this entry; listed here one prerelease late.

fix(runtime): `os serve --artifact-fallback` mounts the knowledge service for a stack whose artifact ships a `knowledge_source`

Clause-②: yes (widening)
Metadata-protocol: none

`createStandaloneStack` (and `createDefaultHostConfig`, which returns its result) now surfaces every stack collection that a `PLATFORM_CAPABILITY_PROVIDERS` row names as its `mountedBy` — today `knowledgeSources` — read from the same resolved artifact as `objects` and `permissions`. `StandaloneStackResult` gains the optional `knowledgeSources`. The CLI's artifact-serve path wraps that result as its stack config, so `stackItemCapabilities` now finds the sources there: a stack served from its built artifact with no `objectstack.config.ts`, that ships a `knowledge_source` and does not list `requires: ['knowledge']`, is served the knowledge service and the deployment's store, as the same stack served from its config already was. Before this, such a source stayed inert on that path. A stack that already lists `requires: ['knowledge']` is served the same set as before. The list of collections is read from the table, so a later `mountedBy` row needs no edit to the runtime.
