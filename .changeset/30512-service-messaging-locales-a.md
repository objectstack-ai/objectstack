---
'@objectstack/service-messaging': patch
---

i18n(service-messaging): the notification objects and the digest heading ship in Traditional Chinese, Arabic, French and Brazilian Portuguese

Clause-②: no
Metadata-protocol: none

The messaging objects (`sys_inbox_message`, `sys_notification_receipt`, `sys_notification_delivery`, `sys_notification_preference`, `sys_notification_template`, `sys_http_delivery`, `sys_user_device`) and the digest heading "You have {{count}} notifications" now carry `zh-Hant`, `ar`, `fr` and `pt-BR` beside the existing `en`, `zh-CN`, `ja-JP` and `es-ES`, so a recipient in one of those languages reads the notification screens and the digest heading in their own language instead of English. `t()` selects no plural form, so the Arabic heading is worded as a tally (`عدد الإشعارات لديك: {{count}}`), correct for every count. A recipient whose language is `fr-FR` now reads the `fr` pack. Each new locale is registered under its platform-table tag with its source-hash companion and its messages, and the package's extract command lists the tags, so the existing `check:i18n` bundle check covers them. First half of package 9 of #30512; `ru`, `de` and `ko` follow in the second half.
