---
'@object-ui/plugin-grid': patch
---

Clause-②: no
Metadata-protocol: none

Phone list cards now put a line's total in the amount slot. The slot used to take only a column whose field type is literally `currency`, so on an order-line list the card showed the unit price (6,000.00) where the line total (10,800.00) belonged, and with no plain currency column there was no amount at all. A column now counts as money when its cell draws a number as currency: a `currency` field, a formula declaring `returnType: 'currency'`, or a summary declaring its currency (`currencyConfig`). The first such column the view shows is the amount, as before. A view that presents the field as another type, a masked column and a number-returning formula are still not promoted. Nothing changes on desktop.
