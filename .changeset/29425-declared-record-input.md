---
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

fix(runtime): a flow start input declared a record id (`objectName`) is loaded in the caller's own scope from the declared object at every door that starts the flow by name, before the run exists

Clause-②: yes (narrowing) — a start that ran before is now refused when it hands a declared record-id input an id the caller cannot read in the declared object, an id that names no record there, or a value that is not one id. No flow shipped in this repository declares the key, and an input without the declaration answers exactly as before.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: `objectName` on a flow variable already parses, and what moves is the answer a start door gives to a caller who hands such an input a value it cannot read. Nothing at rest records that answer, so there is nothing for a migration to rewrite. -->

**The rule.** A flow start input may declare that its value is the id of a record of a named object, with `objectName` on the variable (`{ name: 'accountId', type: 'text', isInput: true, objectName: 'crm_account' }`). Every door that starts the flow by name now loads such an input from the declared object in the caller's own scope before the run exists, whether or not the flow's definition reads the input in plain sight. A record the caller cannot read there and an id that names no record get the same answer, `404 RECORD_NOT_FOUND` (the action door's own refusal), and no run is created. A value that is not one id (a string or a number) is refused `400` naming the input: `VALIDATION_FAILED` from the start check, or, at an action whose param declares a type, `VALIDATION_ERROR` from that param's own contract, which answers first. The system principal is not judged.

**Which doors.** `POST /api/v1/automation/:name/trigger` and the legacy `POST /api/v1/automation/trigger/:name`; a declared endpoint of `type: 'flow'`; an action of `type: 'flow'` over the REST action route and the MCP `run_action` tool. All of them ask the one check they already shared for inputs a definition reads in plain sight.

**Beside the definition's own reads, never in place of them.** An input declared a record id of one object and also read by the definition as an id of another (a `get_record` node's `filter.id`, say) is loaded from both, so the caller must be able to read both rows. A parent flow that hands its input on, unchanged, to a `subflow` or `map` callee whose input carries the declaration is judged by that declaration too. A `loop` or `map` that later rebinds the name does not withdraw the declaration: it is the author's word about the value the caller sent.

**What stays as it was.** An input without the declaration keeps the visible-read rule: it is judged only where the definition reads it as a record id. A start whose caller can read the declared record starts as before.

**If a start now answers 404 or 400.** Hand the declared input the id of a record the caller can read in the object the input names, or start the flow as the system principal.

`@objectstack/spec`: the `objectName` describe on a flow variable no longer says that no door applies it, and its liveness row is `live`, so `os validate` no longer warns `liveness-planned-property` on a flow that declares it.
