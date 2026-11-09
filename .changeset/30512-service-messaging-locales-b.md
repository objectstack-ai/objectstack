---
'@objectstack/service-messaging': patch
---

i18n(service-messaging): the notification objects and the digest heading ship in Russian, German and Korean

Clause-②: no
Metadata-protocol: none

The messaging objects and the digest heading "You have {{count}} notifications" now carry `ru`, `de` and `ko` as well, so the package ships all eleven platform languages. `t()` selects no plural form, so the Russian heading is worded as a tally (`Уведомлений: {{count}}`), correct for every count. Each new locale is registered under its platform-table tag with its source-hash companion and its messages, and the package's extract command lists the tags, so the existing `check:i18n` bundle check covers them. Second half of package 5 of #30512.
