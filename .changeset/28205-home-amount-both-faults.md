---
'@objectstack/spec': patch
---

fix(spec): a `currencyConfig.homeAmount` home or rate field that lacks `readonly: true` and declares an `expression` is told both faults in one refusal

Clause-②: no
Metadata-protocol: none

An object whose `homeAmount.field` or `homeAmount.rateField` names a field that lacks `readonly: true` AND declares an `expression` was refused with only the `readonly` fault, so the author added `readonly: true` and met the `expression` fault on the next parse. The one issue at that pointer now names both faults and both remedies: add `readonly: true` to the field and delete its `expression`. The accept set is unchanged; a field with only one of the two faults is told exactly what it was told before.
