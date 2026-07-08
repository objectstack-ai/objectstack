# @objectstack/metadata-protocol

## 12.6.0

### Minor Changes

- 21420d9: Seed loader and data-import now route bulk writes through the engine's array-form `insert()` (one round-trip per batch, with parent-deduplicated summary recompute) instead of one `insert()`/`createData()` call per record, and both retry transient driver errors instead of silently dropping the row (#2678).

  A new shared helper, `bulkWrite` (`@objectstack/core`), batches rows through a caller-supplied batch-write function, retries a whole-batch transient failure (network blip / timeout) with exponential backoff, and degrades to per-row writes (each itself retried) when a batch fails for a non-transient reason — so one bad row can't drop the other N-1. `withTransientRetry` wraps a single write (e.g. an update) with the same retry behavior.

  - `SeedLoaderService.loadDataset()` (`@objectstack/metadata-protocol`) buffers insert-mode records and flushes them in batches of 200 via the engine's array `insert()`. Datasets with a self-referencing field (e.g. `employee.manager_id -> employee`) keep the historical per-record write path, since a later record may need an earlier one's freshly-assigned id.
  - `runImport()` (`@objectstack/rest`) buffers create-resolved rows and flushes them via `protocol.createManyData()` when the protocol supports it, falling back to the original per-row `createData()` call otherwise. `Protocol.createManyData` (`@objectstack/metadata-protocol`) now forwards `context` to `engine.insert()` like `createData` already did, so tenant-scoped bulk creates work correctly.

  Previously, a 1000-row seed or import into an object with a rollup summary issued 1000+ round-trips and up to 1000 summary recomputes; a single transient network error on any one row silently dropped it with no retry (the 2026-07-06 HotCRM first-boot incident). A `bulkCreate`-capable driver now sees roughly `ceil(N/batch)` writes, and a transient error is retried before a row is ever reported as failed.

  **Fix (`@objectstack/driver-sql`):** `SqlDriver.bulkCreate()` never generated a client-side id for a row missing one, unlike `create()` — a latent gap that this change is the first to exercise at scale (a bulk-inserted row without a driver-native id default silently landed with `id: NULL`). `bulkCreate()` now mirrors `create()`'s id/`_id` normalization per row.

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/formula@12.6.0
  - @objectstack/metadata-core@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- 8b3d363: Package metadata seed can no longer wedge the platform via record-change automation.

  A seeded record whose lifecycle flow self-triggered (a `record-after-update` flow
  writing back to its own trigger record) looped forever when its boolean re-entry
  guard never tripped — booleans persist as integer `1` on SQLite/libsql and CEL
  `1 != true` is `true`. During first-boot seed (which awaits automation) this hung
  the whole kernel build.

  Three layers:

  - `ExecutionContext.skipTriggers` (set by the seed-loader, threaded onto
    `HookContext.session` via `buildSession`) makes the record-change trigger skip
    flow dispatch for seed/bulk writes — seed data is end-state reference data, not
    user events. Lifecycle hooks still run.
  - `coerceBooleanFields()` converts SQLite 0/1 (and `'0'/'1'/'true'/'false'`) to
    real booleans on the after-hook view of a record (`hookContext.result` /
    `.previous`), so flow conditions see JS booleans. The value returned to the
    caller is unchanged.
  - The automation engine breaks a flow re-entering for the same record while an
    execution is still on the stack (`activeRecordFlows`), a backstop for any
    self-trigger loop.

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/formula@12.5.0
  - @objectstack/metadata-core@12.5.0
  - @objectstack/types@12.5.0

## 12.4.0

### Minor Changes

