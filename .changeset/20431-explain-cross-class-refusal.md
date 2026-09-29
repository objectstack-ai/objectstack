---
'@objectstack/plugin-security': patch
---

fix(plugin-security): `security/explain` reports the refusal enforcement gives a row-level policy that compares two fields of no shared comparison class, instead of a record verdict (#20431)

Clause-②: no

A row-level policy can compare two fields that share no comparison class: text against a number, or any field against a file field, a formula field, or a field that holds a list or an object. The platform defines no answer for such a comparison. The SQL driver refuses to compile it, so every find the policy scopes answers `INVALID_FILTER` / 400. A by-id update or delete fails closed at its row-level gate, because that gate's pre-image read is the same refused read.

The explain engine's record attribution judged the same predicate in-process without the object's declared columns. So it compared the two raw values and reported `record.visible` as `true` or `false`, depending on how those values happened to compare. For one ordering of a pair it reported the record visible, where enforcement refuses the read.

The record matcher now receives the object's declared columns, as the RLS write check already does. It refuses the comparison the same way the driver does, and the report records that refusal in the shape explain already uses for a call enforcement cannot complete:

- The `rls` layer's `record.outcome` is `not_evaluated`, with no `matchesRecord`. Its `detail` names `INVALID_FILTER`, the policy, and both fields with their declared types. `rowFilter` still carries the composed predicate.
- `record.visible` is `false`, with `decidedBy: 'rls'`, for read, update and delete. Both orderings of one pair get this one answer.

The response has no new keys, and `not_evaluated` is an existing outcome value.

Unchanged:

- Enforcement admits and refuses exactly what it did before.
- A comparison between two fields of one class keeps its row verdict.
- A schema that cannot be read hands over no columns, so the record matcher judges values only, as before.
- The object-level `allowed` and the object-level `rls` layer verdict.
