# @objectstack/objectql

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/formula@9.5.0
  - @objectstack/metadata-core@9.5.0
  - @objectstack/types@9.5.0

## 9.4.0

### Minor Changes

- 0856476: feat(metadata): package-scoped single-item resolution via `?package=` (ADR-0048)

  A single-item metadata GET (`/meta/:type/:name?package=<id>`) now resolves
  package-scoped (prefer-local): when two installed packages ship an item of the
  same `type`/`name`, the requester's own package wins. Previously only the _list_
  endpoint was package-aware; a single-item fetch was context-free, so a
  cross-package collision always resolved to whichever package registered first.

  The fix threads `packageId` end-to-end:

  - `@objectstack/rest` — the cacheable single-item path called `getMetaItemCached`
    (ETag keyed on type+name only) and dropped `?package=`. A `?package=` read now
    bypasses that cache and takes the disambiguating `getMetaItem(type, name,
packageId)` path, so two same-named items never share one cache entry.
  - `@objectstack/objectql` — `protocol.getMetaItem` forwards `packageId` to the
    overlay query (`sys_metadata.package_id`), `MetadataFacade.get`, and
    `registry.getItem`; `MetadataFacade.get` gained an optional `currentPackageId`.
  - `@objectstack/runtime` — the parallel HTTP dispatcher threads `?package=` too.

  This lets the doc viewer (`/apps/:packageId/docs/:name`) resolve one doc scoped
  to its app, so `doc` names no longer need a namespace prefix for uniqueness (the
  prefix becomes a recommended convention, like `page`/`dashboard`/`report`);
  `doc.zod` doc-comments updated accordingly.

