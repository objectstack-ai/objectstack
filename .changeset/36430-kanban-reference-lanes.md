---
'@object-ui/plugin-kanban': patch
---

fix(kanban): a board grouped by a lookup, user, master-detail or tree field draws one lane per referenced record

The board reads the lane field off records fetched with `$expand`, so a reference field's value is the referenced record, not its key. The lanes were built from the stringified value: one lane per card, every one titled "[object Object]", each holding every card. A lane on a reference field is now keyed by the foreign key and titled by the referenced record's name (the field's `displayField`, then the target object's `nameField`, then the shared record-title ladder); cards bucket by the foreign key, also into declared `columns` keyed by it; a drag to another lane writes the foreign key, and the moved card keeps naming its new value until the board refetches. A card with no value is drawn in "Uncategorized", as before; a data-derived board no longer draws a lane titled "null" for it.
