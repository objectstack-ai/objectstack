---
"@objectstack/spec": minor
---

feat(spec): `II18nService.getFallbackLocale()` — the declared fallback locale is readable, so the metadata-document translators can be handed the chain the deployment declared (#14882)

`ResolveOptions.fallbackChain` on the `@objectstack/spec/system` label
resolvers (`translateMetadataDocument`, `translateObject`, `translateApp`,
`resolveViewLabel`, …) is the ordered list of locales consulted after the
requested one and BEFORE the authored label. Nothing on `II18nService`
exposed the deployment's declared fallback (`i18n.fallbackLocale`, else
`defaultLocale`), so no serving layer could thread it, and every caller fell
to the resolver's literal `['en']` default. A `zh-CN` workspace that shipped a
courtesy `en` bundle therefore served English bundle text to a `zh-CN`
request ahead of its own authored Chinese labels.

- New optional contract member `II18nService.getFallbackLocale?(): string | undefined`
  — the locale the service's own `t()` consults second. `undefined` (or the
  method absent) means nothing was declared, and a serving layer must then
  leave the resolver's default in place rather than invent a chain.
- The `fallbackChain` documentation now states who supplies it (the serving
  layer, from `getFallbackLocale()`) and that the `['en']` default applies
  only when a caller declares no chain at all. The resolver's behaviour for
  a caller that passes nothing is unchanged.

Additive: no existing implementation or caller changes shape.
