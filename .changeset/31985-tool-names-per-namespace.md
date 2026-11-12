---
'@objectstack/objectql': minor
'@objectstack/core': minor
'@objectstack/metadata': minor
---

feat(objectql)!: two packages of two namespaces may each ship a tool of the same name, and the metadata service keeps each package's tool under its own (package, name) slot (ADR-0150 child B)

Clause-②: yes (narrowing) — widened: the engine's package door (`SchemaRegistry.installPackage`), its item seam (`SchemaRegistry.registerItem`) and the cold boot's holder seal (`SchemaRegistry.sealBareNameHolders`) accept, for a tool, a second package holder they refused before: one that declares a namespace other than the holder's. Narrowed: `tool` joins `PACKAGE_SLOTTED_STORE_TYPES` (`@objectstack/metadata`) in the same change, as that set's rule requires, so the metadata service's in-process answers for a tool move the way they moved for the other types stored per package: (1) `MetadataManager.get('tool', NAME)` and `getDiagnosed` naming no package, of a name two packages hold, are refused `409 RESOURCE_CONFLICT` (`ambiguous-in-environment`, naming both) where they answered the item registered (or saved) last; (2) `get('tool', NAME, PKG)` and `getDiagnosed`, where `PKG` holds no slot of the name and another package does, answer `undefined` where they answered the stored item (the one holder's, or the survivor of two); (3) `unregister('tool', NAME)` naming no package, of a name two packages hold, is refused the same way before anything is deleted or announced, and so is a rollback of a name whose rows are two packages', or one package's beside the name's package-less row; (4) `DatabaseLoader.delete` naming no package of a name two packages hold is refused, where it deleted the first row; (5) `MetadataManager.getHistory`, `diff` and `rollback` of a tool name two packages saved through `DatabaseLoader`, naming no package, are refused `409 RESOURCE_CONFLICT` naming both, where they answered every version of the one row both saves wrote, and a rollback to a version a removed package wrote is refused where it wrote that version into the remaining holder's row. First-party callers of these in-process reads and writes for a tool: 0 (no production source calls `get`, `getDiagnosed`, `unregister`, `getHistory`, `diff` or `rollback` with the literal type `tool`; first-party tool records in `examples/`: 0). On a booted stack no HTTP or MCP door moves from served to refused: `/meta/tool/NAME` and `/meta/tool/NAME/layers` read through the protocol, which already resolved a tool by `(package, name)` (ADR-0150 child E8).
Metadata-protocol: added

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped and no stored row changes shape: what moves is which second package an install admits for a tool name, and which stored tool item an in-process read of the metadata service answers; nothing an author writes needs converting -->

**BREAKING** for five in-process answers of the metadata service for a tool (first-party count: 0), listed above under the declaration line. The fix for each:

- FROM `get('tool', NAME)` of a two-holder name TO `get('tool', NAME, PKG)`, a package the refusal names.
- FROM `get('tool', NAME, PKG)` for a package that does not hold the name TO `get('tool', NAME, HOLDER)`, the holding package (the bare read's refusal, or `list`, names it).
- FROM `unregister('tool', NAME)` of a two-holder name TO `unregister('tool', NAME, { packageId })`, or `unregisterPackage(PKG)`.
- FROM a rollback or a `DatabaseLoader.delete` by name of a two-holder name TO the same call naming the package, or removing the extra row first.
- FROM `getHistory('tool', NAME)` / `diff('tool', NAME, …)` of a name two packages saved TO the same call with `{ packageId }`, once per package.

The bare-name one-holder rule (`bare-name-one-holder.ts`) has narrowed for `tool` from one package holder per deployment to one per namespace (ADR-0150 D2, D9), as it did for `agent`, `skill`, the object-less `action`, `email_template`, `flow` and the picklist family. The switch, `NAMESPACE_SCOPED_BARE_NAME_TYPES`, lives in `@objectstack/core` (`package-scoped-resolution.ts`) and `@objectstack/objectql` re-exports it under the same name. A package's `tool` record has one by-name reader, `GET /meta/tool/NAME`, which already answers by `(package, name)`: it refuses `409 RESOURCE_CONFLICT` naming every served holder when two packages hold the name, and `?package=ID` and `/meta/tool/NAMESPACE/NAME` serve that package's own. A disabled package holds no name for that read (ADR-0150 D3): of two namespaces' holders, one disabled, the bare read serves the enabled one, and refuses naming both again once it is re-enabled. The install door still counts every installed holder, disabled or not. So a package no longer has to rename a tool because a package of another namespace already ships one of that name.

The metadata service stores a tool per `(package, name)` (`PACKAGE_SLOTTED_STORE_TYPES`, now `api`, `agent`, `skill`, `action`, `email_template`, `permission`, `flow`, `picklist`, `mapping`, `dataset` and `tool`), by the rules `package-slotted-store.ts` already applies to the others:

- The in-memory store keeps both packages' tools of one name; `list('tool')`, `loadMany('tool')`, `loadManyKeyed('tool')` and `GET /meta/tool` answer both, where they answered the survivor.
- `DatabaseLoader.save` of a tool: FROM one `sys_metadata` row per name with `package_id` empty TO one row per `(package, name)` with `package_id` filled; versions are numbered per name across the packages' rows, and each history row records the package whose row it snapshots. A legacy tool row the loader wrote before this release binds on its package's next save, or through `migrateDatabaseLoaderRowPackages(driver)` (`@objectstack/metadata/migrations`), which now covers `tool` rows too and can be re-run any number of times.
- Fixed, on an artifact boot (`os dev`, `os start`): `GET /meta/tool/NAME/layers?package=PKG`, for a name two packages hold, FROM the other package's body (code and effective layer) TO that package's own.
- A composition whose metadata engine reads a tool through `getItem` (its registry's `readsByPackage('tool')` answers `false`) now refuses a bare `/meta/tool/NAME` read `501 NOT_IMPLEMENTED`, as it refuses every narrowed type it cannot judge. `SchemaRegistry` answers `true` for `tool` (ADR-0150 child E8), so no in-repo composition moves.

Unchanged, and still refused with the same `422 NAMESPACE_CONFLICT` envelope and sentence:

- a second package of the SAME namespace (a co-owner) holding the name: for a tool that is the namespace co-owner rule's `NamespaceNameConflictError` (child N), which judges a tool ahead of this rule at every install, boot included, exactly as before;
- a package that declares no namespace, beside any other holder of the name (a disabled one included), and any holder beside it;
- two packages of one shareable namespace (`base`, `system`, `sys`) holding the name;
- a built-in name (none for a tool: the platform requests no tool record by name).

Every covered type not yet narrowed (webhook, connector) keeps one package holder per deployment.

`os migrate stored-references` no longer lists two namespaces' holders of one tool name among the sealed clashes: they are not a clash.

Carried to the cloud: the first cloud change that reads package `tool` records (today the cloud's tool registry and a skill's `tools` resolve against the AI service's live registry, never a `tool` record) must resolve a name from the referring item's own package (ADR-0150 D3), refuse a name two packages hold naming every candidate, and never take the first one registered. `packages/spec/liveness/tool.json` records that precondition.
