---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a formula declaring `returnType: 'currency'` reads as money in related lists and the quick-look panel

Clause-②: no
Metadata-protocol: none

A `Field.formula` with `returnType: 'currency'` and its own `currencyConfig` read as a bare grouped number (`90,000.00`) in a related list and in the quick-look panel, beside the currency fields it was computed from (`$150,000.00`). The related list's cell builder and `buildRecordDetailFields` rebuilt the field from a picked key list that left `returnType` out, so the formula cell never saw it. Both now hand `returnType` through beside `currencyConfig`, the way the list grid and the record page already do, and the formula reads `$90,000.00`. A formula declaring `number`, or nothing, keeps the bare number.
