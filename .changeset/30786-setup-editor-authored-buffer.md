---
'@object-ui/app-shell': patch
---

fix(app-shell): Setup's metadata editor edits a view, an app or a dashboard as its author wrote it, not as the console is served it

Clause-②: no
Metadata-protocol: none

Setup's metadata editor (`MetadataResourceEditPage`) took the editable copy of every type but `object` from the `?state=draft` read, which the server translates into the console's language. In a Chinese console the first save of a published view, app or dashboard was correct, but the refresh after it installed the translated draft, so the next save stored the Chinese text (a view's label, an app's navigation labels, a dashboard's widget titles) as the author's own, and English readers then saw Chinese. The editor now takes the copy from the layered read for every type whose served reads are translated (`TRANSLATABLE_METADATA_TYPES`, the set the server itself translates by): the pending draft as stored (`draft`) when one is pending, otherwise the published item as authored (`overlay ?? code` for an object, `effective ?? code` for the others, which the layered read serves untranslated). That covers pages, reports, actions, datasets, picklists, positions, permission sets and books the same way. When a draft is pending but the layered read does not carry it, the editor installs nothing, shows the existing "draft unreadable" refusal and sends nothing, as it already did for objects. Types the server does not translate keep their editor exactly as it was.
