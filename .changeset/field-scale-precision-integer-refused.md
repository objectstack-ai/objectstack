---
"@objectstack/spec": minor
---

feat(spec): refuse malformed field `scale`/`precision` declarations at authoring time (#8321)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

`Field.scale` ("Decimal places") and `Field.precision` ("Total digits") are
digit counts, but both parsed as bare `z.number()` — admitting `scale: 2.5`
and `scale: -1`, neither of which has a defined meaning as a count. That
looseness became load-bearing when #7501 made `scale` enforced at write time:
the runtime branch deliberately guards on `Number.isInteger(def.scale) &&
def.scale >= 0` (inventing floor/round semantics in a consumer would be PD #12
guessing), so a typo'd declaration silently got **no enforcement at all** —
the declared-but-inert shape that hides AI-authored metadata errors.

**What is refused:** a non-integer or negative `scale` or `precision`, at
parse time with the issue path and substance (`invalid_type` "expected int" /
`too_small` ">=0") — the house `z.number().int().min(0)` shape (ADR-0078
declared=enforced).

**What stays accepted:** every well-formed declaration byte-identically
(`0`, `2`, any non-negative integer, or no declaration).
`CurrencyConfigSchema.precision` (under `currencyConfig`) is a **different
surface** with its own bounds and `scale → precision` alias table — unchanged.

**Stored metadata is not hard-broken:** a `sys_metadata` row already at rest
with a malformed value keeps loading — the ADR-0087 D2 conversion
`field-malformed-scale-precision-removed` (retired from the load path,
replayed by the stored-row rehydration seam and `os migrate meta`) drops the
meaningless key, which is behaviour-preserving because a malformed declaration
enforced nothing. The semantic entry
`field-scale-precision-integer-refused` (protocol major 18) tells authors to
re-declare the digit count they meant.

<!-- adr-0087: registered field-scale-precision-integer-refused -->
