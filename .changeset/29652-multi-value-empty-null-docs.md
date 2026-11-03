---
'@objectstack/spec': minor
---

docs(spec): a cleared optional multi-value field is stored as `null`, the same as one never set; `FieldSchema`'s `multiple` and `required` docs now say so

Clause-②: yes
Metadata-protocol: semantic

`FieldSchema.multiple` documented that an emptied multi-value lookup reads back as `[]`, never `null`, for every writer, and `required` leaned on that. The rule is now the other way round for optional columns.

- **Now.** A cleared optional multi-value field (`multiselect`, `checkboxes`, `tags`, and `select`, `lookup`, `user`, `file` or `image` with `multiple: true`) is stored as `null` at the engine's write door, the same as a field never set, whether or not a unique constraint covers it. `[]` and `''` written to such a column store `null`. The rule binds every writer: cascade repair, form clears and API writes.
- **Reading.** Treat `null` and `[]` alike as empty. The `is_empty` filter (`$empty`) already does, and its table is unchanged. A row stored before this rule can still hold `[]`.
- **Unchanged.** `required` on a multi-value field still means a non-empty list: `[]` is refused, as is `null`.
- **This change is documentation.** The `multiple` and `required` descriptions (and the generated field reference) state the rule. The write-door change that applies it to `[]` and `''` ships separately, and stored `[]` values are cleaned by a separate `os migrate` data step.
