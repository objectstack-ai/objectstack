---
'@objectstack/platform-objects': patch
---

fix(platform-objects): Setup → People & Organization no longer shows two identical "组织" / "組織" entries

Clause-②: no
Metadata-protocol: none

`nav_organization` (the active organization's record page) and `nav_organizations` (the organization list, shown where `org-scoping` is mounted) both translated to "组织" in zh-CN and "組織" in ja-JP, so a multi-organization deployment showed two identical menu entries that open different pages. They now read "当前组织" / "所有组织" (zh-CN) and "現在の組織" / "すべての組織" (ja-JP). A new test fails when any two entries in one Setup nav group read the same in any shipped locale.
