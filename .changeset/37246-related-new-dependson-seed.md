---
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
'@object-ui/console': patch
---

fix(console): a related tab's New keeps the parent it prefills when the child's relationship lookup declares `dependsOn`

Clause-②: yes (widening) — one new export, `relatedCreateSeedOf`, on the published `@object-ui/plugin-detail/core` subpath; nothing is removed or renamed, and the package root exports the same names as before
Metadata-protocol: none

On a record page's related tab, New (the header's, or the one inside the Add picker) opened the child's create form with the parent linked and nothing else. When the child's relationship lookup declares `dependsOn` (a billing milestone's order `dependsOn` the milestone's account), the form drew that lookup gated ("Select Account first") with the parent hidden, or, with a `lookupAutofill` that fills the account from the order, filled the account and then emptied the order, and Create saved the child without its parent and without an error.

The New now opens with each `dependsOn` field of the relationship lookup seeded from the parent record — the child's field takes the parent's value, the same pairs the derived Add picker scopes its candidates by. The parent stays visible and is saved. A `dependsOn` field that is itself a lookup with a `dependsOn` and a `lookupAutofill` of its own can still be emptied by the form's dependent-lookup clear when the form opens; that clear is tracked separately. A relationship lookup without `dependsOn`, or a parent with no value for it, opens with the parent link alone, as before; the Add picker's scope is unchanged.

- The record-form overlay's `formLink` URL parameter repeats: the parent pair first, then one `field:value` pair per seeded value, so a refresh reopens the form with all of them.
- `@object-ui/plugin-detail/core` exports `relatedCreateSeedOf(childFields, referenceField, parentRecord)`, the values a related New opens with beside the parent link.
- A custom page's related lists, which each bind a parent of their own, still open New with the parent link alone.
