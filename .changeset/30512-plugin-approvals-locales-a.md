---
'@objectstack/plugin-approvals': patch
---

i18n(plugin-approvals): the approval objects, notifications, record page and e-mail link line ship in Traditional Chinese, Arabic, French and Brazilian Portuguese

Clause-②: no
Metadata-protocol: none

The approval objects (`sys_approval_request`, `sys_approval_action`, `sys_approval_delegation`), the approval notifications' sentences, the approval request record page (its label and its Details / Timeline tabs) and the line that opens an approval from its e-mail now carry `zh-Hant`, `ar`, `fr` and `pt-BR` beside the existing `en`, `zh-CN`, `ja-JP` and `es-ES`, so an approver or submitter in one of those languages reads the approval screens, notices and e-mails in their own language instead of English. Each new locale is registered under its platform-table tag with its source-hash companion, its page entry and its messages, and the package's extract command lists the tags, so the existing `check:i18n` bundle check covers them. The e-mail templates' shape, the template selection and `EMAIL_TEMPLATE_FLOOR_LOCALE` are unchanged; only the link line is added per locale. First half of package 9 of #30512; `ru`, `de` and `ko` follow in the second half.
