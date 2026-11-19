# ADR-0067: Commit history and rollback for AI authoring — turns become atomic, revertible commits

**Status**: Accepted (2026-06-24; completed 2026-07-16) · **Amended** (2026-08-06, #5351/#5696 — the D2 join is now distinguishable (`owned`), and Decision-2's atomicity is enforced as a ONE-datasource promise, with audit rows carved out and possibly orphaned; see the Amendment at the end) — fully implemented: commit grouping (`sys_metadata_commit`), `revertCommit`/`rollbackToPackageCommit`/`listCommits`, REST routes; **Decision-2 landed via #3066**: `publishPackageDrafts` runs every promotion + the commit record inside ONE `engine.transaction()` (two-phase — side effects post-commit), so a commit cannot half-land; `engine.transaction()` joins ambient transactions to make nested repository writes participate. Locked by `protocol-publish-package-drafts.test.ts` (all-or-nothing + rollback tracking) and `engine-ambient-transaction.test.ts`. **Letter index** (2026-08-29, #12786): the Decision headings are relabeled `1.`–`6.` → `D1`–`D6` so `Dk` citations verify — recognition of the record's own numbering (this status line and the Amendment already say "D2"); no decision is renumbered, reordered, or rewritten. · **Amended** (2026-11-12, #32396/#32480 — Decision-2's atomicity holds where the engine can roll back (`engineCanRollBack`), which is not the same line as "a SQL driver"; elsewhere a package publish is judged first and undone by compensation, best effort; see the 2026-11-12 Amendment at the end). · **Amended** (2026-11-14, #32504 — Decision-3's revert doors are not atomic across items: `revertCommit` reverts item by item and reports `reverted[]` and `failed[]`, and `rollbackToPackageCommit` runs one `revertCommit` per commit; neither opens a transaction around the whole; see the 2026-11-14 Amendment at the end). · **Amended** (2026-11-15, #33850 — after PR #33805 and PR #33979, the faults a revert reads after an item's row write (the registry write-through's answer, a storage advisory, the projector's `success: false`, the heal's answered stop where a row was removed, a later throw) are named in `failed[]` with the row state and make `success` false, while a heal outcome that answers no stop is still not reported; the revert commit is written from the revert's own plan and records the version each row held, so reverting a revert restores; an item recorded as existing with no version to restore is named in `failed[]`; the doors are still not atomic across items; see the 2026-11-15 Amendment at the end).
**Deciders**: ObjectStack Protocol Architects
**Builds on / amends**: [ADR-0045](./0045-additive-materialization-and-visibility-gate.md) (**amended**: ADR-0045 keeps a *draft + human-confirm* gate on mutations as the safety mechanism; this ADR replaces *confirm-before* with *revert-after* for everything except irreversible data loss, and unifies the two authoring regimes under one primitive — the commit), [ADR-0027](./0027-metadata-authoring-lifecycle.md) (draft workspace — retained as a *review affordance*, demoted from *safety mechanism*), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) ("AI never publishes — it drafts" → **AI commits; commits are revertible**), [ADR-0034](./0034-transactional-writes-and-ambient-transaction.md) (per-write transaction — **extended to span a whole turn**), [ADR-0038](./0038-build-verification-loop.md) (machine gate — runs per commit, before it lands)
**Consumers**: `@objectstack/objectql` (commit grouping, atomic turn-apply, `revertCommit`, history query — built on the existing `sys_metadata_history` + `restoreVersion`), `@objectstack/runtime` + `@objectstack/rest` (commit/revert routes), `../cloud/service-ai-studio` (turn = commit; auto-commit policy; data-loss confirmation), `../objectui` (commit timeline + "revert to here")

**Premise**: pre-launch, no back-compat debt — specify the target end-state directly.

**Design center**: **a confirm gate is the right safety primitive only for changes you cannot take back.** ADR-0045 made additive builds safe-by-immediacy and kept a human-confirm gate on mutations, reasoning "nothing visible changes without approval." But a confirm-before-publish gate is a *pessimistic lock*: it pays its cost on every change to prevent the rare irreversible one. Git's lesson — and the lesson of every modern authoring tool — is that when changes are **atomic and cheaply reversible**, the safe primitive is *optimistic*: let it land, keep perfect history, revert if wrong. The platform already has the hard parts (per-item version history with full-body snapshots; a single-item `restoreVersion`; per-write transactions). What is missing is the unit the user actually thinks in — **a commit: the atomic, named, revertible set of metadata changes from one AI turn** — and the rule that decides when revert is *not* enough and a human must still confirm: **the destruction of real user data, and nothing else.**

