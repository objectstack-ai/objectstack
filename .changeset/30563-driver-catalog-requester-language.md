---
'@objectstack/service-datasource': patch
---

fix(service-datasource): the datasource driver catalog serves its words in the requester's language, so the New datasource dialog reads in one language

Clause-②: no
Metadata-protocol: none

`GET /api/v1/datasources/drivers` now serves each driver's label and description, and each connection field's `title` and `description` (Filename, Auto-migrate schema, Host, Port, …), in the language the request names: the top `Accept-Language` tag, else `?locale=`. The code is read through the platform locale table (`platformLocaleTagOf`, shortened one subtag at a time), so `zh-TW` and `zh-HK` get Traditional Chinese, `zh`, `zh-CN` and `zh-SG` Simplified, `pt` Brazilian Portuguese and `fr-CA` French. Every language on the table is translated for every offered driver: Simplified and Traditional Chinese, Spanish, Arabic, French, Brazilian Portuguese, Russian, German, Japanese and Korean. English requests, codes the table does not name, and product names (SQLite, PostgreSQL, MySQL / MariaDB, MongoDB) are served the English text, never a key. `DRIVER_CATALOG` stays the English catalog, and the new `driverCatalogFor(locale)` in the package source builds the localized one; ids, icons, types and defaults are unchanged in every language.
