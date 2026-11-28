# ADR-0055: Master-detail "controlled by parent" permissions — derived access via pre-resolved master-id membership

**Status**: Accepted (2026-06-19) — implemented in this PR (P0–P2) · **Amended** (2026-09-07, #11082 / PR #11183 — the "Single-level only in v1" limit under Consequences and the "Transitive nested master-detail chains" **Non-goal** are both **reversed**: since `@objectstack/plugin-security` 17.3.0 (merged 2026-08-23) the read derivation and the write gate compose `controlled_by_parent` across a chain, bounded by a cycle guard and a cost ceiling that both fail **closed**. Nothing else in this record changes — §1–§4, the mechanism choice, the set-size limit and the share-table non-goal all stand. See **"Amendment (2026-09-07, #11082): transitive chains compose — the single-level non-goal is reversed"** at the end.)
· **Revisited in part** (2026-10-10, [ADR-0139](./0139-engine-internal-semi-join-leaf-readable-parent-ids.md), Proposed) — §2's alternatives row (a) is reversed for ONE engine-internal, non-authorable leaf the engine composes from the compiler's output; the RLS compiler still has no subquery form, and §2's chosen mechanism (b), its `rlsMembership` IN-form and the set-size limit all stand.
· **Amended** (2026-10-22, #24932, ruling B `6303721609` and Q1 C / Q2 A `6329027469`) — **§2's chosen mechanism (b) is retired for `controlled_by_parent`, and the set-size limit with it**: the read derivation (`packages/plugins/plugin-security/src/security-plugin.ts#computeControlledByParentFilter`) answers ADR-0139's `ReadableIds` leaf over the master, the engine composes it from this plugin's own `canReadObject` / `getReadFilter` of the master, and the driver compiles one statement with the master inside a subquery — the seventh consumer of that leaf, in the end-state form. No master id set is pre-resolved any more. The 2026-10-10 line above reads as of its date. What still stands: §1 (the one required `master_detail`), §3 (the write gate), the cycle guard and the depth bound (now the engine's own cut, judged first over the registry), and the RLS compiler's `rlsMembership` IN-form, which serves `current_user.<key>` memberships and never served this derivation. The limit that replaces the set-size ceiling is ADR-0139 D5's two master shapes, which the boot refuses (#25144).
⚠️ **Amended 2026-11-15 (#33696, ruling `6893666857`)** — by that ruling the parent chain over a **required** master is dropped for one reader class; every other reader is answered as this line says. See the 2026-11-15 line below.
· **Amended** (2026-10-26, #25760, ruling `6398566164`) — **§3 gains one per-object opt-in**: `sharing.controlledByParent.ownerMayEdit: true` lets the OWNER of a detail row (its `owner_id`) pass the write gate on a by-id `update` of that row with **read** access to the master; every other caller, and every insert, delete, predicate update and on-behalf-of write, keeps the master-**edit** rule. The default is unchanged. See **"Amendment (2026-10-26, #25760): the owner of a detail row may update it with read on the master, by opt-in"** at the end. ⚠️ **Amended 2026-11-14 (#33250 / PR #33369)** — that "every other caller … keeps the master-edit rule" no longer holds on a detail that declares the second opt-in, `writeRequiresMasterRead`: there every write asks **read** on the master. The two opt-ins are refused together. See the 2026-11-14 line below.
· **Amended** (2026-10-27, #26591 / PR #26658) — **the 2026-10-26 amendment's Lint bullet is narrowed in place**: the lint prescribes the opt-in only for an `owner_id`-keyed `update` / `all` policy on a `controlled_by_parent` detail that carries `owner_id` and has not opted in; any other caller-keyed update policy is flagged in both states with the `owner_id` remedy, never the opt-in. The gate, the spec and the lint are unchanged by this note. See the note under **Lint** in "What the opt-in does, exactly".
· **Amended** (2026-11-06, #30905, maintainer ruling 「A」) — **§1 admits an optional master and §2 gains a null-master arm**: a `controlled_by_parent` object whose only `master_detail` is declared `required: false` derives an OPTIONAL master. A detail row that names its master is read through it, unchanged; a row whose master reference is empty is read by its owner (`owner_id`) and by View All on the detail, through a second arm OR-ed with the master arm inside the one read chokepoint, `computeControlledByParentFilter`. §3 (the write gate) is unchanged by this note: a write that leaves the reference empty is still refused. ⚠️ **Amended 2026-11-07 (#30906 / PR #31082)** — that §3 sentence no longer holds; see the next line. See **"Amendment (2026-11-06, #30905): an optional master, and the null-master row its owner reads"** at the end.
· **Amended** (2026-11-07, #30906 / PR #31082, the same ruling 「A」) — **§3 judges the null-master row by an owner rule**: a row of an optional master whose reference is empty is written by its owner (`owner_id`) and by Modify All on the detail, everyone else `403`; an insert naming no master is admitted; setting a master asks edit on it, emptying one asks edit on the stored master (the 2026-10-26 opt-in does not cover it); a chain hop with no master of its own ends the chain under the same rule. A required master is unchanged. See **"Amendment (2026-11-07, #30906): the null-master row its owner writes"** at the end. ⚠️ **Amended 2026-11-14 (#33250 / PR #33369)** — that "setting a master asks edit on it, emptying one asks edit on the stored master" no longer holds on a detail that declares `writeRequiresMasterRead`: there the new master and the stored master are each asked **read**. The owner rule of the null-master row is unchanged. See the 2026-11-14 line below.
· **Amended** (2026-11-14, #33250 / PR #33369, ruling A+ `6880588685`) — **§3 gains a second per-object opt-in, and for the objects that declare it the 2026-10-26 amendment's "Option 2 … was not chosen" line is lifted**: `sharing.controlledByParent.writeRequiresMasterRead: true` makes **read** on the master the master question for every write of the detail (insert, update and delete, by id or by predicate, and the lifecycle verbs); the detail's own object permissions, row-level security, field-level security and the platform ownership floors decide the rest. The default is unchanged: a write's answer moves only if its own object, or a `controlled_by_parent` master on its chain, declares the key. See **"Amendment (2026-11-14, #33250): read on the master is enough to write, by opt-in"** at the end.
· **Amended** (2026-11-15, #33696, ruling 「只对管理员去掉」 `6893666857`) — **for one reader class the parent chain over a REQUIRED master is dropped, and that class alone reads that master's detail rows whose reference is empty or dangling**: a reader who holds View All on the detail AND whose every master hop answers unrestricted (the engine's per-hop scope, not `hasSuperuserReadBypass`) sees those rows — naming no master, or a master that does not exist — inside its own tenant wall. That is consistent with the 2026-11-06 ruling 「A」, whose reader of a row with no master, beside its owner, is View All on the detail. Every other reader, members included, keeps the chain unchanged. An optional master's two arms are outside the ruling, and §3 (the write gate) is not amended by this note. The ruling lifts ADR-0139 D6's ⛔ ("interim removal of the predicate for an unrestricted master scope") for that class only, and [ADR-0139](./0139-engine-internal-semi-join-leaf-readable-parent-ids.md) D6 as amended 2026-11-15 carries the ruling's binding bullets verbatim. This is the "ADR-0055's 10-22 note in step" the ruling orders, and it precedes the code: #33696's change lands only after it. See the note under **"The rules the read keeps"** in the 2026-11-06 amendment.
· **Amended** (2026-11-22, #35802, ruling 「A 批量与逐条一致」 `7073030861`) — **§3: an addressed predicate update or delete hands the platform ownership floor to the master gate, as the by-id write does**: once the gate has passed every master a non-delegated predicate (`multi: true`) write reaches, the write is no longer held to `owner_only_writes` / `owner_only_deletes` (`created_by == current_user.id`), and the rows it writes are the rows a by-id write of each would write for the same caller. This supersedes one sentence of the 2026-11-14 amendment ("A **predicate** update or delete keeps the floor, as before"). The gate's refusals, the read narrowing, the null-master owner rule, app-authored row-level policies, the 10,000-row cap, the delegated write's two floors and `ownerMayEdit` are unchanged. See **"Amendment (2026-11-22, #35802): a predicate write hands the ownership floor to the master gate"** at the end.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove), [ADR-0054](./0054-runtime-proof-for-authorable-surface.md) (prove-it-runs)
**Surfaced by**: an audit of master-detail permission semantics — `OWDModel.controlled_by_parent` is **declared but unenforced** (zero runtime consumers; not reachable through the object's `sharingModel` enum; the RLS compiler is relationship-blind). This is *false compliance* (ADR-0049) and *unproven liveness* (ADR-0054).

> **Framing, not the thesis.** The authorization model is already the mainstream (Salesforce-shaped) model — permission sets + FLS + predicate RLS + ownership + sharing rules + hierarchy. So this is **gap-closure, not a rewrite**: we close `controlled_by_parent` with the existing engine and gates. This ADR is the *concrete landing plan* for that one capability; cleanup items it touches (the `OWDModel`↔`sharingModel` inconsistency, removing dead `contextVariables`) are PR-level tasks, not decisions, and are noted, not belaboured.

---

## TL;DR

A **master-detail detail** record today is access-controlled entirely on its own fields — its master record's access is **not** inherited. Salesforce's "Controlled by Parent" (detail visibility/edit derived from the master) is declared in the spec yet does nothing.

**Decision.** Implement `controlled_by_parent` by **auto-deriving the set of master records the user can access and constraining the detail's master-FK to that set** — reusing the engine's existing pre-resolved-membership mechanism (`ExecutionContext.rlsMembership` + the compiler's `field IN (current_user.<key>)` form), with **zero compiler changes**. Reads inject `masterFK IN (accessible_master_ids)`; by-id writes extend the #1994 pre-image check to require master **edit** access. The guarantee is proven by a `@objectstack/dogfood` RLS proof (ADR-0054), which depends on the verifier's related-record topological synthesis landing first.

---

## Context — the mechanisms this builds on (verified)

1. **Read-path RLS injection.** `packages/plugins/plugin-security/src/security-plugin-authz-middleware.ts#rlsFilter` AND-s an RLS filter into the query AST (`opCtx.ast.where = { $and: [where, rlsFilter] }`) before the driver runs. The builder `computeRlsFilter` (`packages/plugins/plugin-security/src/security-plugin.ts#computeRlsFilter`) is **async** and shared by the engine find-path and the analytics raw-SQL path (`getReadFilter`).
2. **Pre-resolved membership (§7.3.1) already exists.** The RLS compiler recognizes `field IN (current_user.<key>)` and resolves `<key>` against `ExecutionContext.rlsMembership` — "the runtime resolves set-membership that would otherwise need a subquery … and stages each set here under a stable key" (`packages/spec/src/kernel/execution-context.zod.ts#rlsMembership`; merge at `packages/plugins/plugin-security/src/rls-compiler.ts`). **This is the seam controlled_by_parent plugs into — no new compiler form.**
3. **By-id write pre-image check (#1994).** `packages/plugins/plugin-security/src/security-plugin.ts` already re-reads the target row under the write-op RLS filter before an update/delete and denies if invisible. This is the exact hook to extend with a master-access check.
4. **`sharingModel` enforcement seam.** `packages/plugins/plugin-sharing/src/sharing-service.ts#buildReadFilter` reads `object.sharingModel`; `buildReadFilter` gates on it (`effectiveSharingModel(schema) !== 'private'`). A `controlled_by_parent` baseline plugs in here / in the security middleware.
5. **Master-detail storage.** A `master_detail` field's **key is the FK column**; its `reference` (`packages/spec/src/data/field.zod.ts#reference`) names the master object. Given a detail row, the master id is `row[masterFieldKey]`.
6. **Spec inconsistency (to fix either way).** `OWDModel` (`sharing.zod.ts`) includes `controlled_by_parent`; the object's authorable `sharingModel` (`object.zod.ts`) is a different enum `['private','read','read_write','full']` that omits it.

## Decision

### 1. Spec contract

- Add `controlled_by_parent` to the **authorable** `object.sharingModel` enum (converging it with `OWDModel`; resolves the inconsistency).
- An object with `sharingModel: 'controlled_by_parent'` **must declare exactly one required `master_detail` field**; its `reference` identifies the master object and its field key is the master FK. Validation error otherwise (fail closed — an unsatisfiable "controlled by parent" must not silently fall open).
  ⚠️ **Amended 2026-11-06 (#30905, ruling A):** or, with no required one, its **only** `master_detail` declared `required: false` — an **optional** master, whose rows may name none. Every other refusal stands (two masters, a required `lookup` only, a `readonly` / `system` master). See the amendment at the end.
- The author writes **no RLS policy** for this — "controlled by parent" is *derived automatically* from the relationship (Salesforce-like OWD), which is the whole point.

### 2. Read mechanism — pre-resolved accessible-master-id set (chosen)

For a `controlled_by_parent` object, the security layer, per request:
1. resolves the **master object's** read filter for this user (`computeRlsFilter` on the master — the same machinery, reused), runs it to get the accessible master ids, and
2. stages them in `ExecutionContext.rlsMembership` under a per-relationship key (e.g. `cbp_<object>_<field>`), then
3. the detail's derived policy `"<masterFieldKey> IN (current_user.cbp_<object>_<field>)"` compiles via the **existing IN-form** and AND-s onto the read (step 1 in Context). An **empty** set fails closed (the compiler already returns `null` → deny) — correct: no accessible master ⇒ no detail.

This composes with the detail's own tenant/owner RLS (all AND-ed) and flows to analytics via `getReadFilter` unchanged.

⚠️ **Amended 2026-11-06 (#30905, ruling A):** for an **optional** master (§1 as amended), the derivation is one `$or` of two arms that never share a row — the master arm (now ADR-0139's leaf, per the 2026-10-22 amendment) and a **null-master** arm for rows whose master reference is empty, read by the row's owner and by View All on the detail. The `$or` is the cbp layer's own answer, so it is still AND-ed under the tenant wall and beside the detail's own layers. A required master's derivation is unchanged. See the amendment at the end.

⚠️ **Amended 2026-11-15 (#33696, ruling `6893666857`):** for one reader class the read of a **required** master's detail no longer follows the master. For a reader who holds View All on the detail and whose every master hop answers unrestricted (the engine's per-hop scope, not `hasSuperuserReadBypass`), the ruling drops the parent chain, so that reader also sees, inside its own tenant wall, the rows whose master reference is empty or dangling. Every other reader keeps the chain. See the 2026-11-15 status line.

**Why this mechanism (trade-offs):**

| Option | Verdict | Why |
|---|---|---|
| (a) query-time subquery join (`masterFK IN (SELECT id FROM master WHERE …)`) | ✗ rejected | the RLS compiler **deliberately has no subquery support** (`packages/plugins/plugin-security/src/rls-compiler.ts`); the query AST has no EXISTS/sub-select form. Would require extending both. |
| **(b) pre-resolved accessible-master-id set** | ✓ **chosen** | reuses the `rlsMembership` + IN-form path with **zero compiler changes**; resolution is one async pre-query per request, composes with existing RLS, reaches analytics. |
| (c) materialized accessible-ids column | ✗ rejected | dual-write maintenance; goes stale the moment access rules/shares change mid-session — a correctness hazard for a security primitive. |

### 3. Write mechanism — extend the #1994 pre-image check

In the pre-image block (`packages/plugins/plugin-security/src/security-plugin.ts#assertControlledByParentWrite`), for a `controlled_by_parent` detail `update`/`delete`/`create`:
- resolve the target's master id (`row[masterFieldKey]`; for `create`, the master id in the incoming body), and
- re-read the master under its **edit** write-filter (`findOne(master, { where: { $and: [{id: masterId}, masterWriteFilter] } })`); a `null` result ⇒ deny.
- **Rule:** editing/deleting/creating a detail requires **edit** access to its master (Salesforce master-detail semantics). Reading a detail requires **read** access to its master (§2).
  ⚠️ **Amended 2026-10-26 (#25760) — one opt-in.** A detail that declares `sharing.controlledByParent.ownerMayEdit: true` lets the **owner** of a detail row (`owner_id`) pass this gate on a **by-id `update`** of that row with **read** access to the master. The rule above stands for every other caller and every other write; see the Amendment at the end before deriving an invariant from this line.
  ⚠️ **Amended 2026-11-07 (#30906 / PR #31082) — the null-master row.** For an **optional** master (§1 as amended), a row whose master reference is empty has no master to ask: its owner or Modify All on the detail writes it, an insert naming no master is admitted, and emptying a master asks edit on the stored master. See the 2026-11-07 amendment at the end.
  ⚠️ **Amended 2026-11-14 (#33250 / PR #33369) — a second opt-in.** A detail that declares `sharing.controlledByParent.writeRequiresMasterRead: true` is asked **read** on its master in place of edit, for every write of its rows, and its own grants decide the rest. The rule above stands, at its own hop, for every detail that does not declare it; in a chain, a hop above it that declares the key asks read there (see the amendment). See the 2026-11-14 amendment at the end.

This reuses the existing re-read-and-deny pattern; no new enforcement layer.

### 4. Proof (ADR-0054)

A `@objectstack/dogfood` RLS proof, bound in the liveness ledger on `object.sharingModel` (and/or the master-detail field): a member who **cannot read master M** can **neither read nor by-id-write a detail D under M**, and **can** once granted master access (red/green, revert-provable). This is the runtime guard that flips `controlled_by_parent` from declared to *live*.

**Prerequisite:** the proof must create a master + a detail under it. Today `@objectstack/verify`'s `deriveCrudCases` **skips objects with required relations**. So the **related-record topological synthesis** capability (build the object dependency graph, synthesize in topo order threading real ids) lands **first** — it is P0 here.

## Consequences

- **Positive.** Master-detail finally carries permission inheritance (not just cascade/expand); a declared-but-dead OWD value becomes enforced with a permanent runtime guard; zero RLS-compiler changes (lowest-risk path through a security-critical subsystem); composes with tenant/owner/role RLS and analytics; the `OWDModel`↔`sharingModel` inconsistency is resolved.
- **Negative / limits (honest).**
  - **Set-size ceiling.** A user with very many accessible masters produces a large `IN (...)`. Acceptable for typical cardinalities; **large-tenant scale (≫ thousands of masters) is a known limit** — a future share-table/join mechanism would replace the id list. v1 documents this, not solves it.
    ⚠️ **Amended 2026-10-22 (#24932) — retired.** There is no id list and no `IN (...)` of master ids any more: the read derivation answers the engine's `ReadableIds` leaf and the driver compiles `masterFK IN (SELECT id FROM master WHERE …)`, so nothing is bound per master and the statement does not grow with the master table. The ceiling this bullet booked was measured before it went (`DATABASE_ERROR` / 500, `too many SQL variables`, past ~32,800 masters on SQLite; 200 with the right rows at 33,000 after). The bullet is kept because it was true for mechanism (b); ⛔ it is no longer a statement of a limit.
  - **Per-request resolution cost.** One extra master-id query per controlled_by_parent object per request (cached within the request).
    ⚠️ **Amended 2026-10-22 (#24932) — retired, and corrected.** There is no extra query: the master is a subquery inside the detail's one statement (one per find, one per count). Before the switch the extra query ran **twice** per request — once for `find`, once more for `count` — and was never cached within the request; the parenthesis described an intent the code did not implement.
  - **Single-level only in v1.** Nested master-detail chains (a detail whose master is itself a detail) are **not** traversed transitively in v1.
    ⚠️ **Amended 2026-09-07 — this limit was lifted on 2026-08-23** by #11082 (PR #11183), released in `@objectstack/plugin-security` 17.3.0. The bullet is kept rather than deleted because it was true, and correctly recorded, **for v1**; what changed is the version it describes. ⛔ It is no longer a statement of the **enforced boundary** — both halves walk the chain now. Read the Amendment at the end before deriving any invariant from this line.

## Phasing

- **P0** — related-record topological synthesis in `@objectstack/verify` (prerequisite for the proof; independently valuable — widens auto-derive coverage).
- **P1** — spec contract (§1) + read derivation (§2) behind the `controlled_by_parent` sharingModel.
- **P2** — write pre-image extension (§3) + the dogfood RLS proof (§4); bind in the liveness ledger; flip the ledger entry to `live` with its `proof`.

## Non-goals

- **Large-scale share-table/join** for huge master sets (v1 uses the id-set; flagged as a future limit).
- **Transitive nested master-detail chains** (v1 is single-level). ⚠️ **Reversed 2026-08-23** by #11082 (PR #11183) — kept as the record of a decision that was taken and later overturned, ⛔ not as a live non-goal. Chains now compose, bounded and fail-closed; see the Amendment at the end.
- **A permission-model rewrite** — explicitly rejected; this closes one gap on the existing engine.
- **ServiceNow-style scripted/per-row ACL scripts** — over-engineering for an AI-authored platform; the four-form fail-closed compiler is the deliberate ceiling.
- **Client-side enforcement** — authorization is server-enforced; UI affordances are presentation (ADR-0054 §Non-goals).

## Alternatives considered

- **Rewrite the permission model against a mainstream blueprint.** Rejected: the model is already Salesforce-shaped; a rewrite re-opens hard-won invariants (the #1994 by-id-write fix, org-scoping stripping, the fail-closed compiler) for no foundational gain. Gaps are enumerable and closable individually.
- **(a) / (c) access-resolution mechanisms** — see §2 trade-off table.

---

## Amendment (2026-09-07, #11082): transitive chains compose — the single-level non-goal is reversed

**What changed and when.** PR #11183 (card #11082) merged to `main` on 2026-08-23 — commit subject *fix(plugin-security): compose controlled_by_parent across a chain (#11082) (#11183)* — and shipped in `@objectstack/plugin-security` 17.3.0. Two statements in this record stopped describing the runtime that day:

- **Consequences → Negative / limits (honest) → "Single-level only in v1."** — a statement of the **enforced limit**. It was true, and correctly recorded, for v1; it is now a dated record of v1, not a description of enforcement.
- **Non-goals → "Transitive nested master-detail chains"** — a record of a **decision that was taken**. It is **reversed**.

⛔ Neither was deleted. Deleting them would erase that the limit existed and that the non-goal was once chosen — the part of a decision record that cannot be reconstructed from the code, and the reason a reversed decision is written up as a reversal.

### Why v1's limit was a defect, not an unfinished feature

Below the first level the derivation was not enforced narrowly — it was not enforced **at all**. A `controlled_by_parent` detail whose master is *itself* `controlled_by_parent` was readable and writable **org-wide**, through two independent mechanisms:

- **Read.** §2 composed the master's RLS filter with the master's ownership/share filter and nothing else. For a master that is itself derived, both halves answer "no restriction": the RLS half is `null`, because a derived object authors no policy — §1 says so ("The author writes **no RLS policy** for this") — and the sharing half is `null` too, because `packages/plugins/plugin-sharing/src/sharing-service.ts#effectiveSharingModel` maps `controlled_by_parent` to `public` and `packages/plugins/plugin-sharing/src/sharing-service.ts#buildReadFilter` opts out of every non-`private` model. Composed `null`, the master query ran as **system** with an empty predicate and returned **every master row**.
- **Write.** §3's master gate asked `canEdit` on the master row, and `packages/plugins/plugin-sharing/src/sharing-service.ts#checkEdit` answers **`abstain`** for a `public`-mapped model. ⛔ `abstain` is not `deny`, so it answered `true` for every master row. The read-side fix does not reach this path: the two halves are separate mechanisms and are pinned separately.

So a two-level chain was enforced at level one and open at level two, under metadata that reads as though it were narrowed. §1 forbids exactly that shape where it can see it — an unsatisfiable declaration "must not silently fall open" — and the chained case had slipped past it.

### What both halves do now

- **Read.** `packages/plugins/plugin-security/src/security-plugin.ts#computeControlledByParentFilter` AND-composes the master's **own** `controlled_by_parent` derivation as a third layer, resolved through **that same method**, so the recursive answer cannot drift from the top-level one. The master set is therefore point-for-point equal to what a direct read of the master returns **at every level** — the equality §2 established for one.
  ⚠️ **Amended 2026-10-22 (#24932).** The derivation no longer composes the master's layers itself: it answers the `ReadableIds` leaf over the master, and the **engine** composes the master's scope by asking this plugin's public doors — `canReadObject(master)` and `getReadFilter(master)`, the latter being this same derivation for a master that is itself `controlled_by_parent`, so the chain composes recursively, one nested subquery per hop, inside one statement (ADR-0139 D6 as amended). The equality holds for the same reason, one level up: the scope the engine composes IS the scope a direct read of the master runs under.
- **Write.** `packages/plugins/plugin-security/src/security-plugin.ts#assertControlledByParentWrite` walks the chain hop by hop, running the same three master-edit legs — extracted verbatim as `packages/plugins/plugin-security/src/security-plugin.ts#assertMasterRowEditable` — on every hop until it reaches a master that governs its own rows. Each added refusal keeps the `403 PERMISSION_DENIED` envelope named for the **caller's own** object and operation, never for an ancestor the caller never asked about.
  ⚠️ **Amended 2026-11-14 (#33250 / PR #33369).** "On every hop" no longer holds for a hop whose detail declares `writeRequiresMasterRead`: there the walk (`packages/plugins/plugin-security/src/security-plugin-cbp-write-gate.ts#assertControlledByParentChainEditable`) asks whether the principal can **read** the master row in place of the three edit legs, and ends at that hop; the read door answers for the chain above it. A hop that does not declare the key runs the edit legs as before. See the 2026-11-14 amendment at the end.

**Cost.** The per-request resolution cost booked under Consequences is now paid **per hop** — one extra master-id query per `controlled_by_parent` object on the chain, bounded as below.
⚠️ **Amended 2026-10-22 (#24932).** No extra query per hop: each hop is one nested subquery inside the detail's one statement, and the depth bound caps the statement's nesting, not a count of queries. The write gate's per-hop master-row probe is unchanged.

### The two guards, and what the depth bound is NOT

Both fail **closed**, and that is the load-bearing property: what they replace was a fall-open to "no restriction".

- **Cycle guard.** Each walk carries the objects already being resolved on that branch and refuses to re-enter one (`A` mastered by `B`, `B` by `A`, or an object mastered by itself). Read side: the **empty master set**. Write side: **deny**.
- **Depth bound.** `packages/plugins/plugin-security/src/security-plugin.ts#CBP_MAX_CHAIN_DEPTH`, currently `8`. At the bound the read derivation returns the **empty master set** and the write gate **denies**, each logging the chain it refused.

⚠️ **The bound is not a supported chain length, and this record does not claim it is one.** The constant's own header is the authority on that framing and states it in as many words:

> This is a COST ceiling, not a semantic rule, and it is deliberately not a "supported chain length".

An ADR sentence reading the bound as "chains up to 8 levels are supported" would record something the code does not claim. Two consequences, both checkable:

- **Termination does not depend on the bound.** The visited set grows strictly over a finite schema registry, so the cycle guard already guarantees termination. What the bound caps is **work**.
- ⛔ **Overflow never widens.** A bound that fell open past its limit would reintroduce at depth 9 exactly the defect that was fixed at depth 2. That is why both arms of it deny.

The value is not derivable from this tree; the constant's header records how it was chosen and is where a change to it is argued.

### What is unchanged

- The **mechanism** (§2's pre-resolved accessible-master-id set, zero RLS-compiler changes) and the **rule** (§3: editing a detail requires *edit* access to its master; reading requires *read* access) are unchanged. The walk runs §3's existing rule once per hop.
- The **single-level case is byte-for-byte unchanged**, and this is ⛔ **not** a blanket refusal for chained declarations: a detail whose whole chain is reachable stays readable and writable.
- The **set-size ceiling** limit and the **large-scale share-table/join** non-goal both stand. This amendment moves one bullet in each list, not both.
- §1's spec contract is untouched: exactly one required `master_detail` field, no author-written RLS policy, fail closed.

### Why this was worth amending rather than left to the code

An ADR recording a **narrower** enforcement than the runtime performs errs in the safe direction for users and the **unsafe direction for reviewers**. Someone reviewing a later change to this surface derives the invariant from this record, and would have read the chain walk as a deviation from a documented single-level boundary — the concrete hazard being that they "restore" single-level behaviour believing they are fixing a drift, re-opening the org-wide read and write above. That is why the two statements are marked **in place** rather than left to be rediscovered — and why the read derivation's own header points back at this record, naming the scope line it closes and noting that the ADR is amended separately. This is that amendment.

---

## Amendment (2026-10-26, #25760): the owner of a detail row may update it with read on the master, by opt-in

**Ruling.** objectstack-ai/objectstack#25760, maintainer ruling of record `6398566164` (batch #14 item 2, letter 1, 「同意」 2026-10-25): option 1 — a per-object opt-in on a `controlled_by_parent` detail, `sharing.controlledByParent.ownerMayEdit: true`. With it, the detail row's own owner passes the write gate with **read** on the master; everyone else still needs master **edit**. The default is unchanged. Option 2 (`writeRequires: 'read'`, the detail's own object permission and RLS deciding the write for everyone) was **not** chosen: it opens the write to everyone the detail's own grants admit, a wider door than the need.

⚠️ **Amended 2026-11-14 (#33250, ruling A+ `6880588685`) — lifted for opted-in objects only.** The maintainer ruled that wider door open for an object that declares `sharing.controlledByParent.writeRequiresMasterRead: true` (the shipped spelling of option 2, a boolean rather than `writeRequires: 'read'`): there, whoever can read the master writes the detail as the detail's own grants admit. The paragraph above stays the record of the 2026-10-25 ruling, and it still describes every detail that does not declare the key. See the 2026-11-14 amendment at the end.

### The gap this closes

§3 asks **edit** on the master for every write of a detail, and a detail's own row-level policies compose with that answer as an **AND** (§2: "composes with the detail's own tenant/owner RLS (all AND-ed)"). So an `update` policy written on a detail to let the row's owner write it — `owner_id == current_user.id` — could only ever **narrow** the master's editors to the owner; it never admitted an owner who merely reads the master. That is the common shape, not an app quirk: the person a task, an activity or an obligation is assigned to reads the account or the contract and does not edit it (the originating measurement: a `controlled_by_parent` obligation under a signed contract, whose owner's PATCH answered `403 … requires edit access to its master record (… row-level security)` while `security/explain` answered `allowed: true`). Salesforce, the model this record closes gaps against, keeps **"the owner of an activity always has full access to it"** under Activities OWD = Controlled by Parent; this platform had no equivalent.

### What the opt-in does, exactly

- **Spec.** `ObjectSchema` gains a strict `sharing` block with one nested block, `controlledByParent`, with one key, `ownerMayEdit: boolean` (`packages/spec/src/data/object.zod.ts`). The one reader is `controlledByParentOwnerMayEdit`, exported beside the declaration, so the gate, the parse and the lint ask one question one way. The parse **refuses** `ownerMayEdit: true` on an object whose `sharingModel` is not `controlled_by_parent`: nothing reads it there, and a declared capability the runtime never delivers is the ADR-0049 shape §1 already refuses for the master relation.
- **Gate.** `packages/plugins/plugin-security/src/security-plugin-cbp-write-gate.ts#assertControlledByParentWrite` gains one leg, before the §3 chain walk, for a **by-id `update`** only. It admits the write when **all** hold: the detail's resolved relation carries the opt-in **and** the registered schema carries the `owner_id` column (`CbpRelation.ownerMayEdit`, resolved beside the relation in `security-plugin-cbp-relation.ts`); the write is **not** on behalf of another user; the stored row's `owner_id` is the caller's own `userId`; and the caller can **read** the master row, asked of the read door itself under the caller's context — the master's object grant, its row-level and sharing scope and, for a master that is itself `controlled_by_parent`, the chain the engine composes (ADR-0139 D6). A hidden row and a refused read are one answer, "not readable" (#7505). When any condition fails, the write takes the §3 walk and carries the walk's own refusal; the leg adds no envelope of its own.
- **What the leg does not change.** Gate ① (the detail's own object-level `update` grant) and step 2.7 (the detail's own row-level policies, where `owner_id == current_user.id` now decides as authored) run before it, unchanged. A body that re-points the master reference still asks **edit** on the master it names: the owner may change their row, not move it under a master they cannot edit. The on-behalf-of path keeps both floors, as ADR-0090 D10 keeps them for every other relief.
- **Lint.** `@objectstack/lint` gains `security-controlled-by-parent-owner-policy-without-opt-in` (`warning`): an `update` / `all` policy that keys a field on `current_user.id`, on a `controlled_by_parent` detail of the stack that has **not** opted in, is flagged with the opt-in as the fix. Advisory, because a narrowing can be meant and no runtime door refuses the shape.
  ⚠️ **Amended 2026-10-27 (#26591 / PR #26658) — the opt-in is prescribed only where the gate honours it.** The leg above admits one caller, the user in the stored row's `owner_id`, and only on a detail whose registered schema carries that column (`CbpRelation.ownerMayEdit` resolves `false` otherwise), so the arm no longer prescribes the opt-in for every caller-keyed policy. Under the same rule id and the same `warning` tier, `packages/lint/src/validate-security-posture.ts#pushCbpOwnerPolicyWithoutOptIn` prescribes the opt-in only for an `update` / `all` policy that keys the caller on `owner_id`, on a `controlled_by_parent` detail that carries `owner_id` and has **not** opted in — the one shape the opt-in turns into an admission. Every other caller-keyed update policy — one keyed only on another user field (`owner == current_user.id`), or on `owner_id` where the detail carries no such column (`ownership: 'business_unit' | 'org' | 'none'`, or a platform-managed object) — goes to `packages/lint/src/validate-security-posture.ts#pushCbpCallerPolicyOffOwnerColumn` and is flagged in **both** states, opted in or not: the verdict says the opt-in admits only the stored `owner_id`, the remedy is to key the accountable person on `owner_id` (or to give the detail that column), and the opt-in is never named as the fix. The rule's `os explain` entry (`packages/lint/src/rule-explanations.ts#SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN_EXPLANATION`) says the same. The sentence above is kept as the arm as first landed; ⛔ it is no longer a statement of what the lint prescribes. Whether the runtime leg should widen to a named owner field is the maintainer's open question on #26591; this note records it and decides nothing.

### What is out of scope, and why

The ruling names **update**. So the leg does not reach: an **insert** (no row to own; the master named in the body is asked for edit as before), a **delete** (deleting a child is still answered by the master, as §3 and `masterGateCoversOperation` have it), a **predicate** (`multi: true`) update (it judges every master of the rows it selects and has no single row whose owner could be asked), and a **delegated** write. Each is a widening of its own, to be ruled on its own evidence; none is implied by this one. Option 2's door — the detail's own grants deciding the write for everyone — stays closed.

⚠️ **Amended 2026-11-14 (#33250) — open on a detail that declares `writeRequiresMasterRead`, and only there.** On such a detail the insert, the delete, the predicate update and delete and the delegated write each ask **read** on the master, by the 2026-11-14 ruling, not by this one. The owner leg above is unchanged on a detail that does not declare the new key, and the parse refuses the two keys together. See the 2026-11-14 amendment at the end.

### Fail-closed boundaries

- An opt-in on an object whose schema carries no `owner_id` column (`ownership: 'business_unit' | 'org' | 'none'`, or a platform-managed object) names nobody: the relation resolver resolves `ownerMayEdit: false`, reports it once per object (`reportOwnerMayEditWithoutOwnerColumn`), and every write keeps the §3 rule. The parse cannot refuse this half (the injected-column plan imports `object.zod.ts`; the same cycle its attached-block refusal stops at), so it is said at resolution.
- A row with no owner, or another's, admits nobody; a master the caller cannot read admits nobody; a store fault during the master read propagates as raised, never as a verdict.
- The opt-in is a **declaration on the detail**, read through one spec reader: the gate never pattern-matches a policy's text, and no consumer tolerates an alias.

### What is unchanged

§1 (one required `master_detail`, no author-written derivation), §2 (read derived from the master), the chain walk, the cycle guard and the depth bound all stand. Every detail that does not declare the opt-in behaves byte-for-byte as before this amendment.

---

## Amendment (2026-11-06, #30905): an optional master, and the null-master row its owner reads

**Ruling.** objectstack-ai/objectstack#30905, maintainer ruling 「A」 (2026-11-06): `controlled_by_parent` admits an optional master, and a detail row with no master is visible only to its owner — the Salesforce reading of a contact with no account, a private contact. Rejected with it: a membership key collecting its object's own id, one-hop RLS traversal, and no platform change. The ruling lands in three serial changes; this amendment records the first (spec, lint, the read). The write gate (§3) and the docs follow in their own changes, and this record is amended again for §3 then. ⚠️ **Amended 2026-11-07:** it was — see the 2026-11-07 amendment (#30906 / PR #31082).

### The gap this closes

"A rep sees the contacts of the accounts they own; a contact need not have an account" had no declarative form. §1 required the master reference on every row, the parse and `ObjectSchema.create()` refused a `master_detail` declared `required: false`, a `lookup` derives no access, and RLS cannot read the master's owner. The one working route was a copied owner field kept in step by hooks.

### What changes, exactly

- **Spec (§1).** The object's **only** `master_detail`, declared `required: false`, is its master when it declares no required one — an **optional** master. The parse's one-master rule (`packages/spec/src/data/controlled-by-parent-master.ts#controlledByParentMasterRefusal`) judges the master through `controlledByParentMasterOf`, exported beside it, which answers the field and whether it is optional; `isControlledByParentMasterField` keeps meaning the REQUIRED master. `ObjectSchema.create()` keeps an explicit `required: false` on the only `master_detail` as written; beside another `master_detail` it still refuses it, since that field is a second parent, not the master. Every other refusal stands: two masters, a required `lookup` only, and a `readonly` / `system` master (required or optional).
- **An omitted `required` keeps meaning required where the omission is visible.** The builder forces it to `true` and the stored-row conversion `cbp-master-detail-required-defaulted` converts it to `true`, both unchanged. The **parse** cannot see it: `required` defaults to `false` on the parsed field map, so a raw parse (and `defineStack` over a plain object literal) admits an omitted `required` on the only `master_detail` as the optional master. `os lint`'s `relationship/master-detail-required` reports the omission at `error`, naming both spellings. Whether the parse should tell the two spellings apart was ruled by the maintainer on #30905 (record `6687830530`, 2026-11-06): option A, the parse does not tell them apart, and this bullet implements that ruling; option B (refusing the omitted spelling at every door through a new raw-input check) and option C (a separate explicit key) were not chosen.
- **Compatibility.** No accepted stored object changes meaning. A stored row the v18 upgrade listed under `cbp-master-relation-tiers-retired` as `master-not-required` because it declared `required: false` is a valid optional-master detail now and is no longer listed; the semantic migration entry `cbp-optional-master-admitted` records it.
- **Read (§2).** `packages/plugins/plugin-security/src/security-plugin-cbp-read-filter.ts#computeControlledByParentFilter` answers an optional master with `{ $or: [ { fk: { $in: ReadableIds.of(master) } }, nullMasterArm ] }`. The null-master arm is `{ fk: null }` for a holder of View All on the detail (`viewAllRecords` or `modifyAllRecords`, the super-user read bypass on the detail), else `{ $and: [ { fk: null }, { owner_id: <caller> } ] }` when the detail carries the `owner_id` column, else nothing. The function is the one chokepoint: the data middleware, `getReadFilter` (analytics, and the engine's `ReadableIds` composer behind the parent gates of attachments, comments, activity and approvals, and behind a chain's next level) and the delegated read compose it, each with the permission sets of the context it is asked for, so every read door follows. A required master's leaf is byte-identical to before.
- **Explain.** `security/explain` narrates the null-master arm on a record read: which arm returned the row, or, for a row the read door withholds, that it names no master and who reads it instead (`packages/plugins/plugin-security/src/explain-engine.ts`).

### The rules the read keeps

- A row that names a master is never read through the null-master arm, and a row that names none never through the master arm (`$in` never matches an empty reference).
- View All on the detail admits the null-master rows and nothing more: it does not open the master arm, which stays the master's own read answer.
- A null-master row with no owner (an ADR-0142 queue row), or on an object with no `owner_id` column (`ownership` other than `'user'`), is read by View All alone until it is claimed.
- In a chain, an intermediate row whose own master is empty is read by its owner, and the next level's master arm sees exactly that: its leaf is composed with the intermediate level's own read scope, the `$or` included.
- A caller who reads another master does not read the null-master rows they do not own.

⚠️ **Amended 2026-11-15 (#33696, ruling `6893666857`) — on a required master, the rows with no master gain one reader class.** The rules above are an **optional** master's, and they stand. A **required** master has no null-master arm: a detail row under it whose master reference is empty, or names a master that does not exist, matches no reader's master arm. By the ruling one class reads those rows, inside its own tenant wall: a reader who holds View All on the detail AND whose every master hop answers unrestricted (the engine's per-hop scope, not `hasSuperuserReadBypass`; a master scope that is the tenant wall is not unrestricted), for whom the parent chain is dropped. That is consistent with ruling 「A」, whose reader of a row with no master, beside its owner, is View All on the detail; on a required master the owner has no arm, and View All on the detail alone still "does not open the master arm". Every other reader, members included, keeps the chain unchanged. Where the 2026-11-06 amendment calls a required master unchanged ("byte-identical" under Read above, "byte for byte" under "What is unchanged" below), that reads as of its date for this one class. [ADR-0139](./0139-engine-internal-semi-join-leaf-readable-parent-ids.md) D6 as amended 2026-11-15 carries the ruling's binding bullets verbatim; the change is #33696's and lands only after this note.

### Fail-closed boundaries

- An omitted `required` on an object that reached the registry without the parse resolves no master (the runtime reads `required === false`, not its absence), so every read is denied, as before.
- A cycle or a depth refusal of the chain still denies the whole object, the null-master rows included: the declared chain is the defect.
- The write gate is unchanged: an insert or update that leaves the master reference empty is refused (`MasterReferenceMissingError`, 422), so no null-master row can be written through the platform until §3 is amended. ⚠️ **Amended 2026-11-07 (#30906 / PR #31082) — no longer:** for an optional master §3 now judges such a write by the owner rule; a required master's empty reference is still refused. See the 2026-11-07 amendment.

### What is unchanged

§3, the chain walk, the cycle guard and the depth bound; every `controlled_by_parent` object with a required master, byte for byte; the owner opt-in of the 2026-10-26 amendment. ⚠️ **Amended 2026-11-07 (#30906 / PR #31082):** §3 and the chain walk changed for the null-master row; see the 2026-11-07 amendment.

## Amendment (2026-11-07, #30906): the null-master row its owner writes

**Ruling.** The same maintainer ruling 「A」 of #30905 (2026-11-06): a detail row with no master is its owner's. The 2026-11-06 amendment recorded the first of three changes (spec, lint, the read) and left §3 refusing every write that leaves an optional master empty. The second, #30906 (PR #31082, merged 2026-11-07), amends §3; this section records it. The third, #30907, teaches it in the docs and the authoring skill.

### What §3 does now, exactly

The gate (`packages/plugins/plugin-security/src/security-plugin-cbp-write-gate.ts#assertControlledByParentWrite`) judges a row of an **optional** master whose master reference is empty instead of refusing it `422`:

- **The owner rule** (`packages/plugins/plugin-security/src/security-plugin-cbp-write-gate.ts#nullMasterRowWritable`). Such a row is written by its owner (`owner_id`, non-null, equal to the principal) and by a holder of Modify All (`modifyAllRecords`) on the detail. Everyone else who reaches the gate, View All included, is refused `403 PERMISSION_DENIED`, leg `master_chain`, naming the row; a principal who cannot read the row meets the read door first (`404 RECORD_NOT_FOUND`, step 2.7), as for every hidden row. A row with no owner (an ADR-0142 queue row), and every row of an object with no `owner_id` column, is Modify All's alone. It is the write twin of §2's null-master arm: View All reads such a row, Modify All writes it.
- **Insert.** An insert, single or batch, that names no optional master is admitted, and its creator becomes its owner. Every master a batch's rows do name is still asked.
- **By-id update and delete** of a stored null-master row, and each null-master row a predicate write (`multi: true`) selects: the owner rule.
- **Setting a master** on such a row asks the row's owner rule, then edit on the new master. **Emptying one** asks edit on the stored master through the §3 walk; the 2026-10-26 opt-in (`ownerMayEdit`) does not cover a body that empties an optional master.
  ⚠️ **Amended 2026-11-14 (#33250 / PR #33369).** On a detail that declares `writeRequiresMasterRead`, the new master and the stored master are each asked **read**, not edit, through the same §3 walk; the stored null-master row's owner rule still runs first when a master is set on it. See the 2026-11-14 amendment.
- **Chains.** A hop whose master is itself `controlled_by_parent` with an optional master of its own, left empty, ends the chain there and asks that row's owner rule, on its own object.
- **On behalf of.** Each pass (agent, then delegator) asks the owner rule of its own principal. `ISecurityService.checkControlledByParentWrite` answers such a row `allow`, or `deny` with leg `master_chain`, never `unresolvable`.
- **Proof (§4, ADR-0054).** `packages/verify/src/parent-write-reach.ts` proves an optional-master detail both under a master and with none (`masters: 'none'`), with the owner rule as the expectation.

### What is unchanged

Every `controlled_by_parent` object with a required master, byte for byte: its empty reference is still refused (`422 MISSING_REQUIRED_FIELD`). Ownership transfer stays on `allowTransfer`. §1, §2, the cycle guard and the depth bound.

---

## Amendment (2026-11-14, #33250): read on the master is enough to write, by opt-in

**Ruling.** objectstack-ai/objectstack#33250, maintainer ruling A+ (Leehom, 2026-11-14T16:21:29Z; ruling record `6880588685`), verbatim: 「开关打开后,能读主记录的人按子对象自己的授权新增、修改、删除,默认不变。HotCRM 的设计授权全部兑现。」 (With the switch on, whoever can read the master record inserts, updates and deletes the detail under the detail's own grants; the default is unchanged. HotCRM's designed grants are all honoured.) PR #33369 implements it (merged 2026-11-14). For an object that declares the key it lifts the 2026-10-26 amendment's "Option 2 … was **not** chosen" line and its "Option 2's door … stays closed" line; for every other object both stand, and neither is rewritten. The ruling left the key's name, the paths the swap covers, its relation to `ownerMayEdit` and the lint arm to the seat. This section records what shipped; the two seat calls the contract review (`6881744779`, ① items 5 and 6) named for the maintainer's veto window are under **The two seat calls** below.

### What the opt-in does, exactly

- **Spec.** `ObjectSchema`'s strict `sharing.controlledByParent` block gains `writeRequiresMasterRead: boolean`, optional, beside `ownerMayEdit` (`packages/spec/src/data/object.zod.ts`). The one reader is `controlledByParentWriteRequiresMasterRead`, exported from `@objectstack/spec/data`; only the boolean `true` opts in, and an absent block or schema answers `false`. The gate (through `CbpRelation.writeRequiresMasterRead`, resolved in `packages/plugins/plugin-security/src/security-plugin-cbp-relation.ts`), explain and the lint ask that one reader.
- **Two parse refusals** (`packages/spec/src/data/object.zod.ts#refuseControlledByParentWriteRequiresMasterReadMisplaced`). `true` on an object whose `sharingModel` is not `controlled_by_parent` is refused at `sharing.controlledByParent.writeRequiresMasterRead`: nothing reads it there (ADR-0049). `true` beside `ownerMayEdit: true` is refused at `sharing.controlledByParent.ownerMayEdit`, with the fix "Delete ownerMayEdit; writeRequiresMasterRead already admits the owner.": with read as the master question for every principal, the owner leg admits no one more. `false` is accepted everywhere.
- **Gate.** The swap is made at one place, the hop of the §3 chain walk (`packages/plugins/plugin-security/src/security-plugin-cbp-write-gate.ts#assertControlledByParentChainEditable`). A hop whose detail declares the key asks whether the principal can **read** the master row (`assertMasterRowReadable`) in place of the three edit legs, and the walk ends there. The read is asked of the read door under the principal's own context, so it is the answer a direct by-id read of the master gives: the master's object-level read grant, its row-level security and record sharing, and, for a master that is itself `controlled_by_parent`, the chain the engine composes above it (ADR-0139 D6). A hop that does not declare the key runs the edit legs, as before.
- **What reaches the walk.** Every shape the gate judges: an insert (single and batch); a by-id update or delete; a predicate (`multi: true`) update or delete, for every master of the rows it selects; a body that re-points the reference (the master it names and the one it leaves); a body that empties an optional master (the stored master).
- **What decides after the master question.** Unchanged: the detail's own object-level grant for the verb, its own row-level policies (step 2.7 of `packages/plugins/plugin-security/src/security-plugin-authz-middleware.ts`), field-level security, and the platform ownership floors. In plain words, "admitted when the caller can read the master" is always subject to those floors:
  - A **by-id** update or delete hands the floor (`owner_only_writes` / `owner_only_deletes`, `created_by == current_user.id`, `packages/plugins/plugin-security/src/platform-ownership-policies.ts`) to the master gate, as it has for every `controlled_by_parent` detail through the coverage vouch (`masterGateCoversThisWrite`, step 2.7). So a master reader can update or delete a row they did not create.
  - A **predicate** update or delete keeps the floor, as before: among the rows it selects it touches only those the caller created.
    ⚠️ **Amended 2026-11-22 (#35802, ruling `7073030861`) — superseded.** A non-delegated addressed predicate update or delete now hands the floor to the master gate once the gate has passed every master the write reaches, on every `controlled_by_parent` detail, this opt-in included. See the 2026-11-22 amendment at the end.
  - A **delegated** (on-behalf-of) by-id update or delete keeps **both** principals' floors, the ADR-0090 D10 exclusion, unchanged.
- **On behalf of.** Step 2.8 runs the gate once per principal, the agent and then the delegator, each asked the read under its own context: either one unable to read the master refuses the write, and both able admit it, subject to the floors above.
- **What a refusal answers.** A by-id update or delete by a caller who cannot read the master answers `404 RECORD_NOT_FOUND`, not `403`: the detail row's own read derives from its master (§2), so the read door (`callerCannotReadAddressedRow`, step 2.7) hides the row before the gate runs. That is the hidden-row rule (#7505), the same answer a detail that does not opt in gives. An insert or a re-point answers `403 PERMISSION_DENIED`, named for the caller's object and verb, "requires read access to its master record". `ISecurityService.checkControlledByParentWrite` answers `deny` for all of them, on `object_permission` (the master read is refused) or `row_level_security` (the master row is not returned); the closed leg union is not widened. `os explain` (`packages/plugins/plugin-security/src/explain-engine.ts#chainAsksMasterRead`) chooses prose that names the read question; its verdict still comes from the served member. A predicate (`multi: true`) update or delete by a caller who cannot read the master selects none of that master's rows, so it judges no master for them, writes none of them and answers no refusal, as on a detail that does not opt in: its matched set is narrowed to the rows the caller can read (`packages/plugins/plugin-security/src/security-plugin-addressed-writes.ts#readableRowsScopeForPredicateWrite`), a detail row's own read deriving from its master (§2), and the gate judges the masters of those rows only (`packages/plugins/plugin-security/src/security-plugin-cbp-write-gate.ts#controlledByParentPredicateWriteMasters`).
- **The null-master row.** A row of an optional master whose reference is empty has no master to read: on an opted-in detail the 2026-11-07 owner rule (`nullMasterRowWritable`) still decides it, and setting a master on it asks that rule, then read on the new master.
- **Lint.** `security-controlled-by-parent-owner-policy-without-opt-in` stands down, both branches, on a detail that declares the key (`packages/lint/src/validate-security-posture.ts`): there a caller-keyed update policy decides among master readers as authored, whichever user field it keys. No rule is added.

### The two seat calls (veto window)

- **Chains: each hop asks what the object at that hop declares.** An opted-in detail under a master that is itself a non-opted `controlled_by_parent` detail asks read on that master and stops; the read door composes the chain above, so a hidden top master refuses the write. A detail that does **not** declare the key, under a `controlled_by_parent` master that **does**, asks the edit legs on its own master (that master's object-level update grant and authored update policies still run on the hop), and then that master's hop asks read on the master above it. So such a detail is written by someone who cannot edit the top master. It is the one case where an object that does not declare the key answers differently, which is why the invariant below names the chain.
- **Every verb.** The gate is verb-blind: step 2.8 runs it for `insert`, `update`, `delete`, `transfer`, `restore` and `purge`, so on an opted-in detail the lifecycle verbs ask read on the master too. The detail's own grants for those verbs still decide.

### The invariant

A write's answer moves only if its own object, or a `controlled_by_parent` master on its chain, declares `writeRequiresMasterRead`. In a stack where no object declares it, every hop runs the edit legs and every master-gate refusal still says "requires edit access". The "What is unchanged" lists of the earlier amendments read as of their dates: where one says a detail is answered as before, that holds for a detail whose chain declares no `writeRequiresMasterRead`.

### Fail-closed boundaries

- The reader answers `false` unless the key is the boolean `true`.
- A store fault during the master read propagates as raised, never as a verdict (`readUnlessRefused`).
- The edit hops below a read hop keep the cycle guard and the depth bound; the read hop ends the walk, and the read derivation it asks carries its own bound.

### Proof

The `[#33250]` describes in `packages/plugins/plugin-security/src/controlled-by-parent-owner-may-edit.test.ts` (admit for a master reader, refusal without the read, the detail's own grants, chains, on behalf of, the unchanged default, the served member); `packages/plugins/plugin-security/src/explain-controlled-by-parent-write.test.ts`; `packages/spec/src/data/controlled-by-parent-owner-may-edit.test.ts` (the key, the reader, both refusals); `packages/lint/src/validate-security-posture-owner-may-edit.test.ts`. Emptying an optional master and the lifecycle verbs reach the same walk and are covered by construction; neither is pinned under the opt-in yet (contract review `6881744779`, N4).

### What is unchanged

§1, §2, the cycle guard and the depth bound; the 2026-11-07 owner rule for a null-master row; the 2026-10-26 owner leg on a detail that does not declare the new key; and every detail whose chain declares no `writeRequiresMasterRead`.

## Amendment (2026-11-22, #35802): a predicate write hands the ownership floor to the master gate

**Ruling.** objectstack-ai/objectstack#35802, ruling record `7073030861` (maintainer Leehom, answered by tap at 2026-11-22T02:37Z). The option he chose, label and consequence as shown, verbatim: 「A 批量与逐条一致」 — 「有权编辑主记录的人批量改删明细时，改到逐条能改的全部行；其中一行被规则拦下就整次拒绝。升级后现有流程会多改到别人创建的行。一个PR。」 (A, predicate and by-id agree: someone who may edit the master record, changing or deleting details by predicate, reaches every row they could change one at a time; one row stopped by a rule refuses the whole write. After the upgrade existing flows change more rows that others created. One PR.) It supersedes one sentence of the 2026-11-14 amendment, "A **predicate** update or delete keeps the floor, as before: among the rows it selects it touches only those the caller created", and the bullet of the `RlsFilterOptions.masterGateCoversThisWrite` docblock that called dropping the floor on that path "a separate decision". Neither older amendment is rewritten; the superseded sentence carries a pointer here.

### The gap this closes

The ruling that made the master gate the sole row-write authority for a `controlled_by_parent` detail (commit `6feac910b6`) set one condition: "the floor comes off only where the master gate demonstrably covers the same operation; otherwise the change is a bare widening". When it was made, the gate returned early on a write that addressed no single row, so a predicate write kept the floor. The gate has judged a predicate write since #25012: every master of the rows the write selects, refusing the write whole on the first the caller may not write under. The condition therefore held on the predicate path, and the floor stayed there all the same. Measured on `origin/main` `a5a5312ff4` (real engine, SQL driver, sharing service): the owner of the master changed 2 of 4 detail rows by predicate, the two they had created, where their by-id writes changed all 4; a Modify All holder and a member holding an `edit` share on the master changed 0 of 4 against 4; on a detail declaring `writeRequiresMasterRead`, a master reader changed 2 against 4. Each write answered success.

### What changes, exactly

- **The floor.** On a `controlled_by_parent` detail, an addressed predicate update or delete (`multi: true`) by a caller who is not acting on another user's behalf composes its row scope with `masterGateCoversThisWrite`, once step 2.8's gate has judged the write for that caller and refused nothing (`packages/plugins/plugin-security/src/security-plugin-authz-middleware.ts`, steps 2.8 and 3). The platform ownership floor is then absent from that scope exactly as it is from a by-id write's (step 2.7); every app-authored policy, and the write-visibility derivation of a detail that authors none, stand as they do there. A predicate update's per-row stored-image check (step 3.6) is composed on the same decision.
- **The rows.** The write is scoped to the rows the gate judged: the gate records the ids of the rows whose master reference it read (`packages/plugins/plugin-security/src/security-plugin-cbp-write-gate.ts#predicateWriteRowIdsJudgedByMasterGate`), and that list replaces the second asking of the read question the predicate door otherwise makes. So a row that comes to match the predicate after the gate read it is not written: no row is written under the handed-over floor without its master having been judged, or, for a row naming no master, without the owner rule having been asked.
- **The vouch is a fact about the pass, not about the object.** The middleware takes the record straight after the caller's own pass of the gate returns. A write the gate did not judge has none and keeps the floor: a shape the engine does not route down its predicate path, a nested or referential write, a principal for whom step 2.8 does not run.
- **Equal to the by-id answer.** The rows such a write changes are the rows a by-id write of each selected row changes for the same caller, with two stated differences, both older than this amendment and both in the refusing direction: the predicate write is refused whole on the first master the caller may not write under, where the by-id writes of the rows under the other masters succeed; and `ownerMayEdit`'s owner leg is a by-id update only (ruling `6398566164`), so a predicate update still asks edit on the master.

### The declared narrowing

A predicate write applies to all of its matched rows or to none (the outcome rule PR #35914 declared for the sharing half of the same card). Rows this amendment adds to the match are subject to it: one that a row-level `check`, a validation rule, a hook or a `restrict` relation refuses now refuses the whole write, where before it was not matched and the write answered success on the rows the caller had created. The change is therefore shipped on the narrowing arm, with the upgrade note leading on the other visible effect: an existing flow now changes or deletes detail rows its caller did not create.

### What is unchanged

- A predicate write reaches only rows the caller can read, and above 10,000 readable rows it is refused.
- It is refused whole on the first master the caller may not edit, or may not read on a detail declaring `writeRequiresMasterRead`.
- A row naming no (optional) master is judged by the 2026-11-07 owner rule; one the caller may not write refuses the write.
- An app-authored row-level policy binds every row.
- A delegated (on-behalf-of) predicate write keeps both principals' floors, as its by-id write does (ADR-0090 D10).
- `ownerMayEdit` (2026-10-26): its owner leg is a by-id update only.
- No key, switch or response member is added; the spec does not move.

### Proof

`packages/plugins/plugin-security/src/predicate-write-floor-deferral.test.ts`, the describe "a predicate write of a controlled_by_parent detail writes the rows its by-id writes do": each caller's predicate update and delete compared row for row with by-id writes of the same rows on a second copy (the master's owner; a member with an `edit` share on the master who created no row; a Modify All holder; `writeRequiresMasterRead`; `ownerMayEdit`; null-master rows; a delegated write), the whole-write refusals, the all-or-none outcome, and a row inserted after the gate's read. `packages/plugins/plugin-security/src/controlled-by-parent-detail-write-authority.test.ts` §3 holds the composed predicate: no floor where the gate admitted the write, the floor where the gate judged nothing.
