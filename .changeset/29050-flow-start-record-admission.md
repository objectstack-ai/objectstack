---
'@objectstack/runtime': patch
---

fix(runtime): every door that starts a flow by name loads the record it hands the run in the caller's own scope, and refuses a record the caller cannot read before the run exists (#29050)

Clause-②: no
Metadata-protocol: none

**The rule.** A start that names a record hands the run that record as the row it addresses. Every door that starts a flow by name now loads each such record key in the caller's own scope first, the load the action door already makes for its routed record, and refuses a key that scope does not deliver with the action door's own `404 RECORD_NOT_FOUND` (ADR-0112 envelope). A record the caller cannot read and an id that names nothing get the same answer. Nothing runs: no run record, no node, no side effect.

**Which doors.** `POST /api/v1/automation/:name/trigger` and the legacy `POST /api/v1/automation/trigger/:name`; a declared endpoint of `type: 'flow'`; and an action of `type: 'flow'` (the REST action route and the MCP `run_action` tool), where a record key the caller's own `params` supply is now judged as the routed record already was.

**Which keys.** The row slots the door itself fills: `recordId`, the `<objectName>Id` alias (`crm_lead` → `crmLeadId`) and an action's declared `recordIdParam`, each with the value the run receives, a caller's own `params` value included. A record key names one record by its id; any other value is refused `400 VALIDATION_FAILED` naming the key.

**The object.** The object the start names: `objectName` (or `object`) in a trigger or endpoint request body, and the action's own object at the action door. A start that names a record key but no object cannot be checked: a flow declared `runAs: 'system'` refuses it `400 VALIDATION_FAILED` naming `objectName`, and a flow that runs as the user starts as before.

**What stays as it was.**

- A start whose caller can read the record.
- A start that names no record.
- The system principal (an in-process caller, such as a job).
- The action door's routed record: its load, its refusal and the record-less and new-record actions are unchanged.
- An action whose `recordIdField` names a field other than `id`: its row slots carry that field's value, not a record id, and are not loaded.

**If a start now answers 404 or 400.** Start it on a record the caller can read, and name the record's object (`objectName`) beside `recordId`.
