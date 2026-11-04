---
'@object-ui/plugin-list': patch
'@object-ui/app-shell': patch
---

feat(plugin-list): a reader can add any field they may read to their own list from the Hide Fields popover (#30077)

Clause-②: no
Metadata-protocol: none

The Hide Fields popover on a Console object list (the toolbar's, and the Hide Fields section of the Display panel) listed only the columns the view already has, so a reader who wanted another field on their list had to ask an administrator to change the view for everyone. After the view's columns it now lists every other field of the object the reader may read, unticked: business fields first, then system fields such as Owner. A field the reader may not read is not offered, and neither is a field the object definition marks `hidden`. Ticking one adds it as a column of the reader's own list; unticking it takes it off again.

The addition is the reader's personalization, stored beside their hidden fields in their `ui.list.<object>` preference row (`perView.<view>.addedFields`), never written into the view: another user sees the view's columns, and "Reset to view" drops it with the rest of the reader's list. While it is stored the list's Personalized marker names "Column layout". An added column is fetched, expanded and drawn like a declared one, so a lookup field shows its related record's name.

It is offered wherever a Hide Fields choice is stored: a view that declares `columns`, and a saved view. On a system view or fallback tab that declares no columns the popover lists the view's columns alone, as before.

For a `ListView` host: two new host props, `addedFields` (the names among `schema.columns` the reader added) and `onAddedFieldsChange` (the door that stores them). Without `onAddedFieldsChange` the popover is exactly what it was. No metadata key and no spec change.
