---
'@objectstack/mcp': patch
---

feat(mcp): `aggregate_records` names the record of a lookup group beside its id, read as the caller

Clause-②: yes (widening)
Metadata-protocol: none

When the MCP `aggregate_records` tool groups by a `lookup` or `master_detail` field, each group now carries a new member `<key>__label` beside the key: the name of the referenced record, from the referenced object's name field (`nameField`, as ADR-0079 resolves it). `<key>` is the group column, which is the key's alias when the call gives one. The same spelling is used by the hosted ask tools, so one prompt reads both. This holds on both the HTTP and the stdio door.

The name is read as the caller, through the same bridge and context as the aggregate, in one batched read of the referenced object for the groups the tool serves. Nothing is read with other rights, so the caller's object, field and record permissions apply as they do for any read the caller makes.

- A label is present only for a key whose record the caller's read returns with a non-blank name. Any other key carries no label, and nothing else in the answer changes.
- No label is added, and the answer is exactly as before, when the caller is not served the referenced object, its name field or the lookup field, when the referenced object is a system object the tool does not read, or when the read fails. A failed name read never fails the aggregate.

The tool description now tells a model to name such a group by its `__label`, never by the id, and to say the record cannot be named where no label is present. Existing members (`rows`, `totalGroups`, `truncated`, `currencies`) are unchanged.
