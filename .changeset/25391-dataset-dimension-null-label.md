---
'@objectstack/spec': minor
---

feat(spec): a dataset dimension may name its null bucket with `nullLabel`

Clause-②: yes (widening)
Metadata-protocol: added

`DatasetDimensionSchema` gains an optional `nullLabel` (`I18nLabel`: a plain string or an inline locale map such as `{ en: 'System', 'zh-CN': '系统' }`). It names the bucket of rows whose value for that dimension is null, for example `'System'` on a `user_id` axis where the rows no user wrote carry no user. It is display copy only and changes no grouping.

- **What is accepted now.** `dimensions[].nullLabel` on a dataset, in either label form. Every dimension that parsed before parses unchanged, and the dimension still refuses any other undeclared key.
- **What reads it.** Nothing yet. The chart renderer that draws the bucket under this label ships separately, and until it does the bucket keeps the renderer's own default label. The liveness ledger records the key as `planned`, so `os lint` and `os validate` warn when you set it.
- **What to do.** Nothing. No existing key, value or default changes.
