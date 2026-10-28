---
'@object-ui/i18n': patch
'@object-ui/fields': patch
'@object-ui/components': patch
'@object-ui/plugin-form': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-dashboard': patch
'@object-ui/plugin-detail': patch
'@object-ui/plugin-gantt': patch
'@object-ui/app-shell': patch
---

feat(ui): a `record`-mode currency amount shows each record's own currency; the code field is an ISO 4217 select pre-filled with the organization currency; Studio edits the mode and the pointer (ADR-0144 D2, D6, D8 rule 4)

Clause-②: no
Metadata-protocol: none

An amount declaring `currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' }` now renders in the currency its record's `currency_code` holds, on every face that holds the record:

- **Cells and widgets.** `resolveFieldCurrency(field, tenantDefault, record)` takes the record in scope as an optional third argument. Under `record` mode it reads only that record's code field; no record, or a blank code, resolves to no currency, so the amount shows as a plain number and never in the tenant default. `dynamic` and `fixed` fields resolve exactly as before. The list cell, the form and inline amount box (symbol, decimals and spinner step follow the selected code), formula cells returning `currency`, the record page's summary chips, the dashboard table and record drawer, and Gantt tooltips all pass the record. `recordCurrencyField(field)` names the pointer.
- **The code field.** A `text` field declaring `valueDomain: 'iso_4217_currency'` renders a searchable select instead of a free-text box, grouped "Available" (the organization currency, then rated currencies, then the codes the object's records already hold) and "All currencies (ISO 4217)". It offers only codes the value domain accepts. The form reads the used codes once per object, with one grouped query, and hands them to the field on its own metadata (`usedCurrencyCodes`); a data source without grouped queries offers home + the record's own code. The rated group is empty until the exchange-rate table ships. The picker itself is `CurrencyCodePicker` in `@object-ui/components`.
- **Filters.** In the list's filter builder, a condition on a `record`-mode amount gains a required currency picker, defaulting to the organization currency, and the filter reads `amount op X AND code = C`: the code condition is a second row of the same group, so stored filters keep their shape. A group holding such a pair stays on AND (under OR the pair would split), and a stored OR group says so. Presence checks (`is null`, `is empty`, …) need no currency.
- **Create forms.** A code field that a `record`-mode amount points at opens pre-filled with `localization.currency`, as a value the user submits; a declared `defaultValue` and the caller's record win, and nothing is seeded while the setting is unset.
- **Totals.** The grid footer draws no sum, average, minimum or maximum for a `record`-mode amount (its rows are in different currencies); counts stand. A group header keeps those aggregates only when the grid is grouped by the amount's code field. Consolidated totals belong to the home field, a `dynamic` amount that totals as before.
- **Studio.** A currency field (or a formula returning `currency`) gains a currency section: the mode (dynamic, fixed, record), the fixed code, and under `record` a `currencyField` picker listing the object's ISO 4217 code fields, with "Create currency field", which adds `currency_code` (`text`, `valueDomain: 'iso_4217_currency'`, required) and points the amount at it.

⛔ Not released alone: this ships in the same release as `currencyMode: 'record'` itself and its aggregate refusals.
