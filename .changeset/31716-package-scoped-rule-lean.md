---
'@objectstack/core': patch
'@objectstack/metadata-core': patch
'@objectstack/lint': patch
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
---

feat(core, metadata-core, objectql): the package-scoped resolution rule and its closure walk move where every reader reaches them, and engine functions resolve in their referrer's package (ADR-0150 D3/D4)

Clause-②: no
Metadata-protocol: none

- **`@objectstack/core`** exports `resolvePackageScopedHolders`, the ADR-0150 D3 rule as a pure function: a caller of package P is answered P's own item, else the unique holder in P's resolution closure, else a refusal naming every candidate; a caller with no package the environment's own item, else the unique package holder, else the refusal. The holders come from a `PackageScopedHolderSource` the caller supplies (`packageScopedHolderSource` builds one from `(package, item)` pairs, a `null` package being the environment's own item), and the closure from a function the caller supplies. The refusal vocabulary moves with it: `PACKAGE_SCOPED_TYPES`, `ENGINE_FUNCTION_TYPE`, `PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE`, `OVERRIDABLE_BASELINE_PACKAGES`, `BARE_NAME_ONE_HOLDER_TYPES`, `describeBareNameHolder` and the refusal and resolution types.
- **`@objectstack/metadata-core`** exports the one closure walk: `resolvePackageClosure` (moved from `@objectstack/lint`), `widenPairClosureToAppMembers` and `packageDependencyClosure` (moved from `@objectstack/metadata-protocol`), and `packageResolutionClosure` with `KERNEL_NAMESPACE` (moved from `@objectstack/objectql`): the declared dependency closure plus every `sys` package.
- **`@objectstack/lint`**, **`@objectstack/metadata-protocol`** and **`@objectstack/objectql`** re-export every moved name under the name they published, so no import changes. objectql's `resolvePackageScopedName` keeps its signature and answers, now as the rule's call over the registry's holders.
- **`@objectstack/objectql`** adds `resolvePackageScopedFunction`, the rule's call over the engine's function holders, and `ObjectQL#functionHoldersOf(name)`: every package that registered a function of that name (the owner `app:PACKAGE_ID` read as the package id), with its own entry. An owner-less registration is the platform's item (`platformItem`, holder kind `platform`, step `platform`): code a plugin or the host registers, in every caller's reach like a `sys` package, so a package caller holding none counts it beside its closure's holders and two or more refuse naming each.
- **`@objectstack/objectql`**: `SchemaRegistry#packageScopedHoldersOf` no longer counts a bundle addition as a holder (#28802). A dependent package's email template locale its base does not ship stays under the dependent, so it is no second holder of the base's name for a bare read, and a package-less resolve of the base's template answers the base. The dependent's own bare read still answers its own item (step 1, `packageScopedHoldersOf(type, name, callerPackageId)`), and a read naming the dependent (`getPackageScopedItem`) still reaches the addition. A dependent holding a member its base also holds, and a package that does not declare the holder, are still holders, and the bare read refuses them.
- **`@objectstack/core`** exports `RUNTIME_COMPATIBILITY_PACKAGE_ID` (`'__runtime__'`), the package id `ObjectQL#registerObject` stamps when its caller gives none, and reads a caller carrying it as a caller with no package (beside the `sys_metadata` sentinel), so it is not refused environment items. How an item stamped with it counts as a holder is unchanged. objectql's compatibility API takes its default from this one spelling.

Nothing changes for a running deployment: no reader calls the rule yet, `resolveFunction` and `resolveFunctionEntry` keep answering the one last-registered function per name, the save door admits and refuses exactly what it did, and phase 1's one-holder refusal stays in force.
