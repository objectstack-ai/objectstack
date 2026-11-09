---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): the Studio publish sheet names a batch of hooks or translations in words ("3 hooks", zh 「钩子 3」) instead of the raw type code ("3 hook") (#29902)

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/i18n`**: two new count families in every pack, `preview.changes.typeCount.hook` and `preview.changes.typeCount.translation`, with each CLDR slot the pack's language selects.
- **`@object-ui/app-shell`**: the Pending changes / publish sheet's summary line and group headings read those families for `hook` (authored in an object's Hooks tab) and `translation` (authored in Studio's "All metadata" form editor). A type with no family still shows its raw name.
