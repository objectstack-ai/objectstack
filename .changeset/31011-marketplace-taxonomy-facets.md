---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the marketplace filters by business function, industry and solution type, and badges a beta package

Clause-②: no
Metadata-protocol: none

- **Facet filters.** The marketplace page's single row of category chips is replaced by three facet filters, read from the marketplace taxonomy in `@objectstack/spec/marketplace`: solution type (a segment with All), business function and industry (toggle rows, any number of values). Values inside one facet combine with OR, the facets combine with AND, and both combine with the search box. Each value shows the count of loaded listings that carry it under the other facets' selection. A listing that declares no solution type counts as `app`, the spec's default. A facet no loaded listing carries is not drawn, so a catalog that does not serve the taxonomy yet shows no filter at all. Filtering stays on the client, over the page the catalog read loads.
- **Badges.** A catalog card shows the listing's primary business function (the first it lists) and a Beta badge when its `maturity` is `beta`. The package Details page shows every business function in the listing's order, the industries, the solution type and the Beta badge. A value outside the spec's vocabulary is drawn nowhere; the old fallback that showed an unknown category's raw value is gone.
- **Strings.** `@object-ui/i18n`'s marketplace catalogues drop the `marketplace.category.*` labels, a copy of the retired category enum, and gain `marketplace.businessFunction.*`, `marketplace.industry.*`, `marketplace.solutionType.*`, `marketplace.maturity.beta` and three facet headings (`marketplace.facet.*`) in every language. The console keys the labels by the spec enums' own values, and a test fails when a spec value has no label, or a catalogue labels a value the spec does not list.
- **Wire.** The console reads the catalog row's `business_functions`, `industries`, `solution_type` and `maturity` columns, and no longer reads `category` or sends `?category=`.
