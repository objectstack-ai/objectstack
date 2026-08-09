---
"@objectstack/formula": patch
---

fix(formula): the CEL hydration retry arms off cel-js's structured code, not the phrase "no such overload" (#6679)

`celEngine.evaluate` catches a fault and asks `isNumericOverloadError` whether to
hydrate string-serialized numeric / date fields and re-evaluate once — the
ADR-0032 §1c accommodation for `Field.rating` → `"5.0"` and `Field.date` →
`"2026-06-20"` (#1530, #1534). That question was answered by
`/no such overload/i.test(err.message)`: the last message-text read in
`cel-engine.ts` that armed behaviour after #6223 / PR #6677 closed the same hole
in `classifyError`. It now reads
`err instanceof EvaluationError && err.code === 'no_such_overload'`, the same
class-and-code rule `classifyCelFault` already follows one function below.

The phrase was reachable from a **native** throw, not only from cel-js. Our
`matches()` stdlib binding is `new RegExp(String(re)).test(...)`, so an
uncompilable pattern escapes cel-js unwrapped as a `SyntaxError` echoing the
pattern verbatim — `Invalid regular expression: /no such overload(/` — which
matched. The pattern can be written in the source or read off a row via
`matches(record.name, record.re)`.

The filing recorded this as observation-class, expecting the consequence to be
nil because the retry re-throws the original error. Measuring it for the fix
found one case where it is not nil, so this ships as a fix rather than a
tolerance removal: when hydration lets the expression short-circuit around the
throwing call, the spurious retry **succeeds** and returns a value where the
fault was the right answer.

```text
record.s == "5.0" ? matches(record.name, "no such overload(") : false
  { s: "5.0", name: "x" }   ->  was: ok, false        now: the regex fault
record.s == "5.0" ? matches(record.name, "(") : false
  { s: "5.0", name: "x" }   ->  the regex fault       (unchanged)
```

Evaluation 1 takes the `matches(...)` branch and throws natively; the phrase
armed the retry; hydration made `record.s` the number `5`, so `5 == "5.0"` went
false, the ternary took the other branch, and `matches` was never called. Two
expressions that differ only in whether a regex literal happens to contain the
phrase no longer disagree about whether they fault.

The behaviour change is one-directional and narrow. A genuine cel-js
`no_such_overload` still arms the retry and every §1c hydration behaves exactly
as before; only a native throw whose message merely contains the phrase stops
arming it. Faults are otherwise unchanged — a native throw carries no cel-js
contract, so it is still reported as `runtime` (#6223).