- 60dc3ba: ADR-0087 P0 — enforce the protocol version handshake (make `engines.protocol` real).

  `PluginEnginesSchema.protocol` (ADR-0025 §3.2, protocol-first per §3.10 #3) was declared, documented, and checked by no loader or installer — an ADR-0078 "declarable-but-inert" violation. A package built against an incompatible protocol major failed deep in a schema `.parse()` or a renderer contract instead of at the boundary.

  - **`@objectstack/spec`**: exports `PROTOCOL_VERSION` / `PROTOCOL_MAJOR` (`kernel`) — the single source of truth the handshake checks against. A drift test keeps it in lockstep with the package major.
  - **`@objectstack/metadata-core`**: adds `checkProtocolCompat()` (pure, major-grained range check), `assertProtocolCompat()`, and the structured `ProtocolIncompatibleError` (`OS_PROTOCOL_INCOMPATIBLE`, carrying both versions and the `objectstack migrate meta --from N` command). It refuses only on a _positive_ mismatch determination; absent ranges are grandfathered (warn) and unrecognized ranges never cause a false rejection.
  - **`@objectstack/metadata-protocol`**: `installPackage` runs the handshake before writing to the registry — an incompatible package is refused with a machine-actionable diagnostic instead of crashing later.

  Additive and backward compatible: packages that declare no `engines.protocol` range keep loading (with a warning). Part of the ADR-0087 epic (#2643); resolves #2644.

- 1dd5dfd: feat(packages): edit a package manifest via `PATCH /packages/:id`

  Adds an editable path for a package's `name` / `description` / `version` after
  creation: `SchemaRegistry.updatePackageManifest` (merges in-memory, preserving
  lifecycle state), `protocol.updatePackage` (re-persists to `sys_packages`), and
  the `PATCH /packages/:id` route in the HTTP dispatcher. `id` / `scope` / `type`
  remain immutable.

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/metadata-core@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/formula@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/formula@12.3.0
  - @objectstack/metadata-core@12.3.0
  - @objectstack/types@12.3.0

## 12.2.0

### Patch Changes

- 75c310f: Rewrite the `writable_package_required` rejection message as user-facing remediation ("switch to a writable package in the package selector, or create a new one") instead of developer-facing copy that cited an internal ADR path — the message is surfaced verbatim as a Studio toast. The ADR pointer moves to a `docs` property on the error; `code`, `status`, and `packageId` are unchanged.
- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/metadata-core@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/formula@12.2.0
  - @objectstack/types@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/formula@12.1.0
  - @objectstack/metadata-core@12.1.0
  - @objectstack/types@12.1.0

## 12.0.0

### Minor Changes

- 9796e7c: feat(security): two-doors separation for permission sets (ADR-0086 P2)

  Splits who may change a permission set into two non-overlapping doors, enforced
  at the data layer instead of by convention:

  **块 1 — the package door (publish-time materialization).**
  `ObjectStackProtocolImplementation` gains a generic publish-time materializer
  registry (`registerPublishMaterializer(type, fn)`). When a draft of a registered
  type is published, its body is projected into a data-plane row and the result is
  surfaced on the publish response as `materializeApplied` (best-effort, never
  thrown — same contract as `seedApplied`). `promoteDraft` now returns the draft's
  `packageId` so the materializer can stamp the owning package. `plugin-security`
  registers a `permission` materializer that upserts the published set into
  `sys_permission_set` with `managed_by:'package'` + `package_id` — so a set
  authored through the studio package door (saved as a `permission` draft, then
  published) lands in the admin surface with the exact provenance the boot seeder
  already stamps, now on the runtime publish path too. The single-set upsert is
  shared with `bootstrapDeclaredPermissions` (`upsertPackagePermissionSet`), so
  both paths apply the same own-row / foreign-package / env-authored rules.

  **块 2 — the admin door (data-layer write gate).**
  The security middleware now refuses any admin-door write
  (`update`/`delete`/`transfer`/`restore`/`purge`) to a `sys_permission_set` row
  with `managed_by:'package'`, and refuses an `insert` that forges
  `managed_by:'package'`. The gate fails closed regardless of the caller's grants
  (a platform admin with `modifyAllRecords` is blocked just the same), so it is a
  real data-layer boundary rather than a UI hint. System/boot writes carry
  `isSystem` and bypass the whole middleware, so the boot seeder and the publish
  materializer are unaffected. Env-authored sets (`managed_by` `user`/`platform`
  or absent) stay freely editable through the admin door — the two doors never
  overwrite each other.

### Patch Changes

- b5be479: fix(protocol): versionless package installs now persist to sys_packages (#2532)

  `installPackage` writes both package stores, but its durable half was guarded by
  `pkgSvc?.publish && manifest.version` — silently skipping every versionless
  runtime-created base (`{id, name}` from the builder / Setup). Those packages
  lived only in the in-memory registry and vanished on restart, while their
  metadata and tables survived. The version is now defaulted (`0.1.0`) instead of
  skipping, a failed persist logs loudly instead of silently, and `deletePackage`
  drops the `sys_packages` record so an uninstalled package no longer resurrects
  at the next boot (service-package hydrates that table into the registry).

- 2d567cb: Runtime-authored (Studio) hooks now execute their `body` (#2588).

  Previously a hook authored at runtime (saved via `protocol.saveMetaItem` /
  `publish-drafts`) loaded into the registry but its L1/L2 `body` never ran — the
  metadata-service bind path passed no `bodyRunner` and the engine's
  `_defaultBodyRunner` fallback was never installed, so the binder silently
  skipped the body. Now:

  - `AppPlugin` installs the QuickJS-sandboxed hook body runner as the engine
    default at boot (`engine.setDefaultBodyRunner`), so bind paths without an
    explicit runner can execute bodies. Opt out with
    `OS_DISABLE_AUTHORED_HOOKS=1` to keep runtime-authored hook bodies inert.
  - `ObjectQLPlugin` re-binds runtime-authored hooks from their `sys_metadata`
    rows at `kernel:ready` (cold boot — env-scoped kernels never surfaced these
    rows before), on `metadata:reloaded`, and on every hook mutation through the
    new `protocol.onMetadataMutation` listener — so saves, publishes, edits, and
    deletes take effect live, without a restart. Package-artifact hooks are
    excluded from this bind path (AppPlugin already binds them with an explicit
    runner) so they no longer risk double execution.
  - `@objectstack/metadata-protocol` gains a server-side
    `onMetadataMutation(listener)` API: `saveMetaItem` / `publishMetaItem` /
    `deleteMetaItem` notify subscribers after persistence succeeds.

- e3498fb: fix(runtime): carry spec-validation issues (and the 422 status) through metadata save/publish errors

  `protocol.saveMetaItem` already validates a metadata draft against its spec Zod
  schema and, on failure, throws a rich error: HTTP `status: 422`, `code:
'invalid_metadata'`, and a structured `issues: [{ path, message, code }]` array
  (field-anchored, `superRefine` issues included). But the HTTP dispatcher's catch
  blocks collapsed all of that to a single message — the save path even hardcoded
  `400` — so a client could only show a generic "failed validation" banner with no
  way to point at the offending field. The publish path was worse: the per-draft
  catch in `publishPackageDrafts` flattened each failure into `{ type, name, error
}` and **dropped `issues` entirely**.

  Now:

  - A new `errorFromThrown(e, fallbackStatus)` dispatcher helper preserves the
    error's own `status` (so validation surfaces as **422**, not a downgraded 400)
    and attaches `{ code, issues }` under `error.details` when present. Errors that
    carry neither behave exactly as before. Used by the metadata **save** (`PUT
/meta/:type/:name`) and **publish** (`POST /packages/:id/publish-drafts`)
    catch sites.
  - `publishPackageDrafts` now carries `issues` into each `failed[]` entry, so a
    validation failure during publish is field-anchored too (it previously kept
    only the message).

  This is the server half of "surface validation at the save/publish moment, on
  the field" — the Studio can now map each issue back to its input instead of
  showing a wall-of-text banner. Purely additive to the error payload; the only
  behavior change is the more-correct 422 (was 400) for a failed metadata save.

- 806a40a: Stop runtime view personalization from permanently removing views from the switcher.

  A console personalization PUT (grid column sort, inline edit, …) sends only the raw
  view config — no top-level `viewKind`/`object`. Persisted verbatim, the overlay row
  replaced the flattened package entry wholesale on read, stripping the identity fields
  every switcher-style consumer filters on (`viewKind && object`) — one sort click and
  the view vanished until the DB row was deleted (#2555).

  Two independent guards: `saveMetaItem` now inherits the missing `viewKind`/`object`/
  `label` from the registry entry the overlay shadows before persisting, and
  `getMetaItems` heals identity-less rows already in the DB the same way on read. The
  overlay's own fields always win; `defineView` container bodies are untouched.

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/formula@12.0.0
  - @objectstack/metadata-core@12.0.0
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/formula@11.10.0
  - @objectstack/metadata-core@11.10.0
  - @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/formula@11.9.0
  - @objectstack/metadata-core@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0
- @objectstack/types@11.8.0
- @objectstack/metadata-core@11.8.0
- @objectstack/formula@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/formula@11.7.0
  - @objectstack/metadata-core@11.7.0
  - @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0
- @objectstack/metadata-core@11.6.0
- @objectstack/formula@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/formula@11.5.0
  - @objectstack/metadata-core@11.5.0
  - @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/formula@11.4.0
  - @objectstack/metadata-core@11.4.0
  - @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/formula@11.3.0
  - @objectstack/metadata-core@11.3.0
  - @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/formula@11.2.0
  - @objectstack/metadata-core@11.2.0
  - @objectstack/types@11.2.0

## 11.1.0

### Minor Changes

- 13dbcf2: Extract metadata management into `@objectstack/metadata-protocol` (ADR-0076)

  `protocol.ts` (the `ObjectStackProtocol` implementation — sys_metadata CRUD, draft/publish, locks, package ownership, diagnostics) plus its `sys-metadata-repository`, `metadata-diagnostics`, `seed-loader`, and `build-probes` helpers were metadata-domain code that lived inside `@objectstack/objectql` for historical reasons. They now live in a dedicated **`@objectstack/metadata-protocol`** package.

  The protocol no longer depends on the concrete `ObjectQL` class — it is typed against an injected `MetadataHostEngine` interface (the engine is still injected at runtime). Dependency direction is now one-way (`objectql → metadata-protocol`); there is no cycle.

  **Non-breaking**: `@objectstack/objectql` re-exports every previously public symbol (`ObjectStackProtocolImplementation`, `SysMetadataRepository`, `SysMetadataEngine`, `SeedLoaderService`, `runBuildProbes`, …), so existing imports keep working.

  This is Step 1 of ADR-0076. A later step turns the protocol into a capability plugin so `objectql` itself stops depending on it (making the engine lean by construction).

  Also adds a lean **`@objectstack/objectql/core`** entry — the engine/registry/hooks/validation surface only, with no kernel plugin or metadata protocol — so a thin embedder can import just the engine and never pull `@objectstack/metadata-protocol` into its bundle. A boundary ratchet test guards the entry.

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0
  - @objectstack/formula@11.1.0
  - @objectstack/metadata-core@11.1.0
