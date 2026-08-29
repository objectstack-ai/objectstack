---
"@objectstack/spec": patch
---

Strip internal issue-tracker ids from refusal prose built inside functions

The fourth customer-facing refusal population in `packages/spec`: prose a
FUNCTION returns rather than prose written at a recognised position — a zod
`error: (issue) => …` map, a hoisted `const X = (key) => '…'` message builder
referenced from `message:` or `retiredKey(X(…))`, a `$ZodErrorMap` const the
`error` callback dispatches to, a `(v): StrictObjectOptions => ({ history })`
options factory. It reaches exactly the same reader at exactly the same moment
as the three populations already stripped: the author whose metadata was just
rejected. That reader has no tracker, so `#NNNN` was a citation-shaped token
resolving to nothing in the one sentence that most needs to be actionable.

47 literals carrying 55 tracker ids across 13 sources.

| how the prose reaches the author | literals | ids | files |
|---|---:|---:|---:|
| built INSIDE a function in a recognised position | 28 | 32 | 8 |
| hoisted into a const an `error:` callback dispatches to | 19 | 23 | 8 |

**Kept, deliberately:** ADR ids, protocol and package versions, error codes
(`400 INVALID_FIELD` traces the runtime twin far better than the id beside it)
and the `os migrate meta --from <N>` commands — the anchors a customer can
actually resolve. Where an id was the whole parenthetical, the parenthetical
went with it; where it was load-bearing for an internal reader, it moved to an
adjacent `//` comment.

`check-doc-authoring` Rule 3 could not see this population at all: its climb
returned `undefined` at `ArrowFunction` / `ReturnStatement`, so the gate printed
`0 violations` over four populated buckets while a fifth sat outside every one
of them. The rule now crosses a function boundary — but only when the FUNCTION
ITSELF sits in a recognised customer-facing position, never unconditionally
through arbitrary function bodies, which would report values as prose. The new
population is its own `functionBuilt` bucket so it carries its own blindness
floor, since an unrecognised spelling produces no flag silently.
