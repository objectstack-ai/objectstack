---
'@objectstack/service-mailbox': patch
---

i18n(service-mailbox): the mailbox objects' labels, help, options and views ship in all eleven platform languages

Clause-②: no
Metadata-protocol: none

The mailbox objects (`sys_mailbox`, `sys_mail_message` and `sys_mail_association`) now carry Traditional Chinese (`zh-Hant`), Arabic (`ar`), French (`fr`), Brazilian Portuguese (`pt-BR`), Russian (`ru`), German (`de`) and Korean (`ko`) beside the existing `en`, `zh-CN`, `ja-JP` and `es-ES`, so a user reading the app in one of those languages sees the mailbox screens in their own language instead of English. RFC 5322 header names (`Message-ID`, `In-Reply-To`, `Reply-To`, …) and the IMAP `UIDVALIDITY` term stay as written, as they already do in `zh-CN`. Each new locale is registered under its platform-table tag with its source-hash companion, and the package's extract command lists the seven tags, so the existing `check:i18n` bundle check covers them. Part of #30512.
