---
'@objectstack/platform-objects': patch
---

i18n(platform-objects): the platform objects, Setup, Studio and Account ship in Russian

Clause-②: no
Metadata-protocol: none

`@objectstack/platform-objects` now carries `ru` beside `en`, `zh-CN`, `ja-JP`, `es-ES`, `zh-Hant`, `ar`, `fr` and `pt-BR`: every `sys_*` object (labels, fields, help, options, views, actions and their dialogs), the metadata-type configuration forms Studio opens, the Setup, Studio and Account navigation, the System Overview dashboard and its datasets, the platform pages' titles, and the inline copy on the user and organization record pages. A user whose locale is `ru` no longer reads English `sys_*` labels in the console. The new bundles pass through the same source-hash fallback as the existing ones, and every hand-authored leaf records the digest of the source it was translated from. The extract config documents `ru` in its `--locales`, so `check:i18n` now gates the new bundles.

The French Connect-an-AI-assistant page subtitle (`pages.connect_agent.subtitle`) is retranslated from the current English text, which names Claude and Doubao, and its recorded digest is refreshed; before this, the source-hash fallback served the English sentence to `fr` users because the French leaf had been translated from an older wording. Package 11 of #30512, fifth of seven locales; `de` and `ko` follow.
