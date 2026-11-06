---
'@objectstack/metadata-core': patch
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
'@objectstack/service-automation': patch
'@objectstack/service-datasource': patch
---

refactor(metadata-core): the customization pair of a package is looked up through the App that carries it

Clause-②: no
Metadata-protocol: none

`@objectstack/metadata-core` exports `pairOf(base)`, `isPairOf(pairId, base)` and `appOf(packageId)`: the pair of a package is `customizationPackageId(appOf(base))` (ADR-0146 D3, with the customization unit being the App per ruling record 6691022506). `appOf` is the identity today, so every package is still its own App for customization and every answer is the one `customizationPackageId` / `isCustomizationPairOf` gave before: the same pair ids, the same refusals, the same served overrides, write gates, list and layered reads, uninstall refusal, flow precedence remedy and datasource import landing.

The served `/meta` reads and writes, the ensure-customization door and the package routes answer exactly as before. Code that asks "which pair customizes this package?" should call `pairOf` / `isPairOf` instead of the spec id rule directly; the parse direction (`customizationBasePackageId`, `isCustomizationPackage`) is unchanged.
