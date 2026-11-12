---
'@objectstack/objectql': patch
'@objectstack/core': patch
'@objectstack/runtime': patch
'@objectstack/cli': patch
'@objectstack/plugin-security': patch
'@objectstack/plugin-email': patch
'@objectstack/plugin-sharing': patch
'@objectstack/metadata-protocol': patch
'@objectstack/service-automation': patch
'@objectstack/plugin-approvals': patch
'@objectstack/rest': patch
'@objectstack/metadata': patch
---

fix(objectql, metadata-protocol)!: by-name doors judge a name's holders over the served set, so a disabled package's item is not a holder (ADR-0150 D3, #32183)

Clause-②: no (narrowing) — for a name that only disabled packages hold, `SchemaRegistry.resolveItem`, `MetadataFacade.get` / `getEntry` and `SchemaRegistry.getApp` (`@objectstack/objectql`) answer `undefined` where they answered the disabled package's body, and `MetadataFacade.exists` answers false where it answered true. Every by-name door already withheld that body. The other moved answers are listed below, each before → after. Most widen or name fewer packages: a name one enabled and one disabled package hold is served by the enabled holder where it was refused naming both. Three narrow a served answer. A package caller whose closure holds the name only through a disabled package, while an enabled package outside the closure holds it, is refused `outside-closure` where it was served the disabled package's body. The pair address (`?package=<base>.custom`) of a disabled base answers 404 where, with an enabled holder registered first, it served the disabled base's body under that holder's envelope. A disabled package's address at a member only its customization pair stores answers 404 where it served the pair's row. The rest move between a refusal and not-found.
Metadata-protocol: none
Skills-docs: none — `content/docs/deployment/marketplace-handbook.mdx` already says a disabled module is hidden, and no skill or doc teaches the by-name answer for a name a disabled package holds.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape beyond optional parameters (the flow and connector resolvers' `options`, `MetadataManager.getPublished`'s `packageId`) and one optional query member. The moved answers are reads of registered items under a reversible package state, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** answer narrowing at exported in-process APIs of `@objectstack/objectql`, for a name only disabled packages hold, and for a package caller that reaches a name only through a disabled package; and at the `/meta` exact read (`@objectstack/metadata-protocol`), for the pair address of a disabled base and for a disabled package's address at a member only its pair stores.

- **Before → after.** `SchemaRegistry.resolveItem(type, name)`, `MetadataFacade.get` / `getEntry` and `SchemaRegistry.getApp(name)`: the disabled package's body → `undefined`. `MetadataFacade.exists`: true → false. First-party callers: 0. `MetadataFacade` is never constructed in-tree, `getApp` has no caller, and the one door that reads `resolveItem` (the protocol's by-name read) already withheld the body.
- **Before → after, the resolver primitives**, same name: `SchemaRegistry.packageScopedHoldersOf(type, name)`: `[DISABLED]` → `[]`. `resolvePackageScopedName`, `readPackageScopedItem` and `resolveActionByPackage`, a caller with no package or outside the holder's closure: resolved to the disabled holder → not-found. First-party callers whose answer moves: 0 (no first-party app disables a package at boot).
- **Before → after, served → refused.** A package caller whose declared closure holds the name only through a disabled package, while an enabled package outside the closure holds it: the disabled package's body → refused `outside-closure`, naming the enabled holder. At `resolvePackageScopedName`, `SchemaRegistry.resolveItem(type, name, callerPackageId)` and `resolveActionByPackage`. First-party callers: 0.
- **Before → after, served → not-found, at a door.** `GET /meta/:type/:name?package=<base>.custom`, on both transports, the pair of a disabled base, when an enabled package that holds the name registered first: 200 with the disabled base's body under the enabled holder's envelope (`_packageId`) → 404, the disabled base's withheld item. Measured on `main` with the email-template namespace change merged. First-party callers: 0.
- **Before → after, served → not-found, at a door.** `GET /meta/:type/:name?package=DISABLED&member=` and `?package=DISABLED.custom&member=`, on both transports, at a member only the disabled package's customization pair stores, with one holder of the name or two, in either registration order: 200 with the pair's row → 404, the disabled package's withheld item. An address that reads only a disabled package never serves its customization. Measured on `main` 216674301. First-party callers: 0.
- **Added, `@objectstack/metadata`.** `MetadataManager.getPublished(type, name, packageId?)`: an optional `packageId`, read as `get` reads it. Without it, every answer is unchanged.
- **Unchanged.** A caller inside the disabled package still reads its own item. Re-enabling the package serves it again. A consumer that needs a disabled package's body names the package (`SchemaRegistry.getPackageScopedItem(type, name, packageId)`), or reads the holders with `includeDisabledPackages: true`.

**Every moved answer, before → after.** First-party count 0 for each: showcase (22 packages, 205 package-scoped names), crm (18, 35) and multi-package (16, 27) hold no name that two packages share, and disable none at boot.

