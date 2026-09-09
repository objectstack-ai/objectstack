# ADR-0055: Master-detail "controlled by parent" permissions — derived access via pre-resolved master-id membership

**Status**: Accepted (2026-06-19) — implemented in this PR (P0–P2) · **Amended** (2026-09-07, #11082 / PR #11183 — the "Single-level only in v1" limit under Consequences and the "Transitive nested master-detail chains" **Non-goal** are both **reversed**: since `@objectstack/plugin-security` 17.3.0 (merged 2026-08-23) the read derivation and the write gate compose `controlled_by_parent` across a chain, bounded by a cycle guard and a cost ceiling that both fail **closed**. Nothing else in this record changes — §1–§4, the mechanism choice, the set-size limit and the share-table non-goal all stand. See **"Amendment (2026-09-07, #11082): transitive chains compose — the single-level non-goal is reversed"** at the end.)
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

1. **Read-path RLS injection.** `packages/plugins/plugin-security/src/security-plugin.ts#rlsFilter` AND-s an RLS filter into the query AST (`opCtx.ast.where = { $and: [where, rlsFilter] }`) before the driver runs. The builder `computeRlsFilter` (`packages/plugins/plugin-security/src/security-plugin.ts#computeRlsFilter`) is **async** and shared by the engine find-path and the analytics raw-SQL path (`getReadFilter`).
2. **Pre-resolved membership (§7.3.1) already exists.** The RLS compiler recognizes `field IN (current_user.<key>)` and resolves `<key>` against `ExecutionContext.rlsMembership` — "the runtime resolves set-membership that would otherwise need a subquery … and stages each set here under a stable key" (`packages/spec/src/kernel/execution-context.zod.ts#rlsMembership`; merge at `packages/plugins/plugin-security/src/rls-compiler.ts`). **This is the seam controlled_by_parent plugs into — no new compiler form.**
3. **By-id write pre-image check (#1994).** `packages/plugins/plugin-security/src/security-plugin.ts#sharingModel` already re-reads the target row under the write-op RLS filter before an update/delete and denies if invisible. This is the exact hook to extend with a master-access check.
4. **`sharingModel` enforcement seam.** `packages/plugins/plugin-sharing/src/sharing-service.ts#buildReadFilter` reads `object.sharingModel`; `buildReadFilter` gates on it (`effectiveSharingModel(schema) !== 'private'`). A `controlled_by_parent` baseline plugs in here / in the security middleware.
5. **Master-detail storage.** A `master_detail` field's **key is the FK column**; its `reference` (`packages/spec/src/data/field.zod.ts#reference`) names the master object. Given a detail row, the master id is `row[masterFieldKey]`.
6. **Spec inconsistency (to fix either way).** `OWDModel` (`sharing.zod.ts`) includes `controlled_by_parent`; the object's authorable `sharingModel` (`object.zod.ts`) is a different enum `['private','read','read_write','full']` that omits it.

## Decision

### 1. Spec contract

- Add `controlled_by_parent` to the **authorable** `object.sharingModel` enum (converging it with `OWDModel`; resolves the inconsistency).
- An object with `sharingModel: 'controlled_by_parent'` **must declare exactly one required `master_detail` field**; its `reference` identifies the master object and its field key is the master FK. Validation error otherwise (fail closed — an unsatisfiable "controlled by parent" must not silently fall open).
- The author writes **no RLS policy** for this — "controlled by parent" is *derived automatically* from the relationship (Salesforce-like OWD), which is the whole point.

### 2. Read mechanism — pre-resolved accessible-master-id set (chosen)

For a `controlled_by_parent` object, the security layer, per request:
1. resolves the **master object's** read filter for this user (`computeRlsFilter` on the master — the same machinery, reused), runs it to get the accessible master ids, and
2. stages them in `ExecutionContext.rlsMembership` under a per-relationship key (e.g. `cbp_<object>_<field>`), then
3. the detail's derived policy `"<masterFieldKey> IN (current_user.cbp_<object>_<field>)"` compiles via the **existing IN-form** and AND-s onto the read (step 1 in Context). An **empty** set fails closed (the compiler already returns `null` → deny) — correct: no accessible master ⇒ no detail.

This composes with the detail's own tenant/owner RLS (all AND-ed) and flows to analytics via `getReadFilter` unchanged.

**Why this mechanism (trade-offs):**

| Option | Verdict | Why |
|---|---|---|
| (a) query-time subquery join (`masterFK IN (SELECT id FROM master WHERE …)`) | ✗ rejected | the RLS compiler **deliberately has no subquery support** (`packages/plugins/plugin-security/src/rls-compiler.ts`); the query AST has no EXISTS/sub-select form. Would require extending both. |
| **(b) pre-resolved accessible-master-id set** | ✓ **chosen** | reuses the `rlsMembership` + IN-form path with **zero compiler changes**; resolution is one async pre-query per request, composes with existing RLS, reaches analytics. |
| (c) materialized accessible-ids column | ✗ rejected | dual-write maintenance; goes stale the moment access rules/shares change mid-session — a correctness hazard for a security primitive. |

### 3. Write mechanism — extend the #1994 pre-image check

In the pre-image block (`packages/plugins/plugin-security/src/security-plugin.ts#controlled_by_parent`), for a `controlled_by_parent` detail `update`/`delete`/`create`:
- resolve the target's master id (`row[masterFieldKey]`; for `create`, the master id in the incoming body), and
- re-read the master under its **edit** write-filter (`findOne(master, { where: { $and: [{id: masterId}, masterWriteFilter] } })`); a `null` result ⇒ deny.
- **Rule:** editing/deleting/creating a detail requires **edit** access to its master (Salesforce master-detail semantics). Reading a detail requires **read** access to its master (§2).

This reuses the existing re-read-and-deny pattern; no new enforcement layer.

### 4. Proof (ADR-0054)

A `@objectstack/dogfood` RLS proof, bound in the liveness ledger on `object.sharingModel` (and/or the master-detail field): a member who **cannot read master M** can **neither read nor by-id-write a detail D under M**, and **can** once granted master access (red/green, revert-provable). This is the runtime guard that flips `controlled_by_parent` from declared to *live*.

**Prerequisite:** the proof must create a master + a detail under it. Today `@objectstack/verify`'s `deriveCrudCases` **skips objects with required relations**. So the **related-record topological synthesis** capability (build the object dependency graph, synthesize in topo order threading real ids) lands **first** — it is P0 here.

## Consequences

- **Positive.** Master-detail finally carries permission inheritance (not just cascade/expand); a declared-but-dead OWD value becomes enforced with a permanent runtime guard; zero RLS-compiler changes (lowest-risk path through a security-critical subsystem); composes with tenant/owner/role RLS and analytics; the `OWDModel`↔`sharingModel` inconsistency is resolved.
- **Negative / limits (honest).**
  - **Set-size ceiling.** A user with very many accessible masters produces a large `IN (...)`. Acceptable for typical cardinalities; **large-tenant scale (≫ thousands of masters) is a known limit** — a future share-table/join mechanism would replace the id list. v1 documents this, not solves it.
  - **Per-request resolution cost.** One extra master-id query per controlled_by_parent object per request (cached within the request).
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
- **Write.** `packages/plugins/plugin-security/src/security-plugin.ts#assertControlledByParentWrite` walks the chain hop by hop, running the same three master-edit legs — extracted verbatim as `packages/plugins/plugin-security/src/security-plugin.ts#assertMasterRowEditable` — on every hop until it reaches a master that governs its own rows. Each added refusal keeps the `403 PERMISSION_DENIED` envelope named for the **caller's own** object and operation, never for an ancestor the caller never asked about.

**Cost.** The per-request resolution cost booked under Consequences is now paid **per hop** — one extra master-id query per `controlled_by_parent` object on the chain, bounded as below.

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
