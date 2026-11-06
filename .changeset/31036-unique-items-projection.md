---
'@objectstack/spec': patch
---

feat(spec): the published JSON Schema states the marketplace taxonomy facets' no-duplicates rule as `uniqueItems: true`

Clause-②: no
Metadata-protocol: none

`businessFunctions` and `industries` refuse a repeated value at parse time (`['sales', 'sales']` is refused with "`businessFunctions` lists a value more than once; list each value once."), but `packages/spec/json-schema/**` dropped that rule, so an editor or an external validator reading the published files accepted the duplicate. The files now say `uniqueItems: true` on both facets, wherever they appear: `marketplace/MarketplaceBusinessFunctions`, `marketplace/MarketplaceIndustries`, and the `businessFunctions` / `industries` properties of `marketplace/Package`, `marketplace/CreatePackageRequest`, `marketplace/UpdatePackageRequest`, `marketplace/MarketplaceListing`, `marketplace/TemplateManifest` and `marketplace/MarketplaceSearchResponse` (under `items`).

**Not a behaviour change.** The runtime accepts and refuses exactly what it did before; only the published file catches up. A document the published file now refuses was already refused by the parse.

**How.** The closed refinement projection (`src/shared/refinement-projection.ts`) gains one arm, `unique-items`, and a declared predicate for it, `UNIQUE_SCALAR_ITEMS`, which the taxonomy's list helper now uses in place of an inline copy of the same expression. The arm is exact only on lists of JSON scalars: a `Set` compares strings, numbers, booleans and `null` the way `uniqueItems` does (`0` and `-0` are one value to both, `"1"` and `1` are two), but compares objects by identity, so the predicate's parameter type is `readonly JsonScalar[]` and composing it on a list of objects does not compile.

**The ledger shrinks.** `packages/spec/dropped-refinements.baseline.json` loses the eight entries above (14 sites), from 1037 dropped sites in 260 published schemas to 1023 in 252.
