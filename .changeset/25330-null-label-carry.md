---
'@objectstack/spec': patch
'@objectstack/service-analytics': patch
'@objectstack/platform-objects': patch
---

feat(analytics): a dataset answer carries each dimension column's null-bucket name, and System Overview names its null user bucket "System"

Clause-②: no
Metadata-protocol: none

A dataset dimension's `nullLabel` now reaches the renderer. The chart reads every column's display metadata from the dataset answer's `fields[]` and never fetches the dataset document, so the name rides that descriptor:

- **`@objectstack/spec`:** `AnalyticsResult.fields[]` and its mirror `AnalyticsResultResponseSchema` gain the optional response member `nullLabel?: string`, the display name of a dimension column's null bucket. It is a response member only; nothing an author writes changes.
- **`@objectstack/service-analytics`:** the column-description pass shared by the live query and the draft-data preview sets `fields[].nullLabel` on a dimension column whose dataset dimension declares `nullLabel`, resolved to a string at the request locale by the same resolver as `label`. A dimension without one, and every measure column, carry no `nullLabel` key, so those answers are byte-identical to before.
- **`@objectstack/platform-objects`:** the `sys_audit_log_metrics` dataset's `user_id` dimension declares `nullLabel: { en: 'System', 'zh-CN': '系统', 'ja-JP': 'システム', 'es-ES': 'Sistema' }`. The rows the platform writes itself carry no user, and System Overview's "Events by User" drew them, its largest bar, under the renderer's default "(None)". Once the console reads `fields[].nullLabel`, that bar reads "System".
