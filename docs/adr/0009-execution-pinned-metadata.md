# ADR-0009: Execution-Pinned Metadata

**Status**: Accepted
**Date:** 2026-05-22
**Supersedes:** —
**Builds on:** ADR-0008 (Metadata Repository & Change Log)

---

## 1. Context

A subset of metadata types describes **executable business processes**
whose runtime executions can pause across definition upgrades:

- A `flow` execution is mid-step when the flow definition is republished.
- A `workflow` instance is at state `step_5` when the state machine is
  edited.
- An `approval` request is at "level-2 manager review" when the approval
  process is changed.

In every case a long-lived transaction row references a specific
**version** of the metadata. If the runtime later resolves the definition
by `name` only and gets HEAD, the row's encoded state becomes incoherent
(unknown steps, missing approvers, changed branching logic).

ADR-0008 introduced a per-organization durable history log
(`sys_metadata_history`) that records every version of every metadata
item. This ADR formalises the small set of additional contracts that the
metadata layer must honour so that execution-pinned business rows can
trust those historical versions to remain **resolvable forever**.

## 2. Decision

Introduce a single new capability flag on the
`MetadataTypeRegistryEntry`:

```ts
executionPinned: z.boolean().default(false).describe(
  'Transaction rows reference a specific version_hash; old hashes must ' +
  'remain resolvable via repo.getByHash() and history GC is disabled.'
)
```

A type with `executionPinned: true` gives a **stronger guarantee** than
`supportsVersioning: true`:

| Capability                    | `supportsVersioning` | `executionPinned`            |
| ----------------------------- | -------------------- | ---------------------------- |
| History rows are recorded     | ✅                   | ✅                           |
| History rows may be GC'd      | ✅ (per policy)      | ❌ never                     |
| `repo.getByHash()` available  | optional             | ✅ required                  |
| Suitable for tx-row pinning   | ❌                   | ✅                           |

`executionPinned` implies `supportsVersioning` (enforced via a Zod
`superRefine`). The reverse does not hold — many "versioned" types
(`object`, `app`, `agent`, `permission`) evolve through migrations and
do not pin transactions to a specific historical body.

### 2.1 Initial type assignments

| type        | `supportsVersioning` | `executionPinned` | rationale                                                                       |
| ----------- | -------------------- | ----------------- | ------------------------------------------------------------------------------- |
| `flow`      | true                 | **true**          | Step executions can pause across redeploys                                      |
| `workflow`  | true                 | **true**          | State-machine instances pause indefinitely between transitions                   |
| `approval`  | **true** (corrected) | **true**          | Multi-step approval requests pause for human action                              |
| `object`    | true                 | false             | Schema evolves via migrations; no row "remembers" a prior definition body       |
| `app`       | true                 | false             | Compiled to artifacts; runtime always uses HEAD                                 |
| `agent`     | true                 | false             | Conversation history captures the prompt/response text, not the agent body     |
| `permission`| true                 | false             | Always resolved against HEAD by the security service                            |

`approval` was previously `supportsVersioning: false` — that was a
mistake. This ADR corrects it and adds the `executionPinned` flag in
the same commit. `agent` and `tool` are intentionally **not** pinned;
their long-lived state (conversation history) records the *messages*
exchanged, not the agent definition body, so HEAD-resolution remains
correct.

### 2.2 Repository contract additions

The shared `MetadataRepository` interface gains exactly one method:

```ts
/**
 * Resolve a historical version by content hash. Returns the
 * MetadataItem whose body's canonical sha256 equals `hash`, or null
 * if no such version exists in this repository's history.
 *
 * Implementations MUST return rows from the history log (not just
 * HEAD) — pinned transactions rely on past versions remaining
 * resolvable. Implementations MAY return null for non-executionPinned
 * types if they choose to GC history aggressively.
 */
getByHash(ref: MetaRef, hash: string): Promise<MetadataItem | null>;
```

`SysMetadataRepository.getByHash()` is implemented as a single indexed
lookup against `sys_metadata_history`:

```sql
SELECT metadata, version, recorded_at, recorded_by, source
FROM sys_metadata_history
WHERE organization_id = ?
  AND type = ?
  AND name = ?
  AND checksum = ?
LIMIT 1
```

The composite index `(organization_id, type, name, checksum)` is added
to keep this O(log N).

