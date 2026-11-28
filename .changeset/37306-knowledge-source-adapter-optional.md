---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/service-knowledge': minor
'@objectstack/cli': minor
'@objectstack/verify': minor
'@objectstack/runtime': patch
---

feat(knowledge): a knowledge source needs no `adapter` and no `requires: ['knowledge']` — it binds to the deployment's store, and shipping one mounts the service

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up #37310 — `skills/**` teaches the optional `adapter` and the item mount after this lands

A `knowledge_source` may leave out `adapter` (ADR-0161 K4), and a stack that ships one in `knowledgeSources` is served the knowledge service and one vector store without listing `knowledge` under `requires` (ADR-0161 K8, item 12). One source written as metadata now builds on SQLite under `os dev` (the `turso` store, a libSQL file), on PostgreSQL (`pgvector`) and on a host that mounts its own store, with no change to the source.

- **`@objectstack/spec`.** `KnowledgeSourceSchema.adapter` is optional. Omitted, the source is held by the deployment's adapter: the store the runtime mounted beside the knowledge service, else the only adapter registered. A named adapter is kept as written. `PlatformCapabilityProvider` gains an optional `mountedBy: { collection }`, set on the `knowledge` row of `PLATFORM_CAPABILITY_PROVIDERS` (`knowledgeSources`): a stack holding an item of that collection is served the capability as its token serves it.
- **`@objectstack/core`.** `stackItemCapabilities(stack)` answers the tokens a stack's items mount (top level, then each package body), and `resolveServedCapabilities` takes them as `itemTokens`: appended after the declared tokens, read as declared (a provider that cannot be built fails the boot as for `requires`), and reported in a new `byItems` set. `resolveCapabilityArgument('knowledge', …)` now answers `{ deploymentAdapter }`, the adapter id of the store `resolveCapabilityExtras` mounts for the same database.
- **`@objectstack/cli` and `@objectstack/verify`.** `os serve` / `os dev` / `os start` and `bootStack` read the item tokens, and hand the knowledge service the deployment's store (`pgvector` on PostgreSQL, `turso` otherwise). `os migrate plan` / `apply` read them too, so an item-only stack's migrate run composes the knowledge service as `os serve` mounts it (init only: no store, build or embedder call).
- **`@objectstack/service-knowledge`.** `KnowledgeServicePlugin` and `KnowledgeService` take a `deploymentAdapter` option: the runtime's mark of the store it mounted. It is a service option, not an adapter-contract member, and `registerAdapter` is unchanged: an adapter application code registers is never the deployment's by registering. A source that names no adapter is placed where it is used (`adapterIdFor`, `adapterFor`), so one registered in code before its store started finds it. With several adapters registered and none the deployment's, such a source is refused at registration (both doors) and at its save, `400 VALIDATION_ERROR`, naming the adapters; registered first and left unplaceable by adapters that came later, it answers the same refusal at index and search, and the boot names it once at `error`. With no adapter registered it answers `503 SERVICE_UNAVAILABLE`, naming the deployment's store when one was marked. The `index_status` action reports the adapter a source is placed on.
- **`@objectstack/runtime`.** The MCP draft door (`save_metadata_draft`) carries the knowledge service's refusal code through: a source refused `400 VALIDATION_ERROR` arrived over MCP as `SERVICE_UNAVAILABLE` with status 400, and now arrives as `VALIDATION_ERROR`, as on the REST door. A `403` is still `PERMISSION_DENIED`.

Unchanged: a source that names an adapter that is not mounted answers `SERVICE_UNAVAILABLE` as before; a host that mounts `KnowledgeServicePlugin` itself keeps its own, gets no store from the runtime and no deployment's mark; without a source or the token nothing is mounted; an item saved at run time on a deployment that mounted no knowledge service is reported at boot exactly as before.

What to do: nothing to change, with one behaviour to know. A stack on 19.0.0-next.1 that ships a source without `requires: ['knowledge']` held it inert, with a boot warning; it is now indexed: the service mounts, the boot pass builds the source's index, and its content fields are sent to the configured embedder (ADR-0161 K5: embedding is egress). A source that names `adapter: 'turso'` or `adapter: 'pgvector'` keeps working; drop the key to let the deployment choose, and drop `knowledge` from `requires` in an app that ships its sources.
