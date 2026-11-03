---
'@objectstack/runtime': patch
---

fix(runtime): a start input a flow's definition reads as a record id is loaded in the caller's own scope from the object the flow reads it from, and must be an id, before the run exists (#29050)

Clause-②: no
Metadata-protocol: none

**The rule.** Where a flow's own definition reads a start input as the id of a record of a fixed object, every door that starts the flow by name loads that input in the caller's own scope from THAT object before the run exists, and refuses a value the caller cannot read there with the action door's own `404 RECORD_NOT_FOUND` (ADR-0112 envelope). A record the caller cannot read and an id that names nothing get the same answer. The input must name one record by its id (a string or a number), or a list of records by their ids where the definition reads it as a list; any other value is refused `400 VALIDATION_FAILED` naming the input. Nothing runs on a refusal: no run record, no node, no side effect. This holds whatever object the start names, or none, and whatever the flow runs as.

**Where a definition reads an input as a record id.** Across every region of the flow (loop bodies, parallel branches, try and catch regions):

- a `get_record`, `update_record` or `delete_record` node with a literal `objectName` whose `filter.id` or `filter.id.$eq` is the input (one id), or whose `filter.id.$in` is (a list of ids);
- a `screen` node with a literal `objectName` whose `recordId` is the input;
- a `subflow` node with a literal `flowName` that hands the input to a callee input the callee reads so, and a `map` node that does the same with the input itself or with each item of it (a `map` iterating the input reads it as a list of ids).

"Is the input" means a CEL value whose whole source is the input's name (`caseId` or `vars.caseId`).

**Which doors.** `POST /api/v1/automation/:name/trigger` and the legacy `POST /api/v1/automation/trigger/:name`; a declared endpoint of `type: 'flow'`; and an action of `type: 'flow'` (the REST action route and the MCP `run_action` tool), for each key of the caller's own `params` and for the routed record id under the row slots, so the routed record is judged against the object the flow reads as well as the action's own object.

**The REST action route's routed record is one id.** A body `recordId` that is not one id (a string or a number) is refused `400 VALIDATION_FAILED` naming `recordId`, before the declared param contract, the record load and dispatch, for every action type. A path segment is always one id; an absent, `null` or empty `recordId` is the record-less call, as before.

**What stays as it was.**

- A start whose caller can read the record in the object the flow reads it from.
- An input the definition does not read as a record id, including a value the flow computes from an input or derives elsewhere.
- A name a `loop` or `map` node binds as its item or index variable, which no longer holds the start's value once that node runs.
- The system principal (an in-process caller, such as a job).
- At the action door, the subject record's own fields, and the row slots of an action whose `recordIdField` names a field other than `id`.

**If a start now answers 404 or 400.** Hand the input the id of a record the caller can read in the object the flow reads it from, in the shape the flow reads (one id, or a list of ids).
