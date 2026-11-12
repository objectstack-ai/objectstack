---
'@objectstack/formula': minor
'@objectstack/spec': patch
---

fix(formula)!: the gate refuses a date or datetime field handed straight to a call that takes a timestamp, which faults wherever the field's text reaches it, and stops refusing its concatenation with text and its ordering against a literal (#32595)

Clause-②: no (narrowing) — the author-time gate (`os validate`, `os build`, `os lint`, the object save door and the other doors of the active authoring gate) refuses a call on a date or datetime field it passed before. The two refusals it drops (concatenating a date field with text, ordering one against a text literal) are behaviour the published text already declares accepted: the `registerDateTextOverloads` docblock in `packages/formula/src/cel-engine.ts` ("ordering against another date field or a text literal → string-lex", "`+` with text … → string concatenation") and this package's 18.3.0 changelog entry for #28944 (51058ef: "Date comparisons (`<`, `==`, against a literal, against `today()`), concatenation, … all stay accepted"). Nothing is newly accepted.
Metadata-protocol: narrowed

<!-- adr-0087: registered formula-date-text-call-refused -->

**BREAKING** accept-set narrowing at the authoring type-soundness gate (`@objectstack/formula` `validateExpression`), shipped as `minor`. The gate declared a `date` / `datetime` field a CEL Timestamp, so `isoDate(record.start_at)` and `record.start_date.getFullYear()` checked clean. The SQL driver's read doors (ADR-0053 D-F1) and a write that hands the value as text (every JSON body) give the evaluator a date field as its `YYYY-MM-DD` text and a datetime field as its ISO-8601 instant text, and there the evaluator finds no overload for the call, on every record whose value reaches it.

- **Before.** A formula `isoDate(record.start_at)` built green and read `null` on every record whose value reached the call as text, with a server WARN as the only trace. A validation rule `!startsWith(isoDate(record.start_at), "2026")` published clean and then refused every such write as unevaluable, because a validation rule fails closed. A fail-open predicate of the same shape never fired. `isoDatetime(...)` and the Timestamp methods (`getFullYear()`, `getHours()`, …) on a date field behaved the same.
- **Now.** The same expression is refused (`severity: error`) under the new code `date-text-call`, or `date-text-call-fail-closed` / `-fail-open` / `-run-fails` / `-run-may-fail` where the site's fault outcome is known. The message names the call and the field, says what the fault does at that site, and prescribes the rewrite with the field parsed by `date(…)` first. The gate checks the rewrite clean before it prescribes it. `params: { call, reference, rewrite }`.
- **No longer refused.** `record.title + " " + record.start_at` and `"Due: " + record.end_date` (concatenation), and `record.start_date < "2026-12-01"` (ordering against a text literal), evaluate to a value at runtime. The gate refused them as `type-mismatch-fail-closed` at a fail-closed site and warned `type-mismatch` elsewhere. They are clean now, as the declared text above says.
- **Unchanged.** Ordering a date field against text that is not a literal keeps its `type-mismatch` verdict, because no declared text covers it: a text field read directly (`record.title < record.start_at`) or through a ternary, and text computed by `+`, `upper(…)`, `string(…)` or `isoDate(…)` (`record.start_date < isoDate(today())`). Date arithmetic keeps its `date-arithmetic` / `date-text-arithmetic` / `date-duration-value` refusals word for word. `daysBetween`, `addDays`, `addMonths` and comparison against `today()` stay accepted.
- **Also refused: a guarded call.** `record.start_at != null && isoDate(record.start_at) == "2026-11-16"` evaluates to `false` on a row without a value and faults on every row with one, so it is refused like the bare call; the rewrite keeps the guard.
- **Where a date-time arrives as a JS `Date`.** A server-side writer that hands a `Date` (measured through the engine), or a MongoDB read, whose storage form for a datetime is a BSON `Date` (not measured end to end), gives the evaluator a Timestamp, and there the refused call evaluates. The refusal applies there too. The prescribed rewrite reads the same value on the text and on a `Date`, so rewriting changes no value that worked.
- **Who sees it.** An author whose expression hands a date field straight to `isoDate`, `isoDatetime` or a Timestamp method. On an SQL-backed object written through the API, that expression already read `null` or refused the write wherever the field had a value. No expression shipped in this repository's `packages/`, `examples/`, `skills/` or `content/docs/` has this shape.
- **`@objectstack/spec`.** The upgrade guide entry `formula-date-text-call-refused` (a semantic migration: the rewrite is shown per call in the refusal, and it reads the same value on both shapes the field arrives in).

## FROM → TO

```ts
// before: built green, read null wherever the field's text reached the call (a validation rule refused the write)
day: Field.formula({ expression: 'isoDate(record.start_at)' }),
year: Field.formula({ expression: 'record.start_date.getFullYear()' }),

// after: parse the field's text into a timestamp first
day: Field.formula({ expression: 'isoDate(date(record.start_at))' }),
year: Field.formula({ expression: 'date(record.start_date).getFullYear()' }),
```

`date(…)` keeps a datetime's instant, so `isoDatetime(date(record.start_at))` and `date(record.start_at).getHours()` read the value they were written to read.
