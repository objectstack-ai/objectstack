---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a record page's body tables total only the columns declared additive — a version number or an instalment number is no longer summed

Clause-②: no
Metadata-protocol: none

**Visible behaviour change on a released page.** The 「Totals (this page)」 line under a body table of the default record page (a related list drawn full width in the details column) used to add up every `currency`, `number`, `integer` and `decimal` column. Ordinals were summed with the quantities: a contract's versions v1–v4 read 「版本号 10」, five instalments 「期次 15」. The line now totals:

- a `currency` column, when every counted row is in one known currency, formatted in it. Each row's currency is the one its cell displays (`resolveFieldCurrency`): the field's code under `currencyMode: 'fixed'`, the tenant default under `dynamic`, the row's own code field under `record`. Rows in different currencies, or a row whose currency is unknown (a `record`-mode row with a blank code, a `dynamic` amount with no tenant default), give that column no total rather than a bare or wrong-currency sum. A `currencyConfig` without `currencyMode: 'fixed'` no longer formats in its `defaultCurrency`, which the spec does not read outside `fixed`; it shows the tenant default, as the column's cells do;
- a `number`, `integer` or `decimal` column only when the record's own object declares a `summary` field whose `summaryOperations` sums that child field (`function: 'sum'`, `object` naming the child). The roll-up is the author's statement that the column adds up. Without one, as for an amount stored as `number` with its currency on the parent, the column gets no total;
- nothing else. When no column qualifies the line is not drawn.
