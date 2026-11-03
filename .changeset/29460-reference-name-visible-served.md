---
'@objectstack/objectql': patch
'@objectstack/spec': patch
---

feat(objectql): a `referenceNameVisible` lookup or user field names the record it points at on `$expand` when the reader may not read that record

Clause-②: yes (widening)
Metadata-protocol: none

`FieldSchema.referenceNameVisible` was declared ahead of its runtime. It is now served on the expanded read:

- **What a refused reader gets.** On `$expand` of a `lookup` or `user` field that declares `referenceNameVisible: true`, a target the reader is refused (the target object's read gate, its required permissions or its row scope) answers `{ id, name, readRefused: true }` in place of the bare id it answered before. `id` is the id the record holds; `name` is the target's display name as ADR-0079 resolves it (`nameField`, then `displayNameField`, then the derived title, with the floor `Record #` and the id). `readRefused: true` tells a renderer to show the name as text with no link. A `multiple: true` field is answered per element.
- **Nothing else of the target.** The name is read by the engine from exactly the target's id and its name field. The `$expand` request's projection, nested expand, filter and order are never applied to that read, and the field's `displayField` does not change the column it reads.
- **Field-level rules on the name field still hold.** When the reader's field-level security keeps the name field from it, the field declares a `maskingRule`, or the name is a formula reading through another reference, the name served is the `Record #` floor with the id.
- **Unchanged.** A target the reader can read is expanded exactly as before. An id no record has, a record of another organization, and every field without the key keep the bare id. An unexpanded read still answers the stored id for every reader. The same key covers `sys_user` names through a `user` field or a lookup to `sys_user`.

The key's `.describe()` drops its planned marker and the liveness ledger records it as live.
