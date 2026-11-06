---
'@objectstack/metadata-core': patch
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
'@objectstack/runtime': patch
'@objectstack/cli': patch
'@objectstack/cloud-connection': patch
'@objectstack/lint': patch
'@objectstack/service-automation': patch
'@objectstack/service-datasource': patch
---

feat(metadata-protocol, metadata-core)!: the ensure door creates no customization pair for a kernel package, and every pair question carries the installed manifests

Clause-②: yes (narrowing) — `POST /api/v1/packages/:id/ensure-customization` (and the protocol's `ensureCustomizationPackage`) answers a kernel base, a package of scope `system` or `cloud`, with `409 RESOURCE_CONFLICT` and a sentence saying kernel objects are not customizable in this version, where it created `<id>.custom`. Beside it, the exported `pairOf`, `isPairOf` and `appOf` (`@objectstack/metadata-core`), `isServedOverrideRowOf` and the `installed` member of `OverrideWriteClosure` (`@objectstack/metadata-protocol`), and `resolveFlowPrecedence` / `describeFlowContender` (`@objectstack/service-automation`) take the installed-manifest lookup as a required argument.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed or re-shaped and no stored row is read differently, converted or dropped: the narrowing is one runtime refusal at one door, for one kind of base, whose remedy is that no pair exists to create; the existing pairs and the overrides in them stay served exactly as before. The retyped exports are runtime functions with no metadata surface, and the compiler names every caller that has not passed the new argument, so there is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING** for a caller that ensures the customization pair of a kernel package — a platform package of scope `system` (users, organizations, security, settings and the rest of the platform suite) or `cloud` — and for a TypeScript importer of the pair helpers named above.

- **Why (ruling records 6691022506 and 6691217245 on ADR-0146 D3).** The customization unit is the App, and the kernel is not an App a customer owns: it ships with the runtime at the runtime's version and is always installed whole. In this version no kernel object is customizable, so the door creates no pair for one. Which kernel objects a later version opens (a whitelist) is that version's decision.
- **What the door answers.** `409 RESOURCE_CONFLICT`, the status and code the door already answers when a base's state rules the pair out (a writable base, no namespace, a version that is not SemVer). Nothing is created or written. Every other base is answered exactly as before.
- **A kernel pair that already exists stays.** An earlier version of the door may have created `<kernel id>.custom` on a deployment. It stays installed, the overrides inside it stay served by every read of the kernel item's name, and a further save into it is still admitted. Only the ensure call is refused.
- **A copy of a platform permission set.** `POST /api/v1/security/permission-sets/:name/clone` with no `package` named landed the copy of a kernel-shipped set (`member_default` and the platform's other sets) in `<kernel id>.custom`. It now saves the copy environment-wide, as it already does for a set authored in the environment, with the notice code `PERMISSION_SET_CLONE_ENVIRONMENT_WIDE_KERNEL_SOURCE` and a sentence naming the kernel package and `package`. A Console that does not know the new code shows that sentence as sent. Naming a writable package with `package` still lands the copy there. The flow clone door answers a kernel-shipped flow with the ensure door's sentence.
- **The closes that named the pair.** A package-less save, or a save naming the kernel package, onto a kernel item was refused naming the pair as the fix. That fix no longer exists, so those two closes leave the save open, as they already do for every other base the ensure door refuses.
- **The lookup.** Which pair customizes a package is asked through the installed manifests of the registry the caller serves (`installedManifestsOf(registry)`). Today the answer is unchanged for every package: `appOf` is still the identity. The argument is threaded through every site now so that resolving a module to its App is one change in `appOf`.
- **`os validate`'s customization-namespace advisory** now skips a package that is itself a pair through `isCustomizationPackage`, the one spelling of that question. An id ending in `.custom` that no base derives (`a.custom.custom`, a bare `.custom`) is now judged like any other package.
- **Who moves, and the fix.** A script or client that ensured a kernel package's pair drops that call: the kernel item is served as it ships, and an existing pair keeps serving what it holds. A TypeScript importer of the helpers passes `installedManifestsOf(engine.registry)`, or `installedManifestsOf(undefined)` where it holds no registry.
