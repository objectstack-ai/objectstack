---
'@object-ui/fields': patch
---

fix(fields): a `lookupAutofill` written by hand on a standalone form node's field is not run

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: `lookupAutofill` on a form field was never in a declared accept set. What narrows is a runtime export of @object-ui/fields, `readLookupAutofillTargets`, whose consumer is code calling it, not metadata an upgrade could rewrite. -->

`lookupAutofill` is a fact about the object, and it runs where the object is read: in a record form and in a line-item grid column. A lookup on a standalone `form` node whose field carries `lookupAutofill` written by hand now fills nothing when a record is picked. The lookup itself is still set. Before, such a pick copied values into the other fields without the cross-currency rule, so an amount could be copied into a field in another currency with no note. A development build now warns once, naming the field and saying where the key is honoured.

Record forms and grid columns behave as before, the cross-currency rule included. The widget recognises a record form by the stamp the record form puts on its lookups (`withLookupAutofillTargets`). That stamp is now written on every lookup that declares pairs, including when no target is a field of the loaded object, and only a stamp the record form issued counts. A `lookupAutofillTargets` key written as data is ignored.

No metadata key is added or changed. Fix: declare `lookupAutofill` on the object's lookup field and draw the object's form.

**BREAKING** (`@object-ui/fields`, runtime export): `readLookupAutofillTargets(field)` now answers only for a target map that `withLookupAutofillTargets` issued.

- FROM: `readLookupAutofillTargets(field)` returned any non-array object found under the field's `lookupAutofillTargets` key.
- TO: it returns only the map `withLookupAutofillTargets` stamped, which is what the record form does. A same-name key written by hand reads `undefined`. `withLookupAutofillTargets` now also stamps a lookup whose pairs name no field of the map it is given, with an empty map. Before, it returned the field unchanged.
- Fix: stamp the field through `withLookupAutofillTargets`, as the record form does. If you need the raw value, read `field.lookupAutofillTargets` directly.