---

## TL;DR

1. **A turn is a commit.** Every AI apply (and Studio batch) records its metadata changes as one **commit** — a named group over the existing `sys_metadata_history` event log, tagged with a `commit_id`, actor, message (the user's prompt), and the AI model. The per-item history and full-body snapshots that back rollback already exist; this ADR adds the *grouping* and the *package-scoped HEAD*.
2. **Commits are atomic.** All metadata writes in a turn land in **one transaction** or none do. This closes ADR-0045's residual seam — `publishPackageDrafts` is per-item best-effort today, so a mid-batch failure leaves a half-live app ("claimed 120 rows, opens empty"). A commit cannot half-land.
3. **Rollback is first-class.** `revertCommit(id)` / `rollbackToPackageCommit(id)` restores every item in the target commit atomically, reusing the single-item `restoreVersion` primitive. A revert is a **new forward commit** (git-revert, not reset): history is append-only and never loses the record. *(Amended 2026-11-14: neither door is atomic across items — see the Amendment of that date at the end.)*
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
| Read a prior version / **single-item revert** | `SysMetadataRepository.history()` / `restoreVersion(ref, targetVersion)` (`packages/metadata-protocol/src/sys-metadata-repository.ts`) | revert already lands as a forward `operation_type='revert'` event |
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

### D1 — A turn is a commit

A **commit** is the atomic set of metadata events produced by one apply/turn, identified by a `commit_id` and recorded as a group over `sys_metadata_history`. Minimal mechanism: a `commit_id` column on the history event (plus a thin `sys_metadata_commit` row carrying `{ commit_id, package_id, organization_id, message, actor, ai_model?, event_seq_range, parent_commit_id }`). No new snapshot store — the bodies are already in `sys_metadata_history.metadata`.

The commit's **message is the user's prompt**; its **actor** is the AI principal; its **diff** is computed from the per-event `checksum` / `previous_checksum` already recorded. A package's commits form a **linear history with a HEAD** (the current top), scoped per environment (metadata is org/env-scoped).

The server owns commit assembly — the model never constructs it. `apply_blueprint` and the per-item authoring tools (`add_field`, `create_metadata`, …) run inside a turn context that opens a commit, writes through it, and seals it.

### D2 — Commits are atomic

All metadata writes in a turn execute inside **one `engine.transaction()`**; any failure rolls the whole commit back — no half-built app, no orphan rows, no partial visibility flip. This replaces `publishPackageDrafts`'s per-item best-effort loop with a turn-spanning transaction (the per-item `withTxn` composes into it). The visibility flip (ADR-0045 `hidden:false`) is part of the same transaction — never "some apps visible, some not."

*Driver caveat*: in-memory drivers have no real transaction (`withTxn` no-ops); atomicity is a SQL-driver guarantee. Production is SQL; document the gap, don't paper over it. *(Scope amended 2026-11-12 — see the Amendment of that date at the end.)*

### D3 — Rollback is first-class and append-only

- `revertCommit(commitId)` — restore every item the commit touched to its **pre-commit** body, atomically (reuse `restoreVersion` per item inside one transaction). Recorded as a **new forward commit** (`operation_type='revert'`), so history is never rewritten and a revert is itself revertible. *(Amended 2026-11-14: no transaction spans the items; the revert runs per item and reports `reverted[]` and `failed[]`; and reverting a revert commit restores nothing today — see the Amendment of that date at the end.)* *(⚠️ Amended 2026-11-15, #33850: "reverting a revert commit restores nothing today" no longer holds. Since PR #33805 a revert commit records the version each row held, and reverting it restores — see the Amendment of 2026-11-15 at the end.)*
- `rollbackToPackageCommit(commitId)` — revert the package's HEAD back through every commit after the target, as one transaction. This is the "一层一层回退" the founder described — **commit-granular, not per-artifact** (§Resolved-1). *(Amended 2026-11-14: not one transaction; one `revertCommit` per commit, each step's failures collected — see the Amendment of that date at the end.)*
- Revert restores **metadata** deterministically. Its effect on **data** is governed by §5.

### D4 — The confirm gate, relocated

ADR-0045 gated *publish* (a human confirms before anything visible changes). This ADR relocates the gate to the only place revert can't save you:

- **Default (self-use / auto-publish environments)**: additive **and** mutation turns **auto-commit** — no per-change confirmation. The user reasons over the **commit timeline** (review, revert), not a stream of approve-prompts. This is the friction removal.
- **Confirmation survives in exactly two cases**: (a) **governed environments** keep their ADR-0045/0027 approval gate by *policy* (compliance requirement — unchanged; the `autoPublishAiBuilds=false` path); (b) **irreversible destruction of real user data**, everywhere, per §5.

The ADR-0027 **draft workspace + `?preview=draft` diff review** is retained as a *review affordance* (a reviewer may still preview a pending change), but it is **no longer the safety mechanism** — revertibility is. Drafts stop being mandatory for mutations in the default path.

### D5 — Metadata reverts cleanly; data is made reversible (the crux)

Metadata is declarative and snapshotted, so it reverts exactly. Data does not: reverting "create object *X*" or "drop field *f*" touches real tables and real rows — including rows a user typed in after publish. The rule that keeps revert safe:

- **Destructive operations are soft by default.** Dropping a field/object hides the column/table and **retains the data** (the existing `keepData` posture; never `dropStorage:true` on a revert). Reverting the drop restores the data losslessly. **Hard teardown** (physical drop) happens only on explicit **discard/GC** (ADR-0045 trash-can), never as a side effect of a commit or revert.
- **Reverting an additive commit is tiered** (the *limit-aware* principle — *invisible when safe, explicit when it matters*):
  - the new object/view holds **only AI-seeded sample rows** → revert teardown is **silent** (recoverable in the trash window); zero friction.
  - the new object holds **user-entered rows beyond the seed** → revert requires a **typed confirmation that names the impact** ("revert will remove object *X* and its **N** rows, **M** of them entered after publish") **and auto-cuts a `sys_package_version` named restore point first** (the escape hatch — the revert is itself undoable).
- This is the precise boundary of the §4 confirm gate: a human confirms **iff** the operation would destroy real user data that revert cannot resurrect.

### D6 — Substrate and restore points

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
- Turn-atomicity is a **SQL-driver** guarantee; in-memory loses it (documented, acceptable). *(Scope amended 2026-11-12 — see the Amendment of that date at the end.)*
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

---

## Amendment (2026-08-06, #5351 / #5696) — the D2 join is now distinguishable, and "a commit cannot half-land" is scoped to one datasource

Decision-2 ("commits are atomic") and its join rule — `engine.transaction()`
JOINS an already-open ambient transaction so the outermost caller owns the one
and only commit/rollback — are both **unchanged and reaffirmed**. A nested
`begin` would take a second connection (a deadlock on the single-connection
SQLite pool) and would not be covered by the outer rollback, which is the exact
half-landing the join prevents. Two things around it are amended.

### The join is now distinguishable by the callback (#5696 point 3)

The join was correct but **silent**: a nested caller could not tell whether it
owned the transaction it was running in, and a helper whose own contract reads
"this all rolls back together" was making a promise it might not control. The
callback's second argument now carries `{ owned: boolean }` — `true` when this
call opened the transaction, `false` when it joined an outer one or ran on the
no-transaction degrade path. Nothing about who commits changed; only whether the
callback can find out.

### "A commit cannot half-land" is a promise about ONE datasource

Decision-2's atomicity was always scoped to the driver the transaction was
opened on — ADR-0119 D1 says so — but the engine did not enforce that scope, and
the gap was worse than the wording suggested: a write routed to another
datasource was handed the FIRST driver's transaction handle and executed on the
wrong connection entirely (measured in #5351; see ADR-0119's 2026-08-06
amendment for the full mechanism and evidence). Since that amendment:

- the handle never reaches a driver that does not own it;
- a **business** write that would cross drivers inside a transaction is
  **refused** by name, so a metadata commit spanning two datasources fails
  loudly at the first crossing instead of half-landing invisibly — which is
  Decision-2's own goal, now actually enforced rather than assumed;
- **append-only system ledgers** (`lifecycle.class` audit / telemetry / event,
  routed away by ADR-0057 §3.6) are **carved out**: executed outside the
  transaction, and therefore surviving its rollback.

### Orphan rows are a deliberate consequence of the carve-out

A reverted commit — `revertCommit` / `rollbackToPackageCommit` — restores the
metadata, but the **audit rows written during the reverted work remain**. They
are not undone, and this record now says so rather than leaving it to be
discovered.

That is the correct direction of error here, and it fits this ADR's own design
center. History is append-only by construction — Decision-3 makes a revert a
*new forward commit* precisely so the record of what happened is never rewritten
— so an audit row describing work that was later undone is consistent with how
this ADR already treats history, not an exception to it. The alternative was
refusing the audit write, which an audit hook's `try/catch` turns straight back
into a dropped row; a spurious row is reconcilable against the commit history,
a missing row for a write that DID commit is not recoverable at all.

**Decided by**: the maintainer, 2026-08-06, on #5351 (plan A) and #5696.
**Mechanism, limits and evidence**: ADR-0119's amendment of the same date —
including the one path the same-origin gate declines to judge (handles the
engine never opened and cannot attribute). **Implemented in**
`packages/objectql/src/engine.ts`; pinned by
`engine-transaction-same-origin.test.ts`.

---

## Amendment (2026-11-12, #32396 / #32480) — Decision-2's atomicity holds where the engine can roll back; elsewhere a package publish is judged first and undone by compensation, best effort

Decision-2's design — one `engine.transaction()` around every promotion and the
commit record — is **unchanged**. What is amended is the scope of its promise.
D2's *Driver caveat* and the first line of *Costs* drew that scope by driver
family: "atomicity is a SQL-driver guarantee", "Production is SQL". The line is
not there. A SQL driver can be unable to roll back, a production deployment can
run on one, and #32396 was the half-land this record says cannot happen: a
package of eleven drafts, the ninth refused, the first eight live under a
response that said nothing took effect.

### The scope is "this runtime can roll back", not "this driver is SQL"

"A commit cannot half-land" holds where `engineCanRollBack(engine)`
(`@objectstack/core`) answers yes: the engine has `transaction()`, and its
default driver has `beginTransaction` and does not declare
`supports.transactionsUnsupported` (`driverSupportsTransactions`,
`@objectstack/spec`). Where the engine exposes no driver registry to inspect,
the engine-level probe is all the gate has. On a runtime that passes, D2 reads
exactly as written.

Where the gate answers no, `engine.transaction()` still exists and still runs
its callback — with no transaction and no rollback. That is the degrade
ADR-0119 D1 declares (and D1-R4 lets a caller refuse), not a fault in the
engine. The fault was a caller reading the method's presence as atomicity,
which is what the publish door did.

Which runtimes those are, read from the code on `main` at `e765a092d` — a
reading of that date, not part of the decision:

- **`driver-turso` on its remote transport.** `TursoDriver` extends `SqlDriver`
  and declares `transactionsUnsupported` when `transportMode === 'remote'`; its
  local and embedded-replica modes do not. This is the case the original caveat
  missed: SQL, a production shape, and no rollback.
- **`driver-odata`**, which declares it unconditionally.
- **Any default driver with no `beginTransaction`, and any engine with no
  `transaction()`** — a foreign engine, a test double.

**The in-memory driver is not on that list.** The original caveat named it
("in-memory drivers have no real transaction"), and that is not what the code
shows today: `driver-memory` implements `beginTransaction` / `commit` /
`rollback` by snapshotting the store and restoring the snapshot, declares no
`transactionsUnsupported`, and the gate answers yes for it. The driver half is
pinned by `memory-driver.test.ts` ("should rollback a transaction"); the engine
half was measured at the same commit by a one-time probe, not kept as a test:
on ObjectQL over `InMemoryDriver`, a transaction that inserted two
rows and then threw left none of them, with `owned: true`; the same driver made
to declare `transactionsUnsupported` left both. What it rolls back is the whole
store, to its state at `begin` — a rollback, without the isolation a SQL
transaction gives.

### What a package publish does where the engine cannot roll back (#32396, PR #32454)

`publishPackageDrafts` now asks that gate instead of
`typeof engine.transaction === 'function'`. Where it answers yes nothing
changed. Where it answers no:

1. **Every draft is judged before any is written.** A first pass runs each
   draft's promotion in judge-only mode. A draft the publish-time gate refuses
   — the class #32396 hit — refuses the batch with no draft promoted. (The
   refusal itself is still recorded in the audit trail.)
