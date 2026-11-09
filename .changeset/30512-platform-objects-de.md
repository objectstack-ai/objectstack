---
'@objectstack/platform-objects': patch
---

i18n(platform-objects): the platform objects, Setup, Studio and Account ship in German

Clause-②: no
Metadata-protocol: none

`@objectstack/platform-objects` now carries `de` beside `en`, `zh-CN`, `ja-JP`, `es-ES`, `zh-Hant`, `ar`, `fr`, `pt-BR` and `ru`: every `sys_*` object (labels, fields, help, options, views, actions and their dialogs), the metadata-type configuration forms Studio opens, the Setup, Studio and Account navigation, the System Overview dashboard and its datasets, the platform pages' titles, and the inline copy on the user and organization record pages. A user whose locale is `de` no longer reads English `sys_*` labels in the console. The new bundles pass through the same source-hash fallback as the existing ones, and every hand-authored leaf records the digest of the source it was translated from. The extract config documents `de` in its `--locales`, so `check:i18n` now gates the new bundles. Package 11 of #30512, sixth of seven locales; `ko` follows.