- fef38ec: feat(metadata): package-scoped customization overlays (ADR-0048 #1824)

  A `sys_metadata` customization overlay is now keyed by `(type, name,
organization_id, package_id)`, so two installed packages shipping an item of the
  same `type`/`name` can each carry their **own** overlay. Previously the overlay
  uniqueness key was `(type, name, organization_id)` — physically one row per
  name — so customizing one package's item shadowed both, and a package-scoped
  read fell back to whichever row existed.

  - **Index**: `idx_sys_metadata_overlay_active` / `…_draft` now include
    `package_id`. The runtime migration (`ensureOverlayIndex`) uses
    `COALESCE(package_id, '')` so package-less (global) overlays stay unique among
    themselves (a plain unique index treats NULLs as distinct). DROP-then-CREATE,
    idempotent; existing rows migrate safely (the old key already guaranteed one
    row per `(type, name, org)`).
  - **Write**: `SysMetadataRepository.whereFor`/`put`/`get` scope the upsert to the
    requested package, so a save bound to package B no longer finds and overwrites
    package A's same-name overlay. A package-less save (`packageId` null) targets
    the global row.
  - **Read**: `getMetaItem` / `getMetaItemLayered` overlay lookups already prefer
    the package-scoped row; the fallback now resolves only the **global**
    (`package_id IS NULL`) overlay, never a _different_ package's row. Package-less
    readers are unchanged (match-any, back-compat).

  Verified live against a real collision (two packages each shipping
  `page/showcase_task_workbench`): two overlay rows coexist, and `?package=` single
  reads + the `?layers=true` Studio editor view each return that package's own
  overlay; the unique index migrated in place.

  Known follow-up: the _unscoped list_ (`GET /meta/:type` with no `?package=`)
  still dedupes by bare name, so when two packages both carry an overlay on the
  same name the list collapses them — the per-package single-item and editor paths
  are unaffected. Tracked for the list-dedup-by-name work.

- b678d8c: feat(objectql): ADR-0048 Phase 1+2 — namespace install gate + package-scoped resolution

  Phase 1 — install-time namespace gate. `SchemaRegistry.installPackage` refuses a
  package whose `manifest.namespace` is already owned by a DIFFERENT installed
  package (new `NamespaceConflictError`), making explicit and early the constraint
  the table layer already enforces implicitly. Same-package reinstall and
  shareable platform namespaces (`base`/`system`/`sys`) are exempt;
  `OS_METADATA_COLLISION=warn` downgrades to a warning.

  Phase 2 — prefer-local resolution, pivoted to ADR-0048 option A (package id as
  the routing key). `getItem(type, name, currentPackageId?)` prefers
  `${currentPackageId}:${name}` before any cross-package fallback (ADR-0005 overlay
  precedence and backward compatibility unchanged); `getApp(name,
currentPackageId?)` resolves prefer-local by package id. Because package ids are
  globally unique, package-scoped resolution always disambiguates two distinct
  packages — so the old per-item CROSS-package throw (and the now-dead
  `MetadataCollisionError`, `findOtherPackageOwner`, `SYS_METADATA_OWNER`, …) is
  retired; two different-namespace packages legitimately coexist on the same bare
  name. `collisionPolicy` now governs only the Phase 1 namespace gate.

- b678d8c: feat(objectql): opt-in `sys_metadata` hydration for isolated project kernels

  Boot Phase-2 hydration (`restoreMetadataFromDb` → `loadMetaFromDb`, which
  registers objects WITH their fields into the `SchemaRegistry`) was gated on
  `environmentId === undefined`, assuming every project kernel sources its
  metadata from a remote artifact / control-plane proxy. That is untrue for an
  isolated, proxy-free project kernel that persists its OWN `sys_metadata`
  locally (the cloud single-env tenant runtime): objects created at runtime there
  never re-entered the registry after a restart, so `registry.getObject(name)`
  returned nothing and every registry consumer silently degraded (notably the
  `engine.find` unknown-`$select` guard, which then let an unknown projected
  column zero the result set).

  Adds an explicit `hydrateMetadataFromDb` plugin option (default `false`, so the
  control-plane/proxy path is untouched). When set, hydration runs even with
  `environmentId` defined — safe because each engine now owns its registry
  instance and `loadMetaFromDb` already tolerates a missing table.

### Patch Changes

- c1dfe34: fix(metadata): keep each colliding item's own `_packageId` provenance (ADR-0048)

  When two installed packages ship an item of the same `type`/`name`, the
  single-item and list reads grafted the artifact protection envelope from a
  **first-match** artifact lookup (`lookupArtifactItem(type, name)`), so the
  second package's item inherited the FIRST package's `_packageId`. The frontend
  prefer-local resolution (dashboard/report/page) filters the unscoped list by
  `_packageId`, so this mislabel made it resolve a collision to the wrong package
  (or fail to find the local item entirely).

  - `getMetaItem` now scopes the artifact lookup to `request.packageId`.
  - `getMetaItems` scopes the per-item decorate to the requested package (when the
    whole list is package-scoped) else to each item's own `_packageId`.

  `getItem` ordering is unchanged — a bare-key runtime/DB overlay still takes
  ADR-0005 precedence over the packaged item (clarifying comment added). An
  env-wide (package-less) overlay of a name that collides across packages remains
  inherently ambiguous by schema (`sys_metadata` is unique on `type+name+org`, not
  package); pure-artifact collisions (the marketplace default) now resolve and
  list correctly per package.

- 3e675f6: fix(metadata): package-scope the layered (Studio editor) read via `?package=` (ADR-0048)

  The `?layers=true` single-item read (the Studio metadata editor's 3-state
  code/overlay/effective view) ignored `packageId`, so editing one of two
  same-named items from different packages resolved ambiguously (first match).

  - `protocol.getMetaItemLayered` now threads `packageId` into the code layer
    (`metadataService.get` + `lookupArtifactItem` + `registry.getItem`) and the
    `sys_metadata` overlay query (`package_id` prefer-local).
  - `registry.getArtifactItem(type, name, currentPackageId?)` and
    `lookupArtifactItem` gained the optional package-scope hint.
  - `rest-server` threads `?package=` into the layered branch.

  This completes the per-route package-scoped resolution audit: the runtime
  render surface (dashboard/report/page/doc) was already scoped; this closes the
  Studio editor (`/apps/:appName/metadata/:type/:name`). Frontend counterpart
  sends `?package=` from the metadata list row's owning package.

- b678d8c: fix(objectql): seed reference resolution falls back to matching by `id`

  `SeedLoaderService.resolveFromDatabase` only matched a reference value against
  the target's natural-key field. A seed that wires a lookup to a REAL existing
  record by its internal id — e.g. a people field (approver/applicant → user)
  pointed at the current user — dangled to `null` when that id is not a
  UUID/ObjectId (so the caller's `looksLikeInternalId` guard did not
  short-circuit) and is not the target's natural key.

  Adds an id fallback: when the natural-key lookup finds nothing, try resolving
  the value as the target's `id`. Safe — an id either exists or it doesn't, so
  there is no risk of a false natural-key match, and it is tenant-scoped like the
  primary lookup.

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [fef38ec]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/metadata-core@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/formula@9.4.0
  - @objectstack/types@9.4.0

## 9.3.0

### Minor Changes

- 1ada658: ADR-0046 P1: package documentation as metadata. New `doc` metadata element — flat Markdown files under `src/docs/*.md` compile into `docs: DocSchema[]` on the stack and register like any other metadata.

  - spec: `DocSchema` ({ name, label?, content }) in `system/`, `StackDefinition.docs`, `doc` in `MetadataTypeSchema` + type registry (inert data, runtime-creatable) + canonical schema map, `docs → doc` plural mapping.
  - cli: `os build` collects flat `src/docs/*.md` (frontmatter `title:`/first `#` heading → label) and enforces the ADR lint — flat directory, namespace-prefixed snake_case names, namespace required when docs ship, MDX/image ban, same-package relative-link resolution. Same rules surface in `os lint`.
  - objectql: `docs` joins the generic metadata registration loop (manifest + nested plugins).
  - runtime: docs count as app payload; `GET /metadata/doc` list responses omit `content` by default (`?include=content` opts in) so unbounded manuals stay off hot paths.

- 6259882: ADR-0048: cross-package metadata collision detection. Bare-named generic metadata (`page`, `dashboard`, `flow`, `app`, `action`, `doc`, …) carries no package coordinate in the registry key (`org/type/name`), so two installed packages defining the same `(type, name)` would silently shadow each other at read time (`getItem` returns whichever the registry iterates first). The kernel only prefix-validates object names, leaving these types unguarded.

  `SchemaRegistry.registerItem` now refuses a cross-package base-layer collision — a real `packageId` registering a `(type, name)` already owned by a _different_ real package — with a `MetadataCollisionError` naming both packages and the type/name. `ObjectQL.registerApp` and the nested-plugin loop delegate to it, so manifest and plugin metadata are both covered.

  Legitimate same-key writes are unaffected: same-package reloads, runtime/DB overlays (ADR-0005, bare-key or `sys_metadata`-sentinel rows), object ownership/extension, and nav contributions all pass through. Policy is `error` by default; set `collisionPolicy: 'warn'` (or `OS_METADATA_COLLISION=warn`) to downgrade during a deliberate migration.

- b10aa78: Metadata registered through the metadata-service path now carries package provenance. `loadMetadataFromService` and `MetadataFacade.register` pass each item's own `_packageId` through to `registry.registerItem` so `applyProtection` stamps `_packageId`/`_provenance: 'package'` (never a synthetic id — `isArtifactBacked()` write authorization keys off `_packageId`). New `MetadataPluginOptions.packageId` lets hosts running the filesystem scanner declare the owning package id for scanned source-file metadata, closing the same gap for hand-wired kernels. GET /api/v1/meta/:type consumers (e.g. objectui NavigationSyncEffect) can now distinguish package-shipped items from user-authored rows without name heuristics.

### Patch Changes

- 2796a1f: Fix metadata registry pollution: a packaged artifact's protection envelope (`_lock`/`_packageId`/`_provenance`) survives overlay hydration and reset (ADR-0010 §3.3). GET-list hydration used to register the sys_metadata overlay body under the registry's plain key, shadowing the artifact — a `_lock: full` app read back as unlocked after PUT+GET, and DELETE (reset) left the stale shadow in place until restart. Envelope readers now resolve through the shadow-immune `SchemaRegistry.getArtifactItem()`, hydration grafts the artifact envelope onto the overlay body (overlay content wins, artifact protection wins), and reset heals the registry via `removeRuntimeShadow()` — including self-healing on a no-op DELETE.
- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/formula@9.3.0
  - @objectstack/metadata-core@9.3.0
  - @objectstack/types@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/formula@9.2.0
  - @objectstack/metadata-core@9.2.0
  - @objectstack/types@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/formula@9.1.0
  - @objectstack/metadata-core@9.1.0
  - @objectstack/types@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/formula@9.0.1
  - @objectstack/metadata-core@9.0.1
  - @objectstack/types@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/formula@9.0.0
  - @objectstack/metadata-core@9.0.0
  - @objectstack/types@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/types@8.0.1
- @objectstack/metadata-core@8.0.1
- @objectstack/formula@8.0.1

## 8.0.0

### Minor Changes

- b990b89: fix(autonumber): one owner for autonumber generation — the persistent driver sequence (#1603)

  Autonumber values were generated in TWO places: the SQL driver's persistent,
  atomic `_objectstack_sequences` table AND a non-persistent in-memory counter in
  the ObjectQL engine. Because the engine pre-filled the field BEFORE calling the
  driver, the driver always saw a value already set and skipped — so the
  persistent sequence was effectively dead code, and a multi-instance / post-restart
  deployment could mint duplicate numbers from the in-memory counter.

  This makes generation single-owner:

  - **`@objectstack/spec`** — `DriverCapabilities` gains an optional `autonumber`
    flag: "driver natively generates persistent autonumber/sequence values".

  - **`@objectstack/driver-sql`** — advertises `supports.autonumber = true`.
    `bulkCreate()` now fills autonumber fields too (previously only `create()` /
    `upsert()` did), so bulk inserts also draw from the persistent sequence.
    Field parsing now honors either the spec-canonical `autonumberFormat` key OR
    the `format` shorthand (both appear in metadata).

  - **`@objectstack/objectql`** — when the driver advertises native autonumber
    support, the engine NO LONGER pre-fills (it defers entirely to the persistent
    driver sequence as the single source of truth). For drivers without native
    support (memory, mongodb) the in-memory fallback is unchanged. The fallback
    also now reads either `autonumberFormat` or `format`. Record-validation
    exempts `autonumber` fields from the `required` check — the value is
    runtime-owned and assigned after validation, so a required record number is
    never rejected as "missing".

  No metadata changes required. Existing data is respected: the driver bootstraps
  each sequence from the current max numeric tail on first use.

- 99111ec: Field-level conditional rules (CEL): `visibleWhen` / `readonlyWhen` / `requiredWhen`, enforced server-side.

  Add three CEL-predicate field props (over `record`) evaluated on both sides. **Spec**: `visibleWhen` / `readonlyWhen` / `requiredWhen` (`requiredWhen` canonical; `conditionalRequired` kept as a back-compat alias). **Server (objectql)**: the validator now enforces `requiredWhen`/`conditionalRequired` over the merged record (so the rule can't be bypassed by a direct API write), and the update path ignores writes to a field whose `readonlyWhen` is TRUE (keeps the persisted value). `needsPriorRecord` accounts for conditional fields so the prior record is fetched on update.

- 9e2e229: feat(objectql): compute roll-up `summary` fields server-side

  The `summary` field type was declared in the spec but never computed — its value
  stayed empty. ObjectQL now recomputes roll-up summaries automatically: a parent
  field whose `summaryOperations` aggregates (`count`/`sum`/`min`/`max`/`avg`) a
  field across child records is recalculated whenever a child is inserted,
  updated, or deleted.

  - **`@objectstack/spec`** — `summaryOperations` gains an optional
    `relationshipField` (the child→parent FK). When omitted the engine
    auto-detects it from the child's `lookup`/`master_detail` field whose
    `reference` points back at the parent; set it explicitly only when the child
    has more than one such reference.

  - **`@objectstack/objectql`** — after `afterInsert` / `afterUpdate` /
    `afterDelete` on a child object, the engine finds the affected parent (from
    the child's FK, plus the prior FK on update/delete so a re-parented child
    updates both), re-aggregates the child collection, and writes the result onto
    the parent's summary field. It runs in the caller's execution context, so when
    a transaction is open (e.g. the cross-object `/api/v1/batch`) the rollup
    commits atomically with the child writes. A small index of child→summary
    descriptors is built lazily from the registry and invalidated on package
    registration.

  Empty collections roll up to `0` for `count`/`sum` and `null` for
  `min`/`max`/`avg`. This lets master-detail forms stop computing parent totals on
  the client — the server is now the single source of truth.

- 345e189: Robust multi-write transactions (ADR-0034). `engine.transaction()` now establishes an ambient transaction (AsyncLocalStorage) so every data operation during the callback — including internal reads performed while a write runs — binds to the active transaction's connection instead of asking the pool for another one and deadlocking on SQLite's single-connection pool. Adds a cross-object transactional batch endpoint (`POST /api/v1/data/batch`) with intra-batch `{ $ref: <opIndex> }` parent references, so a parent and its children can be created atomically in one transaction.

### Patch Changes

- e6374b5: fix(objectql): master_detail cascade delete + autonumber generation

  - `delete` now applies referential delete behavior for incoming relations: `master_detail` cascades to children (the parent owns the child lifecycle; only an explicit `restrict` deviates), `lookup` honors its `deleteBehavior` (default `set_null`). Recurses for grandchildren, depth-guarded, single-id deletes. Previously deleting a parent left its children orphaned.
  - `insert` now generates values for empty `autonumber` fields before required-validation (`max+1`, seeded per `object.field`, honors `autonumberFormat`). Previously a required autonumber was rejected as "missing" and autonumber fields were never populated.

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/formula@8.0.0
  - @objectstack/metadata-core@8.0.0
  - @objectstack/types@8.0.0

## 7.9.0

### Minor Changes

- ac1fc4c: feat(metadata): optional storage teardown on delete so "publish to preview" leaves no orphan table

  Object storage was create-only: `publishMetaItem` creates a table (`ensureObjectStorage`) but nothing ever dropped one — `deleteMetaItem` only tombstones the metadata row, leaving the physical table behind. That made the pragmatic "publish an object just to preview it with real data, then discard if wrong" loop leave residue.

  Adds the inverse path, opt-in and guarded:

  - `engine.dropObjectSchema(name)` — inverse of `syncObjectSchema`; resolves the table name + driver and calls the driver's existing `dropTable` (DROP TABLE IF EXISTS / drop collection).
  - `deleteMetaItem({ …, dropStorage })` — when `true`, drops the object's physical table after the metadata is removed. **DESTRUCTIVE**, so it is gated: `object` type only (others have no table), `active` state only (drafts were never materialised), and never a `sys_`-prefixed platform table. Default `false` keeps delete non-destructive to data. Best-effort: a drop failure is logged, not thrown.
  - REST: `DELETE /meta/:type/:name?dropStorage=true` threads the flag.

  This makes "publish to preview → discard" cleanly reversible. Combined with the draft-overlay read mode, it backs the team's chosen approach: lean on publish (into a dev sandbox) for data-level confirmation rather than building a full draft-data preview, and make that publish safely undoable.

- ac1fc4c: feat(metadata): draft-overlay reads so an admin can render the console off pending drafts before publish

  ADR-0033's loop is `build (draft) → review → publish`, but "review" was only a JSON diff — the one thing that actually confirms an AI/hand-authored change (the rendered object page / kanban / form / nav) only existed _after_ publish. That forces publishing unreviewed metadata just to look at it, defeating the draft gate.

  This adds a request-scoped **draft-overlay read mode** to the metadata resolution layer:

  - `getMetaItems({ …, previewDrafts })` — after the active overlay, overlays `state='draft'` rows on top (draft WINS on name collision; draft-only items surface too). Drafts are never hydrated into the process-wide SchemaRegistry.
  - `getMetaItem({ …, previewDrafts })` — non-strict: prefers a draft row if one exists, else falls back to the active value (unlike the strict `state:'draft'` mode, which 404s `no_draft`).
  - Every overlaid item is tagged `_draft: true` so the UI can badge it and show a "preview" banner.
  - The runtime HTTP dispatcher threads `?preview=draft` on `GET /metadata/:type` and `GET /metadata/:type/:name` into these reads.

  The same overlay also unblocks the AI authoring agent referencing its own just-drafted objects (a follow-up will point `list_metadata` at it). Admin gating of the `?preview=draft` flag is a deliberate follow-up step.

  Note: a brand-new draft object has no physical table until publish, so preview renders its _shape_ (form/view/kanban/nav) but shows no data; field-additions to existing objects preview fully.

- ac1fc4c: feat(packages): one-click discard-drafts and full delete for a package

  Two distinct package-level lifecycle operations, both built on the per-item delete primitive:

  - **`discardPackageDrafts(packageId)`** — drop every pending DRAFT bound to the package, reverting it to its last published baseline. NON-destructive: active/published metadata and physical tables are untouched. Use case: "I edited this app for a while and it turned out worse than before — abandon all my changes." Routes through the sys_metadata path (no metadata-service dependency, unlike the existing `POST /packages/:id/revert`, which 503s without a metadata service). REST: `POST /packages/:id/discard-drafts`.

  - **`deletePackage(packageId)`** — remove the ENTIRE package: every `sys_metadata` row (active + draft) and, by default, the physical table of each object it defined (DESTRUCTIVE). `keepData: true` removes metadata but preserves tables; the `sys_`-table guard still applies. Use case: "I don't want this package anymore." `DELETE /packages/:id` now performs this persisted removal in addition to the in-memory registry unregister it already did (previously it left AI/runtime packages' rows and tables behind); `?keepData=true` opts out of teardown.

  Drafts are deleted before active rows so each object's table is torn down exactly once. Per-item failures are collected without aborting the rest.

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/types@7.9.0
- @objectstack/metadata-core@7.9.0
- @objectstack/formula@7.9.0

## 7.8.0

### Minor Changes

- a75823a: feat(metadata): expose pending DRAFT metadata (ADR-0033 draft discoverability)

  AI-authored metadata lands as drafts (`sys_metadata` rows with `state='draft'`, bound to an app package), but the only list path — `getMetaItems` — reads the active registry, so drafts were invisible: a just-built app package looked empty and there was no "pending changes" surface.

  - `SysMetadataRepository.listDrafts({type?, packageId?})` lists draft rows (mirrors `list()` but scoped to `state='draft'`, optionally narrowed by package), returning a light header projection (no body) with `packageId`.
  - `protocol.listDrafts({packageId?, type?, organizationId?})` exposes it over the overlay repo.
  - `GET /api/v1/meta/_drafts?packageId=&type=` surfaces it to the console. Registered in the REST server before the greedy `/meta/:type` route (and mirrored in the dispatcher) so `_drafts` is never captured as a metadata type name.

  Read-only; no behavior change to existing list/publish paths. Powers the upcoming Studio "drafts/pending changes" view and draft-aware package contents.

- 4fbb86a: feat(packages): consolidate the package subsystem so AI-built app packages surface in Studio

  The package subsystem was split across two stores that never met: the in-memory
  `SchemaRegistry` (what the dispatcher's `/api/v1/packages` list/detail and
  `getMetaItems({type:'package'})` read — i.e. Studio's package selector) and the durable
  `sys_packages` table (where the AI's auto app package, and any `package`-service publish,
  were written). Nothing reconciled the two, so an AI-created `app.<name>` package never
  appeared in Studio.

  This unifies them around one write primitive and one read source:

  - **`protocol.installPackage`** is now implemented (it was declared-but-missing). It is the
    single canonical write path: it registers the package in the in-memory registry **and**
    best-effort persists it to `sys_packages` via the `package` service. Non-fatal when no
    `package` service is wired (registry write still succeeds).
  - **Dispatcher `POST /api/v1/packages`** routes through `protocol.installPackage` (falling
    back to the bare registry write when the protocol is unavailable), so HTTP installs are
    durable too.
  - **`@objectstack/service-package`** reconciles `sys_packages` back into the registry on
    boot, without clobbering filesystem-registered packages — so persisted packages survive a
    restart and stay visible in the registry-backed read paths.
  - **`@objectstack/service-ai`** `apply_blueprint` now homes an app via
    `protocol.installPackage` (falling back to the legacy `package`-service publish), so the
    app package lands where Studio reads it.

  Still the _legacy_ `package_id` plane — sealed `sys_package_version` versioning and
  cross-environment promotion remain ADR-0027 follow-ups.

- e631f1e: feat(metadata): publish a whole app's drafts in one shot (ADR-0033)

  After an AI builds an app, its metadata is drafted (bound to an app package) and
  had to be published one item at a time. The package-level `POST /packages/:id/publish`
  needs the `metadata` service (503 when absent, e.g. the showcase) and reads the
  in-memory registry, not the drafts.

  - `protocol.publishPackageDrafts({ packageId })` promotes every `sys_metadata`
    draft row bound to the package to active by reusing the per-item
    `publishMetaItem` primitive (overridable/lock guards + runtime registry
    refresh). Per-item failures are collected, not fatal. No `metadata`-service
    dependency.
  - `POST /api/v1/packages/:id/publish-drafts` exposes it (distinct from the
    registry-based `/publish`), returning `{ success, publishedCount, failedCount, published, failed }`.

  Verified live: an AI-built `app.asset_management` (4 drafts) published in one call —
  all 4 promoted to active, drafts cleared, draft objects became queryable.

- 36719db: fix: AI-built apps are usable immediately — sync new object tables on publish + emit valid kanban config

  Two gaps found by end-to-end testing of an AI-built app:

  1. **A freshly-published object couldn't accept records until a server restart.** Publishing a drafted object registered it in the in-memory registry but never created its physical table (table sync only ran at boot), so inserts failed with `object_not_found` ("no such table"). Added `ObjectQL.syncObjectSchema(name)` (a targeted, idempotent single-object schema sync) and call it from the publish paths (`protocol.publishMetaItem` and `saveMetaItem` mode:'publish', via `ensureObjectStorage`). Best-effort + non-fatal. New objects are now CRUD-able the moment they're published.

  2. **AI-generated kanban views rendered as plain lists** (and sometimes failed validation). The blueprint `viewBody` emitted `list.type:'kanban'` with no `kanban` config; `KanbanConfigSchema` requires `groupByField` **and** `columns`. Added an optional `groupBy` to the blueprint view schema (lenient + strict) and have `apply_blueprint` set `list.kanban = { groupByField, columns }` — using the view's explicit `groupBy` when given, else inferring the object's first `select` field. AI-built kanban views now validate, publish, and carry a real group-by field.

### Patch Changes

- 6fc2678: fix(metadata): stamp a top-level `name` on `view` bodies at the write path so AI/hand-authored views surface

  `getMetaItems` only overlays a `sys_metadata` row when its parsed body has a top-level `name`. Some view producers — notably loose `{ list: <ListView> }` / `{ form: … }` fragments that AI tools and hand-authoring emit — pass schema validation but carry no top-level `name`, so the view was silently dropped from the object's view list and never appeared as a tab ("validates ≠ surfaces").

  `saveMetaItem` now guarantees a top-level `name` on every view body at the single write chokepoint, BEFORE validation + persistence, so a nameless view is auto-corrected regardless of which authoring path produced it. It deliberately does NOT reshape the document: both the `defineView` container form (`{ list, listViews, … }`, expanded by the loader) and the `{ name, object, viewKind, config }` record form are valid and the console consumes both — reshaping a container into a record risks producing an invalid record (e.g. a non-`<object>.<key>` name) and drops Studio-only fields (`isPinned`, `sortOrder`, …). Exported as `normalizeViewMetadata` and unit-tested.

  (Note for follow-up: the `view` metadata schema is itself a permissive union — it accepts an unknown `viewKind`, a kanban config missing `groupByField`, even `{}`. Tightening it correctly requires first consolidating the four legitimate view shapes — record / container / flat list / flat form — and is a separate spec change.)

- Updated dependencies [06f2bbb]
- Updated dependencies [f01f9fa]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/formula@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/metadata-core@7.8.0
  - @objectstack/types@7.8.0

## 7.7.0

### Patch Changes

- 764c747: fix(metadata): home the metadata-storage objects in metadata-core and register them from ObjectQL

  Standalone "host config" apps boot without `@objectstack/metadata`'s MetadataPlugin, so nobody registered the metadata-storage objects (`sys_metadata`, `_history`, `_audit`, `sys_view_definition`) into ObjectQL — their tables were never schema-synced and ObjectQL's own protocol (`loadMetaFromDb` / `getMetaItems`) failed with `no such table: sys_metadata` on every read.

  - Move the four storage-object definitions from `@objectstack/platform-objects/metadata` to `@objectstack/metadata-core` (the lowest package shared by their real consumers); `platform-objects/metadata` now re-exports them for back-compat.
  - `ObjectQLPlugin` registers these objects itself (gated on `environmentId === undefined`, mirroring `restoreMetadataFromDb`) so their tables always sync on platform/standalone kernels.
  - Gate the SQL driver's tenant-audit warning on actual multi-tenant mode — `organization_id` now exists on every table, so column presence alone no longer implies "tenant-scoped"; single-tenant boots no longer spam the warning for system writes.

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [825ab06]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/formula@7.7.0
  - @objectstack/metadata-core@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/types@7.7.0

## 7.6.0

### Minor Changes

- 7648242: Enforce every declared validation-rule type on the write path; trim the three that can't be (#1475).

  The `validations` union advertised nine rule types but only three (`state_machine`,
  `cross_field`, `script`) ran on insert/update — the other six were accepted by the
  schema yet silently did nothing. This closes that gap on both sides: implement the
  synchronous types, and trim the ones that don't belong in a write-path rule.

  **`@objectstack/objectql` (additive):** the rule evaluator now enforces three more
  types, all deterministic, synchronous, side-effect-free predicates over one record:

  - `format` — a field value against a `regex` and/or a named format
    (`email` / `url` / `phone` / `json`). Runs only when the write touches the field
    and the value is non-empty; a malformed regex fails open.
  - `json_schema` — a JSON field validated against a JSON Schema via `ajv` (compiled
    result memoised per schema). Accepts a parsed object or a JSON string; an
    unparseable string is itself a violation; an uncompilable schema fails open.
  - `conditional` — evaluates `when`, then recurses into `then` / `otherwise`. The
    nested rule supplies the message; the outer conditional's `severity` decides
    blocking. `needsPriorRecord` now recurses into conditional branches.

  Adds `ajv` as a dependency and three error codes (`invalid_format`, `invalid_json`,
  `json_schema_violation`).

  **`@objectstack/spec` (breaking for unused declarations):** removes the
  `unique`, `async`, and `custom` validation-rule variants (and the
  `UniquenessValidationSchema` / `AsyncValidationSchema` / `CustomValidatorSchema`
  exports). They were never enforced and each needs I/O or a handler model a
  write-path rule must not carry. Use the layer that already does each correctly:
  uniqueness → a unique index (`ObjectSchema.indexes`, `partial` for scope) or
  field-level `unique: true`; async/remote → the client form layer; custom code →
  a `beforeInsert` / `beforeUpdate` lifecycle hook. Field-level `unique: true` is
  unaffected.

  `examples/app-showcase` demonstrates and verifies each newly-enforced type. See the
  ADR-0020 addendum for the rationale.

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/formula@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/types@7.6.0
  - @objectstack/metadata-core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/types@7.5.0
- @objectstack/metadata-core@7.5.0
- @objectstack/formula@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/types@7.4.1
- @objectstack/metadata-core@7.4.1
- @objectstack/formula@7.4.1

## 7.4.0

### Minor Changes

- 23c7107: ADR-0020 — converge the three "state machine" declaration shapes to one
  **enforced** `state_machine` validation rule.

  Before this change a record state machine could be declared three ways (a
  `workflow` metadata type, an `object.stateMachines` map, or a `state_machine`
  validation rule) and **none of them were enforced at runtime** — a declarative
  guardrail that was pure decoration, and a hallucination trap for AI authors.

  **Enforcement (`@objectstack/objectql`)**

  - New `validation/rule-validator.ts` evaluates the object's `validations` union
    on the write path: `evaluateValidationRules`, `needsPriorRecord`, and the
    `legalNextStates` introspection helper (all exported from the package root).
  - `state_machine` rules reject illegal `field` transitions on update (with the
    rule's `message`); `script` / `cross_field` predicate rules now also fire
    (they were silently broken on PATCH updates because only the patch, not the
    prior record, was available). The engine plumbs the prior record into
    rule evaluation on single-row update; multi-row (`updateMany`) updates log a
    warning and skip rule evaluation rather than enforce on incomplete data.

  **Convergence / retirement (`@objectstack/spec`) — breaking**

  - Retires the `workflow` metadata type (removed from the metadata-type enum,
    the registry, the schema map, the `workflows` collection key, and the
    plural→singular mapping).
  - Removes the `object.stateMachines` map and the `stack.workflows` array. The
    `state_machine` validation rule is the single canonical home.
  - The XState-style `StateMachineSchema` file is **kept** (still used by the
    agent conversation lifecycle and the discovery protocol); only its role as
    the `workflow` metadata-type backing schema was removed. The optional
    `workflow` **RPC service** surface (`CoreServiceName.workflow`,
    `/api/v1/workflow`, `IWorkflowService`) is kept as a documented follow-up.

  **Introspection (`@objectstack/runtime`)**

  - Adds `GET /metadata/objects/:name/state/:field?from=:state`, returning the
    legal next states for a field (`next: null` when no FSM governs the field,
    `[]` for a declared dead-end) so UIs/agents read the transition table instead
    of re-deriving it.

  **Surfaces (`@objectstack/platform-objects`, `@objectstack/cli`)**

  - Studio drops the standalone "Workflow Rules" nav (state machines are edited
    alongside the object's other validation rules).
  - `explain` no longer lists `workflow` as a related metadata type.

  Migration: replace a `workflow` / `StateMachineConfig` declaration with a
  `state_machine` validation rule on the object (`field` + `{ from: [allowedTo] }`
  transition table), and move any side-effecting actions (emails, task creation)
  into a record-triggered or scheduled Flow (ADR-0019). See the migrated
  `examples/app-crm` flows for the pattern.

- c72daad: ADR-0029 D7 — Setup app navigation contributions.

  Adds the UI-layer analog of object `own`/`extend`: a package can contribute
  navigation items into an app it does not own, so a shared admin app can be a
  thin shell while each capability plugin ships the menu for the objects it owns.

  - **`@objectstack/spec`** — new `NavigationContributionSchema` (`{ app, group?,
priority, items }`) and an optional `navigationContributions` field on the
    manifest.
  - **`@objectstack/objectql`** — `SchemaRegistry.registerAppNavContribution()`
    plus lazy merge in `getApp` / `getAllApps` (by target group id + priority,
    cloning so the stored app is never mutated); the engine wires
    `manifest.navigationContributions` during app registration.
  - **`@objectstack/platform-objects`** — the Setup app becomes a **shell** of
    empty group anchors; its entries for platform-objects-owned objects move to
    `SETUP_NAV_CONTRIBUTIONS`.
  - **`@objectstack/plugin-auth`** — registers `SETUP_NAV_CONTRIBUTIONS` alongside
    the Setup app it already registers.
  - **`@objectstack/plugin-webhooks`** — contributes its `Webhooks` /
    `Webhook Deliveries` entries into the Setup `group_integrations` slot (it owns
    `sys_webhook` / `sys_webhook_delivery` per K2.a), demonstrating end-to-end
    cross-plugin contribution.

  The rendered Setup nav is identical to the former static artifact — just
  assembled from its owners. A disabled/absent capability contributes nothing and
  its slot stays empty (in addition to the existing `requiresObject` gating).
  This unblocks moving each remaining K2 domain's menu out of the monolith with
  its objects.

- eea3f1b: ADR-0029 K0 + K2.a — single-owner invariant and webhooks ownership pilot.

  **K0 (`@objectstack/objectql`)** — add `SchemaRegistry.assertSingleOwnerPerObject()`,
  the install-time backstop for the kernel-decomposition invariant: every
  registered object must resolve to exactly one `own` contributor. A second
  cross-package owner is already rejected at registration time; this additionally
  catches "extend with no owner" (which would otherwise resolve to nothing). Call
  after kernel bootstrap completes.

  **K2.a (`@objectstack/plugin-webhooks` ← `@objectstack/platform-objects`)** — move
  the `sys_webhook` object definition out of the `platform-objects` monolith into
  `@objectstack/plugin-webhooks`, where it joins its sibling `sys_webhook_delivery`
  so the plugin owns both its data model and behavior as one unit. `sys_webhook` is
  no longer exported from `@objectstack/platform-objects` (or its `/integration`
  subpath, now an empty barrel); import it from `@objectstack/plugin-webhooks/schema`
  instead. Runtime behavior is unchanged — the webhook plugin already registered
  `sys_webhook` at runtime; only the definition's home moved. Setup-app navigation
  (which references `sys_webhook` by name) and existing i18n bundles (object-name
  keyed) continue to work. Per ADR-0029 D8, migrating the object's i18n extraction
  into the plugin is a tracked follow-up before the next translation regeneration.

- 2faf9f2: External Datasource Federation (ADR-0015) — write gate (Gate 3) + introspection plumbing.

  - Write gate: ObjectQL `insert`/`update`/`delete` now block writes to a
    federated datasource (`schemaMode !== 'managed'`) unless BOTH
    `datasource.external.allowWrites` and `object.external.writable` are true,
    throwing `ExternalWriteForbiddenError` (code `EXTERNAL_WRITE_FORBIDDEN`).
    Managed datasources (and objects without a datasource definition) are
    unaffected. New `registerDatasourceDef()` records declarative datasource
    ownership; manifests carrying `datasources` are indexed during `registerApp`.
  - `engine.introspectDatasource(name)` delegates to the named driver's
    `introspectSchema()`, wiring the external-datasource service end-to-end.

### Patch Changes

- a6d4cbb: Fix conditional & record-change flows silently skipping.

  Two bugs together caused every flow with a start-node / edge **condition** to
  silently skip (record-change triggers fired but the flow body never ran;
  audit-style `previous.*` gates and `budget > 100000`-style gates all evaluated
  to false):

  - **service-automation — CEL engine unreachable in ESM.** The condition
    evaluator loaded the formula engine via a CommonJS `require('@objectstack/formula')`.
    In the package's ESM build (`"type": "module"`) that resolves to tsup's
    throwing `__require` stub, so **every** CEL evaluation threw and the
    swallowing `catch` returned `false`. Replaced with a static top-level import,
    which binds correctly in both the ESM and CJS builds.

  - **objectql — prior record not exposed to update hooks.** `HookContext`
    documents a `previous` snapshot for update/delete, but `engine.update` never
    populated it (the row it fetched for validation was a local var). Record-change
    conditions like `status == "done" && previous.status != "done"` therefore had
    no `previous` to read. The engine now attaches the pre-update record to
    `hookContext.previous` for single-id updates whenever a validation rule needs
    it or an `afterUpdate` hook is registered.

  Both paths are covered by new unit tests.

- 58b450b: Make metadata labels follow the active UI language without a page refresh (#1319).

  The client now carries the active locale on every request (`Accept-Language`,
  `setLocale`/`getLocale`), the protocol ETag is locale-aware so cached metadata
  no longer collides across languages, and the `client-react` metadata hooks
  refetch when the locale changes. The `apps/account` console wires its router
  locale through so a language switch relabels server-resolved object/field/view
  labels in place instead of leaving the UI half-translated until reload.

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/core@7.4.0
  - @objectstack/formula@7.4.0
  - @objectstack/types@7.4.0
  - @objectstack/metadata-core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/formula@7.3.0
  - @objectstack/types@7.3.0
  - @objectstack/metadata-core@7.3.0

## 7.2.1

### Patch Changes

- 9096dfe: **`OS_` env-var prefix migration** (issue #1382).

  All ObjectStack-owned environment variables now use the `OS_` prefix. Legacy
  names still work for one release and emit a one-shot deprecation warning via
  the new `readEnvWithDeprecation()` helper in `@objectstack/types`.

  **Renamed (with legacy fallback):**

  | New                       | Legacy (deprecated)                                    |
  | :------------------------ | :----------------------------------------------------- |
  | `OS_AUTH_SECRET`          | `AUTH_SECRET`, `BETTER_AUTH_SECRET`                    |
  | `OS_AUTH_URL`             | `AUTH_BASE_URL`, `BETTER_AUTH_URL`, `OS_AUTH_BASE_URL` |
  | `OS_PORT`                 | `PORT`                                                 |
  | `OS_DATABASE_URL`         | `DATABASE_URL`                                         |
  | `OS_ROOT_DOMAIN`          | `ROOT_DOMAIN`                                          |
  | `OS_MULTI_ORG_ENABLED`    | `OS_MULTI_TENANT`                                      |
  | `OS_CORS_ENABLED`         | `CORS_ENABLED`                                         |
  | `OS_CORS_ORIGIN`          | `CORS_ORIGIN`                                          |
  | `OS_CORS_CREDENTIALS`     | `CORS_CREDENTIALS`                                     |
  | `OS_CORS_MAX_AGE`         | `CORS_MAX_AGE`                                         |
  | `OS_AI_MODEL`             | `AI_MODEL`                                             |
  | `OS_MCP_SERVER_ENABLED`   | `MCP_SERVER_ENABLED`                                   |
  | `OS_MCP_SERVER_NAME`      | `MCP_SERVER_NAME`                                      |
  | `OS_MCP_SERVER_TRANSPORT` | `MCP_SERVER_TRANSPORT`                                 |
  | `OS_NODE_ID`              | `OBJECTSTACK_NODE_ID`                                  |
  | `OS_METADATA_WRITABLE`    | `OBJECTSTACK_METADATA_WRITABLE`                        |
  | `OS_DEV_CRYPTO_KEY`       | `OBJECTSTACK_DEV_CRYPTO_KEY`                           |
  | `OS_HOME`                 | `OBJECTSTACK_HOME`                                     |

  **Migration:** rename in your `.env`. Legacy names continue to work this
  release and will be removed in a future major. Industry-standard names
  (`NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth
  `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`,
  `AI_GATEWAY_*`, `SMTP_*`) are NOT renamed.

- Updated dependencies [9096dfe]
  - @objectstack/types@7.2.1
  - @objectstack/spec@7.2.1
  - @objectstack/core@7.2.1
  - @objectstack/metadata-core@7.2.1
  - @objectstack/formula@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/types@7.2.0
- @objectstack/metadata-core@7.2.0
- @objectstack/formula@7.2.0

## 7.1.0

### Patch Changes

- 47a92f4: Promote `email_template` to a first-class metadata type using the canonical
  `EmailTemplateDefinitionSchema`.

  Previously `email_template` had two competing Zod schemas (Prime Directive
  #8 violation): the legacy `EmailTemplateSchema` (a sub-shape of
  `Notification`) and the richer `EmailTemplateDefinitionSchema`. The runtime
  metadata protocol (`packages/objectql/src/protocol.ts`) and Studio's
  property panel registered the legacy one, which is why all the new fields
  (`name`, `label`, `category`, `locale`, `bodyHtml`, `bodyText`, …) were
  reported as “declared in form layout but missing from schema”.

  This change:

  - Repoints the `email_template` entry in `TYPE_TO_SCHEMA`
    (`packages/objectql/src/protocol.ts`) and in
    `BUILTIN_METADATA_TYPE_SCHEMAS`
    (`packages/spec/src/kernel/metadata-type-schemas.ts`) to
    `EmailTemplateDefinitionSchema`. The legacy `EmailTemplateSchema` is
    kept only as an inline sub-shape inside `Notification`.
  - Adds an `emailTemplates` collection to `defineStack()` input
    (`packages/spec/src/stack.zod.ts`), registers it in
    `MAP_SUPPORTED_FIELDS`/`PLURAL_TO_SINGULAR`
    (`packages/spec/src/shared/metadata-collection.zod.ts`), wires it into
    `ARTIFACT_FIELD_TO_TYPE` (`packages/metadata/src/plugin.ts`) and
    `APP_CATEGORY_KEYS` (`packages/runtime/src/app-plugin.ts`).
  - Rewrites `packages/spec/src/system/email-template.form.ts` for the new
    schema with sections for Identity, Subject, HTML body, Plain-text body,
    Variables, Delivery overrides, Status.
  - Ships three reference templates in `examples/app-crm/src/emails/`:
    `crm.deal_won` (rewritten to canonical shape), `crm.welcome` (new),
    `crm.lead_followup` (new), and wires them into the CRM stack via
    `emailTemplates: Object.values(emails)`.

  End-to-end verified in Studio: list view at
  `/_console/apps/studio/metadata/email_template` shows all three entries;
  the detail view renders the EmailTemplatePreview iframe and the property
  panel cleanly renders every canonical field (no missing-schema warnings).
  `GET /api/v1/meta` now returns the new `properties` set
  (`name, label, category, locale, subject, bodyHtml, bodyText, variables,
fromOverride, replyTo, active, isSystem, description`).

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/formula@7.1.0
  - @objectstack/types@7.1.0
  - @objectstack/metadata-core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/formula@7.0.0
  - @objectstack/types@7.0.0
  - @objectstack/metadata-core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/types@6.9.0
- @objectstack/metadata-core@6.9.0
- @objectstack/formula@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/types@6.8.1
- @objectstack/metadata-core@6.8.1
- @objectstack/formula@6.8.1

## 6.8.0

### Minor Changes

- c8b9f57: Metadata Admin engine — protocol foundations.

  This is the backend half of the unified Metadata Admin shipped in the Setup
  app. The framework now exposes everything the engine needs to render a
  directory tile, schema-driven form, layered diff, references graph, and
  destructive-change confirmation for every registered metadata type.

  - **`GET /api/v1/meta/types`** is now type-rich. Each entry includes
    `{ icon, domain, schema (JSONSchema), allowOrgOverride, allowRuntimeCreate, supportsOverlay, ui? }`
    so the client can render without a second round-trip per type.
  - **`GET /api/v1/meta/:type/:name/references`** scans every registered
    metadata type for pointers to the given item (object fields, view sources,
    flow targets, permission objects, …) and returns the inbound edges so the
    UI can warn before deletes.
  - **`GET /api/v1/meta/:type/:name?layers=code,overlay,effective`** returns
    each layer separately rather than the merged effective document, powering
    the 3-state diff editor (code source / overlay / effective).
  - **Destructive-change detection** on `PUT /api/v1/meta/object/:name` and
    `PUT /api/v1/meta/field/:name`: rejects field type narrowing, required
    toggled on without a default, removed enum values, etc., unless the
    client opts in with `force=true`.
  - **Env-var registry patch:** `OBJECTSTACK_METADATA_WRITABLE=object,field,permission,view,…`
    flips `allowOrgOverride` on for the listed types at boot, enabling
    runtime overlays for production without re-deploying spec.
  - New guide: **[Adding a Metadata Type](../content/docs/guides/adding-a-metadata-type.mdx)**
    walks through registry entry + Zod schema + optional custom editor.

  Setup app navigation now uses the new component-route variant
  (`{ type: 'component', componentRef: 'metadata:directory' }`) — the temporary
  `/dev/meta` route is removed.

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/formula@6.8.0
  - @objectstack/types@6.8.0
  - @objectstack/metadata-core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/types@6.7.1
- @objectstack/metadata-core@6.7.1
- @objectstack/formula@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/formula@6.7.0
  - @objectstack/types@6.7.0
  - @objectstack/metadata-core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/formula@6.6.0
  - @objectstack/types@6.6.0
  - @objectstack/metadata-core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/types@6.5.1
- @objectstack/metadata-core@6.5.1
- @objectstack/formula@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/types@6.5.0
- @objectstack/metadata-core@6.5.0
- @objectstack/formula@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/formula@6.4.0
  - @objectstack/types@6.4.0
  - @objectstack/metadata-core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/types@6.3.0
- @objectstack/metadata-core@6.3.0
- @objectstack/formula@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/formula@6.2.0
  - @objectstack/types@6.2.0
  - @objectstack/metadata-core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/types@6.1.1
- @objectstack/metadata-core@6.1.1
- @objectstack/formula@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/formula@6.1.0
  - @objectstack/types@6.1.0
  - @objectstack/metadata-core@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/formula@6.0.0
  - @objectstack/types@6.0.0
  - @objectstack/metadata-core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/metadata-core@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/formula@5.2.0
  - @objectstack/types@5.2.0

## 5.1.0

### Patch Changes

- 75f4ee6: feat(metadata): introduce `executionPinned` capability for runtime version pinning (ADR-0009)

  Adds a new capability flag on the metadata type registry so that types whose runtime
  transaction rows reference a specific historical version (flow, workflow, approval)
  get unified pinning behavior — instead of every business table re-implementing its
  own snapshot column.

  - `MetadataTypeRegistryEntrySchema` gains `executionPinned: boolean`, enforced
    invariant `executionPinned ⇒ supportsVersioning`.
  - `flow`, `workflow`, `approval` flipped to `executionPinned: true`. `approval`
    also corrected to `supportsVersioning: true` (it was wrongly `false`).
  - `MetadataRepository.getByHash(ref, hash)` added to the interface. Production
    implementation in `SysMetadataRepository` resolves historical bodies through
    `sys_metadata_history` keyed by `(organization_id, type, name, checksum)`.
    In-memory and FS repositories serve HEAD-only matches.
  - `sys_metadata_history` gains an index on `(organization_id, type, name, checksum)`
    to keep hash lookups O(log n).
  - `HistoryCleanupManager` skips pinned types entirely (both age-based and
    count-based retention) — pinned-type history must never be GC'd.

  See `docs/adr/0009-execution-pinned-metadata.md` for full rationale and the
  list of rejected alternatives (no shared snapshot table, no inlined snapshot column).

- 823d559: Remove `sys_metadata_history.metadata_id` column.

  The column was originally a `Field.lookup` FK into `sys_metadata.id`,
  then downgraded to plain `text` during the M1 history-writes work so
  that DELETE tombstones could keep an orphaned ref. After M1 we
  concluded the column carries no business value:

  - Audit-time joins use `(organization_id, type, name, version)`,
    which is already a UNIQUE composite key.
  - The physical row id is a database-internal detail with no logical
    identity — it cannot follow an item through delete + recreate.
  - No code reader was ever added.

  This release removes the column outright:

  - Dropped `metadata_id` from `SysMetadataHistoryObject`
    (`@objectstack/platform-objects`).
  - Dropped `metadataId` from `MetadataHistoryRecordSchema`
    (`@objectstack/spec`).
  - `SysMetadataRepository.put`/`delete` no longer write the column.
  - Legacy `DatabaseLoader.createHistoryRecord` no longer writes it;
    `getHistoryRecord`/`queryHistory` filter by `(type, name)` directly
    (no parent-row lookup needed).
  - `MetadataHistoryCleanup` `maxVersions` policy groups by
    `(type, name)` instead of `metadata_id`.

  **Migration**: Drop the column from existing `sys_metadata_history`
  tables in a follow-up SQL migration. Existing history rows remain
  queryable since `(organization_id, type, name, version)` is already
  the canonical lookup key. No consumer code should be reading
  `metadata_id` — if you are, switch to `(organization_id, type, name,
version)`.

  See ADR-0008 §14 for the full rationale.

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/metadata-core@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/formula@5.1.0
  - @objectstack/types@5.1.0

## 5.0.0

### Minor Changes

- 5e9dcb4: **BREAKING — metadata: remove `project` and `branch` from `MetaRef`**

  The metadata layer no longer models project or branch. Customisation is now
  scoped purely to **organisation**. Project remains exclusively as an artifact
  packaging concept (the `objectstack.json` bundle envelope); branching is left
  to Git.

  What changed:

  - `MetaRef` is now `{ org, type, name, version? }` (was
    `{ org, project, branch, type, name, version? }`). `refKey()` is the two
    segment string `${org}/${type}/${name}` (was five segments).
  - `MetadataItem.seq` is monotonic **per org** (was per branch).
  - `BranchRef`, `MergeStrategy`, `MergeResult` types and the optional
    `fork`/`merge` methods on `MetadataRepository` are removed.
  - `ListFilter` / `WatchFilter` / `HistoryOptions` no longer accept `project`
    or `branch`.
  - `FileSystemRepository` disk layout simplified to
    `<root>/<type>/<name>.json` (was `<root>/<project>/<branch>/<type>/<name>.json`);
    change-log path is now `.objectstack/.log/main.jsonl` regardless of any
    branch concept. Constructor no longer accepts `project` / `branch`.
  - `SysMetadataRepository`: removed `projectLabel` / `branchLabel` options;
    the `sys_metadata` schema's `project_id` / `branch` columns (if present)
    are ignored. A future major release will `DROP` them.
  - `MetadataManager.setRepository(repo, opts)` no longer takes an opts object
    with `branch`.

  Migration:

  ```diff
  -const ref = { org: 'acme', project: 'crm', branch: 'main', type: 'view', name: 'home' };
  +const ref = { org: 'acme', type: 'view', name: 'home' };

  -new FileSystemRepository({ root, org: 'acme', project: 'crm', branch: 'main' });
  +new FileSystemRepository({ root, org: 'acme' });
  ```

  Existing `sys_metadata` rows continue to load; the deprecated columns are
  ignored at read time.

- f139a24: Subscribe `ObjectQLPlugin` to `metadata.subscribe('object', …)` so the
  `SchemaRegistry` merge cache is invalidated and the affected object
  re-registered on every object metadata change (ADR-0008 M0 PR-7).

  Combined with the PR-6 metadata ↔ repository bridge, this closes the
  Studio HMR loop end-to-end: editing an object definition (file, REST
  write, or Studio inline edit) emits a `MetadataEvent`, which flows
  through `MetadataManager.subscribe('object', …)` into ObjectQL, which
  drops the cached merged definition and re-fetches the canonical body
  from the metadata service. Subsequent reads see the new schema with
  no server restart.

  Additions:

  - `SchemaRegistry.invalidate(fqnOrName)` and `invalidateAll()` —
    public hooks for event-driven cache eviction; contributors are
    preserved so `resolveObject` recomputes against the next call.
  - `ObjectQLPlugin.start()` wires the subscription when the metadata
    service exposes `subscribe()`. The handler invalidates, re-fetches
    via `metadata.get('object', name)`, and re-registers with the
    original `packageId` / `namespace`. Deletes only invalidate.
  - `ObjectQLPlugin.stop()` drains the subscription handles so test
    reloads don't leak watchers.

- 2f7e42a: ADR-0008 M0 PR-10b: introduce `SysMetadataRepository` — a
  `MetadataRepository` wrapper over the existing `sys_metadata` table.
  M0 keeps single-row update semantics (append-only event log is M1
  work). Whitelist enforcement, optimistic locking via content hash,
  and in-process watch fan-out are all live. Not yet wired into any
  production write path — PR-10c will compose it under a
  LayeredRepository.
- 888a5c1: PR-10d.3 — feature flag for `SysMetadataRepository.put` write path in `saveMetaItem`.

  - `ObjectStackProtocolImplementation` now accepts an `options.useRepositoryWritePath` flag
    (also honored via `OBJECTSTACK_USE_REPOSITORY_WRITE_PATH=1`) that routes overlay writes
    through `SysMetadataRepository.put`, appending to the change-log and emitting HMR `seq`.
  - `saveMetaItem` request grew optional `parentVersion` (If-Match) and `actor` fields.
    `ConflictError` is mapped to a 409 `metadata_conflict` API error.
  - Plural metadata type aliases (`views`, `dashboards`, ...) are normalized to singular
    before the repo's overlay-allowlist gate.
  - `SysMetadataRepository.put`/`delete` now update/delete by row `id` (the engine's
    strict `.update` semantics require an id or `multi:true`).
  - `sys_metadata.checksum` column widened from 64 → 71 chars to hold the `"sha256:"`
    prefix produced by `hashSpec()`.
  - Default behaviour unchanged: legacy raw-engine path remains until PR-10d.4 flips the
    flag and removes it.

- 09f005a: PR-10d.5 — Flip default of `useRepositoryWritePath` to `true`.

  `saveMetaItem` now routes overlay-allowed metadata types (view, dashboard,
  report, email_template) through `SysMetadataRepository.put` by default —
  every write appends to the change log and emits a watch event with a
  monotonic `seq` for HMR / replay.

  Non-overlay-allowed types (`object`, `flow`, `agent`, ...) still take the
  legacy raw-engine path. This preserves control-plane bootstrap behaviour
  (which writes `object`/`flow` definitions via `saveMetaItem` and is
  permitted by the outer protocol gate to write any type when `projectId`
  is undefined).

  Opt-out remains available during the deprecation window:

  - Constructor: `new ObjectStackProtocolImplementation(engine, …, { useRepositoryWritePath: false })`
  - Env var: `OBJECTSTACK_USE_REPOSITORY_WRITE_PATH=0`

  The legacy raw-engine branch for overlay-allowed types is scheduled for
  removal in PR-10d.6 once this default has soaked for one release.

### Patch Changes

- 4eb9f8c: ADR-0008 M0 PR-10a: pin overlay-whitelist + canonical-hash invariants
  before re-expressing the overlay path as a LayeredRepository. No
  runtime change — adds 28 regression tests that fail loud if a future
  PR weakens the shared-DB tenancy contract or breaks hash stability.
- 602cce7: test(objectql): integration coverage for `LayeredRepository` composed of
  `SysMetadataRepository` (top, writable overlay) over `InMemoryRepository`
  (bottom, artifact baseline). Verifies read fallthrough, overlay-wins
  precedence, write routing, delete behavior, event source tagging across
  layers, and merged-list semantics. Part of ADR-0008 PR-10c.
- 1e625b8: feat(objectql): hash-compat dry-run probe for the legacy → repository
  write-path migration (ADR-0008 PR-10d.1). Pure-function `runDryRun()` plus
  a CLI (`scripts/dry-run-hash-compat.ts`) that audits a snapshot of
  `sys_metadata` for invalid JSON, non-object bodies, unstable hashes across
  canonical round-trip, and duplicate overlay keys. Exits non-zero when
  incompatibilities are found. 14 unit tests covering happy paths, error
  classifications (`invalid_json`, `non_object_body`, `unstable_hash`,
  `missing_metadata`, `duplicate_overlay_key`), and boundary conditions
  (empty snapshot, deep nesting, unicode).
- 6ee42b8: fix(objectql): SysMetadataRepository reuses the existing `checksum` column
  instead of writing a non-existent `_hash` column (ADR-0008 PR-10d.2). The
  production `sys_metadata` schema (`packages/platform-objects`) already
  ships with `checksum: text(64)` — perfect for sha256 hex — and `version:
number` for the monotonic counter. No DDL migration is required for
  PR-10d.3 cutover; legacy rows with NULL checksum will be lazily
  backfilled on first put().

  Also extends the PR-10d.1 dry-run probe with two new checks
  (`checksum_missing` warning, `checksum_drift` error) and three additional
  tests, taking objectql to 325/325 green.

- 5cfdc85: PR-10d.4 — REST plumbing for the metadata repository write path.

  - `PUT /api/v1/meta/:type/:name` (and the compound `:type/:section/:name` variant)
    now forwards the `If-Match` header to `saveMetaItem` as `parentVersion`, and
    `X-Actor` (or `req.user.id`) as `actor`. ETag-style quotes are stripped.
  - A failed optimistic-lock check surfaces as HTTP 409 with body
    `{ "error": "...", "code": "metadata_conflict" }` (no protocol changes —
    `sendError` already honoured `error.status` + `error.code`).
  - Added a real-engine integration test for the repository write path
    (`protocol-save-meta-repo-path-real-engine.test.ts`) — addresses the
    PR-10d.3 rubber-duck stub-drift concern by exercising
    `ObjectStackProtocolImplementation.saveMetaItem` through `new ObjectQL()`
    with an inline in-memory driver. Covers insert→update version bump,
    parentVersion conflict, checksum length, and plural→singular normalization.

  Default behaviour unchanged: the repository write path remains opt-in via
  `options.useRepositoryWritePath` / `OBJECTSTACK_USE_REPOSITORY_WRITE_PATH=1`.
  Flag flip and legacy path removal will follow in a separate post-soak PR.

- 7825394: PR-10d.6 — remove `useRepositoryWritePath` feature flag.

  Overlay-allowed metadata types (`view`, `dashboard`, `report`,
  `email_template`) now unconditionally route through
  `SysMetadataRepository.put` (change-log + HMR `seq`). The legacy
  raw-engine branch is retained for non-overlay types (`object`, `flow`,
  `agent`, etc.) used during control-plane bootstrap, since the repository
  `assertAllowed()` whitelist would reject them.

  Removed:

  - `ObjectStackProtocolImplementation` constructor option
    `{ useRepositoryWritePath: boolean }`.
  - `OBJECTSTACK_USE_REPOSITORY_WRITE_PATH` environment variable.

  There is no opt-out: behavior is now equivalent to the PR-10d.5 default.

- 96ad4df: Fix dev-mode HMR data-reload for `*.view.ts` / `*.flow.ts` source-file edits.

  Three coordinated fixes close the long-standing gap where editing a
  declarative-metadata source file in dev (e.g. `case.view.ts`) would
  recompile `dist/objectstack.json` but the running server kept serving
  the stale boot-time value:

  1. **`@objectstack/objectql`** — `ObjectStackProtocolImplementation.getMetaItem`
     now consults `MetadataService` (HMR-aware) **before** the in-memory
     `SchemaRegistry` (boot-time cache). Previously the registry shadowed
     freshly-registered values: `manager.register('view','case',newDef)`
     updated MetadataManager but `getMetaItem` returned the stale registry
     copy because step 2 (registry) ran before step 3 (service). Reordered
     to "1. sys_metadata overlay → 2. MetadataService → 3. SchemaRegistry".

  2. **`@objectstack/runtime`** — `createStandaloneStack` now enables the
     `MetadataPlugin` artifact-file watcher in non-production environments
     (`NODE_ENV !== 'production'`). Previously hard-coded to `watch: false`,
     leaving nothing watching `dist/objectstack.json` when the CLI dev mode
     recompiled it.

  3. **`@objectstack/metadata`** & **`@objectstack/metadata-fs`** — Both
     chokidar watchers now use `usePolling: true` to avoid `fs.watch`
     EMFILE on macOS / busy dev hosts where the native file-descriptor
     pool can be exhausted by other long-running node processes.

  With these three changes:

  - CLI edits source → recompile artifact (~400ms)
  - Server's polling chokidar detects artifact change → `_loadFromLocalFile`
  - `_loadFromLocalFile` calls `manager.register(type, name, item)`
  - MetadataService now has the fresh value
  - Read path returns the fresh value via the new step-2 lookup
  - Studio SSE listeners re-render

- Updated dependencies [5e9dcb4]
- Updated dependencies [4150fe4]
- Updated dependencies [8337cdb]
- Updated dependencies [58835a6]
- Updated dependencies [8cc30b4]
- Updated dependencies [32ce912]
- Updated dependencies [2f9073a]
  - @objectstack/metadata-core@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/formula@5.0.0
  - @objectstack/types@5.0.0

## 4.2.0

### Minor Changes

- 2869891: feat: Optimistic Concurrency Control (OCC) via `If-Match`

  Update and Delete requests now accept an optional version token. When supplied,
  the protocol compares it against the record's current `updated_at` (or `version`
  column when available) and rejects with `409 CONCURRENT_UPDATE` on mismatch,
  preventing silent overwrites when two clients edit the same record.

  **Wire formats** (opt-in, all server- and client-backward-compatible):

  - `PATCH /data/{object}/{id}` — supports `If-Match: "<token>"` header
    _or_ `expectedVersion: "<token>"` body field (body wins when both present).
  - `DELETE /data/{object}/{id}` — supports `If-Match` header _or_
    `?expectedVersion=...` query param.
  - Conflict response: `409 { error, code: 'CONCURRENT_UPDATE', currentVersion,
currentRecord }` so the client can offer Reload / Overwrite / Cancel UX.

  **Behaviour**

  - Missing/empty version → no check (legacy callers unaffected).
  - Record not found during the version probe → no check; the downstream write
    produces a normal `404`.
  - Object has no `updated_at` column → no check (explicit opt-out for objects
    without timestamps).
  - Quoted RFC-7232 tokens (`"…"`) are accepted and unquoted before comparison.

  **Client**

  `client.data.update(resource, id, data, { ifMatch })` and
  `client.data.delete(resource, id, { ifMatch })` now forward the token as an
  `If-Match` header.

  Application-level CAS (findOne + compare in protocol.ts) is used in this slice
  to avoid touching every storage driver. A small TOCTOU window remains; for the
  B2B record-editing latencies this protects against, it is more than sufficient.
  Drivers may later be upgraded to atomic `WHERE id=? AND updated_at=?` writes
  for true CAS without changing the public API.

  Tests: 7 new cases in `protocol-data.test.ts` cover opt-in, match, mismatch,
  quote-stripping, no-timestamps, empty-token, and the delete path.

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/formula@4.2.0
  - @objectstack/types@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/types@4.1.1
- @objectstack/formula@4.1.1

## 4.1.0

### Minor Changes

- f0b3972: **Driver-level tenant isolation for objects with `organization_id`.**

  `SqlDriver` now auto-applies a `WHERE organization_id = :tenantId` predicate on every read/update/delete and auto-injects the column on insert when the caller passes `options.tenantId` and the object schema declares an `organization_id` field. `bulkCreate`, `bulkDelete`, `updateMany`, `deleteMany`, `count` and `aggregate` are all scoped.

  ObjectQL's engine now threads `ExecutionContext.tenantId` into the driver options for every CRUD entry point (including `expandRelatedRecords`), so a tenant-scoped session can no longer cross tenants — even through lookup expansion or count fallbacks.

  Backward compatible: callers that omit `tenantId` (system tasks, seed scripts) keep getting unscoped behaviour. Explicit `organization_id` on an insert row always wins over the contextual `tenantId` so admin tooling can still target a specific tenant.

  13 new tests in `sql-driver-tenant-scope.test.ts` verify cross-tenant find/findOne/update/delete/count/bulkCreate/updateMany/deleteMany isolation, the unscoped admin path, and that global objects (no `organization_id`) are not scoped.

### Patch Changes

- 5683206: Document the tenant-isolation bypass on raw `execute()` (both `SqlDriver.execute()` and `engine.execute()`). The behaviour is unchanged — `execute()` has always passed commands through verbatim — but the JSDoc now spells out the security contract so callers know they must inline `WHERE organization_id = ?` themselves or restrict raw execution to genuinely global statements (migrations, control-plane tables).
- 0e63f2f: **Declarative tenant scoping + audit warn for missing tenantId.**

  `SqlDriver` now reads `obj.tenancy.tenantField` first when picking the tenant column for an object, falling back to the implicit `organization_id` detection so legacy objects keep working without a spec migration. Set `tenancy: { enabled: true, strategy: 'shared', tenantField: 'workspace_id' }` on any object to use a custom column.

  Writes (`create`, `update`, `delete`, `bulkCreate`, `bulkDelete`, `updateMany`, `deleteMany`, `upsert`) that target a tenant-scoped object **without** `options.tenantId` now emit one `[tenant-audit]` warning per `{object}:{op}` so missing-context bugs surface in CI/logs instead of silently writing globally. The engine auto-silences when `ExecutionContext.isSystem === true` (boot-time seeds, kernel mirrors). Callers can opt out per-call with `options.bypassTenantAudit = true` or globally with `OS_TENANT_AUDIT=0`.

  Driver README now documents the full scope/bypass matrix and the audit warning.

  Three new tests cover the declared-tenant-field path, the audit throttle, and the bypass flag.

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/formula@4.1.0
  - @objectstack/types@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/types@4.0.5
  - @objectstack/formula@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4
  - @objectstack/types@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3
- @objectstack/types@4.0.3

## 4.0.3

### Patch Changes

- fix: ObjectQL.init() now tracks and warns about failed driver connections instead of silently swallowing errors, improving debuggability for cold-start and serverless issues.

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2
  - @objectstack/types@4.0.2

## 4.0.0

### Minor Changes

- e0b0a78: Deprecate DataEngineQueryOptions in favor of QueryAST-aligned EngineQueryOptions.

  Engine, Protocol, and Client now use standard QueryAST parameter names:

  - `filter` → `where`
  - `select` → `fields`
  - `sort` → `orderBy`
  - `skip` → `offset`
  - `populate` → `expand`
  - `top` → `limit`

  The old DataEngine\* schemas and types are preserved with `@deprecated` markers for backward compatibility.

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0
  - @objectstack/types@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1
- @objectstack/types@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0
- @objectstack/types@3.3.0

## 3.2.9

### Patch Changes

- c3065dd: fix turso 2
  - @objectstack/spec@3.2.9
  - @objectstack/core@3.2.9
  - @objectstack/types@3.2.9

## 3.2.8

### Patch Changes

- Auto-sync all registered object schemas to database on startup: `ObjectQLPlugin.start()` now iterates every object in `SchemaRegistry` and calls `driver.syncSchema()` after driver connections are established. This ensures tables for plugin-registered objects (e.g. `sys_user` from plugin-auth) are created or updated automatically.
- Added `getDriverForObject(objectName)` public method to `ObjectQL` engine for resolving the responsible driver for a given object.
- Added optional `syncSchema` method to `DriverInterface` contract, aligning it with the full `IDataDriver` protocol.
- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8
- @objectstack/types@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7
- @objectstack/types@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6
- @objectstack/types@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5
- @objectstack/types@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4
- @objectstack/types@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3
- @objectstack/types@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/core@3.2.2
  - @objectstack/types@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1
  - @objectstack/types@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0
  - @objectstack/types@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1
  - @objectstack/types@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0
  - @objectstack/types@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11
  - @objectstack/types@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10
  - @objectstack/types@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9
  - @objectstack/types@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8
  - @objectstack/types@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7
  - @objectstack/types@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6
  - @objectstack/types@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5
  - @objectstack/types@3.0.5

## 3.0.4

### Patch Changes

- 437b0b8: feat(objectql): add utility functions, introspection types, and kernel factory

  Upstream key functionality from downstream `@objectql/core` to enable its future deprecation:

  - **Introspection types**: `IntrospectedSchema`, `IntrospectedTable`, `IntrospectedColumn`, `IntrospectedForeignKey`
  - **Utility functions**: `toTitleCase()`, `convertIntrospectedSchemaToObjects()`
  - **Kernel factory**: `createObjectQLKernel()` with `ObjectQLKernelOptions`

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4
  - @objectstack/core@3.0.4
  - @objectstack/types@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3
  - @objectstack/types@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2
  - @objectstack/types@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1
  - @objectstack/types@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0
  - @objectstack/types@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7
  - @objectstack/types@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6
  - @objectstack/types@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5
  - @objectstack/types@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4
  - @objectstack/types@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/core@2.0.3
  - @objectstack/types@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/core@2.0.2
  - @objectstack/types@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/core@2.0.1
  - @objectstack/types@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0
  - @objectstack/types@2.0.0

## 1.0.12

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.12
  - @objectstack/core@1.0.12
  - @objectstack/types@1.0.12

## 1.0.11

### Patch Changes

- @objectstack/spec@1.0.11
- @objectstack/core@1.0.11
- @objectstack/types@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [10f52e1]
  - @objectstack/core@1.0.10
  - @objectstack/spec@1.0.10
  - @objectstack/types@1.0.10

## 1.0.9

### Patch Changes

- b9f8c68: fix: handle async metadata service detection safely to prevent startup crash
  - @objectstack/spec@1.0.9
  - @objectstack/core@1.0.9
  - @objectstack/types@1.0.9

## 1.0.8

### Patch Changes

- @objectstack/spec@1.0.8
- @objectstack/core@1.0.8
- @objectstack/types@1.0.8

## 1.0.7

### Patch Changes

- @objectstack/spec@1.0.7
- @objectstack/core@1.0.7
- @objectstack/types@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6
  - @objectstack/core@1.0.6
  - @objectstack/types@1.0.6

## 1.0.5

### Patch Changes

- b1d24bd: refactor: migrate build system from tsc to tsup for faster builds
  - Replaced `tsc` with `tsup` (using esbuild) across all packages
  - Added shared `tsup.config.ts` in workspace root
  - Added `tsup` as workspace dev dependency
  - significantly improved build performance
- Updated dependencies [b1d24bd]
  - @objectstack/core@1.0.5
  - @objectstack/types@1.0.5
  - @objectstack/spec@1.0.5

## 1.0.4

### Patch Changes

- 5d13533: refactor: fix service registration compatibility and improve logging
  - plugin-hono-server: register 'http.server' service alias to match core requirements
  - plugin-hono-server: fix console log to show the actual bound port instead of configured port
  - plugin-hono-server: reduce log verbosity (moved non-essential logs to debug level)
  - objectql: automatically register 'metadata', 'data', 'and 'auth' services during initialization to satisfy kernel contracts
  - cli: fix race condition in `serve` command by awaiting plugin registration calls (`kernel.use`)
  - @objectstack/spec@1.0.4
  - @objectstack/core@1.0.4
  - @objectstack/types@1.0.4

## 1.0.3

### Patch Changes

- 22a48f0: refactor: fix service registration compatibility and improve logging
  - plugin-hono-server: register 'http.server' service alias to match core requirements
  - plugin-hono-server: fix console log to show the actual bound port instead of configured port
  - plugin-hono-server: reduce log verbosity (moved non-essential logs to debug level)
  - objectql: automatically register 'metadata', 'data', 'and 'auth' services during initialization to satisfy kernel contracts
- Updated dependencies [fb2eabd]
  - @objectstack/core@1.0.3
  - @objectstack/spec@1.0.3
  - @objectstack/types@1.0.3

## 1.0.2

### Patch Changes

- a0a6c85: Infrastructure and development tooling improvements

  - Add changeset configuration for automated version management
  - Add comprehensive GitHub Actions workflows (CI, CodeQL, linting, releases)
  - Add development configuration files (.cursorrules, .github/prompts)
  - Add documentation files (ARCHITECTURE.md, CONTRIBUTING.md, workflows docs)
  - Update test script configuration in package.json
  - Add @objectstack/cli to devDependencies for better development experience

- 109fc5b: Unified patch release to align all package versions.
- Updated dependencies [a0a6c85]
- Updated dependencies [109fc5b]
  - @objectstack/spec@1.0.2
  - @objectstack/core@1.0.2
  - @objectstack/types@1.0.2

## 1.0.1

### Patch Changes

- @objectstack/spec@1.0.1
- @objectstack/core@1.0.1
- @objectstack/types@1.0.1

## 1.0.0

### Major Changes

- Major version release for ObjectStack Protocol v1.0.
  - Stabilized Protocol Definitions
  - Enhanced Runtime Plugin Support
  - Fixed Type Compliance across Monorepo

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0
  - @objectstack/types@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2
  - @objectstack/core@0.9.2
  - @objectstack/types@0.9.2

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.
- Updated dependencies
  - @objectstack/spec@0.9.1
  - @objectstack/core@0.9.1
  - @objectstack/types@0.9.1

## 0.8.2

### Patch Changes

- 555e6a7: Refactor: Deprecated View Storage protocol in favor of Metadata Views.

  - **BREAKING**: Removed `view-storage.zod.ts` and `ViewStorage` related types from `@objectstack/spec`.
  - **BREAKING**: Removed `createView`, `updateView`, `deleteView`, `listViews` from `ObjectStackProtocol` interface.
  - **BREAKING**: Removed in-memory View Storage implementation from `@objectstack/objectql`.
  - **UPDATE**: `@objectstack/plugin-msw` now dynamically loads `@objectstack/objectql` to avoid hard dependencies.

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2
  - @objectstack/core@0.8.2
  - @objectstack/types@0.8.2

## 0.8.1

### Patch Changes

- @objectstack/spec@0.8.1
- @objectstack/core@0.8.1
- @objectstack/types@0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0
  - @objectstack/types@1.0.0

## 0.7.2

### Patch Changes

- fb41cc0: Patch release: Updated documentation and JSON schemas
- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2
  - @objectstack/core@0.7.2
  - @objectstack/types@0.7.2

## 0.7.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.7.1
  - @objectstack/types@0.7.1
  - @objectstack/core@0.7.1

## 0.6.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.6.1
  - @objectstack/types@0.6.1
  - @objectstack/core@0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

### Patch Changes

- Updated dependencies [b2df5f7]
  - @objectstack/spec@0.6.0
  - @objectstack/types@0.6.0
  - @objectstack/core@0.6.0

## 0.4.2

### Patch Changes

- Unify all package versions to 0.4.2
- Updated dependencies
  - @objectstack/spec@0.4.2

## 0.4.1

### Patch Changes

- Version synchronization and dependency updates

  - Synchronized plugin-msw version to 0.4.1
  - Updated runtime peer dependency versions to ^0.4.1
  - Fixed internal dependency version mismatches

- Updated dependencies
  - @objectstack/spec@0.4.1

## 0.4.0

### Minor Changes

- Release version 0.4.0

## 0.3.3

### Patch Changes

- Workflow and configuration improvements

  - Enhanced GitHub workflows for CI, release, and PR automation
  - Added comprehensive prompt templates for different protocol areas
  - Improved project documentation and automation guides
  - Updated changeset configuration
  - Added cursor rules for better development experience

- Updated dependencies
  - @objectstack/spec@0.3.3

## 0.3.2

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.3.2

## 0.3.1

### Patch Changes

- @objectstack/spec@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 0.2.0

### Minor Changes

- Initial release of ObjectStack Protocol & Specification packages

  This is the first public release of the ObjectStack ecosystem, providing:

  - Core protocol definitions and TypeScript types
  - ObjectQL query language and runtime
  - Memory driver for in-memory data storage
  - Client library for interacting with ObjectStack
  - Hono server plugin for REST API endpoints
  - Complete JSON schema generation for all specifications

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.2.0

## 0.1.1

### Patch Changes

- Remove debug logs from registry and protocol modules
- Updated dependencies
  - @objectstack/spec@0.1.2
