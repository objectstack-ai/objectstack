---
'@objectstack/spec': minor
'@objectstack/cli': minor
'create-objectstack': patch
---

feat(spec)!: one marketplace taxonomy — business functions, industries, a solution type and a maturity flag replace the single `category` (#30904)

Clause-②: yes (narrowing) — new facet keys and `maturity` widen; `category` retired and refused by name narrows; a contract review runs before the queue
Metadata-protocol: narrowed

<!-- adr-0087: registered marketplace-category-retired -->

**BREAKING** for a package source, publish request or listing that still writes `category`.

- **`@objectstack/spec`.** The marketplace taxonomy is defined once, in `@objectstack/spec/marketplace` (`taxonomy.zod.ts`): `businessFunctions` (1-3 distinct values, the primary one first: `sales`, `marketing`, `customer-service`, `finance`, `hr`, `supply-chain`, `administration`, `project`, `legal`, `it`, `collaboration`), `industries` (up to 3, optional; absent means cross-industry), `solutionType` (`app` | `template` | `connector`; absent means `app`) and `maturity` (`beta` | `stable`; absent means `stable`), on `PackageSchema`, `CreatePackageRequestSchema`, `UpdatePackageRequestSchema`, `TemplateManifestSchema` (`objectstack.manifest.json`) and `MarketplaceListingSchema`, where `businessFunctions` is required. A search filters by `businessFunctions` / `industries` / `solutionTypes` / `maturity` and reads one facet count list per facet. `explainSolutionTypeContradiction` is the publish cross-check (a `template` needs the `unmanaged` install mode, a `connector` a declared connector) and `LEGACY_CATEGORY_MAPPING` says what every old category value becomes.
- **Retired.** `category` on all six schemas, and `MarketplaceSearchResponse.facets.categories`, are `retiredKey()` tombstones: `tsc` refuses them and a parse refuses them with the prescription. `MarketplaceCategorySchema` / `MarketplaceCategory` and `PackageCategorySchema` / `PackageCategory` are removed. `RETIRED_KEYS_BY_MAJOR[18]` lists the six keys, `RETIRED_DEFS_BY_MAJOR[18]` both defs, and the upgrade guide carries the semantic entry `marketplace-category-retired`. No ADR-0087 conversion: none of these shapes is a stack collection member, so `os migrate meta` has nothing to rewrite; a runtime boot never reads them.
- **`@objectstack/cli`.** `os package publish` refuses a `category` in `objectstack.manifest.json`, or the now-hidden `--category` flag, before any network call, naming the facets for the value it held. It judges each facet with the spec's schema, checks a declared `solutionType` against the built artifact, and sends the facets as `business_functions`, `industries`, `solution_type` and `maturity`; an absent facet is not sent.
- **`create-objectstack`.** The blank template no longer ships `category: "starter"`, which every project scaffolded from it inherited and which the hosted publish route refused.

**The remedy.** FROM `"category": "<value>"` TO the facets: delete `category` and declare `businessFunctions` (and, where they apply, `industries` and `solutionType`) in `objectstack.manifest.json`. `os package publish` prints the mapping for the value you had — for example `"finance"` → `"businessFunctions": ["finance"], "solutionType": "app"` — and `LEGACY_CATEGORY_MAPPING` lists them all. A `"starter"` copied from the blank template is simply deleted. A TypeScript caller that imported `MarketplaceCategorySchema` or `PackageCategorySchema` uses `MarketplaceBusinessFunctionSchema` and `MarketplaceSolutionTypeSchema` instead.
