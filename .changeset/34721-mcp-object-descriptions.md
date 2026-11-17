---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
---

feat(mcp): `list_objects` and `describe_object` return the description an author wrote on an object and on its fields

Clause-②: yes (widening)
Metadata-protocol: none

An MCP client that picks an object and its fields by reading the object tools now reads the text the author wrote for them. `list_objects` adds `description` to each object, and `describe_object` adds it to the object and to each field. The key is present only where the definition carries a non-blank `description`, so an object or field without one is answered exactly as before. Both transports (HTTP and stdio) answer the same shape, and the two tool descriptions name the new key.

The text is the existing `description` key of the object and field schemas; no metadata key is added. It is read off the object as the caller is served it, so a field the caller cannot read is left out with its description, as it already was, and the caller is served the same authored text the `/meta` object door serves them when the request names no locale. With a request locale `/meta` translates object and field labels and descriptions; the MCP object tools do not localize labels or descriptions, and this change leaves that as it was.

`McpObjectSummary` gains an optional `description` member.
