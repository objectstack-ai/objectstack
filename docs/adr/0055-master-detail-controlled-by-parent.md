# ADR-0055: Master-detail "controlled by parent" permissions — derived access via pre-resolved master-id membership

**Status**: Accepted (2026-06-19) — implemented in this PR (P0–P2)
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

## Phasing

- **P0** — related-record topological synthesis in `@objectstack/verify` (prerequisite for the proof; independently valuable — widens auto-derive coverage).
- **P1** — spec contract (§1) + read derivation (§2) behind the `controlled_by_parent` sharingModel.
- **P2** — write pre-image extension (§3) + the dogfood RLS proof (§4); bind in the liveness ledger; flip the ledger entry to `live` with its `proof`.

## Non-goals

- **Large-scale share-table/join** for huge master sets (v1 uses the id-set; flagged as a future limit).
- **Transitive nested master-detail chains** (v1 is single-level).
- **A permission-model rewrite** — explicitly rejected; this closes one gap on the existing engine.
- **ServiceNow-style scripted/per-row ACL scripts** — over-engineering for an AI-authored platform; the four-form fail-closed compiler is the deliberate ceiling.
- **Client-side enforcement** — authorization is server-enforced; UI affordances are presentation (ADR-0054 §Non-goals).

## Alternatives considered

- **Rewrite the permission model against a mainstream blueprint.** Rejected: the model is already Salesforce-shaped; a rewrite re-opens hard-won invariants (the #1994 by-id-write fix, org-scoping stripping, the fail-closed compiler) for no foundational gain. Gaps are enumerable and closable individually.
- **(a) / (c) access-resolution mechanisms** — see §2 trade-off table.
