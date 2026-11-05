---
'@objectstack/platform-objects': patch
'@objectstack/plugin-security': patch
'@objectstack/plugin-approvals': patch
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-email': patch
'@objectstack/service-settings': patch
---

fix: Setup's form help speaks to an administrator, and the queue pages, the mail status banner and the test-email toast read in Chinese on a zh-CN console

Clause-②: yes (widening)
Metadata-protocol: none

- **Field help (English source and zh-CN):** the permission set and position assignment forms, the out-of-office (approval delegation) rule, and the business unit, organization and user forms no longer describe the implementation. Gone: "fail-closed", "half-open [from, until)", "agent grants", "graph semantics", "expanded by graph queries", "Null = root of tenant", "HRIS", "When true / When false" (zh-CN 「为 true 时」 now reads 「开启后」) and an HTTP status code. The help now says when an assignment starts and ends, what turning a switch on does, and what to fill in. Text only: no field name, key, option value or behaviour changes.
- **`@objectstack/plugin-sharing`:** `sys_queue` and `sys_queue_member` join the plugin's translation bundle, with zh-CN text, so the 队列 and 队列成员 pages, their columns, help and the 新建 button read in Chinese. ja-JP and es-ES carry English fills for now.
- **`@objectstack/plugin-email`:** the live-status statement at the top of Setup → Email and the "Send test email" answer (sent, failed, logged only) are written in the caller's display language, en and zh-CN today; another language gets English.
- **`@objectstack/service-settings`:** a settings action handler (`SettingsActionHandler`) receives an optional `locale`, the caller's display language read from the request the same way the live-status statement's is (`Accept-Language`, else `?locale`); `runAction` takes it as a fifth `display` argument. Existing handlers compile and behave unchanged.
