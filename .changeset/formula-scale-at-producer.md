---
"@objectstack/objectql": patch
---

Apply a `formula` field's declared `scale` when the formula is evaluated
(#10280). `Field.formula({ scale: 2 })` was accepted and then ignored: a
percentage formula such as `(record.num_responses * 100.0) / record.num_sent`
**returned** `41.666666666666664`, so the API response — and the record page
rendered from it — carried all fifteen digits despite the declaration.

The value is now rounded where it is produced, in the engine's formula
evaluation, so all three surfaces that materialize a formula inherit it: list
reads, single-record reads, and the record a write responds with.

- **Rounding is `Number(v.toFixed(scale))`** — round-half-away-from-zero, the
  same arithmetic the console's client-side computed columns use. Negatives
  round away from zero: `-1.5` at `scale: 0` is `-2`, not `-1`.
- **A formula declaring no `scale` is unchanged** and keeps full precision.
- **Non-numeric results are untouched** — a formula returning a string,
  boolean or `null` is returned as-is.
- A formula value is **returned, never stored** — it is virtual and has no
  column. Rounding it at the producer is what makes an app's own copy of that
  result writable into a stored `DECIMAL(10, 2)`-style field, which previously
  failed that field's decimal validation.

Unchanged: `scale` on a **caller-supplied** number (`Field.number`,
`Field.currency`, …) is still enforced by **rejection** (`max_scale`), never by
rounding. A value someone sent has an author to refuse; a platform-computed
formula result does not.
