---
'@objectstack/spec': minor
'@objectstack/service-knowledge': patch
'@objectstack/knowledge-memory': patch
---

feat(service-knowledge): knowledge documents carry their organization, and a search hands the adapter the caller's organizations so it ranks only their documents

Clause-②: yes
Metadata-protocol: added
Skills-docs: none — no skill under `skills/**` teaches `KnowledgeDocument`, `AdapterSearchOptions` or the adapter contract suite; `skills/objectstack-ai/SKILL.md` teaches `KnowledgeSource` authoring only, which this change does not touch. `content/docs/protocol/knowledge.mdx` gains the members and an "Organization scope" section in this change.

In a deployment with more than one organization, a knowledge search now ranks only the documents of the caller's organizations, so another organization's documents no longer take the top places. Which hits the caller gets back is still decided by re-reading each record as the caller, as before.

New, both optional, in `@objectstack/spec`:

- `KnowledgeDocument.organizationId?`: the organization of the record a document was built from. The knowledge service sets it from the record's `organization_id` under the `group` and `isolated` tenancy postures. It is absent under `single`, for `file` and `http` sources, and for a record with no organization. `indexDocument` refuses a document that already carries one (it throws, naming the field).
- `AdapterSearchOptions.organizationIds?`: the caller's organizations. The knowledge service computes it from the caller's execution context and the deployment's tenancy posture: under `isolated` the active organization, under `group` every organization the caller is a member of. It is absent (no filter) under `single`, for the system identity, for `file` and `http` sources, and for an object outside the tenancy wall. `[]` means the caller has no organization behind a wall and must match nothing; it never means "no filter". An adapter that reads it ranks only the documents whose `organizationId` is in the set and filters before it ranks; a document with no `organizationId` is not ranked.

`docHash` now covers `organizationId` when a document has one. A document without one hashes exactly as before, so nothing changes under `single`.

`KnowledgeService` reads the deployment's effective tenancy posture from the kernel's `tenancy` service (`KnowledgeServicePlugin` wires it; new option `resolveTenancyPosture`). If the posture cannot be read, a search does not search any `object` source for that call and logs an error, and a reindex stops before writing and returns `ok: false` with the reason. `recordToDocument` takes the posture as an optional fifth argument. The `search_knowledge` tool refuses an `organizationIds` argument: the organizations are never taken from the caller.

`@objectstack/knowledge-memory` stores `organizationId` and filters by `organizationIds` before ranking. `runKnowledgeAdapterContract` (from `@objectstack/service-knowledge/testing`) now requires `implements.organizationIds`. It adds organization-filter cases for the adapter alone, and cases run through a real `KnowledgeService` under `isolated`, `group` and `single`.

What to do: under a `group` or `isolated` posture, run a complete reindex of each `object` source (`reindexSource` with no `limit`). Documents indexed before this change carry no organization, and a filtered search does not rank them until that reindex writes them again; their hash changes, so the reindex does not skip them. An adapter package reads `organizationIds` in its search, stores `organizationId` as given, and passes `implements: { listDocuments, organizationIds }` to the contract suite.
