---
'@objectstack/platform-objects': patch
---

i18n(platform-objects): the platform objects, Setup, Studio and Account ship in French

Clause-②: no
Metadata-protocol: none

`@objectstack/platform-objects` now carries `fr` beside `en`, `zh-CN`, `ja-JP`, `es-ES`, `zh-Hant` and `ar`: every `sys_*` object (labels, fields, help, options, views, actions and their dialogs), the metadata-type configuration forms Studio opens, the Setup, Studio and Account navigation, the System Overview dashboard and its datasets, the platform pages' titles, and the inline copy on the user and organization record pages. A user whose locale is `fr` no longer reads English `sys_user` field labels inside French sentences, as the Home feed showed them (`A modifié Utilisateur « … » : Banned et Ban Reason`). The new bundles pass through the same source-hash fallback as the existing ones, and every hand-authored leaf records the digest of the source it was translated from. The extract config documents `fr` in its `--locales`, so `check:i18n` now gates the new bundles. Package 11 of #30512, third of seven locales; `pt-BR`, `ru`, `de` and `ko` follow.
