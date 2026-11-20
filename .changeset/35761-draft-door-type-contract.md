---
'@objectstack/runtime': patch
'@objectstack/skills': patch
---

Clause-②: yes — widening: one new read on the draft door behind the same `metadata:write` grant and `manage_metadata` check; no save, publish or existing read changes, so nothing accepted today is refused.
Metadata-protocol: none

feat(runtime): the MCP draft door answers a metadata type's contract

- **`list_metadata_items` takes an optional `contract: true`.** The reply then also carries `contract`: the type's JSON Schema and its `createSeed`, read from the same entry `GET /meta/types` serves. A client that cannot read files can now see which keys a type accepts and which it requires before its first save, also for a type that has no item in the environment yet. A type with no JSON Schema answers `schema: null` with the reason. The read is admitted as the list is: the `metadata:write` scope and the user's own `manage_metadata`, the type-level read admission, and the unknown-type refusal. Without the flag the reply is unchanged.
- **`objectstack-mcp-build` skill, step 3** names that read where it said to copy a published item of the same type. The save is still the final check.
