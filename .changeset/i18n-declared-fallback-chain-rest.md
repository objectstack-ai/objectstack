---
"@objectstack/rest": patch
---

fix(rest): metadata label lookup honours the stack's declared `i18n.fallbackLocale` / `defaultLocale` instead of falling through to the `en` bundle (#14882)

On a workspace whose labels are authored in `zh-CN` (`defaultLocale: 'zh-CN'`,
`fallbackLocale: 'zh-CN'`) and which ships only a courtesy `en` translation bundle,
`GET /api/v1/meta/object/:name`, the `/meta/:type` list, `GET /api/v1/meta` and the
public-form schema served the ENGLISH bundle labels to a `zh-CN` request (`Entry Sheet`
for an authored `填报单`, `KPI Assessment` for `KPI 考核管理`). The document translators walk
`requested locale → fallback chain → authored label` and default the chain to a literal
`['en']`; every REST seam passed none, so the declared fallback never reached the chain
and `en` was consulted before the authored label.

Every metadata translation seam now passes `fallbackChain: [i18n.getFallbackLocale()]` —
the locale the i18n service's own `t()` falls back to, which `I18nServicePlugin` receives
from the stack config as `fallbackLocale || defaultLocale || 'en'`. For the workspace
above a `zh-CN` request now resolves `zh-CN → zh-CN → authored label` (the authored
Chinese labels), an `en` request still gets the `en` bundle, and a `zh-CN` bundle, when one
is shipped, still wins over the authored label.

Feature-detected: an i18n service that does not declare a fallback (the method is
optional on `II18nService`; the core in-memory fallback has none) gets no chain and the
resolver's own default applies exactly as before. A stack declaring `defaultLocale: 'zh-CN'`
with `fallbackLocale: 'en'` is likewise unchanged — the declared `en` is honoured as it
reads.
