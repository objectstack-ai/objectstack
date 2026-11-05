---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): Studio edits a translation item as a source-to-translation table with its gaps counted

Clause-②: no
Metadata-protocol: none

A `translation` item in Studio now opens on a table for its language: a row per string the package declares (objects, fields, options, apps, navigation, views, actions, dashboards and the rest), the source text beside the translation, grouped by item, with a count such as "37 of 120 untranslated" and an "Untranslated only" filter. The rows come from `collectExpectedEntries` in `@objectstack/lint`, the walk `os i18n extract` and `os lint` use, over the package's declared documents. The platform objects the package points at (for example the user object behind an owner lookup) are included, because their labels ship in a few languages only. A row also counts as translated when another bundle already serves the language at its key.

- Saving writes the same `translation` item to the same place as before (the `.custom` pair on a read-only package): each cell writes the item's JSON at its key. The item's label, language and description stay in the form above the table, and its JSON stays available as an advanced view for what the table does not list (messages, settings UI, metadata forms).
- The "no custom renderer, editing as JSON" notice no longer appears on this page.
- The metadata item list labels an item in a code package's `.custom` pair as customer-written, not as shipped in a code package.
- Labels in English and Chinese.
