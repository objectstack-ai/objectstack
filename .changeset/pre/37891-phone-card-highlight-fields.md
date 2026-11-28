---
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-detail': patch
---

Clause-②: no
Metadata-protocol: none

Phone list cards now follow the object's `highlightFields`. When an object declares them, a card's amount is the first of those fields that draws as money, and its subtitle is the next three, in that order, with empty values dropped and each number, currency or percent part under its field label (`Quantity 2 · Sales Price ¥6,000.00 · Discount % 10.00%`). The view's column order no longer decides the card, so an order line that declares `highlightFields: ['total_price', 'quantity', 'unit_price', 'discount']` shows its line total bottom right while its wide table keeps its columns. A highlighted field no column shows is drawn too: the grid's own fetch, the list page's fetch and the related list's fetch now ask for the object's `highlightFields` beside its name field, through the same field-level security gate.

This changes the phone card of every object that declares `highlightFields` and shows its fields in a different order, or shows more than two of them: review an object's `highlightFields` order if its phone list now reads differently. An object without `highlightFields` keeps the column-order card. Nothing changes on desktop tables, apart from the fetch asking for the highlighted fields.
