---
"@objectstack/objectql": minor
---

`accept-language: zh` now reads a Chinese refusal on the response whose labels are already Chinese.

`@objectstack/spec` has one locale-negotiation rule — `resolveBundleLocale`: exact match, then case-insensitive, then base language, then **variant expansion**, which is the step that reaches a `zh-CN` bundle from a bare `zh`. `pickData` calls it, and every document translator (`translateObject`, `translateView`, `translateDataset`, …) goes through `pickData`. That is why an app shipping only `zh-CN` still answered `accept-language: zh` with translated object, view and dataset labels.

The write path's message bridge was the one consumer that never negotiated. `ExecutionContext.locale` is the header's first tag verbatim — `preferredLocaleFromHeader` reports what was *asked for* and expands nothing, deliberately, because each of its callers negotiates differently — and the engine handed that tag straight to `II18nService.t()`. A served adapter resolves a locale exactly and then falls to its declared fallback (`FileI18nAdapter.t()` is `resolveFromLocale(key, locale)` then `resolveFromLocale(key, fallbackLocale)`), so `zh` missed the `zh-CN` bundle and the English text came back. The result was a half-translated response an app had no way to see coming: the bundle key was present and correct and the coverage gate was green.

`ObjectQL`'s validation-message context now resolves the requested tag against what the bridged service reports it holds (`II18nService.getLocales()`), through that same `resolveBundleLocale`. The rule is not re-implemented in the engine — the document translators ask it about a bundle's keys, and this asks it about the service's locales. Authored `objects.<object>._validations.<rule>.message` text, `validation.field.*` overrides and translated field labels all follow, because they read one locale.

Unchanged: **which** writes are refused, and everything machine-readable about a refusal — the `code`, the `field`, the `constraint`, the status. Only the language of the sentence moves. `preferredLocaleFromHeader` is untouched, and so is every other caller of it. A request with nothing to negotiate against — no i18n service, a service that cannot report its locales, or a tag no variant of which is on offer — passes through exactly as before.

`ObjectQL.setI18nService` accepts an optional `getLocales?: () => string[]` alongside `t`. `II18nService` has always required `getLocales()`, so every real service already satisfies it; a partial shim that omits it keeps today's behaviour rather than being negotiated against.
