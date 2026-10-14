---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): `duplicatePackage` refuses a copied item whose renamed object reference meets a name the item already holds, instead of merging the two

Clause-②: no

`duplicatePackage` (ADR-0070 D4, the package duplicate route's method) renames every copied object into the target namespace and rewrites each reference to it where a property names an object: a string, an array entry, or a record key (a permission set's `objects`, a translation's `objects`).

**FROM.** When a copied item also named the object the copy is about to be called, the renamed name landed on a name the item already held, and the copy merged the two with `failed: []`. A permission set holding `objects: { crm_customer: { allowRead: true }, crm2_customer: { allowRead: true, allowEdit: true, allowDelete: true } }`, duplicated into namespace `crm2`, was copied as `objects: { crm2_customer: { allowRead: true, allowEdit: true, allowDelete: true } }`: whichever entry came last was kept, so one grant was dropped, and here the copied object gained edit and delete the source set never granted on its own object. A translation's `objects` dropped one object's labels the same way. A hook whose `object` list held both names was copied as `['crm2_customer', 'crm2_customer']`, so its handler ran twice per event on the copied object.

**TO.** Such an item is listed in `failed[]`, and nothing of it is written (no item row, no history entry). The entry names the item, the property, the name that moved and the name it met, and the source edit that clears it, for example: "Permission set 'crm_access' is not copied: its `objects` key 'crm_customer' follows the copied object to 'crm2_customer', a key it already holds there, which this copy does not rename. … Remove 'crm_customer' or 'crm2_customer' on the source, then duplicate again." Remove one of the two names on the source item, then duplicate again.

**Unchanged.** An item with no such collision copies as before, its references following the copied objects. An entry the source item itself repeats is copied as stored. The source package is never modified.
