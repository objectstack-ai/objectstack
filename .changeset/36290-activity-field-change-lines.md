---
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

feat(record-page): each changed field is its own line under an activity entry, `Label: old → new`

Clause-②: yes (widening) — four new `detail.*` language-pack keys in every locale `@object-ui/i18n` ships (`fieldChangeLabel`, `fieldChangeEmpty`, `fieldChangeExpand`, `fieldChangeCollapse`), and four new optional props on the exported `FieldChangeItem` (`label`, `oldText` / `newText`, `emptyLabel`, `expandLabel` / `collapseLabel`); nothing is removed or renamed
Metadata-protocol: none

The record page's activity named a saved change by its fields only (「更新了 客户备注」), or carried every value on one cut line. An activity entry now reads as the fields it changed, with one line per changed field under it: `Customer notes: Old words → New words`. A save that changed the phone and the email is one entry with two lines.

- The values come from the field-change code the server already serves on each `sys_activity` row (`metadata.summary_message`), narrowed per reader by plugin-audit: a field the reader may not read has no change in it, so it draws no line. Nothing new is read, and nothing is filtered in the browser.
- An empty side reads as the language pack's word for empty (`Empty`, `空`), never the stored `∅`.
- A select side reads as the field's option label in the reader's language; a lookup or user side reads as the record's name the server served; a yes/no reads as the pack's Yes / No.
- Each side is cut to its line. A side that does not fit, or holds more than one line, offers a control that shows both sides in full and one that cuts them again.
- An audit-log entry (objects with `enable.trackHistory`) draws its changes the same way, and an activity row paired with its audit entry keeps its own summary with the audit's lines under it. The record's creation is unchanged: one row with its values beside the summary.
- The compact one-line text of a change (the activity panel's peek rows) now reads `Label: old → new` with the same words, where it read `Label old → new` with `—` for empty.

What does not change: which entries the activity shows, how consecutive edits by one person on one day fold into one row, the activity filters, and no metadata key, value or default.
