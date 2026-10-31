---
'@objectstack/spec': patch
---

feat(spec): the error-code ledger registers `ERR_EXCHANGE_RATE_MISSING` and `ERR_HOME_CURRENCY_UNSET`, and `@objectstack/spec/data` exports `CURRENCY_FRACTION_DIGITS` (ADR-0144 D5, Open items 3 and 9)

Clause-②: yes (widening: two new error codes under `@objectstack/objectql` in `ERROR_CODE_LEDGER`; the `CURRENCY_FRACTION_DIGITS` table, already in the package, is now exported from `@objectstack/spec/data`. No Zod schema shape and no table value changes)
Metadata-protocol: none

⛔ Not released alone: these ship in release R2 with the write-time home-currency projection that answers them (ADR-0144 D9).

- `ERR_EXCHANGE_RATE_MISSING` (400): a write that must convert an amount into the home currency found no exchange rate in force on the record's document date.
- `ERR_HOME_CURRENCY_UNSET` (400): the same write found no home currency, because the organization's `localization.currency` setting is not set.
- `CURRENCY_FRACTION_DIGITS` (CLDR fraction digits per code, which differ from ISO 4217's minor units for some codes such as IQD, HUF, COP, IDR and PKR) is the table the engine rounds a home amount with, exported so a consumer rounds with the same table instead of a copy.
