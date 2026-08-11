---
"@objectstack/spec": minor
"@objectstack/core": minor
"@objectstack/runtime": minor
"@objectstack/service-i18n": minor
---

fix(i18n): `GET /i18n/locales` reports the locales the app declared, not every locale a plugin happened to load (#7679)

`GET /api/v1/i18n/locales` answered with four locale descriptors — `en`,
`zh-CN`, `ja-JP`, `es-ES` — on the showcase app, whose artifact declares
`i18n.supportedLocales: ['en', 'zh-CN']`. The envelope was correct (#3636); the
**set** was a superset.

Nothing was wrong with what had been *loaded*. Every platform plugin
(`platform-objects`, `service-settings`, `service-storage`, `service-messaging`,
`service-realtime`, `plugin-security`, `plugin-sharing`, `plugin-webhooks`)
ships an `en/zh-CN/ja-JP/es-ES` bundle and pushes it at `kernel:ready`, which is
what a platform should do. What was wrong is that the **loaded** set was
reported as the **offered** set — two different facts owned by two different
parties. So a locale picker built from this route, including the platform's own
Settings > Localization select, offered `ja-JP` and `es-ES`: locales in which
only `sys_*` objects are translated, guaranteeing a mixed-language session for
everything the app itself owns.

**What changed.** `II18nService` gains an optional
`setSupportedLocales(locales)`. `AppPlugin.loadTranslations` threads the
artifact's `i18n.supportedLocales` into it exactly the way it already threads
`defaultLocale`, and both providers of the `i18n` slot — `createMemoryI18n` in
`@objectstack/core` and `FileI18nAdapter` in `@objectstack/service-i18n` —
narrow what `getLocales()` reports to that declaration. The runtime app-plugin
layer is the only place this can originate: `getLocales()` sees what is loaded,
and the app's declaration is not visible below it.

The narrowing is applied as a filter at **read** time, never as a prune of what
is stored, because the platform bundles arrive *after* the app plugin has run.

**Only the reported set narrows.** Bundles stay loaded and stay servable:
`GET /i18n/translations/ja-JP` still answers on a stack that no longer
advertises `ja-JP`, and `t()` still resolves it. Unloading those bundles buys
nothing — `sys_*` translations for an unadvertised locale cost nothing sitting
in the map.

Two questions the fix had to settle, both behaviour in their own right:

- **An app that declares no `supportedLocales` is not narrowed.** Absent means
  "no narrowing", and it keeps reporting every loaded locale — the behaviour it
  has today. Every app written before this change declared nothing, so
  narrowing an undeclared app to zero (or to its default alone) would have
  emptied the picker on every stack whose author never opted in. An
  `i18n` block carrying only a `defaultLocale`, and a `supportedLocales: []`
  that declares no usable code, are both read the same way.
- **A declared locale with no bundle behind it is reported, not dropped.** If an
  app declares a locale the platform plugins never shipped, it appears in the
  response as declared-but-unserved rather than being silently intersected away.
  The declaration is the app's statement of intent and the client is entitled to
  see it; a quietly shortened list hides the authoring gap from both ends.
  Reporting the declaration is also the only answer that does not depend on how
  many bundles had loaded by the time the route was called. Reads for such a
  locale degrade to the default/fallback exactly as a half-translated bundle's
  missing keys already do.

Reported locales now follow the **declared order** rather than the insertion
order of whichever plugin loaded first, so a picker renders the ordering the app
author wrote.

`setSupportedLocales` is optional on the contract, like `setDefaultLocale`: a
third-party `II18nService` that does not implement it keeps its current
behaviour instead of failing to boot.
