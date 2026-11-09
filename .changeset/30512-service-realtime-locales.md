---
'@objectstack/service-realtime': patch
---

i18n(service-realtime): the presence object's labels, help and option names ship in all eleven platform languages

Clause-②: no
Metadata-protocol: none

`sys_presence` now carries Traditional Chinese (`zh-Hant`), Arabic (`ar`), French (`fr`), Brazilian Portuguese (`pt-BR`), Russian (`ru`), German (`de`) and Korean (`ko`) beside the existing `en`, `zh-CN`, `ja-JP` and `es-ES`, so a reader in one of those languages sees the object's labels in their own language instead of English. Each new locale is registered under its platform-table tag and carries its source-hash companion, and the package's extract command lists the seven tags, so the existing `check:i18n` bundle check covers them. Part of #30512.
