---
'@objectstack/spec': minor
---

feat(spec): a field can say it is not asked for when a record is created (`showOnCreate`)

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up #36455

`FieldSchema` gains `showOnCreate`, an optional boolean. Absent or `true`, the field is asked for when a record is created, as today. `false` says the business does not ask for it at creation: every create surface (the create dialog, the full-page create, an action-opened create) leaves it out, while editing, the record page and lists keep showing it, so the value is filled in after the record exists.

- The one pair refused is `showOnCreate: false` on a `required: true` field, at the field's `showOnCreate` key, at every door that parses a field (`defineStack`, `os validate`, the metadata save): a required field is always asked for when a record is created, so the person creating it sees every value the record must have. The message names both fixes (keep the field on create, or drop `required`). A declared `defaultValue` makes no exception: the field is still asked for, with its default filled in. A `requiredWhen` field is accepted, since its gate is a predicate the parse cannot judge; the write door still refuses a create born inside it.
- No create surface reads the key yet: it is `planned` in the liveness ledger, and the Console's create surfaces read it in the change that follows. Nothing that parses today is refused, and no parsed field's output changes (the key has no default).
