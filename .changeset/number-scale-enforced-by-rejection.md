---
"@objectstack/spec": minor
"@objectstack/objectql": minor
---

feat(objectql,spec): a number field's declared `scale` is enforced — by rejection, never rounding (#7501)

`scale` sat in the field contract next to `precision`, `min` and `max` — all of
which read as constraints — but had no validator branch at all: a field declared
`scale: 0` ("integer, no decimals") accepted `11.5` and stored it verbatim, with
no error, no rounding, no warning, through both the REST create endpoint and the
CSV import endpoint. A downstream app that declared `scale: 0` to express "whole
number" shipped on the reasonable assumption that the declaration was enforced
the way `min`/`max` are; it was documentation.

Per the maintainer ruling of 2026-08-11, the number branch of the record
validator now **refuses** an over-scale value the way it refuses an
out-of-range one — `400 VALIDATION_FAILED` with field code `max_scale` and
`constraint: { scale, actual }` — and deliberately does **not** round: silent
rounding is silently altering data. `max_scale` joins the closed field-level
error catalog (ADR-0114 D2) in the `max_*` bounded-range family, with built-in
messages in all four platform locales.

Scope and edges:

- **New writes only.** Values already stored under the old non-enforcement are
  not migrated, re-judged, or touched on read.
- **Every write leg is covered by the one branch**: REST create/update, CSV/JSON
  import (real write *and* dry run — the dry run asks the engine for its
  verdict, so import previews report the same refusal), and flow/hook writes
  that pass through `validateRecord`.
- Decimal places are measured from the number's canonical string form, so
  exponent notation is judged correctly (`1e-7` is 7 decimal places, `1.2e+3`
  is 0) and large magnitudes cannot overflow into false rejections.
- `min`/`max` behave exactly as before and are checked first; an integer into
  `scale: 0` still writes; a field with no declared `scale` accepts any
  precision. A malformed declaration (negative or non-integer `scale`) stays
  unenforced rather than being given invented semantics.

If a deployment was knowingly storing over-scale values into a field that
declares `scale`, the declaration and the data now disagree loudly: widen or
remove the field's `scale` to match what you actually store.
