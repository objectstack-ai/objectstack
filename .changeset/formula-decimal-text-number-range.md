---
'@objectstack/formula': patch
---

fix(formula): decimal text is judged against the number range before it is scaled

Clause-②: no
Metadata-protocol: none

`toScaledDecimal` now judges decimal text against the number range before it scales it, the way the same value is judged as a number:

- Text whose number is not finite (`'1e400'`, `'1.8e308'`) spells no decimal and reads `undefined`, as a non-finite number already did.
- Text whose number is zero because it is below the smallest number (`'1e-400'`) reads as zero, as that number already did.
- A zero is never scaled by its exponent; one written with an exponent below the smallest number's (`'0e-325'`) reads as plain zero.

Inside the range every digit is still kept exactly, numbers and bigints are read as before, and `divideToPlaces` and `formatScaledDecimal` are unchanged. The home-amount projection treats an amount that spells no decimal as before: it leaves the value to the record validator, which refuses a non-finite number as `invalid_number`.
