---
'@objectstack/spec': minor
---

fix(spec)!: the seven multi-word marketplace taxonomy values are spelled as identifiers (`customer_service`, `supply_chain`, …), so a select field can carry the facets as its options

Clause-②: yes (narrowing) — seven accepted facet values change spelling, inside the marketplace-taxonomy narrowing of the same release; no published version carried the hyphenated spelling
Metadata-protocol: narrowed

<!-- adr-0087: not-required (already-registered marketplace-category-retired) The respelled values were introduced by the same unreleased change that registered this entry: @objectstack/spec 18.3.0 was published before it merged and its changeset is still pending, so no published spec ever accepted the hyphenated spelling and no stored row or authored source made against a release can hold it. The entry's prescription (category to the facets of marketplace/taxonomy.zod.ts and LEGACY_CATEGORY_MAPPING) names no value and stays the complete upgrade path; a value-rename entry would project a rename no released author can meet. -->

`businessFunctions` and `industries` used to accept seven values with hyphens. A select option's value is a `SystemIdentifierSchema` (lowercase letters, digits, `_` and `.`), so no select field — the cloud catalog's facet columns, a console filter — could carry them. They are now spelled with underscores; order and arity are unchanged, and a guard test refuses any future taxonomy value that is not an identifier.

| Facet | Wrote (unreleased builds only) | Write instead |
|:--|:--|:--|
| `businessFunctions` | `customer-service` | `customer_service` |
| `businessFunctions` | `supply-chain` | `supply_chain` |
| `industries` | `trade-distribution` | `trade_distribution` |
| `industries` | `professional-services` | `professional_services` |
| `industries` | `financial-services` | `financial_services` |
| `industries` | `public-sector` | `public_sector` |
| `industries` | `real-estate-construction` | `real_estate_construction` |

`LEGACY_CATEGORY_MAPPING` maps `erp` to `["finance", "supply_chain"]`, and `os package publish` lists the identifier spellings when it refuses a retired `category`.
