---
'@objectstack/skills': patch
---

docs(skills): objectstack-formula names action `visible` / `disabled` as the sparse, client-side exception to the total-record rule, and teaches the `has()` guard that surface needs

Clause-②: no
Metadata-protocol: none

- **Before.** The "`has()` is NOT a null check" section said every predicate reads a `record` that is total over the object's declared fields, so `has(record.<declared_field>)` is always `true` and tells you nothing. An agent following it dropped the `has()` guard from an action's `visible` predicate on a `list_item` location, where the row can lack the key: the predicate faults `No such key` and the button silently vanishes. The Surfaces table listed only `Action.disabled`.
- **Now.** The total-record statement is scoped to the server-evaluated surfaces (validation rules, `requiredWhen`, option `visibleWhen`, `readonlyWhen`, hook `condition`, the flow trigger record), where `!= null` is the whole guard. A new paragraph says action `visible` / `disabled` bind the row the client already holds, which lacks a key when the column is outside the view's projection, refused by field-level security, or never written (the mongo and memory drivers), and teaches the guard: `has(record.x) && record.x != null`; `has()` alone beside a literal `==` / `!=`; one `has()` per segment of a nested path. The Surfaces table lists `visible` beside `disabled`, marked client-side and sparse.
- `SKILL.md` stays under its token ceiling (no ceiling moves). No schema, key, command or behaviour changes.
