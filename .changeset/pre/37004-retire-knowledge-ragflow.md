---
'@objectstack/service-settings': patch
'@objectstack/service-knowledge': patch
'@objectstack/embedder-openai': patch
'@objectstack/spec': patch
'@objectstack/skills': patch
---

fix(settings)!: `@objectstack/knowledge-ragflow` is retired, and the Knowledge settings page no longer offers the RAGFlow adapter

Clause-②: no (narrowing) — narrowed: `PUT /api/settings/knowledge` refuses `adapter: 'ragflow'` (`400 SETTINGS_VALIDATION`, field code `invalid_option`) and refuses `ragflow_base_url`, `ragflow_api_key` and `ragflow_default_dataset` (`400 UNKNOWN_KEY`), where it stored all four; `POST /api/settings/knowledge/test` answers `adapter = ragflow` as an unknown adapter (`400 SETTINGS_ACTION_FAILED`), where it answered a form check
Metadata-protocol: none
Skills-docs: updated here — `skills/objectstack-ai/SKILL.md` and its eval case 3 teach the `pgvector` adapter where they taught `ragflow`; `content/docs/protocol/knowledge.mdx`, `content/docs/ai/knowledge-rag.mdx` and `content/docs/ai/index.mdx` name the adapters this repository builds.

<!-- adr-0087: not-required (runtime-export-retired @objectstack/knowledge-ragflow#*) the package is deleted whole: what it published (`KnowledgeRagflowPlugin`, `KnowledgeRagflowAdapter` and their option types) is runtime code a host registers; no `packages/spec` schema, metadata type or stored shape names it, and `KnowledgeSource.adapter` stays a free string, so there is nothing for `objectstack migrate meta` to rewrite. The settings half has the same answer: a settings manifest is a runtime registration, not authorable metadata; the narrowed answers are doors of one settings namespace, and stored rows are untouched. -->

**BREAKING** for a deployment that saved the RAGFlow adapter on the Knowledge settings page, or that registers `KnowledgeRagflowPlugin`.

The package `@objectstack/knowledge-ragflow` is removed from this repository and gets no further release. Its requests did not match the RAGFlow HTTP API (it wrote and filtered on chunk metadata the API neither stores nor returns), so a knowledge source bound to it never retrieved anything, and nothing reported that. It is retired rather than repaired; the last published version stays on npm and will be marked deprecated.

On the Knowledge settings page (`knowledge` namespace, manifest `version` 3):

- The **Adapter** select offers `memory` and `turso`. The `ragflow` option, the RAGFlow group and its three keys (`ragflow_base_url`, `ragflow_api_key`, `ragflow_default_dataset`) are gone, with their strings in all eleven bundled locales.
- A stored `adapter = ragflow` is still served as stored, since the settings service never rewrites a stored value. The Console shows the Adapter select with nothing selected. Saving other keys works; saving `ragflow` again is refused; "Test connection" answers "Unknown adapter: ragflow". No code ever read this setting, so nothing else changes behaviour.
- Stored rows for the three removed keys are kept, never deleted. The page no longer serves them, and no settings door clears them, the encrypted `ragflow_api_key` included.

What leaves, and what to write instead:

- FROM `@objectstack/knowledge-ragflow` TO an adapter package this repository builds: `@objectstack/knowledge-pgvector` (`adapter: 'pgvector'`, PostgreSQL with pgvector), `@objectstack/knowledge-turso` (`adapter: 'turso'`, a libSQL file) or `@objectstack/knowledge-memory` (`adapter: 'memory'`, development and tests). Fix: stop registering `KnowledgeRagflowPlugin`, remove the dependency, and bind your sources to one of those; to keep an external engine, register your own `IKnowledgeAdapter` under an id of your choice.

On a deployment that used it, also:

- A knowledge source that still names `adapter: 'ragflow'` with no such adapter registered boots without an error: searches over it answer no hits and log `references unknown adapter`, and indexing it throws `unknown adapter 'ragflow'`. Change the source's `adapter`.
- Pick an adapter on the Knowledge settings page and save, which replaces the stored `ragflow` value.
- To remove the stored API key, delete the `knowledge` rows named `ragflow_base_url`, `ragflow_api_key` and `ragflow_default_dataset` from `sys_platform_setting`, and the `sys_secret` row whose `id` the `ragflow_api_key` row holds in `value_enc` (a `sec_` handle). Until then the `sys_secret` orphan report may list it. An earlier note in this release says mounting the knowledge service and clearing the key from Setup removes it; for `ragflow_api_key` that no longer applies, because the page no longer declares the key.

Also in this change, text only: `@objectstack/spec` comments on `KnowledgeSource.adapter`, `KnowledgeSource.embedding`, `IKnowledgeAdapter` and `IKnowledgeService` name adapters that exist; the `@objectstack/service-knowledge` README and package description, and the `@objectstack/embedder-openai` README, name the adapters this repository builds (the embedder README now says which of them take an `embedder`).

In `@objectstack/skills`, `skills/objectstack-ai/SKILL.md` (*Knowledge Sources (RAG)*, rewritten in place, 487 lines and 6798 tokens before and after):

- The wiring paragraph names `@objectstack/knowledge-memory` (`'memory'`, dev/test), `@objectstack/knowledge-pgvector` (`'pgvector'`) and `@objectstack/knowledge-turso` (`'turso'`), where it named the retired package and `'ragflow'`.
- The example source uses `'pgvector'`. An agent following the old example wrote a source bound to an adapter that never retrieved anything. The `adapter` row no longer repeats example ids, and the `embedding` row no longer names engines no adapter here serves.
- The splitting paragraph says which adapters take the service's passages (`memory`, `pgvector`, `turso`); any other adapter receives whole documents.
- `evals/skills-tools-knowledge.json`, case 3: the prompt says the deployment runs PostgreSQL with pgvector, and the expected answer writes `adapter: 'pgvector'` and no `split` key, because the default `recursive` split fits article prose. The case keeps what it exercised (an object source with `where`, `metadataFields` and `refresh`, registered through `KnowledgeServicePlugin`); the in-memory adapter is already case 9.
