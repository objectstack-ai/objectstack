# @objectstack/metadata-fs

## 9.11.0

### Patch Changes

- @objectstack/metadata-core@9.11.0

## 9.10.0

### Patch Changes

- @objectstack/metadata-core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/metadata-core@9.9.1

## 9.9.0

### Patch Changes

- @objectstack/metadata-core@9.9.0

## 9.8.0

### Patch Changes

- @objectstack/metadata-core@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/metadata-core@9.7.0

## 9.6.0

### Patch Changes

- @objectstack/metadata-core@9.6.0

## 9.5.1

### Patch Changes

- @objectstack/metadata-core@9.5.1

## 9.5.0

### Patch Changes

- @objectstack/metadata-core@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [fef38ec]
  - @objectstack/metadata-core@9.4.0

## 9.3.0

### Patch Changes

- @objectstack/metadata-core@9.3.0

## 9.2.0

### Patch Changes

- @objectstack/metadata-core@9.2.0

## 9.1.0

### Patch Changes

- @objectstack/metadata-core@9.1.0

## 9.0.1

### Patch Changes

- @objectstack/metadata-core@9.0.1

## 9.0.0

### Patch Changes

- @objectstack/metadata-core@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/metadata-core@8.0.1

## 8.0.0

### Patch Changes

- @objectstack/metadata-core@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/metadata-core@7.9.0

## 7.8.0

### Patch Changes

- @objectstack/metadata-core@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [764c747]
  - @objectstack/metadata-core@7.7.0

## 7.6.0

### Patch Changes

- @objectstack/metadata-core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/metadata-core@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/metadata-core@7.4.1

## 7.4.0

### Patch Changes

- @objectstack/metadata-core@7.4.0

## 7.3.0

### Patch Changes

- @objectstack/metadata-core@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/metadata-core@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/metadata-core@7.2.0

## 7.1.0

### Patch Changes

- @objectstack/metadata-core@7.1.0

## 7.0.0

### Patch Changes

- @objectstack/metadata-core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/metadata-core@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/metadata-core@6.8.1

## 6.8.0

### Patch Changes

- @objectstack/metadata-core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/metadata-core@6.7.1

## 6.7.0

### Patch Changes

- @objectstack/metadata-core@6.7.0

## 6.6.0

### Patch Changes

- @objectstack/metadata-core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/metadata-core@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/metadata-core@6.5.0

## 6.4.0

### Patch Changes

- @objectstack/metadata-core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/metadata-core@6.3.0

## 6.2.0

### Patch Changes

- @objectstack/metadata-core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/metadata-core@6.1.1

## 6.1.0

### Patch Changes

- @objectstack/metadata-core@6.1.0

## 6.0.0

### Patch Changes

- @objectstack/metadata-core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
  - @objectstack/metadata-core@5.2.0

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

- Updated dependencies [75f4ee6]
  - @objectstack/metadata-core@5.1.0

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

- 32ce912: Add `@objectstack/metadata-fs` — Node-only `FileSystemRepository`
  implementation of the M0 Repository contract.

  Layout:

  ```
  <root>/
    <type>/<name>.json          # canonical body (atomic rename writes)
    .objectstack/.log/<branch>.jsonl   # append-only change log
  ```

  Features:

  - All 17 contract tests pass (`singleBranch: true`).
  - Per-key serialization via `KeyedMutex`.
  - Atomic writes via tmpfile + rename.
  - Heads and `seq` recovered from the JSONL log on `start()` — survives
    process restart.
  - chokidar watcher translates external edits (e.g. VSCode saves) into
    `MetadataEvent`s with `source: 'fs'`.
  - Self-write suppression: 200ms window prevents the watcher from
    re-emitting events for files we wrote ourselves.
  - Manual `AsyncIterator` for `watch()` to mirror the in-memory pattern.

  Also (`metadata-core`):

  - Add `singleBranch` option to `runRepositoryContractTests` so
    single-branch backends (like the FS one) skip the cross-branch test.
  - Switch tsup `splitting: true` so `index.js` and `testing.js` share a
    single `ConflictError` class identity (was double-bundled before).

  See ADR-0008 §10 PR-4.

### Patch Changes

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
  - @objectstack/metadata-core@5.0.0