### 2.3 GC contract

`MetadataHistoryCleanup` (`packages/metadata/src/utils/history-cleanup.ts`)
must consult the registry and **skip all rows whose `type` is
`executionPinned`**, for both age-based and count-based policies.

The volume of history rows for `executionPinned` types is bounded by
the rate of *definition edits* (typically << 1/day per item), not by
runtime traffic, so the storage cost of never GC'ing them is bounded
and acceptable.

### 2.4 Transaction-row schema convention

Business tables that pin a definition use the canonical triple:

```ts
{
  process_type:   Field.text(),   // e.g. 'approval'
  process_name:   Field.text(),   // e.g. 'expense_report_lvl3'
  process_hash:   Field.text(),   // sha256 of the pinned body (resolvable via getByHash)
  // optional human-readable companion:
  process_version: Field.number().optional(),
}
```

The row stores **only** the triple — never an inlined snapshot. The
snapshot is recovered on demand via `repo.getByHash(ref, hash)`.

## 3. Why not a separate snapshot table?

A previous draft proposed a `sys_metadata_pinned_snapshot(hash PK, type,
name, body)` table shared across pinned types. We rejected it:

1. **Duplicates `sys_metadata_history`.** That table already stores
   every body keyed by `(organization_id, type, name, checksum)`.
   Adding a second snapshot store re-fragments the persistence layer
   that ADR-0008 just unified.
2. **Cross-type dedup is a non-goal.** Two types with the same hash
   would be a collision-resistant accident; there is no business
   benefit to "sharing" a body across `approval` and `flow`.
3. **Doubles GC complexity.** A separate table needs its own retention
   logic, its own backup story, and reference-counting against
   transaction rows to avoid orphaning. The `executionPinned ⇒
   GC-disabled` rule on the existing history table is strictly
   simpler.

## 4. Why not store the snapshot inline on the transaction row?

Considered: `sys_approval_request.snapshot_json BLOB`. Rejected:

1. **Repeats per row.** A process invoked 10,000 times stores 10,000
   identical bodies.
2. **Migration burden.** Every business table that wants pinning would
   need to add and migrate its own snapshot column.
3. **Defeats the audit log.** The history table is already the source
   of truth for "what did version X look like" — adding a second one
   creates drift opportunities.

## 5. Migration and roll-out

- **No data migration required.** `sys_metadata_history` rows written
  since M1 already carry `(organization_id, type, name, checksum,
  metadata)` — they become valid `getByHash()` targets the moment the
  index is added.
- **Index added in this release.** Follow-up schema-sync run adds
  `idx_sys_metadata_history_hash` on `(organization_id, type, name,
  checksum)`.
- **No new tables.**
- **`approval.supportsVersioning` flipped to `true` in the same PR.**
  History writes for `approval` activate from this version onward;
  pre-existing approval rows have no history, which is acceptable —
  pinning is a forward-looking contract.

## 6. Risks and mitigations

| Risk                                                  | Mitigation                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| History table grows unbounded for pinned types        | Bounded by edit rate (~1/day per item); acceptable. Per-org analytics in M2 can flag outliers. |
| Forgetting to wire `getByHash()` in a custom repo     | The interface is `abstract`; TS compiler enforces. Contract test suite adds a coverage case.   |
| Type author opts into `executionPinned` carelessly    | `superRefine` invariant forces explicit `supportsVersioning: true` too; review gate.           |
| Definition body changes break running execution logic | Out of scope — that's the orchestrator's job; this ADR only guarantees the body is resolvable. |

## 7. Open questions

- **Cross-org sharing of pinned definitions?** Not in scope.
  `getByHash()` is always organization-scoped.
- **Pruning policy for `executionPinned` types ever?** Possibly in a
  future ADR: "no executions reference this hash for > N days" → GC
  eligible. Requires the orchestrator to expose a reference oracle.
  Deferred.
- **Should `tool` become pinned for `agent` reproducibility?**
  Considered. A tool body change rarely breaks an in-flight conversation
  (the conversation pins the *outputs*, not the tool source). If we
  later need this, flipping the flag is a one-line change.

## 8. Decision

Adopt. Implementation lands together in one release: registry flag +
`approval` correction + `getByHash()` on the shared interface and
`SysMetadataRepository` + index + GC skip + tests.
