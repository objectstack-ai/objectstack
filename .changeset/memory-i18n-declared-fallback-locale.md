---
"@objectstack/spec": minor
"@objectstack/core": minor
"@objectstack/runtime": minor
---

The kernel's in-memory i18n fallback learns the declared `i18n.fallbackLocale`, so one declaration stops answering two ways (#15694)

`i18n.fallbackLocale` is authorable on the stack artifact (`TranslationConfigSchema`), and `FileI18nAdapter` — the provider `I18nServicePlugin` installs — has always honoured it: `os serve` constructs it with `fallbackLocale || defaultLocale || 'en'`, and its `t()` consults that locale, per key, after the requested one.

The kernel's in-memory fallback is constructed with nothing. `AppPlugin.loadTranslations` injected the declared `defaultLocale` and `supportedLocales` (#7679) into whichever `i18n` service was registered, but never `fallbackLocale`, and the provider had no setter to receive one. On every stack running that fallback — any stack that declares `translations` without `@objectstack/service-i18n` registered (not installed, or `tierEnabled('i18n')` false) — the declaration was inert. A stack declaring `defaultLocale: 'zh-CN'` with `fallbackLocale: 'en'` answered a missing `zh-CN` key from `en` under `I18nServicePlugin` and from `zh-CN`, i.e. not at all, under the fallback: one declaration, two providers, two answers. That the fallback self-declares `degraded` licenses fewer capabilities, not a different answer to the same declared key.

What changed:

- **`II18nService.setFallbackLocale?(locale)`** — a new OPTIONAL member, the injection counterpart of `getFallbackLocale`. It is the same shape `setDefaultLocale` and `setSupportedLocales` already have, and for the same reason: the declaration lives on the stack artifact, which only the runtime app-plugin layer can see. A provider constructed with its fallback (`FileI18nAdapter`) omits the method and keeps the value it was built with.
- **`createMemoryI18n` receives it and acts on it.** `t()` now consults the declared fallback per KEY after the requested locale — the same second leg `FileI18nAdapter.t()` has. Per key, not per bundle: the pre-existing `resolveTranslations(locale) ?? mergedLocale(defaultLocale)` line swaps whole bundles and only when the requested locale has none, so a `zh-CN` bundle that simply lacked the key never reached anything else. That older leg is unchanged.
- **`AppPlugin.loadTranslations` threads the declaration**, through the same `typeof … === 'function'` optional-capability probe as `setDefaultLocale`, and guarded on the app having declared something — several `AppPlugin`s can share one kernel, and an app that declares no `i18n` block must not clear a fallback another app declared.

A stack that declares no `fallbackLocale` gets exactly the behaviour it has today: the setter is never called, and `t()` walks the same chain it always did. A fallback nobody asked for would be a new chain, not a fix.

`getFallbackLocale()` is deliberately still absent from the memory fallback. The setter is what the provider is TOLD; the accessor is what the serving layer ASKS it when building the metadata-document translators' fallback chain (#14882). Answering the second from `defaultLocale` — the only value always available there — would settle the default-locale contract question #14882 leaves deliberately open, from a degraded provider. Those reads keep the resolvers' own default, which is known and intentional.
