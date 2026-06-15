---
"@objectstack/service-automation": minor
---

fix(automation): `create_record` outputVariable exposes the created record so `{var.id}` resolves (#1873)

A `create_record` node stored only the created record's **id string** in its
`outputVariable`, so a later node referencing `{var.id}` (or any `{var.<field>}`)
traversed into a string and resolved to empty — the created record was
effectively unreferenceable downstream. `get_record` already stores the record
object (that's why `{rec.field}` works there); `create_record` now matches.

Behavior change: `outputVariable` holds the created **record** (an object with
`id` + fields), not the bare id. Reference the id explicitly as `{var.id}`. A
bare `{var}` that previously yielded the id now yields the record — update such
references to `{var.id}` (the in-repo `app-todo` create-task flow was updated).
When the driver returns a bare id, it's wrapped as `{ id }` so `{var.id}` still works.
