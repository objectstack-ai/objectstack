---
"@objectstack/spec": minor
"@objectstack/driver-sql": minor
---

fix(spec): lower equality triples with a `$field` comparand to `{ $eq: ref }` (#7597)

`parseFilterAST` lowered one authored intent two different ways depending only on
how the operator was spelled:

| authored | lowered to | what it did |
| :--- | :--- | :--- |
| `['amount', '>', { $field: 'budget' }]` | `{ amount: { $gt: { $field: 'budget' } } }` | worked on both evaluation paths |
| `['amount', '=', { $field: 'budget' }]` | `{ amount: { $field: 'budget' } }` | matched **nothing**, silently |

The four equality spellings (`=`, `==`, `equals`, `eq`) dropped the operator,
because a LITERAL comparand's implicit-equality form is `{ field: value }` —
correct for a literal, and for a field reference it produces a field spec whose
only key is `$field`. Every consumer reads an all-`$` key set as an OPERATOR
SPEC, and nothing implements an operator named `$field`: the in-memory evaluator
(`@objectstack/formula`) dispatches it to its operator switch, finds no arm, and
returns the fail-closed `false` — so the filter matched no record on the very
path that produced it, with no error anywhere. On SQL push-down the same shape
arrived as an unknown operator and was refused.

An equality triple whose comparand is a `FieldReferenceSchema` now lowers to the
explicit `{ field: { $eq: ref } }` — the spelling both evaluation paths already
implement (the memory evaluator resolves the reference; `driver-sql` compiles it
to a column-to-column comparison, #5222). `['amount', '=', ref]` and
`['amount', '>', ref]` are now the same kind of thing.

Unchanged, deliberately:

- **Literal comparands.** `['amount', '=', 5]` still lowers to `{ amount: 5 }`.
  The fix branches on the comparand being a field reference, never on the
  operator, and a `$field` carrying a non-string is not a field reference on any
  path — it keeps the literal lowering too.
- **The in-memory evaluator's unknown-operator posture.** #6520 examined it and
  kept it; a hand-authored bare `{ amount: { $field: 'budget' } }`
  `FilterCondition` keeps exactly its current fate on every backend — fail-closed
  `false` in memory, and `driver-sql`'s actionable refusal naming `$eq` (#5222).
  Only what the ARRAY sugar produces has changed.

`@objectstack/driver-sql` gains `CROSS_FIELD_AUTHORED_CASES` — the conformance
corpus's new AUTHORING arm, entering through the lowering sink instead of at the
already-lowered object, run by both SQL drivers' cross-field suites. Its only
other change is documentation.
