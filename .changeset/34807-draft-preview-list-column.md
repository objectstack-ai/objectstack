---
'@object-ui/plugin-list': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): under draft preview, a list column on a field that exists only in the draft no longer makes the whole list fail

Clause-②: yes (widening — one new @object-ui/i18n `list.*` key only; no exported prop, no typed interface member; the `_draftOnly` field marker is an internal undeclared key on an untyped value)
Metadata-protocol: none

Under `?preview=draft` a list view may show a column on a field the draft adds. The data door validates every `$select`, `$filter`, `$orderby` and `$searchFields` name against the published object, so that one column made it refuse the whole list query with `400 INVALID_FIELD`. In draft preview the console's list pages (the object view, `/:objectName/data` and interface list pages) now hand the list a data source whose `getObjectSchema` answers the published object definition plus each draft-only field, with its draft label and the marker `_draftOnly: true`, the published sortability projection kept. Outside preview they hand the list the adapter itself, unchanged. The data contract is unchanged: data reads never see a draft schema.

`@object-ui/plugin-list`: `ListView` leaves a field marked `_draftOnly` out of `$select`, `$expand`, `$filter` and `$orderby` (and out of the `$searchFields` it sends with a search term, and a server export's fields), and out of the Filter panel and Sort picker. Its column is drawn empty under the field's draft label. A sort or filter that names such a field is left out of the request, and one line above the rows says so (`list.draftOnlyQueryDropped`). `_draftOnly` is an underscore-private convention between the console and this package, never an authoring key; nothing new is exported.

`@object-ui/i18n`: new key `list.draftOnlyQueryDropped` in every locale.
