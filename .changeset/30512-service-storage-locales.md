---
'@objectstack/service-storage': patch
---

i18n(service-storage): the file and upload-session objects ship in all eleven platform languages

Clause-②: no
Metadata-protocol: none

`sys_file` and `sys_upload_session` now carry Traditional Chinese (`zh-Hant`), Arabic (`ar`), French (`fr`), Brazilian Portuguese (`pt-BR`), Russian (`ru`), German (`de`) and Korean (`ko`) beside the existing `en`, `zh-CN`, `ja-JP` and `es-ES`, so a reader in one of those languages sees the file and upload screens in their own language instead of English. Each new locale is registered under its platform-table tag with its source-hash companion, and the package's extract command lists the seven tags, so the existing `check:i18n` bundle check covers them. Package 10 of #30512.
