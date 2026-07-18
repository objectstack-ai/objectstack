---
"@objectstack/formula": minor
---

feat(formula): `dateField == today()` now matches — AST temporal-comparison rewrite (#3183)

**Behavior change (the fix):** a `Field.date` compared with `==`/`!=` against a
temporal function now matches on the calendar day. Previously it **silently
returned the wrong answer** — `record.due_date == today()` was always `false`
(and `!= today()` always `true`) even for a same-day record, because a
`Field.date` reads back as a `YYYY-MM-DD` **string** (ADR-0053 Phase 1) and
cel-js's equality (`overloads.js` `isEqual`) treats a string and a timestamp as
unequal without consulting any overload.

`celEngine.evaluate` now rewrites the parsed AST: for each `==`/`!=` whose one
operand is `today()`/`daysFromNow()`/`daysAgo()`/`now()`, the **field operand**
is wrapped in `date(...)` (the stdlib coercion), then the expression is
serialized and evaluated. So `record.due_date == today()` runs as
`date(record.due_date) == today()`.

- **Per-occurrence**, not per-field: `record.d == "2026-06-20" || record.d == today()`
  keeps the string-literal comparison intact while fixing the temporal one.
- **Type-blind-safe**: `date()` degrades gracefully — an already-`Date`
  (`Field.datetime`) operand passes through; a non-date string or null →
  `Invalid Date` → the comparison stays `false`, exactly as before. No
  field-type information is needed, and no currently-correct result is worsened.
- **Cheap**: the rewrite only reserializes when such a comparison is present
  (a plain-`includes` gate skips the rest), and is memoized per source string.

Applies to every interpreter site — read-time `Field.formula`, default values,
validation rules, hook conditions, and flow conditions — since all route through
`celEngine.evaluate`. RLS/sharing conditions are unaffected: they compile via
`cel-to-filter`, which already rejects function calls as a loud authoring error.

**Supersedes the #3192 advisory lint.** That build-time warning
(`checkTemporalDateEquality`) flagged `dateField == today()` as a silent-miss;
with the runtime fixed it would be a false alarm, so it (and the
`temporalEqualityFields` helper it used) is removed. Authors can now write the
natural `record.due_date == today()` directly; the `date(...)` /
`daysBetween(...) == 0` / range idioms all keep working.
