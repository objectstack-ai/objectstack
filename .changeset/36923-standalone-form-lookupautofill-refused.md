---
'@object-ui/fields': patch
---

fix(fields): a `lookupAutofill` written by hand on a standalone form node's field is not run

Clause-②: no
Metadata-protocol: none

`lookupAutofill` is a fact about the object, and it runs where the object is read: in a record form and in a line-item grid column. A lookup on a standalone `form` node whose field carries `lookupAutofill` written by hand now fills nothing when a record is picked. The lookup itself is still set. Before, such a pick copied values into the other fields without the cross-currency rule, so an amount could be copied into a field in another currency with no note. A development build now warns once, naming the field and saying where the key is honoured.

Record forms and grid columns behave as before, the cross-currency rule included. The widget recognises a record form by the stamp the record form puts on its lookups (`withLookupAutofillTargets`). That stamp is now written on every lookup that declares pairs, including when no target is a field of the loaded object, and only a stamp the record form issued counts. A `lookupAutofillTargets` key written as data is ignored.

No metadata key is added or changed. Fix: declare `lookupAutofill` on the object's lookup field and draw the object's form.
