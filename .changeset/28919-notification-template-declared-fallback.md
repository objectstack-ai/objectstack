---
'@objectstack/service-messaging': patch
---

fix(service-messaging): a `sys_notification_template` read for a recipient locale with no row tries the stack's declared fallback locale before `en` (#28919)

Clause-②: no
Metadata-protocol: none

`NotificationTemplateStore` walked the named tag, its primary subtag (`zh-CN` → `zh`), then `DEFAULT_LOCALE` (`en`), and never read the stack's declared `i18n.fallbackLocale` (else `defaultLocale`). The email template ladder reads it since #28880, so the two template families answered the same recipient differently. The ladder is now: the named tag, its primary subtag, the declared fallback (read from the i18n service's `getFallbackLocale` at each resolve, so a service registered later is seen) and its primary subtag, then `en`. The store holds no locale list, so it tries exact rows; it does not fold with `resolveBundleLocale`. A host with no i18n service, a store built outside this package, and a call that names no locale answer exactly as before. Every shipped example declares `fallbackLocale: 'en'`, so their ladder is unchanged. The published `NotificationTemplateStoreOptions` is unchanged: the composition hands the reader in under a module-private key.
