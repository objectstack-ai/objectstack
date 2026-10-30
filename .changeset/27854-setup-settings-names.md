---
'@objectstack/platform-objects': patch
'@objectstack/plugin-audit': patch
---

fix(platform-objects): the Setup sidebar names each settings page the way the settings hub does, and lists every page the hub lists; Notification Events and the audit action read in words

Clause-②: no
Metadata-protocol: none

- **One name per settings page.** The Setup sidebar's Configuration entries now carry the hub card's title in every shipped locale. In English, "Email" becomes "Mail Delivery". In zh-CN, ja-JP and es-ES the mail, company, file storage and feature flags entries take the hub's wording (for example 邮件 becomes 邮件投递, 公司信息 becomes 公司).
- **The same set of pages.** SMS Delivery (`nav_settings_sms`) and Data Lifecycle (`nav_settings_lifecycle`) gain sidebar entries; until now they were reachable only through "All Settings". Both require `manage_platform_settings`, as their settings namespaces do.
- **Notification Events.** Severity options read Info / Warning / Critical, and Source Object is drawn as the object's label (the `object-ref` widget the sharing rules use) instead of its api name. The stored values are unchanged: severity keeps `info` / `warning` / `critical`, and the field still stores the object name.
- **Audit action.** Each `sys_audit_log.action` option carries a label ("Config Change" for `config_change`, "Login Failed" for `login_failed`, …), so the English list, detail and System Overview's "Audit Events by Action" chart no longer show the codes. The stored values are unchanged.
