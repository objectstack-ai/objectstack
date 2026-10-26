---
'@objectstack/plugin-security': patch
---

The built-in permission sets' names are shown in Chinese, Japanese and Spanish

Clause-②: no
Metadata-protocol: none

Setup → Permission Sets showed the platform's own permission sets with English names (*Administrator — Full Access*, *Member — Standard Access* …) under zh-CN, ja-JP and es-ES, next to each app's translated sets and next to their own translated descriptions. Each built-in set's label is now translated through the permission-set group of the translation bundle (`permissions.NAME.label`), beside its description, so a row reads in one language. For example, under zh-CN *Administrator — Full Access* reads 「管理员 — 完全访问」 and *Viewer — Read-Only* reads 「查看者 — 只读」.

No set's grants, name, English label or description changed. This changes only the text shown for each set, not its permissions.