2. **Then the drafts are promoted, each judged again** against the store as the
   earlier promotions left it, and the commit is recorded.
3. **A failure the first pass could not see is undone by compensation** — a
   refusal that only the earlier promotions provoke, a draft saved in between,
   a store fault. Every promotion already made is undone, newest first: the
   active row is removed when the publish created it and restored to its prior
   version when the publish edited it, and the draft the promotion consumed is
   put back as the pending draft, byte for byte. Each undo appends its own
   history events, as a Decision-3 revert does, so the log records a publish
   that was undone rather than nothing.
4. **An undo that fails is named.** One item's failure does not stop the others
   from being undone. An item that could not be undone is reported in
   `failed[]` as live, without the `BATCH_ABORTED` code that means "not
   published"; and it is logged at `error` with the fix. The refusal's audit
   note names it too, but only when the refusal has an identifiable causal
   item: that audit row is written per causal item, and a failure outside any
   one promotion — the commit record failing after every promotion — has
   none.

### That is best effort, not atomicity

Compensation is not a transaction, and this record says where it falls short
rather than leaving it to be discovered:

- **A process that stops between a promotion and its undo leaves that
  promotion live.** The list of what to undo is held by the publishing call
  itself; nothing durable records that an undo is owed, and nothing retries one.
- **An undo is a write, and a write can fail.** The item then stays live — named
  in the response and the log, and in the audit note only where the refusal
  has a causal item, as above.
