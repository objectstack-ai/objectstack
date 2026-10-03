---
"@objectstack/verify": patch
---

`os verify` writes each derived sample in the shape the engine stores it: a `select` declared `multiple: true` is written as a list and compared as a set

Clause-②: no

- The CRUD round-trip derivation now asks `@objectstack/spec`'s `isMultiValueField` whether a field is multi-valued, the same predicate the engine stores by. Before, the `select` / `radio` sample was one scalar option code compared `equal` whatever the field declared, so a multi-valued `select` read back as a one-element list and was reported as a fidelity gap the engine does not have. The shipped `examples/app-todo` (`todo_task.tags`) failed `os verify` with exit 1 on exactly that, and now passes.
- A single-valued `select` or `radio` keeps its scalar sample and its `equal` comparison. `multiselect` and `checkboxes` are unchanged.
- A relational field's `multiple` is answered by the same predicate. A `lookup` declared `multiple: true` still receives a list of ids. A `master_detail` or `tree` field carrying `multiple: true` now receives one id, which is how the engine stores those types. The spec already refuses `multiple` on those types at parse, so only an unparsed config could reach this.
- No export, type or accept-set change.
