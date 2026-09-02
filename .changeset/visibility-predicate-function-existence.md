---
"@objectstack/formula": minor
"@objectstack/lint": minor
---

feat(lint,formula): refuse a visibility predicate that calls a function the CEL environment does not register (#13594)

An accept-set narrowing at `objectstack validate` and at the runtime publish
door, ruled by the maintainer on 2026-08-31 (director batch #21) on a censused
premise.

**The hole.** `validate-visibility-predicates` — the gate that judges
`visibleWhen` on view form sections/fields and page components — was
deliberately parse-only. So a predicate that parses perfectly and calls a
function that does not exist passed CLEAN, measured side by side with two
controls that fired:

```text
source                       lint gate (before)   validateExpression
totallyBogusFn(1,2)          CLEAN                ok=false
record.x.nosuchmethod('a')   CLEAN                ok=false
country === "USA"            syntax               ok=false   <- control
status == 'active'           bare-identifier      ok=true    <- control
```

The runtime fault it hides is the worst-shaped one the platform has: on a view
or page surface it falls OPEN (the element renders unconditionally, identical
to carrying no predicate at all), and on an action surface — evaluated with
`throwOnError: true` — it falls CLOSED, so the action disappears for every
user *including one who holds the grant*, behind a single deduped
`console.warn` (objectui#4421). A plausible-looking function name that does not
exist is exactly what a generator invents.

**What changed.**

- `@objectstack/formula` publishes `firstUnknownFunctionCall(source)` — the
  function-EXISTENCE verdict, isolated from everything else cel-js's `check()`
  has an opinion about. The oracle is the evaluation environment's own
  registration set, read through the same `buildEnv` seam `celEngine.compile`
  and `celEngine.evaluate` build with — never the advertised
  `CEL_STDLIB_FUNCTIONS` catalog, which lists 35 of the 72 registered names and
  would have refused 37 functions that resolve and evaluate today (`type`,
  `map`, `filter`, `split`, `getFullYear`, `json`, …).
- `@objectstack/lint` gains `visibility-predicate-unknown-function`
  (**error**), covering both call forms — global (`totallyBogusFn(1,2)`) and
  receiver/member (`record.x.nosuchmethod('a')`). The message quotes the
  engine's own `found no matching overload for '…'` verbatim so publish time
  and run time read as one system, and offers **no** "did you mean" suggestion:
  nearest-name matching over the function namespace was measured to answer
  `min` for `can`.

**Scoped supersession, not a widening.** The module's parse-only ruling stands
for everything except function existence. A registered name called with wrong
arguments (`upper(1, 2)`), a registered name called in the wrong position
(bare `split('a,b')`), the CEL-type blind spot (`type == 'grid'`) and every
operator-overload fault (`1 + 'a'`) are all still unreported — `type(record.x)
== string` and every other legal `dyn` predicate is untouched. Refusing an
unregistered call cannot be a false positive: the validation and runtime
environments are the same builder (53 probes, 0 divergence), so the call this
refuses is a call that would have faulted.

**Migration.** A refused predicate names a function that does not exist and
never evaluated — replace it with an advertised callable, or precompute the
value into a formula field on the object and test that field. The census found
**0** host-registered extra CEL functions across the reachable corpus
(objectstack `packages/`/`examples/`/`apps/`, objectui, one shipped host app),
with a firing positive control, and this repo's `examples/**` and `apps/**`
sweep produces **0** new refusals. `cloud`, `objectos` and published
third-party apps were NOT MEASURED — if a host in one of those registers extra
CEL functions, its predicates are refused; that gap was declared before the
ruling and accepted with it.
