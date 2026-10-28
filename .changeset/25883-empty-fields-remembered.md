---
'@object-ui/react': patch
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

fix(plugin-detail): the record page remembers "Show empty fields" per user and object

Clause-②: no
Metadata-protocol: none

On a record page, each section's "Show N empty fields" row used to open that one section only, and the choice was gone after a reload or on the next record. A reader who wanted the whole record clicked once per section, every time.

What changes:

- In the Console, the choice is now the signed-in user's, per object. One click shows the empty fields in every section of that object's record page. The choice holds on the next record of the same object, after a reload and on another device. Other objects keep their own choice.
- It is stored in a `sys_user_preference` row per object, key `ui.record.<object>`, with the value `{ "showEmptyFields": true }` or `false`. The row sits beside the list page's `ui.list.<object>` rows and loads in the same single preference read.
- `@object-ui/react` adds `RecordPagePreferencesProvider`, `useRecordPagePreferences` and the `RecordPagePreference` and `RecordPagePreferencesStore` types. A host uses them to hand its store to the record page's sections.
- With no store (no signed-in user, or a host that provides none), each section keeps the toggle in its own state, as before.

What to do: nothing. Nothing a view or object declares changes.
