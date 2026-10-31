---
'@objectstack/objectql': patch
---

feat(objectql): a record-mode amount that declares `currencyConfig.homeAmount` stores its value converted into the home currency, with the rate used, on every write (ADR-0144 D5)

Clause-②: yes (widening: `ObjectQL.setHomeCurrencyResolver(resolver)` is new public engine surface; the write refusals below reach only an object that declares `currencyConfig.homeAmount`, a key that ships in this same release, so no released accept set narrows)
Metadata-protocol: none

⛔ Not released alone: this is the engine half of release R2 (ADR-0144 D9). It ships in the same release as the `currencyConfig.homeAmount` key (`@objectstack/spec`), never ahead of it and never without it.

When a record is inserted, and when an update changes its amount, its currency code or its document date, the engine writes the two fields `homeAmount` names:

- **The rate** is the organization's `sys_exchange_rate` row for the record's currency with the latest `effective_date` on or before the document date (`homeAmount.rateDate`). A `datetime` document date is read as its UTC calendar day. The row's rate is stored in `homeAmount.rateField` as it is, unrounded.
- **The home amount** is the amount divided by the rate (a rate states how many units of the foreign currency one unit of the home currency buys), computed in exact decimal arithmetic and rounded once, half away from zero, to the home currency's minor units (0 for JPY, 2 for USD and CNY, 3 for KWD). USD 10,000 at 0.1389 into CNY stores 71994.24.
- **Same currency as home:** rate `1`, no rate read. **Blank amount:** blank home amount and rate.
- **The home currency** is the `localization.currency` setting, read for the row's organization through the `settings` service. `ObjectQLPlugin` wires it; an engine booted without the plugin answers it through `setHomeCurrencyResolver`.
- **The engine's alone.** A value a caller sends for either field is dropped (or refused under `strictReadonlyWrites`) as before; a `defaultValue`, a system write or a historical (`preserveAudit`) import of either field is computed over.
- **Refusals, before anything is written:** `ERR_EXCHANGE_RATE_MISSING` / 400 when no rate row is in force on the document date (the message names the currency and the date; never a rate of 1, a later rate or an empty home amount); `ERR_HOME_CURRENCY_UNSET` / 400 when the organization has no `localization.currency` (never an assumed home currency); `VALIDATION_FAILED` `required` on the date field when a foreign-currency amount has no document date. A multi-row insert (`insertMany`, the import) refuses only the offending row; an update by filter is refused when its one patch would convert the matched rows to different home amounts.
- **Every door, one path.** REST create and update, the import (batched and per row, dry run included) and `validate()` reach the same insert and update seam, so they convert and refuse alike.
- **No migration.** Nothing changes for an amount that does not declare `homeAmount`.
