---
'@object-ui/fields': patch
---

fix(fields): a read-only record-mode amount that declares `homeAmount` shows the live home-amount preview in an editable form

Clause-②: no
Metadata-protocol: none

A `record`-mode amount that declares `homeAmount` (ADR-0144 D5) draws the "≈ AMOUNT at RATE on DATE" line under it while the record is edited. The line was mounted on the widget's editable face only, so an amount the form draws read-only lost it. The showcase invoice's `amount` is computed by an `expression`, and the form draws such a field read-only, so its edit form had no preview at all, whatever the currency or document date.

`CurrencyField`'s read-only face now mounts the same preview when the field is not `disabled`, so it follows a changed currency or document date before save. A read-only form (`mode: 'view'` or `readOnly`) disables every field and shows no preview: it has no save, and its home field already says the rate and date the engine used. The record page draws the amount with the cell renderer, which is unchanged, so it still shows the stored conversion once, under the home field. No new prop, no new translation key: the preview and its `fields.currencyHome.*` strings are the ones the editable face already uses.
