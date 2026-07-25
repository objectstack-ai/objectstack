---
"@objectstack/plugin-webhooks": patch
---

chore(plugin-webhooks): drop the dead sys_webhook_delivery i18n blocks

`sys_webhook_delivery` was removed from `@objectstack/plugin-webhooks` when
outbound delivery moved to `@objectstack/service-messaging` (`sys_http_delivery`,
ADR-0018 M3), but its translation blocks lingered in all four generated locale
bundles (en / zh-CN / ja-JP / es-ES) — loaded at runtime yet referenced by
nothing, since the object no longer exists in this plugin.

- Removed the `sys_webhook_delivery` node from each `*.objects.generated.ts`
  bundle; `WebhooksTranslations` now carries only `sys_webhook`.
- Corrected the stale ownership comment on `SysWebhook` that still named
  `sys_webhook_delivery` as a live sibling.

(The dangling `SysWebhookDelivery` import in `scripts/i18n-extract.config.ts`
was fixed independently on `main` by #3489, so it is not part of this change.)
