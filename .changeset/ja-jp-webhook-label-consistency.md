---
'@objectstack/plugin-webhooks': patch
---

Fixed the `sys_webhook` object's `ja-JP` display name (`label`) to ウェブフック, matching the already-Japanese `pluralLabel` and the bundle's own help prose (`object_name.help`, `triggers.help`), which both use the same term. Previously `label` was a stale `Webhook` fill left over from a prior source revision, so the object rendered its own name two different ways within the same locale in the Setup/admin UI. `description` (which uses "Webhook" inside a longer Japanese sentence) and the `Webhook ID` field label are unchanged — this only renames the object itself. `zh-CN` is deliberately untouched: it uses `Webhook` for both slots on purpose, as there is no established Chinese rendering of the term in this codebase.
