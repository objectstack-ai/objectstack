---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/components': patch
---

feat(console): 「Configure tabs」 on an installed object writes its paired `.custom` package, marks where each tab comes from, and opens the record's 「…」

Clause-②: yes (widening)
Metadata-protocol: none

On the record page of an object of an installed (read-only) package, a workspace administrator who may author metadata now finds 「Configure tabs」 too, where the customization door does not wall them off (the walled `group` / `isolated` postures leave it to the platform operator). Its 「Save」 writes the `relatedLists` of the object extension of the base's paired `.custom` package in the spec's shape (ADR-0146 D10): every shown tab in order, a built-in tab by its bare name, and every hidden related tab written `{ list, hidden: true }`; the pair is created on the first save by the ensure door, as Studio creates it. The extension is written over what the pair stores, with only its `relatedLists` replaced (`fields`, `fieldPatches`, `place` and `fieldGroups` kept), as a draft with the first-write pin, then published; a refused publish discards that draft. The original package is not written.

On an installed object every tab can be moved: the object's own lists, a list another package brings, and the built-in 附件 / 审批 / 动态. A related tab can be hidden and shown again; a built-in tab cannot be hidden there (the `.custom` list cannot hide it), and an attachments tab the base hides waits in 「Hidden」, from which it can be shown. Each related tab is marked 「Original package」, 「From <package>」 or 「This environment」, read from the child object's package and the relationship field.

A tab's stored title is kept when the administrator did not rename it, on self-built and installed objects alike: the name the editor shows is the served one, which the read translates for the reader's language.

The write is one shared helper, `saveObjectExtensionArrangement`, which replaces only the arrangement keys a caller returns (`relatedLists` here; `fieldGroups` for a field-layout editor).

`page:header`: a host `⋯` entry declaring `leadsMenu: true` is drawn first, ahead of Refresh; an authored action cannot claim the place. The record page's 「Configure tabs」 declares it, so it is the first item of the record's 「…」.

New language-pack keys under `designMode.recordTabs` (`pairNotWritable`, `builtinMoves`, `sourceBase`, `sourcePackage`, `sourceEnvironment`) in all eleven console locales.
