---
"@objectstack/plugin-webhooks": patch
---

chore(i18n): purge the dead sys_webhook_delivery translation block and guard against recurrence

`sys_webhook_delivery` was removed when webhook delivery moved to
`@objectstack/service-messaging` (`sys_http_delivery`, ADR-0018 M3), but a full
translation block for it lingered in the four generated plugin-webhooks i18n
bundles (en/zh-CN/ja-JP/es-ES) — dead weight bound to an object that no longer
exists, and destined to be dropped silently (with any curated strings) on the
next `os i18n extract`.

- Removed the stale `sys_webhook_delivery` block from all four locale bundles
  (surgical; the `sys_webhook` block is untouched).
- Corrected three stale `sys_webhook_delivery` doc comments (platform-objects
  `integration/index.ts` + `setup.app.ts`, plugin-webhooks `sys-webhook.object.ts`)
  that still named it as a plugin-webhooks-owned object.
- Rolled out the platform-objects `bundle-ownership` test guard (#2834 ⑤ /
  ADR-0029 D8) to the eight packages that own i18n bundles, so a stray object
  block in a generated bundle now fails the build instead of dying silently.
- That guard immediately surfaced a live-object omission: `sys_capability` was
  present in plugin-security's bundles with curated translations but had been
  dropped from its extract config — re-added to the config so the strings are
  preserved, rather than deleted.
