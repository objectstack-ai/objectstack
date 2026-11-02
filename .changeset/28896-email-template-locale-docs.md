---
'@objectstack/spec': patch
---

docs(spec): the email template locale docs describe the ladder #28880 landed (#28896)

Clause-②: no
Metadata-protocol: none

The `SendTemplateInput.template` / `.locale` docs, the `EMAIL_TEMPLATE_FLOOR_LOCALE` docblock, the `EmailTemplateDefinitionSchema.locale` docblock and its served `describe`, and the `defineStack` warning for a bundle with no `en-US` row said the resolver matches the named locale exactly and retries only `en-US`, with no language-subtag folding. Since #28880, over the built-in template loader, a call that names a locale folds it against the template's own locales (exact, case-insensitive, base language, variant expansion), then tries the stack's declared fallback locale (`i18n.fallbackLocale`, else `defaultLocale`) folded the same way, then `en-US`, then fails with `TEMPLATE_NOT_FOUND`. The texts now say so, and say that a replacement `TemplateLoader` keeps the exact ladder and that a call naming no locale keeps its own ladder (`en-US`, then the bundle's lowest tag).

Text only: no schema shape, accept set or warning trigger changes. `en` and `en-US` are still two rows of one bundle.
