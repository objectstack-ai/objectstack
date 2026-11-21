---
'@object-ui/components': patch
'@object-ui/fields': patch
'@object-ui/plugin-grid': patch
---

feat(fields): typed values edit flat in their list cell, a record picker opens its list in place, and a rating is set without an editor

Clause-②: yes (widening)
Metadata-protocol: none

In the list grid's cell editor (the layer over the cell, `inCell`):

- Text, email, phone, URL, number, currency and percent are the cell itself: one row tall, square, with no border, fill or shadow of their own, the layer's 2px frame the only line around them (square and flat even under a host theme that rounds and lifts every dialog with `!important`). The box starts as wide as its column and grows to the right with the text, over the next cells, without moving them. Numbers are right-aligned and raw (`34500.5`, not `34,500.50`); a currency shows its code before the amount; a percent shows its points and a `%`, without the slider. The grid's built-in text and number editors take the same flat look.
- A lookup, master-detail or user cell opens its searchable candidate list at once (recently used first, then results); a pick is the whole edit. Under the list, Browse all records opens the full record picker (classic lookups, gated by `dependsOn` like the list), and Clear is offered while the cell holds a value.
- On a select-first grid a rating opens no editor: a digit key sets that many stars (0 clears, capped at the field's scale), a click on a star of the already selected cell sets it, and Backspace or Delete clears it. `GridCellFacts` gains the optional `stars` fact a host sets for this (`ObjectGrid` sets it for `rating` fields).
- The record pickers' local "recently used" ring is kept per signed-in user as well as per object, so two accounts in one browser no longer share it.

Forms, dialogs and the record page draw these widgets as before. No i18n key is added.
