---
'@objectstack/runtime': patch
---

fix(runtime): a declarative update action refuses a caller with no edit grant `403 PERMISSION_DENIED`, as the data door does, whether or not the record exists or is visible to them

Clause-②: no — no request that succeeded is refused and no shape changes: one refusal's code moves from `404 RECORD_NOT_FOUND` to the data door's `403 PERMISSION_DENIED`, for a caller who may not update the object
Metadata-protocol: none

An `operation: 'update'` action (REST `POST /actions/:object/:action/:id`, MCP `run_action`) now judges the caller's update permission on the object before it answers on the record lookup, the order the data door already keeps ("Refusals come before the record lookup"). A caller who may read the object but holds no edit grant on it, writing a record their access hides or an id that names no record, was answered `404 RECORD_NOT_FOUND` by the action and `403 PERMISSION_DENIED` by `PATCH /data` and MCP `update_record` for the same write. Both doors now answer `403 PERMISSION_DENIED`, with the data door's sentence.

A caller who may update the object keeps `404 RECORD_NOT_FOUND`, one answer for a hidden record and a missing id, so neither door tells a caller whether a record it cannot see exists. A record the caller can read but not edit was already answered `403` by both doors and is unchanged.
