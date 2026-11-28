---
'@objectstack/metadata-core': minor
'@objectstack/objectql': patch
'@objectstack/spec': patch
'@objectstack/skills': patch
---

feat(metadata-core)!: a knowledge source is saved only on a deployment that mounts the knowledge service

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered knowledge-source-save-refused-without-knowledge-service -->

**BREAKING** for an author who saves a `knowledge_source` on a deployment that registers no knowledge service: the save was accepted before and is refused now. Nothing there loads, indexes or searches the source, and the service is mounted when the server starts, never while it runs, so the accepted item was kept and never served; only a boot log line said so, which a Studio, REST or MCP author does not see.

- **`@objectstack/metadata-core`.** `authoredKnowledgeSourceRefusal` answers a refusal, `503 SERVICE_UNAVAILABLE`, when no knowledge service is registered and the writer is not the engine. The message names the item, the reason and the fix: add `requires: ['knowledge']` to the stack (or, on a host that composes its own kernel, `KnowledgeServicePlugin` and a knowledge store), restart, then save the source. Every door that asks it refuses the save with that answer and writes nothing: `PUT /meta/:type/:name` on both transports, the MCP `save_metadata_draft` tool, and a package duplicate that would copy a source.
- **`@objectstack/objectql`.** The boot line for `knowledge_source` items held with no knowledge service names the same fix: `requires: ['knowledge']` and a restart (or `KnowledgeServicePlugin` and a knowledge store on a host that composes its own kernel), where it named the plugin and an adapter.
- **`@objectstack/spec`.** The upgrade guide carries the `knowledge-source-save-refused-without-knowledge-service` entry.
- **`@objectstack/skills`.** The `objectstack-ai` skill's Knowledge Sources section says that on an app that ships no source, a run-time save is refused (`503 SERVICE_UNAVAILABLE`, nothing written) until the stack declares `requires: ['knowledge']` and the server restarts. It used to say such items are never indexed. The eval case for an app that authors its sources at run time expects the same.

Unchanged: the engine's own writes (a package install, a seed, a migration) are not refused; a registered knowledge service that is not the platform's (one with no `admitAuthoredSource`) answers for its own sources and the save goes on; stored items are not rewritten or refused at boot.

## FROM → TO

- A deployment whose stack does not declare `requires: ['knowledge']`, where authors save knowledge sources → add `requires: ['knowledge']` to the stack, restart, then save the source.
