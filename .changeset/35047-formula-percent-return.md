---
'@objectstack/spec': minor
'@objectstack/objectql': patch
'@object-ui/fields': patch
'@object-ui/app-shell': patch
---

feat(spec): a formula field can return `percent`

Clause-②: yes (widening)
Metadata-protocol: added

A ratio formula (budget used, gross margin) can now declare `returnType: 'percent'` and read and display as a `percent` field does, instead of a bare decimal beside the stored percentages.

- **The value.** A `percent` formula result is read exactly as a `percent` field reads its stored value: a fraction (`0.25` shows `25%`, so the expression divides and does not multiply by 100), unless the formula declares a `max` above 1, then percentage points (`percentScaleOf`).
- **Its places.** `scale` counts the decimal places of the displayed percentage, as on a `percent` field (absent: 0). The engine rounds a fraction result to `scale + 2` places and a whole percentage to `scale`, so `scale: 1` keeps 0.417 (41.7%) instead of rounding it to 0.4.
- **An existing `percent` field computed from its `expression` rounds the same way.** The engine shares one rounding step for computed values, so a stored `percent` field that computes from an `expression` now keeps `scale + 2` places for a fraction (and `scale` for a whole percentage). Before, its computed fraction was rounded to `scale` itself: at `scale: 1`, 0.417 was stored as 0.4 and read 40.0%; it is now stored 0.417 and reads 41.7%. The change applies to the next computed write; rows written earlier are not rewritten.
- **Its face.** `percentDisplay` applies to a `percent` formula too (bar or plain). The formula renderer formats the result with the percent formatter, and the Studio field inspector offers `percent` as a return type.
- **Declared, never inferred.** No CEL type proves a quotient is a percentage, so authoring keeps a declared `percent` where it would otherwise stamp `number`. Readers that switch on `returnType` (display-name eligibility, filter operator and comparand typing) treat `percent` as a number.

The enum only gains a member: every formula that parsed before parses the same, and nothing stored needs migrating.
