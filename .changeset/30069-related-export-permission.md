---
'@object-ui/plugin-detail': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
---

fix(plugin-detail): a record page's related table offers Export only to a reader the list page offers it to, and an export refusal reads in the Console's language

Clause-②: no
Metadata-protocol: none

- **`@object-ui/plugin-detail`: the related table asks the list page's question.** The enlarged related list (the record page's active tab) drew Export whenever its data source could export. It now also reads the child object's effective API operation set (`/me/permissions` `apiOperations`) through `usePermissions()`, the source the list page's `exportPermitted` reads, and draws no Export when that set leaves `export` out. A missing set keeps the button, as on the list page. A reader who may export still exports this relation's rows alone.
- **Export refusals read in the Console's language.** When the export route still refuses (a 403, such as `EXPORT_NOT_PERMITTED`), the related table, the list page and the grid show the new `view.exportNotPermitted` sentence in the reader's language instead of the route's English text. Other export failures keep the server's sentence.
- **`@object-ui/i18n`: `view.exportNotPermitted`** in all ten locale packs.
