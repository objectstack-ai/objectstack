---
'@object-ui/components': patch
---

fix(components): an opening lookup autofill no longer clears the seeded relationship pair two dependsOn levels deep

Clause-②: no
Metadata-protocol: none

A related tab's New seeds the child's relationship lookup and the lookup it is scoped by. When that second lookup is itself scoped by a third field and fills that field from its record (`lookupAutofill`), the form used to read the fill as the user changing the field: its dependent-lookup clear emptied the seeded lookup, the emptied lookup emptied the relationship lookup, and the child saved unlinked from its parent with no error. The fill a create form makes from the value it opened with is now treated as part of the opening values, like a record landing, and clears nothing. A user's own change of any of those fields still clears the lookups it scopes, and so does a fill made by a user's pick.