Widening:

- Bare `GET /meta/:type/:name` for every type of `PACKAGE_SCOPED_READ_TYPES`, on both transports, and the doors that read it (MCP `agent_prompt`, the dataset query door with a bare `datasetName`, the import door's `mappingName`, the connector pull). Two holders, one disabled: 409 naming both → 200 with the enabled holder's item.
- Bare `GET /meta/:type/:name/layers` (and `?layers=true`), on both transports, the same name: 409 naming both → 200 with the enabled holder's layers, read at its address (its code layer, its stored overlay row, its lock), whichever holder registered first or last. A stored row bound to the disabled holder is read by none of them, and rows bound to each holder no longer make the layered read refuse. The metadata service's copy of a type it keys by name alone is the body registered last, and when that copy is the disabled holder's it is never the code layer.
- Bare `GET /meta/:type/:name/published`, on both transports, the same name: 409 naming both → the enabled holder's stored row if it has one. Otherwise → the metadata service's copy, read at the enabled holder's package. A type the service stores per `(package, name)` (`agent`, `skill`, `api`, `action`) answers that package's copy and is never refused naming the disabled holder. A copy stamped with the disabled holder is replaced by the enabled holder's code layer. Otherwise → 404, as `/published` answers an item the metadata service does not hold (a package registered only through the `manifest` service).
- Two co-owners of a shareable namespace, one disabled, `GET /meta/:type/:ns/:name` and the bare read: 409 `ambiguous-in-namespace` → 200 with the enabled co-owner's item.
- `resolveActionByPackage`, and the REST route rung for a caller's package (`resolveRouteActionDeclaration`), a caller with no package or one whose closure holds both: refused → the enabled holder's declaration and its handler.
- The security catalog, a permission-set reference with no package column: refused → the enabled holder's set. `holdsPlatformPermissionSet` for that name: false → the enabled holder's platform verdict.
- The caller arm (`?callerPackage=P`) of `GET /meta/dataset/:name` and of the dataset query doors, single and batch, on both transports: two holders in P's declared closure, one disabled: 409 naming both → 200 with the enabled holder's dataset.
- The connector pull of a job's mapping for a package caller (the package that declares the job): two holders in its closure, one disabled: 409 `mapping_name_refused` naming both → the enabled holder's mapping is pulled.
- An App's pair (`?package=<App>.custom`), two modules of the App holding the name, one disabled, where the layer below reaches neither module's item (a package outside the App holds the name and registered first): 409 `ambiguous-in-closure` naming both → 200 with the enabled module's item.
- A package-less row of a name an enabled and a disabled package hold (the environment's item, or a package-less stored row), at the enabled holder's exact address (`?package=`, its namespace): 409 `ambiguous-in-closure` naming both → served as that holder's customization, as with one holder. Re-enabled, it is refused naming both again. At the enabled holder's pair (`?package=<enabled>.custom`) beside the same row: 409 naming both → 200 with the row when the enabled holder registered first; → 404 when the disabled one did (the 409 → 404 line below).
- The flow credential channel's write (the flow save door's credential store), for a flow name an enabled and a disabled package hold: a save that sets, clears or removes a stored credential, refused 409 naming both → written, each row stamped (`flow_package`) with the enabled holder's package, the one the served flow is.
- The list scoped to the enabled holder (`GET /meta/:type?package=`), and the execution list at its address (`getMetaItemsForExecution`, which an email send resolved to that holder reads), a package-less stored row of a name an enabled and a disabled package hold: the holder's own item → the row, as that holder's customization (the package-less row line above, read in the list). Re-enabled, the holder's own item again. The environment's item in the registry is not in either list, disabled or not.
- A member row an App's pair stores with no `overrides`, of a bundle name two modules of the App hold, one disabled: at the enabled module's exact address, refused 409 naming both → served as its member; in its scoped list and its execution list (a send resolved to that module), left out → listed. Re-enabled, as before.

Same status, the disabled package no longer named:

- `?package=NONHOLDER`, `GET /meta/:type/:ns/:name` of a namespace that holds nothing, and `_env`, two holders: 409 naming both → 409 naming the enabled holder.
- An action or permission-set caller outside both closures: refused naming both → refused naming the enabled holder.

Served or not-found → refused:

- An action caller whose closure holds the name only through the disabled holder, the enabled one outside it: the disabled holder's declaration → refused `outside-closure`, naming the enabled holder (the served → refused line above).
- A permission-set caller with the disabled holder inside its closure and the enabled one outside: not-found (the catalog withheld the disabled set) → refused `outside-closure`, naming the enabled holder.
- The dataset caller arm (`?callerPackage=P`), P's closure reaching the name only through a disabled package while an enabled package outside it holds it: 404 (the disabled package's withheld item) → 409 `outside-closure`, naming the enabled holder.

Served → not-found:

