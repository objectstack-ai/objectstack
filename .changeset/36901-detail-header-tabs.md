---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): a metadata item fills the content pane under one detail header, and its tools are tabs instead of side sheets

Clause-②: no
Metadata-protocol: none

Studio's generic item page and the form editor of an email template or a translation now draw the shared Studio detail header: × back to the type's list (its search, filters, sort and package scope kept), ‹ › to the previous and next item in the list's order with "index / total", the type and source package as chips, and the page's actions at the right. Both × and ‹ › ask first when the page holds unsaved edits; the browser's Back is not intercepted.

The six side sheets of the generic item page are tabs of the page: Details, Preview (a type with an editing canvas), Related (a type with anchors), Referenced by, History (the versions with rollback, and the audit log read inside it; shown to a caller who may read the authoring trail) and Source (the JSON source, and the layered comparison read inside it, for read-only callers too). The open tab is in the address as `?tab=`; the values the sheets wrote still open the same place (`?tab=layers` opens Source on the layers, `?tab=audit` opens History on the audit log). The draft review is a status chip in the header while a draft is pending, and `?review=1` still opens it.

On a type with a canvas the page opens on Preview; Details shows the whole item's form. Both edit one draft, and one Save (the header's button, ⌘S or autosave) saves it whichever tab is open, so a tab switch keeps every unsaved edit.

The address `/studio/PACKAGE/metadata/TYPE/NAME/history` opens the item on its History tab; the permission set, whose item page is its own matrix editor, and an item a pillar's designer opens (a flow, an object) keep the standalone history page there.

New in `@object-ui/app-shell`: `item-tools/ItemToolTabs.tsx` (the tab strip, the address helpers and the References, History and Source panels, for the designers to mount) and `metadata-admin/ResourceDetailHeader.tsx`. New locale keys `engine.studio.itemTabs.*` in the studio catalogue (en, zh). No metadata changes; nothing to migrate.
