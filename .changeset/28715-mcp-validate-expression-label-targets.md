---
"@objectstack/mcp": patch
"@objectstack/runtime": patch
---

fix(mcp): `validate_expression` refuses the `label()` call the object save door refuses

The object save door refuses a formula whose `label(record.FIELD)` names a field that declares no options (422 `expression-invalid`, code `label-field-no-options`). The MCP `validate_expression` tool judges with the same validator, but the object schema it read carried field names and types only, so it answered `ok: true` for that formula and the agent learned of the refusal at save.

Clause-②: yes (widening) — the published `McpDataBridge` interface gains one optional member, `optionFieldsOf(name)`. A bridge that omits it behaves exactly as before. No tool's input or output shape changes: `describe_object` serves the same projection, and `validate_expression`'s new verdict is an `errors[]` entry with an existing code.

Metadata-protocol: none (nothing a metadata author can write is added, refused or changed in meaning; the door already refused this formula)

- **Now.** On the `formula` site, `validate_expression` hands the validator the object's option-bearing fields (`ExprSchemaHint.optionFields`), so `label(record.first)` on a text field answers `ok: false` with one `label-field-no-options` error naming `first`, in the sentence the door carries.
- **Unchanged.** `label()` on a field with inline `options`, or bound to a shared `picklist`, reads ok. An unknown field keeps its `unknown-field` refusal and gets no second one. The `validation`, `flow_condition` and `template` sites answer as before: the door judges `label()` targets on a formula field's `expression` only.
- **How.** Both bridges (the stdio bridge and the runtime's HTTP bridge) answer `optionFieldsOf` from the object `describeObject` reads, the protocol's served object, through `@objectstack/formula`'s `declaresOptions`: on the served object a picklist-bound field already carries its list's resolved `options`.