- **There is no isolation.** Between a promotion and its undo the store holds
  the promoted row. The publishing runtime's registry does not serve it —
  registry refresh is a Phase-2 side effect, which a refused batch never
  reaches.
- **One promotion is itself more than one write** (the active row, then its
  history row), and the per-item `withTxn` degrades the same way. A promotion
  the store left half-written threw, so it is not among the promotions the undo
  walks.

So on a runtime that cannot roll back, this record's "a commit cannot
half-land" (TL;DR 2, the status line), D2's "no half-built app, no orphan
rows", and the gain "The half-land class dies" read as: a batch refused at
judgement writes nothing; a batch that fails mid-promotion is put back, unless
the process stops first or an undo fails — and a failed undo is named.

### What this amendment does not decide

- **Whether the remote Turso transport gets real transactions** is open on
  #32481. Nothing here assumes either answer. The scope above is written
  against the gate, not against a list of drivers, so the list is the part
  that would move.
- **It describes the package-publish door only** — the one PR #32454 changed.
  It makes no statement about Decision-3's revert doors or about any other
  caller of `engine.transaction()`.

**Decided by**: the maintainer, 2026-11-12, on #32480 (option A — amend this
record; no historical text is rewritten). **Mechanism**: ADR-0119 D1, the
declared no-rollback degrade, and its D1-R4. **Implemented in**
`packages/metadata-protocol/src/protocol-history-and-publish.ts`
(`publishPackageDrafts`, `undoLandedPromotions`) by PR #32454 (`976770ccb3`);
the gate is `engineCanRollBack` in
`packages/core/src/utils/migration-journal.ts`. Pinned by
`protocol-publish-drafts-all-or-nothing.test.ts`.

