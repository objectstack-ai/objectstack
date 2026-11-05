---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(ui): Setup's everyone note and header tags speak to an administrator

Clause-②: no
Metadata-protocol: none

- **Assigned users of a permission set:** a set the everyone position distributes now says 「所有登录成员都持有此权限集。」 / "Every signed-in member holds this set." It no longer names the everyone anchor.
- **Setup list header tags:** three tags now say what they mean for the administrator reading the page, in all ten language packs. Admin config becomes "Configured here" (zh 「在此配置」), Platform schema becomes "Built in · editable" (zh 「平台预置 · 可编辑」), and Identity becomes "Via identity service" (zh 「经身份服务写入」). The tooltip text and the rule for when a tag is drawn do not change.
