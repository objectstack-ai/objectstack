---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): the object page's 「表单」 tab is now 「字段布局」 (Field layout), edits the object's field groups only, and arranges an installed object into its paired `.custom` package

Clause-②: no
Metadata-protocol: none

The Studio object page's Form tab is renamed 「字段布局」 / Field layout, and says in one sentence where its groups and order are used: the record page, the right-side preview, and the create and edit dialogs. It reads and writes the object's field groups and nothing else; no form view is read or written there.

Group membership and order are saved in each group's own `fields` list. An object still written with a `group` on each field shows its groups as before, and its first save from the tab converts it to the lists, with nothing on the canvas moving.

On an object of an installed (read-only) package the tab is no longer read-only where the customization door is open: adding, renaming, deleting and reordering groups, dragging fields (a field another package brings included) and the group settings all edit the object extension of the base's paired `.custom` package, as the whole `fieldGroups` arrangement (every group listing its members), saved and published by the top bar's Save with the rest of that extension. The original package is not written. A field or group `place` entry of that extension, which a written arrangement replaces, is taken off on save; a tab placement stays. Each field card of an installed object is marked 「原始包」 / Original package, 「本环境」 / This environment, or with the package that contributes it. Where the door is walled the tab stays read-only, as before.

New Studio strings: `engine.studio.data.form.usedOn` and `engine.studio.designer.source.{base,baseTitle,environment,environmentTitle}` (en, zh); `engine.studio.data.form.layoutSource.*` is removed with the chip it labelled.