---

## Amendment (2026-11-14, #32504) — Decision-3's revert doors are not atomic across items; a revert runs per item and reports per item

Decision-3's design — a revert restores every item the commit touched to its
pre-commit body, reusing `restoreVersion`, and is recorded as a **new forward
commit** — is **unchanged**. What is amended is the atomicity TL;DR 3 and D3's
first two bullets attach to it: "atomically", "inside one transaction", "as one
transaction". The code on `main` never opened that transaction. This record now
says what the two doors do instead; it records the code and does not decide
whether a revert should stay this way (below).

### What the doors do

> ⚠️ **Amended 2026-11-15 (#33850 — PR #33805, PR #33979).** This section is
> the reading at `ba35dfd7`, and `main` has moved on four points since. ⛔ On
> these the text below is no longer a statement of what the doors do: the
> faults the revert reads after an item's row write (now named in `failed[]`,
> and `success` is false); the skipped item (now named in `failed[]`, nothing
> written); what the revert commit is written from (the revert's own plan,
> with the version each row held); and "reverting it still restores nothing"
> (reverting a revert commit recorded since PR #33805 restores). In the
> closing paragraph, the sentence "A fault after an item's row write is not
> named there, and a skipped item is not named at all." goes with them. Still
> true: on the soft-remove limb, a registry heal outcome that answers no stop
> is not reported, and the item is in `reverted[]`. The rest of the section
> stands. See the Amendment (2026-11-15, #33850) at the end.

Read from the code on `main` at `ba35dfd7` — a reading of that date, not part
of the decision:

- **`revertCommit`** walks the commit's items in reverse apply order. An item
  the commit created is soft-removed; an item it modified is restored to its
  `prevVersion` through `restoreVersion`, as D3 says. Each item's own write —
  the row and its history event — runs in the repository's per-item `withTxn`,
  so it rolls back as one where the engine can roll back (the gate of the
  2026-11-12 Amendment). **No transaction spans the items**: the function
  opens none. An item that is refused, or whose removal or restore throws,
  goes into `failed[]` with its client-facing error (and its code, where it
  has one), and the walk goes on to the next item. What follows an item's row
  write does not reach `failed[]`: the registry write-through (or, on the
  soft-remove limb, the registry heal) and the projector catch their own
  faults and log them, and their results are not read; storage sync reports on
  `advisories`. Such an item is still reported in `reverted[]`, and `success`
  does not see the fault. (One exception, on the soft-remove limb: for an
  `object_extension` item, a store fault while the heal re-reads the stored
  extensions is rethrown, so that item lands in `failed[]` with its row
  already removed.)
- **An item can also be skipped.** An item recorded as existing before the
  commit but with no `prevVersion` takes neither limb: it appears in neither
  `reverted[]` nor `failed[]`. Every revert commit writes its own plan that
  way (`existedBefore` true for an item it restored, `prevVersion: null`), and
  a revert commit can be reverted, so reverting a revert commit restores none
  of the items it restored (and sends the items it removed down the
  soft-remove limb again, recreating nothing).
- **The revert commit.** When the walk ends, it is written from `reverted[]` —
  what was reverted, not what the commit named — and the answer's `success` is
  true only when `failed[]` is empty and at least one item was reverted.
- **The revert commit itself is best effort.** `recordPackageCommit` catches
  every error: where `sys_metadata_commit` is unprovisioned it logs once at
  `info`, and where the write fails it logs at `error`, and either way it
  returns no record. `revertCommit` then answers without `revertCommitId` and
  returns normally. Such a revert is on no package-commit timeline (each
  item's `sys_metadata_history` event is still written), so there is no
  commit to revert. Where the record lands, reverting it still restores
  nothing, as the skipped outcome above says.
- **`rollbackToPackageCommit`** runs one `revertCommit` per `apply` commit
  newer than the target, newest first. A step that throws, and every item a
  step reports in its own `failed[]`, goes into the rollback's `failed[]`;
  neither stops the rollback, and every step that returns has attempted its
  own revert commit, best effort as above.

So a revert in which one item fails leaves the package **partly reverted**:
the item's neighbours are reverted (and recorded, where the record write
lands), the failed item is named in the response, and `success` is false. A
fault after an item's row write is not named there, and a skipped item is
not named at all.
That is the half-land shape D2 exists to prevent on publish, here on the
revert side — reported, not prevented.

### What this amendment does not decide

- **Whether a revert should be atomic.** Running `revertCommit` (or a whole
  rollback) inside one `engine.transaction()` would change what a caller sees —
  a revert with one refused item would then revert nothing — and would hold
  only where the engine can roll back. That is a maintainer decision, not made
  here.
- **Whether a revert commit should carry the versions it restored**, so that
  D3's "a revert is itself revertible" holds, and **whether a fault after an
  item's row write should reach `failed[]`**. Both are code questions; this
  record states what the code does today.
  ⚠️ **Amended 2026-11-15 (#33850 — PR #33805, PR #33979).** The code has
  answered both: a revert commit records the version each row held, and the
  faults the revert reads after an item's row write reach `failed[]`. A heal
  outcome that answers no stop still does not. See the Amendment (2026-11-15,
  #33850) at the end. The first bullet, atomicity, is still open.
- It changes nothing in Decision-2, the package-publish door, or the
  2026-08-06 carve-out (audit rows written during rolled-back work still
  remain).

**Recorded by**: the triage of #32504 ("stale text only"), dispatched as a text
correction: this record follows the code; no historical text is rewritten.
**Implemented in** `packages/metadata-protocol/src/protocol-package-commits.ts`
(`revertCommit`, `rollbackToPackageCommit`). Where the doors' docblocks on
`ObjectStackProtocolImplementation` in `protocol.ts` say more than the code
(a revert answering `success: true` is one the process has acted on; a revert
is itself revertible; each rollback step records its revert commit), this
record states the code. Pinned by
`protocol.revert-stored-type-canonical.test.ts` ("reverts the neighbours of a
refused item and reports the mix honestly").

> ⚠️ **Amended 2026-11-15 (#33850).** Two of the three places named above,
> where the docblocks said more than the code, no longer do: a revert is
> revertible in the code, and the rollback docblock now says each step
> attempts its revert commit, best effort. The first still says more than the
> code, for the outcomes the revert does not read. See the Amendment
> (2026-11-15, #33850) below.

---

## Amendment (2026-11-15, #33850) — the faults a revert reads after an item's row write are now named in `failed[]`, and a revert commit records what it replaced

The 2026-11-14 Amendment recorded what the two revert doors did on `main` at
`ba35dfd7`. Two code changes have landed since: PR #33805 (`568f214a`,
2026-11-15) and PR #33979 (`0bbb211f`, 2026-11-15). This amendment records
what the doors do now. It decides nothing. Decision-3 is unchanged, the doors
are still not atomic across items, and no text of the 2026-11-14 Amendment is
rewritten: the parts this one replaces are marked there and listed below.

### What the doors do now

Read from the code on `main` at `fb79d47c` — a reading of that date, not part
of the decision. The door is
`packages/metadata-protocol/src/protocol-package-commits.ts#revertCommit`.

- **The faults the revert reads after an item's row write are named in
  `failed[]`.** There are five. On the restore limb: the registry
  write-through answering a refusal or a fault; the storage sync answering
  any advisory (a refused sync, or column changes that were not applied; the
  advisory still rides `advisories`); and the mutation projector answering
  `success: false`. On the soft-remove limb, where a row was removed: the
  registry heal answering a stop, and the projector answering
  `success: false`. On either limb: a throw after the row write. Such an
  item goes into `failed[]`, not `reverted[]`. Its entry names the row state
  ("its row was removed from sys_metadata", or "its row was restored to the
  body of version N") beside each step that did not land. The rule for
  `success` is the one the 2026-11-14 Amendment records (true only when
  `failed[]` is empty and at least one item was reverted), so one such item
  makes the answer `success: false`.
- **Which PR reads which.** PR #33805 reads the storage advisory, the
  projector, the later throw, and the write-through's answer, which at that
  time carried only the registry's refusal of an `object`. PR #33979 adds
  the rest. The restore limb now asks the write-through to answer its
  faults (`answerFaults` on
  `packages/metadata-protocol/src/protocol-registry-hydration.ts#RegistryWriteThroughRequest`),
  so its two other branches (the `object_extension` registration, and the
  overlay hydration every remaining type takes) answer a throw as well. The
  heal answers its stop
  (`packages/metadata-protocol/src/protocol-registry-hydration.ts#restoreArtifactRegistryView`, `#RegistryHealStop`),
  and the soft-remove limb reads it only where it removed a row. The
  exception the 2026-11-14 Amendment names for an `object_extension` item
  still ends in `failed[]`, by the throw path, and its entry now names the
  removed row.
- **What still does not reach `failed[]` after a row write.**
  - Registry heal outcomes that answer no stop, on either limb. Among them,
    on the soft-remove limb: the registry refusing to unregister a removed
    `object` is caught and logged at `warn`, and the object stays
    registered. A package-scoped refusal of the baseline read is logged at
    `error`, with the entry retired or not. A degraded baseline read keeps
    the entry. The heal's docblock calls the last two designed outcomes.
    For a removed `object_extension`, a stored extension that cannot be
    registered again is logged at `warn`
    (`packages/metadata-protocol/src/protocol-class-head.ts#resyncStoredObjectExtensions`).
    With no row removed, a stop the heal does answer is not reported
    either. On either limb: the member views of a view container. Each
    view the row no longer expands to is healed by
    `packages/metadata-protocol/src/protocol-registry-hydration.ts#reconcileViewExpansions`,
    which does not keep the heal's answer. The heal of a removed container
    runs it, and so does the write-through of a restored one.
  - The mutation event: it is emitted and its result is not read.
  - The stored-expression fill, which runs after the revert commit is
    written and reports on `advisories` only.

  An item with one of these is reported in `reverted[]`, and `success` does
  not see it. For the heal outcomes, the 2026-11-14 sentences about the
  registry heal stay the account: the outcome is not reported, the item is
  in `reverted[]`, and the registry may keep serving what the revert moved
  away from.
- **The revert commit is written from the revert's own plan**, not from
  `reverted[]` (PR #33805). An item enters the plan when its row write
  returns, whether or not it then reaches `reverted[]`, so a row that
  changed under an item reported in `failed[]` is still on the commit
  timeline. A soft-remove that found no row to remove enters the plan too,
  recorded as `existedBefore: false`. An item refused or thrown before its
  row write is in `failed[]` and not in the plan.
- **Each plan item records what the revert replaced** (PR #33805). Before
  the row write, the revert reads the version of the committing package's
  active row. The plan item carries that version as `prevVersion`, and
  `existedBefore` is true exactly when the row was there. A read that fails
  at that point fails the item into `failed[]` with nothing written. So
  reverting a revert commit restores on both limbs: an item the revert
  restored goes back to the version the revert replaced; an item the revert
  removed is written again at the version it held; and an item the revert
  wrote again because its row had been deleted is removed. Where the read
  finds no version on a row that exists, the item is recorded without one
  and takes the next bullet's path when the revert is reverted.
- **An item recorded as existing, with no version to restore, is named and
  nothing is written for it** (PR #33805). It goes into `failed[]` before
  any read or write, and the walk moves to the next item. The entry carries
  no `code`; its text says the commit records no version to restore the item
  to, and points at the item's own version history. Every revert commit
  recorded before PR #33805 wrote its restored items that way (the
  2026-11-14 Amendment's "skipped" bullet), so reverting one of those now
  names each of them in `failed[]` and answers `success: false`. The items
  such a commit removed still go down the soft-remove limb, as that bullet's
  parenthetical says.
- **The revert commit record is still best effort, and the rollback door's
  docblock now says so** (PR #33805, for #33486). The code is as the
  2026-11-14 Amendment reads it: `recordPackageCommit` catches every error
  and returns no record, and `revertCommit` then answers without
  `revertCommitId`. The docblock on
  `packages/metadata-protocol/src/protocol.ts#rollbackToPackageCommit` now
  reads: "[#33486] That record is best effort: when the commit store is
  unprovisioned or the write fails, nothing is recorded and the step's answer
  omits `revertCommitId`, so the step is on no package-commit timeline and
  cannot itself be reverted as a commit." The rollback itself is unchanged:
  one `revertCommit` per `apply` commit newer than the target, newest first.
  Each item a step reports in its own `failed[]` goes into the rollback's
  `failed[]`, which now includes an item whose row the step wrote.

So a partly reverted package now has one more shape, and it is reported: an
item in `failed[]` whose row **was** changed. Its entry says so, and says
that the stored row and what the process serves disagree until the failed
steps run again.

### What this replaces in the 2026-11-14 Amendment

- In "What the doors do", first bullet: the sentences from "What follows an
  item's row write does not reach `failed[]`" to the end of the bullet, for
  the faults the revert reads (listed above). For a heal outcome that
  answers no stop, those sentences still hold.
- In the bullet "An item can also be skipped": "it appears in neither
  `reverted[]` nor `failed[]`" (it is named in `failed[]`), and, for a revert
  commit recorded since PR #33805, the account of what its plan holds and of
  what reverting it restores. The bullet's parenthetical still holds for a
  revert commit recorded before PR #33805.
- In "The revert commit": "it is written from `reverted[]`". The `success`
  rule in that bullet stands.
- In "The revert commit itself is best effort": the last sentence, "Where
  the record lands, reverting it still restores nothing". It still holds for
  a revert commit recorded before PR #33805, as a named failure, not a
  silent one.
- In the closing paragraph: "A fault after an item's row write is not named
  there, and a skipped item is not named at all." A fault the revert reads
  is named, and so is that item. The paragraph's last sentence stands.
- In "What this amendment does not decide", second bullet: both code
  questions are answered by the code. A revert commit carries the versions
  it replaced, and the faults the revert reads after an item's row write
  reach `failed[]`.
- In the "Recorded by" paragraph: two of the three places where the
  docblocks said more than the code. A revert is revertible, and the
  rollback docblock no longer says each step records its revert commit. The
  third still says more than the code: a revert that answers `success: true`
  is one the process has acted on only as far as the faults the revert
  reads.
- In D3's first bullet, the 2026-11-14 parenthetical's last clause,
  "reverting a revert commit restores nothing today". TL;DR 3's parenthetical
  and D3's second one still hold.

The rest of the 2026-11-14 Amendment stands: the walk is per item, no
transaction spans the items or the rollback's steps, a failed item's
neighbours are still reverted, and the half-land is reported, not prevented.

### What this amendment does not decide

- **Whether a revert should be atomic** is still open, exactly as the
  2026-11-14 Amendment leaves it. Nothing in PR #33805 or PR #33979 opens a
  transaction around the items.
- **Whether a heal outcome that answers no stop should reach `failed[]`.**
  This record states what the code does today.
- It changes nothing in Decision-2, the package-publish door, or the
  2026-08-06 carve-out.

**Recorded by**: the triage of #33850, dispatched as a text correction: this
record follows the code; no historical text is rewritten. **Implemented in**
`packages/metadata-protocol/src/protocol-package-commits.ts`
(`revertCommit`, `rollbackToPackageCommit`) and
`packages/metadata-protocol/src/protocol-registry-hydration.ts` by PR #33805
(`568f214a`) and PR #33979 (`0bbb211f`). Pinned by
`packages/metadata-protocol/src/protocol.revert-commit-honest-outcome.test.ts`:
"[#33563] revertCommit reports a fault after an item's row write in
failed[]" (which also pins the plan, and "rollbackToPackageCommit carries the
step's post-row-write fault and answers success false"), "[#33564] reverting
a revert commit restores what the revert replaced" (restore limb, soft-remove
limb, and "an item recorded as existing with no version is named in failed[],
never skipped, and nothing is written"), "[#33851] revertCommit reports a
non-object write-through fault in failed[]" and "[#33851] revertCommit
reports a removed item whose registry heal stops in failed[]".
