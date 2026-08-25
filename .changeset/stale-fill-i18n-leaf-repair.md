---
"@objectstack/platform-objects": patch
"@objectstack/plugin-webhooks": patch
"@objectstack/service-messaging": patch
---

fix(i18n): re-translate the five leaves that served a superseded source revision (#12065)

`os i18n extract` merges gaps only, so a revised source string leaves the previous
revision standing in every translated locale — in sync by key, green under
`check:i18n` and counted as translated by `check:i18n-coverage`. The five leaves
`check:i18n-stale-fill` froze in its baseline are re-translated here from the
**current** `en` source, and the baseline is ratcheted to empty in the same change.

User-visible admin/Setup help text changes in `es-ES`, `ja-JP` and `zh-CN`:

- `dataset.fields.measures.helpText` (metadata forms) — all three locales promised a
  `"certified"` governance flag that was removed from the declaration in 16.0.
- `sys_webhook.fields.method.help` — all three locales served the pre-revision method
  enumeration after the source became a prose description.
- `sys_webhook.pluralLabel` — `ja-JP` was an untranslated Latin fill and is now
  Japanese; `zh-CN` keeps `Webhook`, which is the term this bundle's own Chinese prose
  uses and which carries no plural inflection.
- `sys_http_delivery.fields.attempts.help` — `es-ES` / `ja-JP` held an English fill and
  `zh-CN` a translation of the same superseded source; all three now carry the
  PARKED / terminal-row clause the source documents.
- `sys_notification_subscription.fields.principal.help` — the selector list was missing
  the `owner_of:object:id` and bare-email forms in all three locales.

No schema, export or runtime behaviour changes: translated-locale leaf values only,
plus the shrink-only ratchet baseline.
