---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/platform-objects': patch
---

feat(spec): a flow start input can declare that it is the id of a record of a named object (`objectName`)

Clause-②: yes (widening)
Metadata-protocol: added

`FlowVariableSchema` declares one optional key, `objectName`: on an input (`isInput: true`), it says the input's value is the id of one record of the named object, e.g. `{ name: 'accountId', type: 'text', isInput: true, objectName: 'crm_account' }`. The key is **planned**: no door reads it yet, and `os validate` warns on every flow that writes it (`liveness-planned-property`). The contract it states, for the start doors to enforce: every door that starts the flow by name (the trigger route, an action of type flow over REST and MCP `run_action`, a declared endpoint of type flow) loads a declared input from that object in the caller's own scope before the run exists; an id the caller cannot read there is refused `404 RECORD_NOT_FOUND`, and a value that is not an id is refused `400 VALIDATION_FAILED` naming the input. An input without the declaration keeps the visible-read rule: it is judged as a record only where the flow's own definition reads it as a record id.

- **Spec.** `objectName` is an object name (snake_case) and is refused on a variable that is not an input, since no caller's value reaches one. `type` stays the data type: the variable holds the id. A `reference` or `object` key on a flow variable is still refused, and the refusal now names `objectName`. The flow form's variables repeater gains the column, labelled in the metadata-form bundles (en, zh-CN, ja-JP, es-ES).
- **Lint.** `flow-input-unknown-object`: a declared object the stack does not define is a warning (it may come from another installed package), and an error at the runtime publish gate when the write's package closure does not reach it, the verdict `flow-trigger-unknown-object` gives a trigger object. A `sys_` name is not judged.

This is the contract half: the start doors read the declaration in a later change, and until then no door loads a declared input, so a start that hands the input an id the caller cannot read still runs. Nothing to do for existing flows.
