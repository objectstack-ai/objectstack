---
'@object-ui/fields': patch
---

fix(fields): the filter-condition builder takes no edit until the object's schema has answered, so a number bound is never saved as text

Clause-②: no
Metadata-protocol: none

The criteria builder (the `filter-condition` widget a sharing rule's criteria uses) shows a stored criteria as soon as it opens, but it reads the object's field types from a schema request that answers later. Until that answer arrived, a value box was a plain text box, and a number typed into it was saved as text: `{"amount":{"$gt":"6"}}` instead of `{"amount":{"$gt":6}}`. Once the answer arrived, the box changed to a number box but the text already saved stayed. The server reads such a value as the number it spells, so this changed no rule's matches. It did make the saved document depend on whether the admin typed before or after a network read.

The builder's controls are now disabled while that request is in flight, and nothing is emitted from them. When the answer arrives they are enabled, and each value box has its column's type. If the request fails, the builder is released with no field types, as before. A host that offers no schema request never holds the builder. The raw-JSON editor is not held.

No metadata key, value or default changes. A criteria already saved is not rewritten.
