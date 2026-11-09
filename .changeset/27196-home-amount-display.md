---
'@object-ui/i18n': patch
'@object-ui/fields': patch
'@object-ui/plugin-form': patch
'@object-ui/plugin-detail': patch
---

feat(ui): a home-currency amount shows the rate and document date it was converted at

Clause-②: yes (widening)
Metadata-protocol: none

A `record`-mode amount that declares `currencyConfig.homeAmount` (ADR-0144 D5) has its home field filled by the server when the record is saved. That home field now draws as a read-only amount in the organization's home currency, with the line "Converted at RATE on DATE" taken from the record's own rate and document-date fields, or "In the home currency (rate 1)" when the amount was already in the home currency. This holds on the record page and on authored form sections (the record dialog, the drawer and an inline `ObjectForm`), where it used to be a disabled number box with no currency symbol. A form laid out automatically still leaves readonly fields out, the home field included.

`@object-ui/i18n` adds `homeAmountSourceOf`, `withHomeAmountSource`, `readHomeAmountSource`, `HOME_AMOUNT_SOURCE_KEY` and the `HomeAmountSource` type, plus two locale keys in every pack: `fields.currencyHome.convertedAt` and `fields.currencyHome.homeCurrency`. `@object-ui/fields` exports `HomeAmountHint`.

The Studio field editor gains the three `homeAmount` pickers under `record` mode (home amount field, document date, rate field), listing only the fields the spec accepts for each. Re-picking an amount's currency code field no longer deletes its `homeAmount`.
