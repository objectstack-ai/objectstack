---
'@objectstack/objectql': patch
---

fix(objectql): a refused member of a multi-package artifact leaves no member of it registered (#31564)

Clause-②: yes (widening) — adds one public method, `SchemaRegistry.recordRestoreOnRefusal`, and refuses nothing that registers today.
Metadata-protocol: none

The engine's `manifest` service registered an artifact's packages one by one, and each package put back only what it had written itself when it was refused. When a later member was refused, the members registered before it stayed in the running kernel (package records, objects, apps, navigation contributions, kinds, datasource definitions), while the marketplace install door answered `422 PLUGIN_REGISTER_FAILED` and ledgered nothing, so a restart dropped them again.

- **Now.** Every package of one artifact, and then its residual (top-level items no package declares), registers in one restore run. A refusal anywhere in it puts back every entry any of them wrote, in the registry and in the engine's own manifest and datasource-definition maps, and the refusal reaches the caller unchanged. A first install leaves no member registered; a refused upgrade leaves the installed version of every member serving.
- **Unchanged.** Nothing that registers today is refused: the same bodies are accepted and refused, with the same code, status and sentence. A single-package artifact is answered exactly as before. The residual owner's origin is now recorded once the artifact has registered whole, so a refused artifact records none.
