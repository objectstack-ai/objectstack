---
'@object-ui/i18n': patch
'@object-ui/fields': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-detail': patch
'@object-ui/plugin-form': patch
'@object-ui/app-shell': patch
---

fix(ui): a child amount that follows its parent's currency draws in the parent's currency

Clause-②: no
Metadata-protocol: none

A `record`-mode amount on a master-detail child may name its parent's code field, `currencyField: 'invoice.currency_code'` (ADR-0144 D2 as amended). The console now draws such an amount in the parent's currency, symbol and fraction digits, on every surface that shows it: the object grid and list view (the read expands the `master_detail` even when no column shows it), the record form and detail view, a related list on the parent's page (cells and the totals line), and the line grid of the master-detail form and the record page's line-items panel (and the master-detail totals). Two lines under one parent read its currency; lines under two parents read each their own. A parent with no code yet shows no symbol, never the tenant's.

A sibling-pointer amount (`currencyField: 'currency_code'`) keeps reading the row's own code, and now also does so in a grid or list that does not show the code column (the read carries the code field) and in a related list (the cell receives its row).

A roll-up `summary` that declares its currency (ADR-0144 D6 as amended) draws as money in the parent record's currency, in the table cell and on the form.

`@object-ui/i18n` reads the parent path in `resolveFieldCurrency` and exports `recordCurrencyPath`, `recordCurrencyReadField`, `withFollowedParent` and the `RecordCurrencyPath` type. `@object-ui/fields` exports `withFollowedParentObject`, `FOLLOWED_PARENT_OBJECT_KEY` and the `ColumnCurrencies` type, and `GridField` takes `columnCurrencies`.

The Studio currency picker offers the parent code fields reached through the object's `master_detail` fields, as `relation.field`, and a stored path reads as the pick; its hint says so.
