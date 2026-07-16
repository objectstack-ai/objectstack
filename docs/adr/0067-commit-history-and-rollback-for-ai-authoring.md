# ADR-0067: Commit history and rollback for AI authoring — turns become atomic, revertible commits

**Status**: Proposed (2026-06-24) — mostly implemented (2026-07-16 audit): commit grouping (`sys_metadata_commit`), `revertCommit`/`rollbackToPackageCommit`/`listCommits`, REST routes and tests all shipped; **Decision-2 (turn-atomic single-transaction apply, "a commit cannot half-land") is NOT implemented** — publish remains per-item best-effort and commits record partial publishes (`protocol.ts` records over `publishedKeys` after the fact).
**Deciders**: ObjectStack Protocol Architects
**Builds on / amends**: [ADR-0045](./0045-additive-materialization-and-visibility-gate.md) (**amended**: ADR-0045 keeps a *draft + human-confirm* gate on mutations as the safety mechanism; this ADR replaces *confirm-before* with *revert-after* for everything except irreversible data loss, and unifies the two authoring regimes under one primitive — the commit), [ADR-0027](./0027-metadata-authoring-lifecycle.md) (draft workspace — retained as a *review affordance*, demoted from *safety mechanism*), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) ("AI never publishes — it drafts" → **AI commits; commits are revertible**), [ADR-0034](./0034-transactional-writes-and-ambient-transaction.md) (per-write transaction — **extended to span a whole turn**), [ADR-0038](./0038-build-verification-loop.md) (machine gate — runs per commit, before it lands)
**Consumers**: `@objectstack/objectql` (commit grouping, atomic turn-apply, `revertCommit`, history query — built on the existing `sys_metadata_history` + `restoreVersion`), `@objectstack/runtime` + `@objectstack/rest` (commit/revert routes), `../cloud/service-ai-studio` (turn = commit; auto-commit policy; data-loss confirmation), `../objectui` (commit timeline + "revert to here")

**Premise**: pre-launch, no back-compat debt — specify the target end-state directly.

**Design center**: **a confirm gate is the right safety primitive only for changes you cannot take back.** ADR-0045 made additive builds safe-by-immediacy and kept a human-confirm gate on mutations, reasoning "nothing visible changes without approval." But a confirm-before-publish gate is a *pessimistic lock*: it pays its cost on every change to prevent the rare irreversible one. Git's lesson — and the lesson of every modern authoring tool — is that when changes are **atomic and cheaply reversible**, the safe primitive is *optimistic*: let it land, keep perfect history, revert if wrong. The platform already has the hard parts (per-item version history with full-body snapshots; a single-item `restoreVersion`; per-write transactions). What is missing is the unit the user actually thinks in — **a commit: the atomic, named, revertible set of metadata changes from one AI turn** — and the rule that decides when revert is *not* enough and a human must still confirm: **the destruction of real user data, and nothing else.**

---

## TL;DR

