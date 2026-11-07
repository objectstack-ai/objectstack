---
'@objectstack/platform-objects': patch
---

i18n(platform-objects): the platform objects, Setup, Studio and Account ship in Arabic

Clause-②: no
Metadata-protocol: none

`@objectstack/platform-objects` now carries `ar` beside `en`, `zh-CN`, `ja-JP`, `es-ES` and `zh-Hant`: every `sys_*` object (labels, fields, help, options, views, actions and their dialogs), the metadata-type configuration forms Studio opens, the Setup, Studio and Account navigation, the System Overview dashboard and its datasets, the platform pages' titles, and the inline copy on the user and organization record pages. An administrator or developer reading the platform in Arabic no longer sees it in English. The new bundles pass through the same source-hash fallback as the existing ones, and every hand-authored leaf records the digest of the source it was translated from. The extract config documents `ar` in its `--locales`, so `check:i18n` now gates the new bundles. Package 11 of #30512, second of seven locales; `fr`, `pt-BR`, `ru`, `de` and `ko` follow.
