---
'@objectstack/service-datasource': patch
---

fix(service-datasource): the datasource driver catalog serves its words in the requester's language, so the New datasource dialog reads in one language

Clause-②: no
Metadata-protocol: none

`GET /api/v1/datasources/drivers` now serves each driver's label and description, and each connection field's `title` and `description` (Filename, Auto-migrate schema, Host, Port, …), in the language the request names: the top `Accept-Language` tag, else `?locale=`, matched by the platform's locale ladder (`resolveLocaleAmong`), so `zh`, `zh-cn` and `zh-SG` reach `zh-CN`. Simplified Chinese is translated for every offered driver. English requests, languages without a translation, and any word a translation leaves out are served the English text, never a key. `DRIVER_CATALOG` stays the English catalog, and the new `driverCatalogFor(locale)` in the package source builds the localized one; ids, icons, types and defaults are unchanged in every language.
