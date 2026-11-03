---
'@object-ui/app-shell': patch
---

fix(app-shell): an optional choice row in a Studio metadata form can be cleared again

Clause-②: no
Metadata-protocol: none

- **A "— None —" item on optional enum selects.** Both builtin select paths of the metadata-admin `SchemaForm` (a form row's `options`, and a schema property's own `enum`) listed only the enum values, so once an author picked a value on an optional key, the form had no way back to "declares nothing". An optional row now leads with "— None —" (the `engine.form.none` word the metadata-admin pickers already use). Choosing it writes the key as absent, through the form's existing clear convention. A required row, and one element of a list of choices, are unchanged: they offer no None item.
- **Clears in an inspector's "More fields" form are kept.** The action, dashboard, hook, page and report editors pass their "More fields" form's changes to a host that merges them over the draft. A key the form cleared was merely missing from that change, so the merge kept the old value: a None pick, or an emptied text box, was undone at once. The cleared keys now reach the draft as absent, and the saved metadata no longer carries them.
