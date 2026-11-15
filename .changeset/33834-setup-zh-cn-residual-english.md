---
'@objectstack/plugin-audit': patch
'@objectstack/service-settings': patch
---

fix(i18n): Setup no longer shows five audit actions and five AI settings help lines in English under a translated locale

Clause-②: no
Metadata-protocol: none

The audit actions `package_unmanaged_import`, `credential_use`, `scim_refused`, `audit_signing_key_change` and `dataset_query` were still the English extract fill in all ten translated locales, so the audit log, its detail and the System Overview "Audit Events by Action" chart and table named them in English (for example "Credential Use" under zh-CN). They are now translated in zh-CN, zh-Hant, ja-JP, ko, es-ES, fr, de, pt-BR, ru and ar.

On the AI settings page, the help under the conversation-title toggle ("When on, the LLM is asked to produce a short title …") had no translation in any locale, and neither had the model help of the DashScope and Cloudflare AI Gateway providers; zh-CN also lacked the OpenRouter API key hint. All of them are now translated. Only translation values change: no setting, key or audit action is added or removed.
