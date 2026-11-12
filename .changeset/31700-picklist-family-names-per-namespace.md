---
'@objectstack/core': minor
'@objectstack/metadata': minor
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
---

feat(core, metadata, objectql, metadata-protocol)!: picklist, mapping, dataset, API and function names are held per namespace, and a reader with no package is refused where two holders answer (ADR-0150 child B, #31700)

Clause-②: yes (narrowing) — a read or removal of the metadata service naming no package, of a picklist, mapping or dataset name two packages hold, is refused `409 RESOURCE_CONFLICT` naming both, where it answered or removed the item registered last; a `picklistExtensions` entry extending a list two namespaces hold is refused at install, and refuses the cold boot, naming both; an install, upgrade, hot reload or late item registration whose lists, extensions or field redeclarations would leave a picklist reference ALREADY installed with no one list, or with writers reaching different lists, is refused before anything of it registers; the store keeps one slot per `(package, name)` for picklist, mapping and dataset (moves (a)–(f) below); and the engine's bare function read of a name two namespaces hold is refused naming both. Measured first-party: 0 (showcase, crm and multi-package: no picklist, mapping, dataset, API or function name two packages hold). The install side widens: two packages of two namespaces may each declare one such name.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type an author writes changes. Each refusal names every holder's package-qualified address (`?package=`, `/meta/:type/:ns/:name`), which is the fix, so there is nothing for a migration to rewrite and no tombstone. -->

The bare-name one-holder rule (`bare-name-one-holder.ts`) narrows for `picklist`, `mapping`, `dataset`, `api` and the engine `function` from one package holder per deployment to one per namespace (ADR-0150 D2, D9): they join `NAMESPACE_SCOPED_BARE_NAME_TYPES` (`@objectstack/core`). Their readers already answer by `(package, name)` (#32070, #32071, #32072, #32073, #32069). `picklist`, `mapping` and `dataset` join `PACKAGE_SLOTTED_STORE_TYPES` (`@objectstack/metadata`), so the metadata service keeps one slot per `(package, name)` for them, as it does for `api`.

| What | FROM | TO |
| --- | --- | --- |
| Install of a package of another namespace declaring a picklist, mapping, dataset or API name a package holds | `422 NAMESPACE_CONFLICT`, nothing installed | installed |
| A function of the same name bound by a package of another namespace | refused at bind, naming the holder | bound; `functionHoldersOf` keeps both |
| Cold boot of two namespaces' holders of one such name | boots, warning `Bare-name conflict at boot` naming both | boots, no warning |
| A co-owner of one namespace, a package with no namespace, two packages of `base` / `system` / `sys`, a built-in name | refused | refused, same envelope and sentence |
| Metadata service `get` / `getDiagnosed('picklist' \| 'mapping' \| 'dataset', NAME)` naming no package, two packages holding the name | the item registered last (the bare-name store kept one) | `409 RESOURCE_CONFLICT`, both named |
| Metadata service `unregister('picklist' \| 'mapping' \| 'dataset', NAME)` naming no package, two holders | removed the item registered last | `409 RESOURCE_CONFLICT`, nothing removed |
| The same `get` naming a package that holds no slot of the name | the stored item | nothing |
| `picklistExtensions` extending a name two namespaces hold, installed after both | (unreachable: the second list was refused) | install refused `422 INVALID_METADATA`, the extension and both holders named; a cold boot holding it is refused the same way |
| Install or upgrade declaring a list whose name another namespace's package holds, while an installed extension of that list, or an installed field of a package depending on both, resolves it to one list | (unreachable: the list was refused) | refused before anything registers, `422 INVALID_METADATA`: "Installing '…' would leave … already installed with no one list", each reference and both holders named |
| A late install of a package declaring a list another namespace holds AND a `picklistExtensions` entry on that name (its own extension) | `422 NAMESPACE_CONFLICT` | refused at install, `422 INVALID_METADATA`, the extension and both holders named (an extension is judged caller-less: the package's own name is no shortcut) |
| A late install or upgrade declaring a list another namespace holds and redeclaring, in `objectExtensions`, an installed field that reads that name from its owner's list | (unreachable) | refused before anything registers: the field "would be written to picklist '…' by packages that reach different lists", each writer and the list it reaches named (every referrer and every redeclared field judged together) |
| The same arrival through the registry's own seams after the boot: `registerItem('picklist', …, pkg)`, `registerPicklistExtension`, `registerObject` (own or `extend`) | admitted (an orphan or a stripped field measured) | refused alike, "Registering … would leave …", nothing registered |
| A hot reload (`metadata:reloaded`) whose packages would do the same | re-registered through `registerApp`, past the door | refused whole: one warning `[ObjectQLPlugin] reload refused — every package keeps its previous definitions`; every package keeps its previous definitions |
| `ObjectQL#resolveFunction` / `resolveFunctionEntry(NAME)` of a name two namespaces' packages hold | (unreachable: the second was refused at bind) | `409 RESOURCE_CONFLICT` (`PackageScopedNameRefusedError`, `ambiguous-in-environment`) naming both; a one-holder name resolves as before. No production caller: the flow `script` node resolves through `functionHoldersOf` |
| A field the owner and an extender both write, each reaching its own namespace's list | (unreachable) | served no options, values refused (as for any referrers that disagree, #31731); the boot warns once per field, naming each referrer and the list it reaches |
| A reader with no package of a name two namespaces hold: bare `GET /meta/{picklist,mapping,dataset,api}/NAME`, the import door's `mappingName`, a flow with no package naming a function | (unreachable) | `409 RESOURCE_CONFLICT` naming both, by the readers' existing rule |
| A field of an environment-authored object naming a list two namespaces hold | (unreachable) | served no options, values refused (a caller with no package, ADR-0150 D3) |
| A publish's runtime probe of a dashboard widget's dataset | read by its bare name | resolved FROM the publishing package (`?callerPackage=`, #32310) and read at the holder's address; a refusal's fix now names that package. A dataset held only outside the publishing package's declared closure goes FROM probed TO a `widget_not_probed` warning whose fix is the dependency |
| Two namespaces' APIs of one name | (unreachable) | both indexed, each on its own path (the publish gate puts every path under `/api/v1/apps/<namespace>/`); no duplicate-claim error |

**The store's moves for `picklist`, `mapping` and `dataset`** (`PACKAGE_SLOTTED_STORE_TYPES`; the rule `api`, `agent`, `skill`, `action` and `permission` already follow):

| # | What | FROM | TO | Clause-② arm |
| --- | --- | --- | --- | --- |
| (a) | `unregister(type, NAME, { packageId })` naming a package that holds no slot of a one-holder name | the item and its row removed | nothing removed (the watcher and realtime announcements are unchanged: `unregister` announces every call) | narrowing |
| (b) | `unregisterPackage(holder)` after a package-less write over its name | the package-less item stays, and is served | removed with the holder's slot, and its row | narrowing |
| (c) | `list(type)` of a name two packages hold | the survivor alone | both, in registration order; the second holder's first register is the watcher's `added` where it was `changed` (the overwrite). No realtime event either way: the three types are outside `MetadataEventType` | widening |
| (d) | A package-less write under a name two packages hold | replaced the stored item, served by the bare read | a bare slot, listed beside both, answered by no by-name read | narrowing |
| (e) | `DatabaseLoader` | one row per name, the body saved last | one row per `(package, name)` with `package_id`; a delete naming no package of a two-holder name refused `409` naming both; a rollback by name refused naming every holder when several slots exist | narrowing |
| (f) | A bare `/meta` read on a composition whose registry answers `readsByPackage(type) === false` (`protocol-exact-qualifier.ts`) | served by `getItem`'s first match | `501 NOT_IMPLEMENTED` naming the missing resolver, for one holder too. ObjectQL's registry reads all four types by package: first-party 0 | narrowing |

The fix for every refusal is the address that names the holder: `?package=<id>`, `/meta/:type/:ns/:name`, a field in a package that depends on exactly one holder, or a rename of one of the two items. For an install refused because it would leave an installed reference with no one list: rename the list in the package being installed, or remove the reference or extension that names it first.

The unresolved-picklist refusal (`describeUnresolvedPicklistReferences`) keeps "that no loaded package declares" when no line carries a refusal; a refused name now reads "A picklist name resolves to no one list: …", with a remedy for both kinds (declare the list, or make exactly one holder reachable).

Every other covered type (flow, webhook, connector, email template, tool) keeps one package holder per deployment.

`os migrate stored-references` no longer lists two namespaces' holders of a picklist, mapping, dataset, API or function name among the sealed clashes: they are not a clash.

Also added: `publishedItemReader` and the `ProbeItemProtocol` type (`@objectstack/metadata-protocol`), the probes' item read for a publish; `SchemaRegistry.findDisagreeingPicklistReferences()`, the one picklist re-judge `SchemaRegistry.judgePicklistArrival(manifests)` with `refusePicklistArrival`, `admitPicklistArrival`, `registeringPicklistArrival`, `sealPicklistVocabulary` and `picklistVocabularyIsSealed` (`@objectstack/objectql`).
