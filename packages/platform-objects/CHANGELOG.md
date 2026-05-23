# @objectstack/platform-objects

## 5.2.0

### Minor Changes

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

### Patch Changes

- f0f7c27: Add `mark_read` / `mark_unread` row actions to `sys_notification` and polish
  listView columns + grouping.

  - Row-level `mark_read` / `mark_unread` actions guarded by CEL `visible`
    expressions so each only renders on rows in the appropriate state. Both
    use the generic PATCH `/api/v1/data/sys_notification/{id}` endpoint with
    `bodyExtra` to flip `is_read` (and clear `read_at` on unmark).
  - Reordered listView columns to lead with `title` + `actor_name` (the "who
    did what" users actually scan) and demote `type` to a chip column.
  - `mine` view now groups by `type` so mention/assignment storms don't bury
    system or task_due rows.

  `mark_all_read` is intentionally not added server-side — there's no bulk
  PATCH primitive on the REST surface yet, and the popover already handles
  multi-row mark-all client-side via N single-row PATCHes
  (`InboxPopover.tsx` → `AppHeader.markAllRead`).

- b806f58: Scope `sys_user` visibility to fellow organization members.

  The default RLS policy on `sys_user` was `id = current_user.id`, which meant
  @-mention pickers, owner/assignee lookups, reviewer selectors and the user
  roster all returned just the current user. The RLS compiler doesn't support
  subqueries, so a `id IN (SELECT user_id FROM sys_member ...)` policy isn't
  expressible.

  This change:

  1. Pre-resolves `org_user_ids` (the IDs of all users in the active org) into
     `ExecutionContext` in **all three** REST entry-point resolvers
     (`@objectstack/rest`, `@objectstack/runtime`, `@objectstack/plugin-hono-server`).
  2. Adds the field to `ExecutionContextSchema` so it survives Zod parsing.
  3. Adds an `org_user_ids` field to the RLS compiler's user context.
  4. Adds a new `sys_user_org_members` policy (`id IN (current_user.org_user_ids)`)
     to both `member_default` and `viewer_readonly` permission sets, alongside
     the existing `sys_user_self` policy. The RLS compiler OR-combines them, so
     users see themselves AND their org collaborators.

  Capped at 1000 members per request. Large enterprises should plug in a
  directory cache or split per workspace.

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0

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

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0

## 5.0.0

### Patch Changes

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

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
