---
'@objectstack/mcp': patch
---

fix(mcp): `create_record` and `update_record` over stdio answer `droppedFields` and no longer echo a dropped value

Clause-②: no
Metadata-protocol: none

On the stdio MCP transport, `create_record` and `update_record` now answer `droppedFields`, as the HTTP transport has: each entry names the object, the fields the engine did not store and the reason. A non-system write of a `readonly: true` column or of a roll-up `summary` field (read-only on create and update whether or not it declares `readonly: true`) reports the field there with reason `readonly`. Before, the stdio answer carried no `droppedFields`, and `update_record` answered the caller's own value for such a field over the stored one, so the answer read as if the write had landed. The `record` in both answers now leaves a dropped key's caller value out: an update answers the stored value, and a create answers what the write stored. A write that drops nothing answers as before, with no `droppedFields` key. No tool input, export or metadata key changes.
