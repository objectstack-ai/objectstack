---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the per-item publish of an `object_extension` draft asks the record-currency follow door its published save asks

Clause-②: no
Metadata-protocol: none

`POST /api/v1/meta/object_extension/NAME/publish` (`publishMetaItem`) now asks the registry's record-currency follow door before it promotes an `object_extension` draft, with the same question the published save of that body asks (`PUT /api/v1/meta/object_extension/NAME`): the extension judged as its object will be served, in the slot of the package it is published into. A draft that adds a record-mode amount whose `currencyField` the served object cannot satisfy is refused `422 INVALID_METADATA` with the registry's sentence, the same one the published save answers, and the draft stays a draft. Two shapes reach it: a pointer naming no field of the object (`currencyField: 'zz_missing'`), and a `master_detail`-led pointer to a parent field that is missing or holds no ISO 4217 code (`invoice.title`).

Before, the publish answered `published`, promoted the draft and registered the amount. Every later write of it was then refused (`ERR_CURRENCY_CODE_REQUIRED`), or, for a pointer to a parent field holding no code, was stored with a value nobody declared as its currency. Nothing an author can save changes: the published save already refused these bodies, and a package publish (`publishPackageDrafts`) already refused them too. To publish such a draft, point `currencyField` at a field that holds the record's ISO 4217 code: a sibling text field declaring `valueDomain: 'iso_4217_currency'`, or `MASTER_DETAIL.CODE_FIELD` on the parent.
