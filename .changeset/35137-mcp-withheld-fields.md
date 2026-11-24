---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
---

feat(mcp, runtime): `query_records` and `get_record` name the fields field-level security withheld from the caller

Clause-②: yes (widening)
Metadata-protocol: none

A row served over MCP leaves out every field the caller may not read, and nothing in it said so, so an AI client read a withheld field as blank. `query_records` and `get_record` now add two members to their result when a field was withheld, on the HTTP and the stdio server alike:

- `withheldFields`: the names of the withheld fields, field names only, never values. With `fields` in the call, only the asked fields are named; without it, any field of the object.
- `withheldFieldsNote`: one sentence saying these fields exist and are not visible to the caller, and that they must not be described as empty.

A field is named only when the caller's own served schema shows it (the object as `describe_object` serves it to them) and the security service does not answer it readable for them. Both are asked as the caller; nothing is derived from the rows. A field the caller's schema does not show is never named. Under the default object-schema masking, a field a caller may not read is usually left out of their schema too, so `withheldFields` appears for a caller who is served the whole schema (a caller holding `manage_metadata`, `studio.access` or `setup.access`) or where schema masking is switched off.

A caller with nothing withheld, a deployment with no security service, and a server whose bridge does not provide the new optional `McpDataBridge.fieldVisibilityOf` member get the result they got before, byte for byte. The two tool descriptions gain one sentence about the member.

`aggregate_records` is unchanged: a withheld field asked as a measure or a group is already refused `403 PERMISSION_DENIED`.
