---
'@objectstack/plugin-sharing': patch
---

i18n(plugin-sharing): the sharing and queue objects ship in all eleven platform languages

Clause-②: no
Metadata-protocol: none

The sharing objects (`sys_record_share`, `sys_sharing_rule`, `sys_share_link`) and the queue objects (`sys_queue`, `sys_queue_member`) now carry `zh-Hant`, `ar`, `fr`, `pt-BR`, `ru`, `de` and `ko` beside the existing `en`, `zh-CN`, `ja-JP` and `es-ES`, so an administrator in one of those languages reads the sharing and queue screens in their own language instead of English. Each recipient option reads the same on every object within a locale. Each new locale is registered under its platform-table tag with its source-hash companion, and the package's extract command lists the tags, so the existing `check:i18n` bundle check covers them. Package 8 of #30512.
