---
'@objectstack/skills': patch
'@objectstack/spec': patch
---

docs(skills): `objectstack-ai` teaches `knowledge_source` as a metadata item; the type gets a create seed

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ai` § Knowledge Sources (RAG) now teaches the shape the 19 spec accepts. A source is a `knowledge_source` item shipped in a package (`knowledgeSources`, `*.knowledge-source.ts` / `.yml`) or authored in Studio or over MCP, with registration in code as a second door for the same schema. The key table lists `name`, `label`, `description`, the optional `adapter` (omitted, the source binds to the deployment's store), `source.object`, `source.content` (an explicit, non-empty list: `'*'` is refused because embedding is egress), `source.metadataFields`, `source.where`, `source.split`, `refresh.onRecordChange` and `aiExposed`. An item mounts the knowledge service with no `requires: ['knowledge']`. The section says that a source's first build sends every listed field of every matching record to the embedding provider, and that a run-time save needs `manage_knowledge_sources` and passes save-time admission. It names each key retired in 19 with its fix: `id` → `name`, `contentFields` → `content`, `embedding`, `vectorStore`, `adapterConfig`, `refresh.cron`, and the `file` and `http` arms. `split.strategy` is required once `split` is written. The eval cases for knowledge sources move to the same shape, and a new case asks for a wildcard source.

`@objectstack/spec`: `getMetadataCreateSeed('knowledge_source')` now answers a seed, which `GET /meta/types` and the MCP `list_metadata_items` contract serve as `createSeed`. It is `{ name: 'new_knowledge_source', label: 'New Knowledge Source', source: { kind: 'object', object: 'example_object', content: ['example_field'] } }`, with no `adapter`. The object and the field are placeholders for the author to replace, as `example_object` is on the other seeds.
