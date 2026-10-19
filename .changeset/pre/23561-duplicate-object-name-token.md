---
'@objectstack/metadata-protocol': patch
---

`duplicatePackage` no longer renames, in free text, a name that is both a prefixed package object and a field key of one of the package's objects. Such a name (for example a field keyed `acme_deal` on the object `acme_deal`) may name the field, so it is now rewritten only at object-reference properties (`object`, `reference`, `objectName`, a permission set's `objects` keys, …), the way a bare object name already is. A copied list view's `columns` and a copied form's `sections[].fields` keep naming the field the copy has, instead of a field named after the renamed object: the list view is no longer refused at the copy with `list-view-field-unknown`, and the form no longer copies a field the copy does not have. Free text naming such an object (a description) is left as stored; a prefixed object no field key spells is still renamed in free text as before.
