---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): `sys_approval_request.record_id` declares that the record it names was deleted when `cancel_reason` is `record_deleted`

Clause-②: no

- **The pointer carries its own tombstone predicate.** `record_id` declares `referenceDeletedWhen: { field: 'cancel_reason', value: 'record_deleted' }` beside its `referenceVia: 'object_name'`. A request the platform cancelled because its record was deleted (`status: cancelled`, `cancel_reason: record_deleted`) therefore says, in the served object definition, that the pointer names a record that no longer exists. A renderer draws that option's label (`Related record deleted`) in place of a link, and reads nothing.
- **Nothing is accepted or answered differently.** The sibling is the existing `cancel_reason` select, which already holds `record_deleted`, so the spec's parse-time refusals of the key are satisfied by the shipped object. No export, type, route, stored value or request answer moves.

A patch: one key on one platform object's served field definition.
