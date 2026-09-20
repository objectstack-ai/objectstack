---
"@objectstack/objectql": minor
"@objectstack/spec": minor
---

`Clause-②: yes (widening)`

A `percent` field's declared `scale` is the number of decimal places of the **percentage-point** value as displayed and entered; the **stored** allowance now derives from it. For a fraction-stored percent the record validator's `max_scale` branch accepts `scale + 2` decimal places in the stored fraction (#19320).

Maintainer ruling batch #161 item 3 letter B (2026-09-18) settles what one word means: `scale: 2` on a percent field is two displayed decimals, so the edit widget offers `12.34` and writes the fraction `0.1234`. The branch compared those four places against the raw declaration and refused the write — an author could declare two displayed decimals and then not write two displayed decimals.

- **Which fields move**: only a **fraction-stored** percent, i.e. one whose `percentScaleOf` is `fraction` — no declared `max`, or a `max` at or below 1. A **whole-percent** field (`max` above 1) stores the displayed number itself and keeps the declared `scale` exactly, as do `number`, `currency`, `slider` and `rating`. The split is read from the spec's `percentScaleOf`, not re-decided at this seam.
- **Direction, measured in both**: over a 1,950-cell corpus of declaration x written value, **36 cells move from refused to accepted and 0 move the other way**. Nothing that writes today stops writing; no stored value is re-read or re-judged; no migration is implied.
- **`FieldSchema.scale`'s describe states both meanings**, which is the half of the ruling that makes the derivation legible to an author: what the number counts (displayed percentage points) and what it permits in storage (`fraction` ⇒ `scale + 2`, `whole` ⇒ `scale`). The generated field reference page carries the same sentence, and `percentScaleOf`'s docblock points at it rather than restating it.
- **The refusal envelope names the allowance that was applied.** On a fraction-stored `scale: 2` field, `0.12345` is still refused and reports `constraint: { scale: 4, actual: 5 }` — previously it would have read `{ scale: 2, actual: 5 }` on a field that accepts four places, a true refusal described by a false constraint. A consumer asserting the raw declaration back out of a percent field's `max_scale` envelope reads the derived number instead.
