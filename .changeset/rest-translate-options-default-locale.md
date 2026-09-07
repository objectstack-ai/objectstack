---
"@objectstack/rest": patch
---

fix(rest): the metadata reads pass the declared default locale to the label resolvers, so a request for it answers with the authored label (#15711)

`translateOptionsFor` — the single seam every metadata-document translation in the REST server goes through — now threads `i18n.getDefaultLocale()` into `ResolveOptions.defaultLocale` beside the declared fallback chain it has passed since #14882. Both accessors are optional on `II18nService` and both are feature-detected: a provider that declares no default gets no default, one that declares no fallback gets no chain, and the seam never answers `'en'` on a provider's behalf.

Measured on the reporter's stack shape (`defaultLocale: 'zh-CN'`, `fallbackLocale: 'en'`, an `en` bundle and no `zh-CN` bundle): `GET /api/v1/meta/object/kpi_entry_sheet` with `Accept-Language: zh-CN` — or with no header at all, which resolves to the default — now serves the authored `填报单`, not the `en` bundle's `Entry Sheet`; a `fr` request still walks the declared `en` bundle; an `en` request still gets the `en` bundle. Pinned in `meta-i18n-declared-fallback-chain.test.ts` §4 and §5.
