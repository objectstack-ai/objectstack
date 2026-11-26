---
'@objectstack/rest': patch
---

fix(rest): `/meta` reads a regional request tag in the language of the pack the deployment holds

Clause-②: no
Metadata-protocol: none

The metadata reads handed the translators the request's `Accept-Language` tag as written. In a deployment authored in English (`i18n.sourceLocale: 'en'`) that defaults its users to Chinese and holds an `en` pack, an `en-US` request was therefore not the authored language: it walked the declared fallback chain and `GET /meta/object/account` served `客户`, while a write refusal on the same request, which objectql renders with the tag negotiated against the deployment's locales, named the object `Account`.

The translation options every metadata read builds now carry the request tag negotiated against the locales the i18n service reports (`getLocales()`), by the platform's one locale ladder (`resolveBundleLocale`), the same negotiation objectql and plugin-approvals run. An `en-US` request in that deployment reads `Account`. A request for a locale the deployment holds no pack for is unchanged: it walks the declared chain to the default locale. The item and list reads on both transports, the metadata types listing and the public form's object labels read through the same options.

The cached item read's validator is unchanged: it still varies by the tag the request sent, and a validator issued for one language never revalidates a request for another.
