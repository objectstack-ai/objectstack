---
'@objectstack/objectql': patch
'@objectstack/core': patch
'@objectstack/runtime': patch
'@objectstack/cli': patch
'@objectstack/plugin-security': patch
'@objectstack/plugin-email': patch
'@objectstack/plugin-sharing': patch
---

fix(objectql)!: by-name doors judge a name's holders over the served set, so a disabled package's item is not a holder (ADR-0150 D3, #32183)

Clause-②: no (narrowing) — for a name that only disabled packages hold, `SchemaRegistry.resolveItem`, `MetadataFacade.get` / `getEntry` and `SchemaRegistry.getApp` (`@objectstack/objectql`) answer `undefined` where they answered the disabled package's body, and `MetadataFacade.exists` answers false where it answered true. Every by-name door already withheld that body. Every other moved answer widens or names fewer packages: a name one enabled and one disabled package hold is served by the enabled holder where it was refused naming both.
Metadata-protocol: none
Skills-docs: none — `content/docs/deployment/marketplace-handbook.mdx` already says a disabled module is hidden, and no skill or doc teaches the by-name answer for a name a disabled package holds.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape beyond one optional parameter and one optional query member. The moved answers are reads of registered items under a reversible package state, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** answer narrowing at an exported in-process API of `@objectstack/objectql`, for a name only disabled packages hold.

- **Before → after.** `SchemaRegistry.resolveItem(type, name)`, `MetadataFacade.get` / `getEntry` and `SchemaRegistry.getApp(name)`: the disabled package's body → `undefined`. `MetadataFacade.exists`: true → false. First-party callers: 0. `MetadataFacade` is never constructed in-tree, `getApp` has no caller, and the one door that reads `resolveItem` (the protocol's by-name read) already withheld the body.
- **Unchanged.** A caller inside the disabled package still reads its own item. Re-enabling the package serves it again.

**Every moved answer, before → after.** First-party count 0 for each: showcase (22 packages, 205 package-scoped names), crm (18, 35) and multi-package (16, 27) hold no name that two packages share, and disable none at boot.

Widening:

- Bare `GET /meta/:type/:name` for every type of `PACKAGE_SCOPED_READ_TYPES`, on both transports, and the doors that read it (MCP `agent_prompt`, the dataset query door with a bare `datasetName`, the import door's `mappingName`, the connector pull). Two holders, one disabled: 409 naming both → 200 with the enabled holder's item.
- Two co-owners of a shareable namespace, one disabled, `GET /meta/:type/:ns/:name` and the bare read: 409 `ambiguous-in-namespace` → 200 with the enabled co-owner's item.
- `resolveActionByPackage`, and the REST route rung for a caller's package (`resolveRouteActionDeclaration`), a caller with no package or one whose closure holds both: refused → the enabled holder's declaration and its handler.
- The security catalog, a permission-set reference with no package column: refused → the enabled holder's set. `holdsPlatformPermissionSet` for that name: false → the enabled holder's platform verdict.

Same status, the disabled package no longer named:

- `?package=NONHOLDER`, `GET /meta/:type/:ns/:name` of a namespace that holds nothing, and `_env`, two holders: 409 naming both → 409 naming the enabled holder.
- An action or permission-set caller outside both closures: refused naming both → refused naming the enabled holder.

409 → 404:

- A name only disabled packages hold, on `_env`, `?package=NONHOLDER` and its qualified path: 409 naming the disabled package → 404.

Refused → not-found:

- A stored permission-set column naming the disabled holder: refused naming both (it was read as a stale column) → not-found. It conferred nothing before and confers nothing now, and it is never re-targeted to the enabled holder.

Degraded → 409:

- The REST action rung: a package-scoped refusal the protocol's execution read throws → the declaration's `refusal`, answered as the declared `409 RESOURCE_CONFLICT`, where it was swallowed as `degraded`. No door makes that read throw one for an `action` today.

**Not moved.** `?package=DISABLED` and the disabled package's namespace keep their 404. Every holder's own read, the served lists, and a name only disabled packages hold on the bare read (404) answer as before. Durable judgments read every holder, so a binding never moves with a reversible disable: the four stored-reference backfills (R1/R3 permission sets, R4 activation ledger, R5/R6/R13 sharing declarations, R20 email templates), the CLI stored-reference report (`os migrate stored-references`), and the picklist verdict that the load audit, the install door and a field's options share. The install gate (`bareNamePackageHolders`) and the security catalog's item seam are separate reads and are not touched.

**Also in this change, not breaking.** `SchemaRegistry.packageScopedHoldersOf(type, name, callerPackageId?, options?)` takes `options.includeDisabledPackages` (the option name `listItems` already carries) to read every holder, and `resolvePackageScopedName`'s query takes `includeDisabledPackages`, forwarded to it.
