---
"@objectstack/spec": minor
---

feat(spec): a view filter rule's `value` must have the shape its OPERATOR can execute (#6227)

<!-- adr-0087: registered view-filter-rule-value-shaped-by-operator -->

`ViewFilterRuleSchema.value` was declared
`string | number | boolean | null | (string | number)[]` with **no coupling to
`operator`**, so every operator accepted every shape. A set operator carrying a
scalar — `{ field: 'stage', operator: 'not_in', value: 'won' }` — was a
spec-valid view filter rule. It published cleanly, and then failed when someone
opened the view.

That made the failure two-stage. #5869 / PR #6209 had already closed the runtime
half: `assertListComparandShapes` refuses the lowered `{ stage: { $nin: 'won' } }`
with a named `400 INVALID_FILTER` (a `500 DATABASE_ERROR` before it). Correct
refusal, wrong moment — by then the author is long gone, and the view had been
sitting in the store looking valid. The authoring surface now refuses the same
shapes at publish time, so the feedback reaches the person who can act on it.

**The tightening mirrors the runtime gate exactly — three constraints, one for
one, and deliberately nothing more:**

| operator | `value` must be | why |
|---|---|---|
| `in` / `not_in` (and the `nin` / `notIn` / `notin` spellings) | an array, any length | lowers to `$in` / `$nin` |
| `between` | exactly `[min, max]` | lowers to `$between` |
| everything else | unchanged | the query path does not judge them |

It goes no further on purpose. #5685 already ruled on the opposite error — a
schema stricter than the runtime "in ways the runtime deliberately allows" was
found to be the wrong side and was widened to match — so these all still parse:

- `in: []` — an empty list is a declared predicate ("matches nothing" /
  "matches everything"), and both drivers say so.
- `equals: ['a', 'b']` — lowers to a deep-equality comparand every backend answers.
- `contains: 5` — no backend refuses it.
- `is_empty: ''` — the null predicates take their direction from the operator
  **name**; `convertComparison` ignores the value position, and the ObjectUI
  client deliberately sends a truthy placeholder there.

The refusal names the operator, the field, the shape received and the shape to
write:

```
Operator "not_in" on field "stage" requires an ARRAY of values. Received a
string ("won"). "not_in" tests membership of a list — write ["won"] for a single
value, or use "not_equals" to compare against it. An empty list [] is allowed and
is a real predicate. This is refused at authoring time because the query path
refuses it too (400 INVALID_FILTER, #5869).
```

**Migration.** A filter rule whose operator is `in`, `not_in` or `between` and
whose `value` is not an array of the right arity now fails to parse; `os validate`
and `os lint` report each one by path. Wrap a single value in a list
(`value: 'won'` → `value: ['won']`) or complete the range's second bound.

Two checks are worth doing where they look unnecessary. A rule reading
`operator: 'in', value: ''` is an **unfinished** row, not a filter — decide what
it was meant to select rather than mechanically rewriting it to `[""]`, which is
a real and different predicate. And a view that already carried one of these
shapes **was never returning filtered rows**: it answered `400 INVALID_FILTER` on
render, so re-check what the view is supposed to show rather than assuming the
old result set was correct.

**Metadata at rest is not rewritten, and there is no D2 conversion.** The read
path does not re-validate stored rows, so no stored view becomes unreadable; what
changes is that re-saving one is refused at the write gate, naming `value`. A
conversion was considered and rejected: this shape was never written by any
first-party producer (measured — every `in` / `not_in` rule across this repo,
`objectui` and `cloud` already carries an array) and has never executed, so
coercing it at load would be the platform guessing intent rather than replaying a
rename — and it cannot guess honestly, since `between: 5` has no defensible
second bound.

Two operator vocabularies are now exported —
`VIEW_FILTER_LIST_VALUE_OPERATORS` and `VIEW_FILTER_PAIR_VALUE_OPERATORS` — so a
producer can ask the question the schema asks instead of keeping its own copy.
