---
"@objectstack/formula": patch
---

fix(formula): the ADR-0032 §1c retry rewrites only the operands that faulted (#7098)

**A CEL expression could return a silently wrong boolean.** No fault, no log
line, no failing test — `{ ok: true }` with the wrong answer. If you have
compound CEL that mixes a numeric comparison with a string equality over
string-serialized fields, read the "which expressions change answer" list below:
those expressions answer differently after this fix, and the new answer is the
right one.

## What was wrong

When a comparison faults on a string-serialized numeric or date field
(`record.rating >= 4` where `rating` reads back as `"5.0"` — #1530 / #1534),
ADR-0032 §1c hydrates and retries. The retry hydrated the **entire scope** and
re-ran the **entire expression**, justified by a docblock claim that it

> can never change a comparison that already evaluated cleanly — it only rescues
> one that already faulted.

That claim was false, and it was load-bearing: it was the stated reason the
hydration was allowed to be unconditional and scope-wide. The retry knows only
that the *whole expression* faulted, not that each sub-comparison did. So:

```text
record.n >= 4 && record.s == "5.0"    with { n: "7", s: "5.0" }
  before -> { ok: true, value: false }        after -> { ok: true, value: true }
```

`record.n >= 4` faults and is correctly rescued. But `record.s` was hydrated to
the number `5` as well, so the author's deliberate string equality — **true**
when it was evaluated the first time — became `5 == "5.0"`, which CEL answers
`false` across types. The expression returned `false`, and nothing reported that
a clean answer had been overruled.

## Which expressions change answer

Only expressions that **already reached the §1c retry** — i.e. some operand
faulted `no such overload`. Everything that evaluates without faulting is
untouched. Within that set, an expression changes answer when it also contains:

- **a string equality / inequality on a numeric-looking or ISO-date field** —
  `record.n >= 4 && record.s == "5.0"`, and the `!=` and ternary forms. Now
  answers on the string the author wrote.
- **a string membership test** — `record.s in ["5.0", "x"]`.
- **the same field compared as a number in one place and as a string in
  another** — `record.n >= 4 && record.n == "7"`. Both answers are now correct
  at once; previously the second was collateral damage from the first.
- **a numeric-looking string the expression RETURNS rather than compares** —
  `record.n >= 4 ? record.s : "none"` returned the number `5`; it now returns
  the string `"5.0"`. A `Field.formula` of type text was storing a different
  value than the record held.

One class becomes a **loud fault where it used to be silently rescued**: an
operand whose value the rewrite cannot read before deciding — bound by a
comprehension (`record.items.exists(i, i.price > 100)`), or behind a computed
index. That is the deliberate trade of this fix. Rescuing an operand we cannot
prove faulted is exactly the defect being closed, so those report the original
`no such overload` instead of guessing. The reported error is unchanged in shape
and message.

## What replaces it

The coercion is now **per operand position** — the same discipline
`rewriteTemporalEquality` already documents ("no field-wide trade-off"), one
step stricter. The scope is never rewritten; the faulting operand is wrapped in
`double(…)` or `date(…)` in place. An operand is rewritten only when all three
hold, which makes the docblock's guarantee true by construction rather than by
assertion:

1. the operator **raises** on a string-versus-number/Timestamp pair instead of
   answering one, so the comparison cannot have produced an answer;
2. the counterpart is a number or a Timestamp **in this scope**, read off the
   values in hand rather than off a static type (every field is `dyn` under
   `unlistedVariablesAreDyn`);
3. the operand's own value is a §1c serialization artifact — an entirely-numeric
   string or an ISO-8601 date. A zip like `"02134"`, or free text, still faults
   loudly.

Measured per operator on cel-js 8.0.0 and pinned in the new tests: `<` `<=` `>`
`>=` `+` `-` `*` `/` `%` **fault** on a mixed pair and are eligible. `==`, `!=`
and `in` **answer** across types — CEL equality is total — so they already had
an answer and are never rewritten. That measurement is the root of the defect:
the string equality above never faulted at all.

`Field.date` strings not matching a Timestamp under `==` remains owned by
`rewriteTemporalEquality`, which wraps them statically on the clean path, where
both sides are known from the source instead of inferred from an unrelated
conjunct's fault.

## Reach

`celEngine.evaluate` — the only home of this retry — does **not** reach RLS.
Row-level security compiles its `using` / `check` predicates through
`compileCelToFilter` (SQL pushdown) and `matchesFilterCondition` (write-side
post-image), and declared sharing rules do the same; neither calls this
evaluator. No access-control decision could be inverted by this.

It does reach write-gating decisions, which is why the behaviour was not
acceptable as documented: validation-rule predicates and `when` conditionals,
`readonlyWhen`, hook `condition`s, automation/flow conditions, and formula
fields and default values. A validation rule is **fail-closed** on a fault
(#4649) — but a silently flipped boolean is not a fault, so a rule that should
have rejected a write instead read as "not violated" and let it through.
