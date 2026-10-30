---
'@object-ui/app-shell': patch
---

fix(app-shell): a `dynamic`-mode currency change in a record's History reads in the tenant's default currency

Clause-②: no
Metadata-protocol: none

The record page's Activity › History stream formatted a `currency` field with `currencyMode: 'dynamic'` (or no mode) as a plain grouped number (`4,321,000.00`) while the record itself showed `$4,321,000.00`, because the History format context was never handed the tenant's default currency. The record page now passes `useLocalization().currency` (the `localization.currency` setting the page's cells already read, ADR-0053) into that context, so a dynamic change reads with the tenant's code. A `record`-mode field is unchanged: its code lives in a sibling field of the row, so its change still reads as a plain number.
