# ADR-0123: An authenticated session with no active organization is a legal state — reads resolve to nothing, tenant-scoped writes are refused loudly

**Status**: Accepted (2026-08-13)
**Deciders**: ObjectStack Protocol Architects (maintainer ruling on [#8247](https://github.com/objectstack-ai/objectstack/issues/8247), 2026-08-13)
**Builds on**: [ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) (D1 — Layer 0 is an independent, always-first, AND-composed tenant filter; W1/W2), [ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) (D1/D2 — the posture spectrum and the `group` union wall; "empty/absent scope → deny"), [ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) (D1/D2 — the membership reconciler as the single owner of the "every user gets a membership" invariant, and the `session.create.before` hook that resolves `activeOrganizationId` from `sys_member`), [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (D3 — the closed error-code vocabulary this refusal draws from rather than extending), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove — a declared wall the write path does not meet is the defect this record closes)
**Consumers**: `@objectstack/plugin-security` (`security-plugin.ts` step 3.7, `tenant-layer.ts`), `@objectstack/plugin-auth` (`auth-manager.ts` `composeDatabaseHooks`, `reconcile-membership.ts`), `@objectstack/plugin-sharing` (`sharing-rule.ts` — already conforming), `@objectstack/plugin-audit` (`auth-session-audit.ts` login/logout rows)
**Surfaced by**: [#8247](https://github.com/objectstack-ai/objectstack/issues/8247), from three independently measured cards — [#8158](https://github.com/objectstack-ai/objectstack/issues/8158) (fell open), [#8208](https://github.com/objectstack-ai/objectstack/issues/8208) (fell closed, silently), [#8245](https://github.com/objectstack-ai/objectstack/issues/8245) (wrote rows no reader can see)

---

## TL;DR

One state — **an authenticated session whose `activeOrganizationId` is null** — produced three different, mutually contradictory behaviours in three subsystems, all measured on the same working day. None of the three implementations was individually wrong: the platform had never declared what the state *means*, so each layer improvised.

This ADR declares it. The state is **legal**, and it has **fail-closed semantics**:

- **Tenant-scoped reads resolve to nothing.** Already true, and it stays true — Layer 0's deny sentinel, not an error.
- **Tenant-scoped writes are refused loudly** — a 4xx whose message **names the missing active organization**. A write that cannot say which tenant its row belongs to does not land.
- ⛔ **No silent NULL stamping, anywhere.** A row whose tenant column is NULL because nobody could supply one is a row its own author cannot read back; that outcome is now unreachable through an authenticated write path.
- **The audit ledger is the one carve-out, and it is paid for by ordering, not by an exemption** (D3): membership settles before the first session mints, so the account-creation rows a bare refusal would permanently lose are written *with* a tenant instead of being refused or NULL-stamped.

## Context

### The state is structurally guaranteed, and cannot be defined away

`session.create.before` derives a session's `activeOrganizationId` from the caller's `sys_member` row (ADR-0093; `AuthManager.composeDatabaseHooks` → `defaultActiveOrg`). The membership itself is written by the ADR-0093 reconciler composed into `user.create.after`, and better-auth **defers that past the signup transaction**. So every new user's first session predates their membership and legitimately carries no active organization.

Signup is not the only producer. A member removed from their organization, an `invite-only` deployment before the invite lands, an SSO JIT user pending placement, and a multi-organization deployment whose reconciler binds nobody (ADR-0093 D1 `no-target-org`) all reach the same state. **Eliminating it at the mint point (option A of #8247) cannot close the class** — which is why this record declares the state rather than outlawing it.

### The three improvisations

| Card | Subsystem | Behaviour under the state | Consequence |
|:--|:--|:--|:--|
| #8158 | `plugin-sharing` `adminOrgScope` | fell **open** | an org-scoped `manage_sharing` holder read and wrote every tenant's sharing rules |
| #8208 | Layer 0 wall + the write path | fell **closed, silently** | an HTTP-created record was stamped `organization_id: NULL` and was immediately invisible to its own creator |
| #8245 | audit ledger | wrote rows **no reader can ever see** | every audit row from a user's first session carried a NULL tenant, permanently invisible to RLS readers |

#8158's fix (PR #8237) already chose *refuse, naming the missing organization*, over *answer empty*, and gave its reason: `manage_sharing` is declared `scope: 'org'`, so with no organization there is no scope in which it grants anything. **That reasoning generalizes, and this ADR is the generalization.** #8158's landed fix conforms and stands unchanged.

### The asymmetry that produced #8208

The read path and the write path met the same missing value and drew opposite conclusions.

`computeTenantLayer0Filter` (`tenant-layer.ts`) already fails closed on the read side: a walled posture on a tenant object with no organization scope yields `RLS_DENY_FILTER` — zero rows, no error. That is correct and is not changed here.

The write path never met the wall at all. The Layer 0 write-side twin (`security-plugin.ts` step 3.7) validated **supplied** `organization_id` values only — its own comment says so: *"This validates SUPPLIED values only; it never fills an absent one."* That gate exists to catch a **forged** tenant (ADR-0095 / ADR-0105 D5), and a payload that supplies nothing has nothing to forge, so an ordinary insert walked straight past it. Auto-stamping lives in the enterprise `@objectstack/organizations` runtime, and it too has nothing to stamp when the caller has no active organization.

So both halves were individually defensible and jointly produced a write that succeeds and a record nobody — including its author — can read. **If a write is allowed to proceed without an organization, something has to be able to read the result back.** Nothing can. Therefore the write must not proceed.

## Decision

**D1 — The state is legal and named.** "Authenticated, with no active organization" is a declared session state, not an illegal intermediate to be eliminated at the mint point. Every subsystem that meets it inherits the semantics below instead of inventing a fourth.

**D2 — Tenant-scoped reads resolve to nothing; tenant-scoped writes are refused loudly.**

- *Reads* keep Layer 0's deny sentinel: zero rows, HTTP 200, no error. Unchanged from ADR-0095 D1 / ADR-0105 D1. An empty result set is the honest answer to "show me my organization's rows" when the caller has no organization.
- *Writes that place or move a row* — `insert` and `update` — are **refused**, with `PERMISSION_DENIED` / HTTP 403 and a message that **names the missing active organization**. The code comes from ADR-0112's standard catalog rather than a new registration: the condition is a permission-class refusal, and ADR-0112 D3 directs a generic condition to the catalog instead of a synonym. This is the same code and status PR #8237 put on the wire for the same state, which is what makes "#8158 conforms" a measured statement rather than an assertion.
- *`delete`* places nothing and decides no tenant. Its target is selected through the Layer 0 row wall, which already resolves to nothing — so a delete under this state matches no row and is governed by the read rule, deliberately. This boundary is stated so the next author does not read its absence as an oversight.

**The scope of the refusal is exactly the state, and no wider.** It fires only for an authenticated, non-system caller, on an object the posture actually walls (a tenant object under `isolated`/`group`; never a `tenancy.enabled:false` platform-global object, never an object with no `organization_id` column, never a federated phantom anchor), who is not a platform operator crossing the wall by ADR-0095 D3. System contexts — boot seeding, reconcile hooks, backfills, imports — short-circuit the security middleware entirely and are untouched. Under `group`, "no organization scope" means an **empty membership set**, matching ADR-0105 D2's own fail-closed rule.

**D3 — ⛔ No silent NULL stamping, and the ledger carve-out is paid for by ordering.** No path may write a tenant-scoped row with a NULL tenant on behalf of an authenticated caller and report success. For the audit ledger the naive application of D2 would be *worse* than the defect: refusing to write an account-creation row loses history permanently, and nothing back-fills a ledger row that was never written. So the ledger is not exempted — the **ordering** is fixed instead:

> The ADR-0093 membership reconciler settles **synchronously, before the first session's active organization is resolved**, rather than only in the deferred `user.create.after` hook. The first session therefore mints *with* its organization, and the login row it produces carries a tenant.

The reconciler is idempotent, yields to any pre-existing membership, and never throws (ADR-0093 D2), so hoisting it to the session seam adds a settle point, not a second owner. Where the reconciler legitimately binds nobody — `invite-only`, or a multi-organization deployment with no unambiguous target org — the session still mints with no active organization, and that is D1's legal state working as declared. **The ordering fix must not manufacture a membership that policy says must not exist**; it removes a race, not a policy.

**D4 — The refusal names what is missing.** A 403 whose message says only "access denied" is indistinguishable from every other 403 and sends the reader to look at permissions, which are fine. The refusal states that the caller has **no active organization** and that a tenant-scoped write requires one. This is the ADR-0049 half of the record: a declared wall whose refusal cannot be told apart from an unrelated denial is a wall nobody can act on.

## Consequences

**What changes.** An authenticated caller with no active organization, writing to a walled tenant object, now gets `403 PERMISSION_DENIED` naming the missing organization where they previously got `2xx` and an unreadable row. This is a **wire-visible behaviour change** on a security boundary; it is breaking in the direction of refusing something that used to silently corrupt.

**What does not change.** Reads. System contexts. Platform operators. Single-posture deployments (no wall, Layer 0 inert). Objects that opted out of tenancy. The supplied-`organization_id` forge guard, which keeps its own semantics and its own message. #8158's landed fix.

**Dispositions this record carries.** #8208 becomes the D2 refusal — the silent NULL stamp is unreachable. #8245 becomes the D3 ordering fix — the first session mints with its organization, so its ledger rows carry a tenant.

**What was rejected.**

- *Option A — outlaw the state at the mint point.* Cannot close the class: the non-signup producers (member removed, invite-only, JIT pending, multi-org with no target) still reach it, and it puts a synchronous dependency on the signup hot path for a state that would still need semantics afterwards.
- *Answer the write with an empty success, or a 404.* Both are the #7676 shape one layer over: a truthful-looking answer to a question that was never really answered. A write is not a query; there is no honest empty result for it.
- *Let the read path admit org-less rows to their owner.* It would make "no active organization" mean "a private tenant of one", inventing a fourth tenancy posture nobody declared, and it would hand the same rows to any future reader whose own organization is null.
- *Register a new error code for the condition.* ADR-0112 D3 sends generic (permission-class) conditions to the standard catalog; a synonym would put two spellings of one refusal on the wire, and would make #8158's landed fix retroactively non-conforming.
