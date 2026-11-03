---
'@objectstack/plugin-email': patch
---

fix(plugin-email): a templated email to a named locale folds it against the template's locales and tries the stack's declared fallback before en-US (#28880)

Clause-②: no
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches the email template locale ladder.

`sendTemplate` and `renderTemplate` used to try a named recipient locale exactly, then `en-US`, then fail with `TEMPLATE_NOT_FOUND`. A recipient whose tag differed from a template row only by region (`en-GB` against an `en` row, `zh-TW` against `zh-CN`) or by case got nothing, and the stack's `i18n.fallbackLocale` was never read, so those deliveries dead-lettered.

With the built-in template loader, a call that names a locale now resolves, in order:

1. that locale against the template's own locales by the platform's BCP-47 rules (`resolveBundleLocale`): exact, case-insensitive, base language (`en-GB` → `en`), then variant expansion (`zh-TW` → `zh-CN`), taking the first match in ascending tag order;
2. the stack's declared fallback (`i18n.fallbackLocale`, else `defaultLocale`, from the i18n service), folded the same way;
3. `en-US`;
4. `TEMPLATE_NOT_FOUND`, still a permanent failure.

An exact match answers as before. A call that names no locale keeps its ladder (`en-US`, then the lowest tag) and does not read the declared fallback. A replacement `TemplateLoader` keeps the exact ladder: the fold is a capability of the built-in loader, and no exported type changes.
