---
"@objectstack/spec": minor
---

feat(spec): `Field.number` gains a `useGrouping` presentation hint (#7768)

`scale` was the only presentation-adjacent property a `number` field carried,
and it governs decimal places, not digit grouping. Console number renderers
construct `Intl.NumberFormat` with grouping unconditionally ON, so an
ordinal/identifier integer authored as `Field.number({ scale: 0, min: 1900 })`
(e.g. a year) renders `2,026` everywhere it is shown. Downstream apps hit this
three times (hotcrm-heimao#35, #40, #59) and each time converted the field to
`Field.text` to escape the comma — trading away numeric semantics (range
validation, sort-as-number, arithmetic) for a display detail unrelated to the
field's type.

**New:** `useGrouping?: boolean` on `FieldSchema` (flat, alongside
`precision`/`scale`/`min`/`max`), threaded automatically through
`Field.number(...)` and every other type's builder via the existing
`FieldInput` shape — no builder special-casing needed, the same way
`scale`/`min` travel today.

Deliberately three-valued and NO default declared:

- **absent** — the author has not judged whether this integer reads as a
  quantity or an identifier; the renderer decides (an interim heuristic today,
  the locale's own default eventually — that contract lives in objectui, not
  here).
- **`false`** — the author's explicit opt-out: never group this number
  (a year, an ID, a zip code).
- **`true`** — the author pins grouping on, overriding the heuristic the
  other way.

Maps 1:1 onto `Intl.NumberFormat`'s `useGrouping`. This is Option A of the
card's fork — the narrowest shape with measured pull — ruled on #7768,
2026-08-11, with the maintainer's veto window open. No `displayFormat` slot,
no other presentation knobs.

Unblocks objectui#4033, the console renderer half that consumes the explicit
hint and retires the interim heuristic (explicit-hint > heuristic >
locale-default).
