---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console)!: the marketplace filters by business function, industry and solution type, and badges a beta package

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-interface-only ui/packages/i18n/src/namespaces/marketplace/index.ts#MarketplaceCatalogue) the console's own translation catalogues, served as this type by the marketplace namespace loader and as `en`/`zh`/… of `@object-ui/i18n/locales`: no Zod schema, no spec declaration and no stored metadata reads a translation key, so `objectstack migrate meta` has nothing to rewrite and the compiler (for typed catalogue access) or the rendered key (for a `t()` string) reaches every caller -->

- **Facet filters.** The marketplace page's single row of category chips is replaced by three facet filters, read from the marketplace taxonomy in `@objectstack/spec/marketplace`: solution type (a segment with All), business function and industry (toggle rows, any number of values). Values inside one facet combine with OR, the facets combine with AND, and both combine with the search box. Each value shows the count of loaded listings that carry it under the other facets' selection. A listing that declares no solution type counts as `app`, the spec's default. A facet no loaded listing carries is not drawn, so a catalog that does not serve the taxonomy yet shows no filter at all. Filtering stays on the client, over the page the catalog read loads.
- **Badges.** A catalog card shows the listing's primary business function (the first it lists) and a Beta badge when its `maturity` is `beta`. The package Details page shows every business function in the listing's order, the industries, the solution type and the Beta badge. A value outside the spec's vocabulary is drawn nowhere; the old fallback that showed an unknown category's raw value is gone.
- **Strings.** `@object-ui/i18n`'s marketplace catalogues drop the `marketplace.category.*` labels, a copy of the retired category enum, and gain `marketplace.businessFunction.*`, `marketplace.industry.*`, `marketplace.solutionType.*`, `marketplace.maturity.beta` and three facet headings (`marketplace.facet.*`) in every language. The console keys the labels by the spec enums' own values, and a test fails when a spec value has no label, or a catalogue labels a value the spec does not list.
- **Wire.** The console reads the catalog row's `business_functions`, `industries`, `solution_type` and `maturity` columns, and no longer reads `category` or sends `?category=`.

**BREAKING** (`@object-ui/i18n`, the marketplace catalogues served by `@object-ui/i18n/namespaces/marketplace` and held by `en`, `zh`, `zhHant`, `ja`, `ko`, `de`, `fr`, `es`, `pt`, `ru`, `ar` of `@object-ui/i18n/locales`): the `marketplace.category` group is removed from every language. It was a copy of the retired category enum, whose values the spec no longer declares.

- FROM: `marketplace.category.crm`, `.erp`, `.hr`, `.finance`, `.project`, `.collaboration`, `.analytics`, `.integration`, `.automation`, `.ai`, `.security`, `.developer-tools`, `.ui-theme`, `.storage`, `.other`.
- TO: no one-for-one replacement. A listing is now labelled by its facets: `marketplace.businessFunction.<value>`, `marketplace.industry.<value>` and `marketplace.solutionType.<value>`, keyed by the values of `MarketplaceBusinessFunctionSchema`, `MarketplaceIndustrySchema` and `MarketplaceSolutionTypeSchema` in `@objectstack/spec/marketplace`. Which facets an old category value becomes is `LEGACY_CATEGORY_MAPPING` in the same module.
- Fix: delete a `t('marketplace.category.…')` call or an `en.marketplace.category` read, or label the listing's `businessFunctions` / `industries` / `solutionType` with the facet keys instead. A `t()` call that still names a removed key compiles (its key is a `string`) and renders the key itself.
