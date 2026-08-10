---
'@objectstack/service-settings': patch
---

`company.country` adopts the `iso_3166_alpha2` value domain (#6579), the fourth case of the hole #5712 closed on localization: `pattern: '^[A-Za-z]{2}$'` constrains shape only, so `ZZ` (assigned to nobody) and `UK` (a CLDR alias, not an ISO 3166-1 code) passed the write door while the description promised ISO 3166-1. Both doors now judge membership against the explicit 249-code list (`invalid_value` with `constraint: { valueDomain: 'iso_3166_alpha2' }` on save; loud ignore on `OS_COMPANY_COUNTRY`). The pattern stays — a shape breach still speaks first as `invalid_format`. Deliberate tightening, same as #5712: membership is exact uppercase, so lowercase spellings like `us` are now refused.