1. **A turn is a commit.** Every AI apply (and Studio batch) records its metadata changes as one **commit** — a named group over the existing `sys_metadata_history` event log, tagged with a `commit_id`, actor, message (the user's prompt), and the AI model. The per-item history and full-body snapshots that back rollback already exist; this ADR adds the *grouping* and the *package-scoped HEAD*.
2. **Commits are atomic.** All metadata writes in a turn land in **one transaction** or none do. This closes ADR-0045's residual seam — `publishPackageDrafts` is per-item best-effort today, so a mid-batch failure leaves a half-live app ("claimed 120 rows, opens empty"). A commit cannot half-land.
3. **Rollback is first-class.** `revertCommit(id)` / `rollbackToPackageCommit(id)` restores every item in the target commit atomically, reusing the single-item `restoreVersion` primitive. A revert is a **new forward commit** (git-revert, not reset): history is append-only and never loses the record.
4. **The confirm gate narrows from "before publish" to "before irreversible data loss."** With atomic + revertible commits, additive *and* mutation turns auto-commit with no per-change confirmation. The only confirmation that remains is destroying **real user data** (§Decision-5). Governed orgs keep their ADR-0045/0027 approval gate by policy — unchanged.
5. **Metadata reverts cleanly; data is made reversible by discipline.** Destructive operations (drop field/object) go **soft by default** — data retained, column/table hidden, recoverable in the ADR-0045 trash window — so their revert restores data losslessly. Hard teardown happens only on explicit discard/GC. This is what makes "revert-after" actually safe.
6. **Substrate: the framework history log is the commit log; package snapshots are named restore points.** `sys_metadata_history` (per-event, lightweight, already carries actor/diff/`operation_type`) is the commit substrate. `sys_package_version` (full-bundle, heavy) is reserved for **named restore points** — the escape hatch cut before a risky revert, and marketplace release — *not* a per-turn snapshot.

---

## Context — what already exists, and the one gap

A commit-history model usually means "build a versioning system." Here, most of it is already shipped; the gap is narrow and specific.

### The primitives that already exist

| Capability | Where | Note |
|---|---|---|
| Per-item version history, **full body per version** | `sys_metadata_history` (`packages/metadata-core/src/objects/sys-metadata-history.object.ts`) | append-only; `operation_type ∈ {create,update,publish,revert,delete}`; `event_seq` (per-org monotonic, orders *all* changes); `version` (per-item monotonic); `recorded_by` (incl. `ai:claude`) |
| Read a prior version / **single-item revert** | `SysMetadataRepository.history()` / `restoreVersion(ref, targetVersion)` (`packages/objectql/src/sys-metadata-repository.ts`) | revert already lands as a forward `operation_type='revert'` event |
| Per-write ACID (metadata row + history row atomic) | `withTxn()` / `engine.transaction()` (same file + `engine.ts`) | exists **per item**; not across items |
| Full-bundle package snapshot + atomic rollback-by-install | `sys_package_version` + `snapshotBundleAsManifest()` + install pointer swap (cloud `service-tenant` / `service-cloud`) | downgrade already detected ("Rolled back v2→v1") |
| Soft vs hard delete | `keepData` / `dropStorage` flags (`engine.ts` teardown) | **default keeps data**; hard drop is opt-in — soft-drop is already the default posture |

### The gap

Three things are missing, and only three:

1. **Grouping.** There is no "commit" — no id that says *these N history events were one turn*. History is a flat per-item stream ordered by `event_seq`.
2. **Cross-item atomicity.** `publishPackageDrafts` publishes each draft independently and "collects per-item failures without aborting the rest" (its own test name). There is no turn-spanning transaction, so a turn can half-land — the exact seam behind ADR-0038's "seed staged but never materialized" / "Published! but empty" incident classes.
3. **A package-scoped HEAD + revert-a-commit.** `restoreVersion` reverts one item; nothing reverts *the set of items a turn touched* as a unit, and nothing tracks "which commit is current" for a package.

Everything else — the snapshots, the revert mechanic, the audit fields — is reuse.

### Why this is the right time

ADR-0045's own "Consequences/Costs" lists the two regimes ("materialize vs. draft … must be explained") and its v1.1 tail (trash-can, quota) as open. The commit model **subsumes** them: revert *is* discard; the history *is* the audit trail; one primitive (commit) replaces "is this additive or a mutation?" as the thing the user reasons about. And the friction the founder named — *"I don't want to keep confirming publishes"* — is precisely ADR-0045's mutation-confirm gate, which this ADR is designed to retire safely.

---

## Options considered

**A — Keep ADR-0045 as-is.** Additive auto-publishes; mutations stay drafts behind a human confirm. *Rejected.* Leaves the two-regime split and the per-mutation confirm friction in place — the problem this ADR exists to solve. It also leaves the half-land seam (per-item publish) unaddressed.

**B — Per-turn full-bundle snapshot via a cloud `/checkpoint` route on `sys_package_version`.** The "obvious" git-snapshot: serialize the whole package every turn, install-swap to roll back. *Rejected.* (1) Heavy — duplicates the entire package bundle per turn, unbounded DB growth on a chatty iteration loop. (2) Wrong layer — puts the versioning *mechanism* in cloud, violating ADR-0002 "open mechanism, close intelligence"; the framework already owns metadata versioning. (3) Doesn't actually solve data rollback — `sys_package_version` snapshots the *declared* bundle (metadata + seed), not the live runtime rows a user typed in, so install-swap rollback silently diverges from real data anyway. Retained only for what it's good at: heavyweight **named restore points** (§Decision-6).

**C — Commit log on `sys_metadata_history` + turn-atomic apply + first-class `revertCommit`; package snapshots as named restore points; destructive ops soft-by-default.** *Chosen.* Builds on the existing framework primitives, keeps the mechanism open-core-correct, and makes revert genuinely safe by pairing it with soft-delete discipline.

---

## Decision

### 1. A turn is a commit

A **commit** is the atomic set of metadata events produced by one apply/turn, identified by a `commit_id` and recorded as a group over `sys_metadata_history`. Minimal mechanism: a `commit_id` column on the history event (plus a thin `sys_metadata_commit` row carrying `{ commit_id, package_id, organization_id, message, actor, ai_model?, event_seq_range, parent_commit_id }`). No new snapshot store — the bodies are already in `sys_metadata_history.metadata`.

The commit's **message is the user's prompt**; its **actor** is the AI principal; its **diff** is computed from the per-event `checksum` / `previous_checksum` already recorded. A package's commits form a **linear history with a HEAD** (the current top), scoped per environment (metadata is org/env-scoped).

The server owns commit assembly — the model never constructs it. `apply_blueprint` and the per-item authoring tools (`add_field`, `create_metadata`, …) run inside a turn context that opens a commit, writes through it, and seals it.

### 2. Commits are atomic

All metadata writes in a turn execute inside **one `engine.transaction()`**; any failure rolls the whole commit back — no half-built app, no orphan rows, no partial visibility flip. This replaces `publishPackageDrafts`'s per-item best-effort loop with a turn-spanning transaction (the per-item `withTxn` composes into it). The visibility flip (ADR-0045 `hidden:false`) is part of the same transaction — never "some apps visible, some not."

*Driver caveat*: in-memory drivers have no real transaction (`withTxn` no-ops); atomicity is a SQL-driver guarantee. Production is SQL; document the gap, don't paper over it.

### 3. Rollback is first-class and append-only

- `revertCommit(commitId)` — restore every item the commit touched to its **pre-commit** body, atomically (reuse `restoreVersion` per item inside one transaction). Recorded as a **new forward commit** (`operation_type='revert'`), so history is never rewritten and a revert is itself revertible.
- `rollbackToPackageCommit(commitId)` — revert the package's HEAD back through every commit after the target, as one transaction. This is the "一层一层回退" the founder described — **commit-granular, not per-artifact** (§Resolved-1).
- Revert restores **metadata** deterministically. Its effect on **data** is governed by §5.

### 4. The confirm gate, relocated

ADR-0045 gated *publish* (a human confirms before anything visible changes). This ADR relocates the gate to the only place revert can't save you:

- **Default (self-use / auto-publish environments)**: additive **and** mutation turns **auto-commit** — no per-change confirmation. The user reasons over the **commit timeline** (review, revert), not a stream of approve-prompts. This is the friction removal.
- **Confirmation survives in exactly two cases**: (a) **governed environments** keep their ADR-0045/0027 approval gate by *policy* (compliance requirement — unchanged; the `autoPublishAiBuilds=false` path); (b) **irreversible destruction of real user data**, everywhere, per §5.

The ADR-0027 **draft workspace + `?preview=draft` diff review** is retained as a *review affordance* (a reviewer may still preview a pending change), but it is **no longer the safety mechanism** — revertibility is. Drafts stop being mandatory for mutations in the default path.

### 5. Metadata reverts cleanly; data is made reversible (the crux)

Metadata is declarative and snapshotted, so it reverts exactly. Data does not: reverting "create object *X*" or "drop field *f*" touches real tables and real rows — including rows a user typed in after publish. The rule that keeps revert safe:

- **Destructive operations are soft by default.** Dropping a field/object hides the column/table and **retains the data** (the existing `keepData` posture; never `dropStorage:true` on a revert). Reverting the drop restores the data losslessly. **Hard teardown** (physical drop) happens only on explicit **discard/GC** (ADR-0045 trash-can), never as a side effect of a commit or revert.
- **Reverting an additive commit is tiered** (the *limit-aware* principle — *invisible when safe, explicit when it matters*):
  - the new object/view holds **only AI-seeded sample rows** → revert teardown is **silent** (recoverable in the trash window); zero friction.
  - the new object holds **user-entered rows beyond the seed** → revert requires a **typed confirmation that names the impact** ("revert will remove object *X* and its **N** rows, **M** of them entered after publish") **and auto-cuts a `sys_package_version` named restore point first** (the escape hatch — the revert is itself undoable).
- This is the precise boundary of the §4 confirm gate: a human confirms **iff** the operation would destroy real user data that revert cannot resurrect.

### 6. Substrate and restore points

- **Commit log = `sys_metadata_history`** (framework, per-event, reuse). This is the per-turn substrate. No full-bundle copy per turn.
- **`sys_package_version` = named restore points** (cloud, full-bundle, heavy), cut only on: the §5 pre-destructive-revert escape hatch; a user-initiated "name a checkpoint" ("before I let the AI go wide"); and marketplace release. *Not* per turn.
- A "manual checkpoint" affordance is cheap (reuses the existing publish-version route) and may ship early for the *sense of control* it gives, independent of the commit machinery.

### Open-core boundary

The **mechanism** — commit grouping, turn-atomic apply, `revertCommit` / `rollbackToPackageCommit`, history/commit query, the soft-delete-on-revert rule — is **framework, open** (it is generic metadata versioning; it must work for CLI and human authoring, not just AI). The **intelligence/policy** — turn = commit assembly from an AI conversation, auto-commit policy per plan, the AI metadata stamped on commits, *when* a turn counts as data-destructive — stays in **cloud/EE** per ADR-0002. The **timeline UI** is generic SDUI in objectui. The cloud-side per-turn `/checkpoint` route (Option B) is explicitly rejected as a boundary violation.

---

## Consequences

**Gains**
- **One primitive.** "Is this additive or a mutation?" stops being a user-facing concept; every turn is a commit. ADR-0045's "two regimes must be explained" cost is paid down.
- **The friction is gone where it's pure friction.** Self-use authoring stops asking the user to approve their own AI's work; the timeline replaces the approve-stream.
- **Discard, undo, and audit unify.** Revert *is* discard; the commit log *is* the audit trail; ADR-0045's v1.1 trash-can becomes "revert the create commit."
- **The half-land class dies.** Turn-atomicity removes "staged but never materialized" / "Published! but empty" at the source, not by honest after-the-fact reporting.
- **Governance is untouched.** Governed orgs keep approval by policy; the change is purely in the default self-use path.

**Costs**
- Turn-atomicity is a **SQL-driver** guarantee; in-memory loses it (documented, acceptable).
- Revert safety **depends on soft-delete discipline** — any path that hard-drops on a non-discard operation breaks the model; needs a test guard.
- **Schema migration**: `commit_id` on history + the `sys_metadata_commit` grouping row.
- The **timeline UI** is net-new (but replaces, not adds to, the publish-card/changes-panel surface).
- A wrong-but-lint-clean additive build now goes live with **no human in the loop** in the default path — acceptable only because it is one click to revert and (ADR-0038) lint-gated; governed orgs opt back into review.

---

## Phases

### v1 — atomic commits + the timeline (the founder's ask, minimally)

Acceptance, browser-level: *build an app (commit 1) → ask the AI to change it (commit 2) → open the timeline → "revert to commit 1" → the app returns to its commit-1 state; the revert appears as commit 3; no per-change approve-prompt was shown.*

1. **Framework**: turn-spanning transaction for an apply (Decision-2); `commit_id` grouping over `sys_metadata_history` + `sys_metadata_commit` (Decision-1); `revertCommit` / `rollbackToPackageCommit` reusing `restoreVersion` (Decision-3); `listCommits(packageId)` / HEAD.
2. **Cloud**: AI turn opens/seals a commit with the user prompt as message + model metadata; auto-commit replaces per-mutation drafting in the default path (kill-switch retained); governed path unchanged.
3. **objectui**: a **commit timeline** panel on the app/package (message · diff · actor · time + "revert to here"), replacing the publish-card/Changes-panel as the primary surface.

### v1.1 — make destructive reversible, then narrow the gate

4. Soft-by-default destructive ops + the §5 tiered confirmation + auto-snapshot escape hatch; only then let destructive mutations auto-commit. **Order is load-bearing: never auto-commit a destructive mutation before its revert is lossless.**
5. `sys_package_version` named restore points (manual checkpoint button; pre-destructive-revert auto-cut); quota on commits/snapshots via the ADR-0045 §6 entitlement pattern.

### v2+

6. Per-artifact cherry-pick revert within a commit (power-user; referential-integrity-checked).
7. Commit **diff API** (deep-diff of two commits' bodies — both are JSON; library-grade).
8. Retention/GC of ancient commits; squash on marketplace release.

## Resolved questions (decided 2026-06-24)

1. **Revert granularity** → **whole-commit only in v1**, not per-artifact. "一层一层回退" is commit-by-commit; a commit is a referentially consistent set, so whole-commit revert preserves integrity by construction. Per-artifact cherry-pick (which can leave dangling references) is deferred to v2 (§Phase-6).
2. **Reverting an additive commit that holds real user data** → **allowed, tiered** (§Decision-5): silent when only sample data; typed-confirmation + auto-snapshot escape hatch when user-entered rows exist. Reversibility-by-recovery, not safety-by-prohibition — hard-blocking ("export first") is paternalistic and contradicts the friction-removal goal.
3. **Per-turn full-bundle snapshot** → **rejected** (Option B); `sys_metadata_history` is the commit substrate, `sys_package_version` is reserved for named restore points, cut in v1.1, not per turn.
4. **Does the draft workspace go away?** → **No, but it is demoted.** ADR-0027's draft + `?preview=draft` diff review stays as a *review affordance* (governed orgs, optional preview); it is no longer the *safety mechanism* for the default path. Revertibility is.
