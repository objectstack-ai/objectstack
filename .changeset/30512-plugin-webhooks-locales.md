---
'@objectstack/plugin-webhooks': patch
---

i18n(plugin-webhooks): the webhook object's labels, help, options and views ship in all eleven platform languages

Clause-②: no
Metadata-protocol: none

`sys_webhook` now carries Traditional Chinese (`zh-Hant`), Arabic (`ar`), French (`fr`), Brazilian Portuguese (`pt-BR`), Russian (`ru`), German (`de`) and Korean (`ko`) beside the existing `en`, `zh-CN`, `ja-JP` and `es-ES`, so an administrator reading Setup in one of those languages sees the webhook screens in their own language instead of English. Each new locale is registered under its platform-table tag with its source-hash companion, and the package's extract command lists the seven tags, so the existing `check:i18n` bundle check covers them. Part of #30512.
