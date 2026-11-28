---
'@objectstack/skills': patch
'@objectstack/spec': patch
---

docs(skills): `objectstack-ai` names the save refusal of a `knowledge_source` whose `adapter` is not mounted

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ai` § Knowledge Sources (RAG), the `adapter` row: a run-time save naming an adapter the deployment does not mount is refused (`400 VALIDATION_ERROR`, nothing written), naming the source, the adapter and the mounted ones. Fix: name a mounted adapter, or mount the store and save again.

`@objectstack/spec`: migration entry `knowledge-source-unmounted-adapter-refused-at-save` qualifies its `replacement`. Leaving `adapter` out places the source on the deployment's store, except on a host that mounts several adapters and marks none the deployment's, where a source with no `adapter` is itself refused: name a mounted adapter there. No behaviour changes.
