# @objectstack/metadata-core

## 6.8.1

## 6.8.0

## 6.7.1

## 6.7.0

## 6.6.0

## 6.5.1

## 6.5.0

## 6.4.0

## 6.3.0

## 6.2.0

## 6.1.1

## 6.1.0

## 6.0.0

## 5.2.0

### Patch Changes

- bab2b20: feat(approvals): execution-pinned approval processes (ADR-0009)

  When an approval request is submitted, the engine now records a `process_hash`
  on `sys_approval_request` — the sha256 of the approval process body resolved
  through `MetadataRepository`. While the request is in flight, `approve` /
  `reject` / `recall` resolve the pinned process body via
  `MetadataRepository.getByHash`. Upgrading the approval process definition
  mid-flight therefore no longer affects requests that already started against
  the previous version.

  Behavior:

  - `sys_approval_request` gains a `process_hash` column (text, nullable,
    read-only). Existing rows keep working — the engine falls back to the
    current `sys_approval_process` projection when the column is empty.
  - `ApprovalServiceOptions` accepts an optional `metadataRepo`. When omitted
    (e.g. defining processes purely through the runtime API or in unit tests),
    pinning is silently disabled and the service behaves as before.
  - `ApprovalsServicePlugin` looks up the metadata service from the kernel
    and wires its repository automatically.
  - The metadata-core local `MetadataTypeSchema` enum was realigned with the
    canonical `@objectstack/spec/kernel` enum (drift fix: `approval`, `field`,
    `function`, `service`, …).

  This is the first user-visible consumer of the `executionPinned` capability
  introduced in ADR-0009.

## 5.1.0

### Minor Changes

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

- 4150fe4: Add `MetadataCache` — bounded, event-invalidated LRU sitting in front of
  any `MetadataRepository`. Features:

  - Bounded by `maxEntries` and `maxBytes` (default 1024 / 8 MiB).
  - LRU eviction with touch-on-read.
  - Lazy fill on read miss; negative caching for known-absent items.
  - Subscribes to `repo.watch(filter)` and invalidates affected entries
    (including rename: both old and new keys).
  - Coalesces concurrent reads for the same key onto a single backend
    fetch (thundering-herd safe).
  - Generation counter discards in-flight fetches that race an
    invalidation, preventing stale-cache poisoning.
  - Diagnostics via `getStats()` (entries, bytes, hits, misses,
    invalidations, coalesced).

  Includes a property-based test that verifies cache→repo convergence
  under randomly-generated update sequences.

  See ADR-0008 §10 PR-3.

- 8337cdb: Add `InMemoryRepository` (reference implementation) and a parameterised
  Repository contract test suite. The contract suite, exposed at
  `@objectstack/metadata-core/testing`, verifies the seven invariants every
  backend must satisfy (atomic put, monotonic seq per branch, optimistic
  locking, canonical hashing, event ordering, watch resumability,
  tombstones).

  Includes implementation-specific tests covering the injected clock,
  canonical-hash insertion-order independence, and deep-copy isolation
  between caller and store.

  See ADR-0008 §10 PR-2.

- 58835a6: Add `LayeredRepository` — composes N `MetadataRepository`s into a
  read-through stack. Reads walk top-to-bottom; writes route to the
  topmost writable layer; `list()` deduplicates by `refKey` preferring
  the top; `history()` and `watch()` merge events from all layers,
  tagging each event's `source` with `<layer>:<original-source>`. The
  multiplexed `watch()` correctly cancels all child iterators when the
  consumer calls `return()`.

  Enables the canonical "system built-ins under user overlay" pattern
  described in ADR-0008.

  See ADR-0008 §10 PR-5.

- 8cc30b4: New package: Repository contracts for the metadata lifecycle (ADR-0008).

  Definitions only — no I/O. Exports Zod schemas, the
  `MetadataRepository` interface, canonical-form helpers
  (`canonicalize`, `hashSpec`), and typed errors (`ConflictError`,
  `NotFoundError`, `SchemaValidationError`).

  This is M0 PR-1 of the four-layer metadata refactor. Subsequent PRs
  add `InMemoryRepository`, `MetadataCache`, `FileSystemRepository`
  and migrate the existing `MetadataManager` / HMR plumbing onto the
  new contracts.

### Patch Changes

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
