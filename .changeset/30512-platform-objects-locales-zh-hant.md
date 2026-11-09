---
'@objectstack/platform-objects': patch
---

i18n(platform-objects): the platform objects, Setup, Studio and Account ship in Traditional Chinese

Clause-②: no
Metadata-protocol: none

`@objectstack/platform-objects` now carries `zh-Hant` beside `en`, `zh-CN`, `ja-JP` and `es-ES`: every `sys_*` object (labels, fields, help, options, views, actions and their dialogs), the metadata-type configuration forms Studio opens, the Setup, Studio and Account navigation, the System Overview dashboard and its datasets, the platform pages' titles, and the inline copy on the user and organization record pages. An administrator or developer reading the platform in Traditional Chinese no longer sees it in English. The new bundles pass through the same source-hash fallback as the existing ones, and every hand-authored leaf records the digest of the source it was translated from. The extract config documents `zh-Hant` in its `--locales`, so `check:i18n` now gates the new bundles. Package 11 of #30512, first of seven locales; `ar`, `fr`, `pt-BR`, `ru`, `de` and `ko` follow.
