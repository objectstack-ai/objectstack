---
'@objectstack/formula': minor
'@objectstack/spec': minor
---

fix(formula)!: the formula gate refuses bare date subtraction, which reads null or `{}` at runtime

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered formula-date-subtraction-refused -->

**BREAKING** accept-set narrowing at the authoring type-soundness gate (`@objectstack/formula` `validateExpression`), shipped as `minor`. The gate declared a `date` / `datetime` field a CEL Timestamp, so `record.end_date - record.start_date` checked as a legal Duration. The runtime never holds a Timestamp there: every read door serves a date field as its `YYYY-MM-DD` text and a datetime field as its ISO-8601 instant text. So the subtraction faulted and the formula read `null` on every record, and `today() - record.start_date` evaluated to a Duration, which a field serialises as `{}`. Both shapes now get the same verdict at every door that runs the gate: `os validate`, `os build`, `os lint`, and the object save door with the other doors of the active authoring gate (`runRuntimeAuthoringRules`). Every door asks one judge.

- **Before.** A formula `record.end_date - record.start_date` or `today() - record.start_date` built green (exit 0), and `PUT /api/v1/meta/object/NAME` answered 200. A read then returned `null` (with a server WARN) or `{}`. The same was true for two datetime fields, and for `now() - record.start_at`.
- **Now.** The same formula is refused at build (exit 1) and at the save door (422 `INVALID_METADATA`, rule `expression-invalid`), located at the field's `expression`. There are two new refusal codes. `date-text-arithmetic` covers arithmetic on a date field's text that the evaluator faults on, in any role, so a predicate `record.end_date - record.start_date > duration("72h")` is refused too. `date-duration-value` covers a formula whose value is a `google.protobuf.Duration`, whether or not a date field is named (`today() - daysAgo(3)` too). Each message names the runtime outcome and prescribes `daysBetween(a, b)`.
- **Unchanged.** `(record.end_date - record.start_date) + 1` and `record.d + 1` keep their `date-arithmetic` refusal word for word, because the existing check still answers first. Date comparisons (`<`, `==`, against a literal, against `today()`), concatenation, `daysBetween` / `addDays`, number arithmetic, and a predicate that compares a duration (`today() - record.start_date > duration("72h")`) all stay accepted.
- **Who sees it.** An author whose formula subtracts dates. That formula already reads `null` or `{}` for every record. No shipped formula in this repository's `packages/` or `examples/` has this shape.

## FROM → TO

```ts
// before: built green, read null (end minus start) or {} (since a date)
span: Field.formula({ expression: 'record.end_date - record.start_date' }),
age: Field.formula({ expression: 'today() - record.start_date' }),

// after: the span in whole days
span: Field.formula({ expression: 'daysBetween(record.start_date, record.end_date)' }),
age: Field.formula({ expression: 'daysBetween(record.start_date, today())' }),
```

The upgrade guide entry is `formula-date-subtraction-refused`. There is no automatic rewrite, because which span the author meant (days, inclusive or not, or hours) is a judgement about the field.

The closed refusal-code set (`EXPRESSION_REFUSAL_CODES`) gains `date-text-arithmetic` (`params: { operands, reference? }`) and `date-duration-value` (`params: { reference? }`).
