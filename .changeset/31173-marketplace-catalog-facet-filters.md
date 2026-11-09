---
'@objectstack/cloud-connection': patch
---

feat(cloud-connection)!: the marketplace catalog list filters by business function, industry, solution type and maturity on the server, and the `?category=` filter is retired

Clause-②: no (narrowing) — the facets are declared by the published `MarketplaceSearchRequestSchema` (`businessFunctions`, `industries`, `solutionTypes`, `maturity`), so implementing them widens no contract; refusing the retired `?category=` filter, and a facet the catalog cannot answer, narrows what the proxy honours. No export, type or error code of the package is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of the package changes: the catalog list door reads query-string names the spec already declares and refuses one the spec already retired, with the spec's own prescription. Nothing at rest records a catalog query, so there is nothing for a migration to rewrite and no tombstone. -->

**The facet filters.** `GET /api/v1/marketplace/packages` reads `businessFunctions`, `industries` and `solutionTypes`, each one comma-separated value (`?businessFunctions=sales,marketing`), and `maturity`, one value. Values inside one facet are OR-ed, facets are AND-ed with each other, with `maturity` and with `q`, and `limit` / `offset` page the filtered set, so `total` counts every matching listing. A listing that declares no solution type is the spec's default `app`, and one that declares no maturity is `stable`. On the public snapshot path (`OS_MARKETPLACE_PUBLIC_BASE_URL`) the proxy filters and pages the snapshot itself; on the cloud path it forwards the query string to the cloud unchanged, as before.

**BREAKING** accept-set narrowing at the catalog list (`@objectstack/cloud-connection`).

- **Before.** `?category=crm` filtered the public snapshot by the listing's retired `category` column.
- **Now.** `?category=` is refused with `400` and the spec's retirement prescription for `MarketplaceSearchRequest.category` (`retiredCategoryGuidance`, the text a parse of `MarketplaceSearchRequestSchema` gives the same key), on the snapshot and the cloud path alike, before either is asked. A facet value the spec does not declare (`?businessFunctions=crm`), a facet supplied twice (`?industries=retail&industries=logistics`) and a facet naming no value (`?solutionTypes=`) are refused with `400` and `{ "success": false, "error": { "code": "VALIDATION_ERROR", "message" } }` before the snapshot or the cloud is asked; the message names the parameter and the values it takes.
- **Who moves.** Nothing in the workspace sends `?category=` or a facet today; the Console filters the loaded catalog itself. A script still sending `?category=` gets the 400 instead of a filtered list.

**The remedy.** Replace `?category=X` with the facet that says what you mean (`?businessFunctions=`, `?industries=`, `?solutionTypes=`), and send several values of one facet as one comma-separated value.
