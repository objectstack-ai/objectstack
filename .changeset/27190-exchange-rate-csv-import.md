---
'@objectstack/platform-objects': patch
---

feat(platform-objects): Exchange Rates offers CSV import on its list page

Clause-②: no
Metadata-protocol: none

`sys_exchange_rate` now opts in to CSV import (`userActions: { import: true }`), so an organization administrator loads a year of rates for every currency from one file — the columns `currency`, `rate` and `effective_date` — from Setup → Exchange Rates, or through `POST /api/v1/data/sys_exchange_rate/import/jobs`. The import is the generic one, with no importer of its own: a line repeating a currency and effective date already on file is refused for that row alone (`UNIQUE_VIOLATION`) while the rest of the file lands, and a rate keeps its twelve decimals. A file marks its rows imported with a `source` column reading `import`; an omitted one takes the default, `manual`. Who may import is the same write grant that guards New and Edit.
