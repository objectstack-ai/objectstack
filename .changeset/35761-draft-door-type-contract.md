---
'@objectstack/runtime': patch
'@objectstack/skills': patch
---

Clause-②: yes — widening: one new read on the draft door behind the same `metadata:write` grant and `manage_metadata` check; no save, publish or existing read changes, so nothing accepted today is refused.
Metadata-protocol: none

feat(runtime): the MCP draft door answers a metadata type's contract

- **`list_metadata_items` takes an optional `contract: true`.** The reply then also carries `contract`, read from the same entry `GET /meta/types` serves for the type. By default it is the lean form of the type's JSON Schema: the `required` keys, and for each top-level key its type, a short enum and a one-line description, where `drill` names the JSON Pointer of any key with nested structure, plus the type's `createSeed`. A client that cannot read files can now see which keys a type accepts and which it requires before its first save, also for a type that has no item in the environment yet. A type with no JSON Schema answers `schema: null` with the reason. The read is admitted as the list is: the `metadata:write` scope and the user's own `manage_metadata`, the type-level read admission, and the unknown-type refusal. Without the flag the reply is unchanged.
- **`contractPath` drills into that schema.** With `contract: true`, a JSON Pointer such as `/properties/fields` answers the full schema at that pointer. `contractPath` without `contract: true` is refused with a validation error, and so is a pointer that does not resolve, with an error that names the pointer and the keys found there.
- **No `contract` takes more than 24 KiB of the reply,** so the largest types (`object`, `view`, `page`) fit an MCP client's tool-result limit. A lean form still over that size drops its descriptions first and says `truncated: true`. A sub-schema over that size is answered in its lean form marked `truncated: true`, so the client can drill again.
- **`objectstack-mcp-build` skill, step 3** names that read where it said to copy a published item of the same type: read the lean contract, drill into the key you write with `contractPath`, and let the save check you. The save is still the final check.
