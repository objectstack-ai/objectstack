---
'@objectstack/service-knowledge': minor
'@objectstack/spec': minor
---

feat(knowledge)!: refuse a knowledge_source save that names an adapter the running deployment does not mount

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no page under `skills/**` teaches a knowledge source's `adapter`; `content/docs/ai/knowledge-rag.mdx` and `content/docs/protocol/knowledge.mdx` name the save refusal

<!-- adr-0087: registered knowledge-source-unmounted-adapter-refused-at-save -->

**BREAKING** for an author or agent that saves a `knowledge_source` whose `adapter` names a store the running deployment does not mount (a retired store such as `ragflow`, or a typo): `PUT /api/v1/meta/knowledge_source/:name`, Studio, the MCP `save_metadata_draft` tool and a package duplicate now answer `400 VALIDATION_ERROR` where the save answered success, and nothing is written. The message names the source, the adapter and the mounted adapters. Fix: name one of the mounted adapters as the source's `adapter`, leave `adapter` out so the deployment's store holds it, or mount the named store and save again.

Before, the save was stored, the boot named the source at `error`, and every index and search of it answered `503 SERVICE_UNAVAILABLE`. A source already stored is not touched: it keeps answering `503` until it is saved with a mounted adapter.

Not moved: a source that leaves `adapter` out (it is placed on the deployment's store; several adapters and none the deployment's is still refused as before); a source naming a mounted adapter; the engine's own write, so a package install or a seed; a source registered in code (`KnowledgeServicePlugin({ sources })`, `registerSource`), which registers before its store starts; and `objectstack validate`, which runs with no deployment. For those three the boot's `error` line and the `503` at index and search stay the signal. Migration entry `knowledge-source-unmounted-adapter-refused-at-save` (`@objectstack/spec`) carries it for the upgrade guide.