- The pair address of a disabled base, an enabled holder registered first (the line above): the disabled base's body → 404.
- `?package=DISABLED&member=` and `?package=DISABLED.custom&member=`, at a member only the disabled package's pair stores (the line above): the pair's row → 404.

409 → 404:

- An App's pair whose every base is disabled: 409 `ambiguous-in-closure` naming them → 404.
- `?package=DISABLED` and `?package=DISABLED.custom`, beside a package-less row (the environment's item, or a package-less stored row) of a name an enabled and the disabled package hold: 409 `ambiguous-in-closure` naming both → 404, the disabled package's withheld item.
- `?package=<enabled>.custom` beside the same row, the disabled holder registered first: 409 naming both → 404. The pair address's envelope falls back to the first holder that ships the name (#32501 location 1, the same on `main`); with the enabled holder first it is the widening above.
- A name only disabled packages hold, on `?package=NONHOLDER` and its qualified path, whatever row a layer of the read reached (a row of a holder's customization pair at a member only it stores included): 409 naming the disabled package → 404. Only a row stored under the address's own package is served.
- A name two or more disabled packages hold, and nothing else, on the bare read: 409 naming them → 404.
- A shareable namespace whose co-owners both hold the name and are both disabled, `GET /meta/:type/:ns/:name`: 409 `ambiguous-in-namespace` → 404.

Refused → not-found:

- A stored permission-set column naming the disabled holder: refused naming both (it was read as a stale column) → not-found. It conferred nothing before and confers nothing now, and it is never re-targeted to the enabled holder.
- An action or permission-set caller outside the closure of a name only a disabled package holds: refused naming it → not-found.

Degraded → 409:

- The REST action rung for a caller's package (`resolveRouteActionDeclaration` with `callerPackageId`): a package-scoped refusal the protocol's execution read throws → the declaration's `refusal`, answered as the declared `409 RESOURCE_CONFLICT`, where it was swallowed as `degraded`. No door reaches this rung today: it runs only for a caller that names its package, and neither the bare `/actions` door nor the activation door passes one.

**Not moved.** `?package=DISABLED`, the disabled package's namespace, the pair of a disabled base read where no enabled holder's envelope is reached, and the caller arm (`?callerPackage=P`) when P's own holding is disabled keep their 404 (beside a package-less row, the 409 → 404 line above; at a member only the pair stores, the 200 → 404 line above). The email template send (`createRegistryEmailTemplateLoader`, `@objectstack/plugin-email`) reads every holder, so a disabled package still counts there and a refusal still names it, until #32670: every send answers as on `main`, a send made from the disabled holder included. `_env` of a name only disabled packages hold keeps `main`'s 409 naming them: with no served holder, its admission judges every holder. The exact qualifier admits them over every holder, and the item face answers the address itself as the disabled package's withheld item, whichever envelope a layer reached; a refusal's candidates and the bases a pair is read at are the served holders. A name only disabled packages hold keeps the missing name's 404 on the bare `/meta/:type/:name/layers` and `/published`, and the layered view at any other address answers 404 as the plain read does: the item face (`@objectstack/metadata-protocol`) answers it as that package's withheld item, the shape a disabled holder's read had. Every holder's own read, the served lists (but the list scoped to an enabled holder and its execution list, for the two lines above), and a name only disabled packages hold on the bare read (404) answer as before. Durable judgments read every holder, so a binding never moves with a reversible disable: a name only a disabled package holds still binds to it, and a name an enabled and a disabled package both hold stays ambiguous and is left null. They are the stored-reference backfills (R1/R3 permission sets, R4 activation ledger, R5/R6/R13 sharing declarations, R20 email templates, R7 open approval requests, R8 paused runs, R9 flow credentials, R10 dispatch keys, R11 connector connections), the CLI stored-reference report (`os migrate stored-references`, its pair-member and package-less-row sections included), and the picklist verdict that the load audit, the install door and a field's options share. R7–R11 read through `AutomationEngine.durableFlowHolder` and the connector resolver asked with `includeDisabledPackages`; the flow and connector execute doors keep judging the served holders. The install gate (`bareNamePackageHolders`) and the security catalog's item seam are separate reads and are not touched.

**Also in this change, not breaking.** `@objectstack/metadata-protocol`: `packageLessRowOwners(registry, type, name, options?)` takes an optional `options` carrying `includeDisabledPackages`, which the CLI report passes; without it the answer is the served holders. `SchemaRegistry.packageScopedHoldersOf(type, name, callerPackageId?, options?)` takes `options.includeDisabledPackages` (the option name `listItems` already carries) to read every holder, and `resolvePackageScopedName`'s query takes `includeDisabledPackages`, forwarded to it. `@objectstack/service-automation`: `AutomationEngine.durableFlowHolder(name)` asks `flowHolder`'s question over every holder, and the `FlowNameResolver` and `ConnectorNameResolver` types take an optional third `options` argument carrying it.
