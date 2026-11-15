---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
---

fix(mcp): `describe_object` no longer lists the hidden `__search` search companion, on either MCP transport

Clause-②: no
Metadata-protocol: none

Where pinyin search is on, the registry serves an object with the hidden `__search` companion column beside its display field. `describe_object` described every served field, so it offered an agent that column (as `readonly` and `system`), while no caller may read, write or name it: a record never echoes it, a `$searchFields` override naming it is refused, and `validate_expression` answers `unknown-field` for a read of it.

`describe_object` now leaves the companion out on both transports: the HTTP bridge in `@objectstack/runtime`, and the stdio bridge and the `objectstack://objects/{name}` resource in `@objectstack/mcp`. Both skip it by the protocol's one constant, `SEARCH_COMPANION_FIELD` from `@objectstack/spec/data`. Every other field is listed as before, the injected system columns such as `organization_id` and `created_at` included.
