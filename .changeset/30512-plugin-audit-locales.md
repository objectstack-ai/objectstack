---
'@objectstack/plugin-audit': patch
---

i18n(plugin-audit): the audit, activity and comment objects and the activity-feed sentences ship in all eleven platform languages

Clause-②: no
Metadata-protocol: none

`sys_audit_log`, `sys_activity`, `sys_comment` and `sys_comment_reaction` now carry Traditional Chinese (`zh-Hant`), Arabic (`ar`), French (`fr`), Brazilian Portuguese (`pt-BR`), Russian (`ru`), German (`de`) and Korean (`ko`) beside the existing `en`, `zh-CN`, `ja-JP` and `es-ES`, and so do the activity-feed summaries ("Created … ", "Updated …: fields", "… mentioned you"). A reader in one of those languages sees the audit trail, the activity feed and the mention notice in their own language instead of English. Each new locale is registered under its platform-table tag with its source-hash companion and its messages, and the package's extract command lists the seven tags, so the existing `check:i18n` bundle check covers them. Part of #30512.
