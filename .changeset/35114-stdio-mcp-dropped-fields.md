---
'@objectstack/mcp': patch
'@objectstack/lint': patch
---

fix(mcp, lint): `create_record` and `update_record` over stdio answer `droppedFields` and no longer echo a dropped value; a flow write to a roll-up summary field draws a warning

Clause-②: yes
Metadata-protocol: none

On the stdio MCP transport, `create_record` and `update_record` now answer `droppedFields`, as the HTTP transport has: each entry names the object, the fields the engine did not store and the reason. A non-system write of a `readonly: true` column or of a roll-up `summary` field (read-only on create and update whether or not it declares `readonly: true`) reports the field there with reason `readonly`. Before, the stdio answer carried no `droppedFields`, and `update_record` answered the caller's own value for such a field over the stored one, so the answer read as if the write had landed. The `record` in both answers now leaves a dropped key's caller value out: an update answers the stored value, and a create answers what the write stored. A write that drops nothing answers as before, with no `droppedFields` key. No MCP tool input, `@objectstack/mcp` export or metadata key changes.

`os validate`, `os lint` and `os build` now report a new warning, `flow-update-summary-field`, when a flow's `create_record` or `update_record` node that does not run as `runAs: 'system'` writes a roll-up `summary` field that does not declare `readonly: true`. The engine drops that value on create and on update, so the step changes nothing in that column. It is a warning, so no build that passes today fails. Like every warning, it makes `os lint --strict` exit 1; there is no per-rule switch, so a strict run fails until the field is removed from the node. A roll-up that declares `readonly: true` is reported as `flow-update-readonly-field`, an error, as before. `os explain flow-update-summary-field` gives the details. The fix is to remove the field from the node, since the engine recomputes it from the child records.

New export: `FLOW_UPDATE_SUMMARY_FIELD` from `@objectstack/lint`, the rule id constant.
