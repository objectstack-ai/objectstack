# ADR-0057: ERP-Grade Authorization Core — Business-Unit Partitioning, Scope-Depth Grants, and Hierarchy Rollup

**Status**: Proposed (2026-06-21)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0010](./0010-metadata-protection.md) (metadata protection / object ownership),
[ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove),
[ADR-0054](./0054-runtime-proof-for-authorable-surface.md) (runtime proof),
[ADR-0055](./0055-master-detail-controlled-by-parent.md) (RLS reuses pre-resolved membership IN-form; **no compiler subquery**),
[ADR-0056](./0056-permission-model-landing-verification.md) (permission-model landing verification)
**Consumers**: `@objectstack/plugin-security`, `@objectstack/plugin-sharing`, `@objectstack/plugin-org-scoping`, `@objectstack/plugin-auth`, `@objectstack/runtime`, `@objectstack/spec`, `@objectstack/rest`, `@objectstack/verify`
**Supersedes / subsumes**: issue #2077 (seed declarative roles + sharing rules), ADR-0056 **D5** (sharing-rule spec<->runtime reconcile) and **D6** (role-hierarchy widening); references #1887 (SharingRuleSchema disconnected from the live engine).

---

## TL;DR

ADR-0056 verified that ObjectStack's **Salesforce-shaped widening layer** is mostly landed: OWD
(`object.sharingModel`), sharing rules, manual shares, FLS, and RLS predicates all enforce. What that
audit did **not** question is the *shape of the model itself*. Measured against real ERP authorization
needs (multi-entity partitioning, "see my unit / my unit and below / the whole org", manager rollup),
ObjectStack is **"Salesforce-lite"**: it has no first-class data-partition tree, its permission grants
are flat (own<->all, via `viewAllRecords`), and its three candidate visibility hierarchies
(`sys_user.manager_id`, the `sys_department` tree, `sys_role.parent`) are unused, duplicated, or
**broken** (the role hierarchy queries a `parent` column `sys_role` does not have).

This ADR adopts a **Dataverse-core / Salesforce-discipline hybrid** and makes the role system
**self-owned** (no longer borrowing better-auth's membership role). Three load-bearing additions, plus
assignment decoupling and a naming/honesty pass:

1. **Scope-depth on permission grants** — each object grant gains a `scope`
   (`own` / `unit` / `unit_and_below` / `org`), the single highest-leverage ERP feature. Resolves at
   request time into an `owner` `IN`-filter; **no RLS-compiler change**.
2. **`sys_business_unit`** — promote `sys_department` to the canonical owning-unit tree (it was always
   the BU; "department" is one `kind`). Powers the `unit`/`unit_and_below` scopes.
3. **Hierarchy rollup as pre-resolved `IN` membership sets** — `current_user.unit_user_ids` /
   `unit_subtree_user_ids` / `subordinate_user_ids`, computed by BFS over the BU tree and the manager
   chain, merged into `ctx.rlsMembership`. Reuses the existing IN-form (ADR-0055); no subquery.
4. **Decouple RBAC assignment from better-auth** — a platform-owned `sys_user_role` becomes the source
   of truth; `sys_member.role` shrinks to org-administration (owner/admin/member) and is relabelled.
5. **Honesty/naming pass** — renames with one-release aliases; per ADR-0049, any unenforceable grant
   scope is a **compile error**, never a silent fail-open.

This is explicitly **not** a rewrite of the widening layer (OWD/FLS/RLS/sharing stay) and **not** full
Dataverse (position hierarchy, record-owning teams, and matrix cross-BU sharing are deferred,
evidence-gated). It is the *minimum Dataverse subset that unlocks ERP*, framed for AI-safety.

---

## Context

### The orthogonal axes every mature platform converges on

| Axis | Salesforce | Dataverse | ServiceNow / SAP / NetSuite | ObjectStack today |
| :-- | :-- | :-- | :-- | :-- |
| **Capability** (ops x object) | Profile + Permission Set | **Security Role w/ depth** | Role(nest) / Auth Object / Role(own.sub.none) | `sys_permission_set` — **flat CRUD + viewAll/modifyAll only** |
| **Data partition tree** | — (Role/Territory approximation) | **Business Unit tree** | Domain / Company Code.Plant / Subsidiary | flat `sys_organization` tenant only; **`sys_department` tree unused as a partition** |
| **Visibility rollup** | Role hierarchy (1 role/user) | **Hierarchy Security (manager + position)** | Group `parent` / supervisor chain | `sys_user.manager_id` ok, `sys_department` tree ok, **`sys_role.parent` BROKEN** |
| **Assignment** | UserRole | role->user/team | sys_user_has_role / derived role | **`sys_member.role`** (better-auth string) |
| **Grouping + sharing** | Public Group/Queue + Sharing Rule + manual | Team(owner/access/group) + share | Group + ACL | `sys_team` + `sys_sharing_rule`/`sys_record_share` (#1887 divergence) |
| **OWD / FLS / RLS** | OWD + FLS + (Apex) | default access level + column profiles | ACL / ir.rule | `sharingModel` + FLS + `RowLevelSecurityPolicy` ok |

Three rules every serious system obeys: **(a)** capability and visibility are decoupled; **(b)** the
data-partition tree and the rollup tree are distinct (BU is coarse/static; manager/position is
fine/additive); **(c)** the highest-value ERP feature is *scope-depth baked into the grant*
(own/unit/unit+below/org) — without it, "see my unit's data" collapses onto hand-written RLS, one per
object, which an AI author cannot reliably produce and ADR-0049 forbids shipping inert.

### Two facts that make the core cheap and safe

- **`sys_role` is ObjectStack-native**, not better-auth. better-auth's 18 managed tables do not include
  it; better-auth only owns the `role` *string* on `sys_member`
  (`packages/platform-objects/src/identity/sys-member.object.ts:152`, `managedBy:'better-auth'`, enum
  owner/admin/member) and `sys_user`. The word "role" collides; the *table* does not. The platform may
  own the concept outright.
- **Scope-depth and rollup need no RLS-compiler change.** The compiler already compiles
  `field IN (current_user.<key>)` against arbitrary pre-resolved sets supplied through
  `ExecutionContext.rlsMembership` (`packages/plugins/plugin-security/src/rls-compiler.ts:126`, `:225`);
  `org_user_ids` is the existing precedent
  (`packages/runtime/src/security/resolve-execution-context.ts:260`). New scopes resolve into new keys;
  the engine's existing AND-injection (`packages/plugins/plugin-security/src/security-plugin.ts ~504`)
  applies them.

### Salesforce vs Dataverse — why hybrid, not either pure

Dataverse is **strictly more expressive**: it can model SF's role hierarchy (~ manager/position
rollup) and sharing rules (~ access teams) **plus** a first-class BU partition, scope-depth grants, and
dual hierarchies. But its combinatorial config space (BU x depth x hierarchy x team types x matrix
sharing) is where misconfiguration and silent fail-open hide — hostile to an AI-authored, "prove every
primitive" platform. Salesforce is the inverse: a clean *private-baseline + additive-widening* mental
model that is easy to reason about, audit, and prove, but with a hard ERP ceiling (no BU, no
scope-depth). **The right design for ObjectStack takes Dataverse's core and Salesforce's discipline.**

---

## Decision

Governing rules (ADR-0049): every authorization property is **enforced / `experimental` / removed**.
(ADR-0054): every enforced high-risk primitive carries a runtime proof. (ADR-0055): rollup is realized
as pre-resolved `IN` sets, never compiler subqueries. One decision per gap.

### D1 — Scope-depth on object grants (the ERP core)

Extend `ObjectPermissionSchema` (`packages/spec/src/security/permission.zod.ts:17`) so each per-object
grant carries a **read scope** and a **write scope** drawn from a canonical enum:

```
own            -> records the principal owns (owner_id == me)
unit           -> records owned within the principal's business unit
unit_and_below -> the principal's BU plus all descendant BUs
org            -> the whole tenant (today's default-allow)
```

- The scope resolves at request time into an `owner_id IN (current_user.<set>)` filter
  (`own`->`[me]`, `unit`->`unit_user_ids`, `unit_and_below`->`unit_subtree_user_ids`, `org`->no filter)
  and is **AND-injected by `plugin-security`** alongside existing RLS — no new enforcement site, no
  compiler change.
- **Back-compat:** existing boolean grants map to today's behaviour — the new `scope` is optional and
  defaults to preserve current semantics; `viewAllRecords` / `modifyAllRecords` remain the "bypass
  sharing entirely" god-flags (= Dataverse Org / SF "View All Data").
- **Authoring gate (ADR-0049 / ADR-0056 D4):** a `scope` value the runtime cannot resolve is a
  **compile error**; a `unit*` scope while the stack declares no BU tree is a compile error. No
  silently-inert grant ships.

### D2 — `sys_business_unit` as the canonical data-partition tree

Promote `sys_department` to the owning-unit tree and **rename it `sys_business_unit`** (it was always
the BU — its own description reads "department / division / **business unit** / office", and `kind`
already subtypes company/division/department/team/office;
`packages/platform-objects/src/identity/sys-department.object.ts`). The deliberate avoidance of
"organization" (better-auth's tenant) argues **for** `business_unit` and **against** `org_unit` (which
re-introduces the "org" collision).

- Records gain an **owning unit**: derive from the owner's primary unit, or an explicit
  `owning_unit_id` system field where authored. This is the coordinate the D1 `unit`/`unit_and_below`
  scopes filter on.
- Keep the `kind` enum for company/division/region/legal-entity/department subtyping. Reuse
  `DepartmentGraphService` (-> `BusinessUnitGraphService`) and `sys_department_member`
  (-> `sys_business_unit_member`) — these already BFS the tree
  (`packages/plugins/plugin-sharing/src/department-graph.ts`).
- **One-release deprecated aliases** for the object name, member table, the
  `recipient_type:'department'` sharing value, and the `dept:` approver prefix.

### D3 — Hierarchy rollup as pre-resolved membership sets (no compiler change)

`resolve-execution-context` pre-resolves and merges into `ctx.rlsMembership`:

```
unit_user_ids          -> users in my business unit
unit_subtree_user_ids  -> users in my BU + all descendant BUs (BFS, cycle-safe, depth-bounded)
subordinate_user_ids   -> users below me on the sys_user.manager_id chain (manager hierarchy)
```

- Sourced by `BusinessUnitGraphService` (D2) and the existing `managerOf` chain
  (`packages/plugins/plugin-sharing/src/team-graph.ts:94`). Bounded (hard cap + cache, mirroring the
  `org_user_ids` cap) and **org-scoped**.
- Rollup is **additive only** (widens, never restricts) and respects tenant isolation. It powers both
  D1's `unit*` scopes and sharing-rule recipients (D6). Because it is pure pre-resolution, the choice
  of *which* tree drives visibility is an authoring/modelling decision, not a runtime-mechanism one.

### D4 — Decouple RBAC assignment from better-auth (`sys_user_role`)

Introduce a platform-owned **`sys_user_role`** (`user_id`, `role`, `organization_id`,
`business_unit_id?`, `granted_by`, timestamps) as the **source of truth** for "who holds which RBAC
role".

- `resolve-execution-context` resolves `ctx.roles` from `sys_user_role` (union `sys_member.role` during
  a transition window), replacing the current sole dependence on the better-auth membership string
  (`packages/runtime/src/security/resolve-execution-context.ts:226`).
- `sys_member.role` is **reframed to org-administration only** (owner/admin/member) and **relabelled**
  in ObjectStack's projection to `org_membership_level` (the underlying better-auth column/API param
  stays `role`; we relabel the platform schema projection in
  `packages/plugins/plugin-auth/src/auth-schema-config.ts`).
- Continue feeding declared role names to better-auth `additionalOrgRoles`
  (`packages/plugins/plugin-auth/src/auth-manager.ts:657`) **only** so invitations to those role names
  are accepted — never as the authority for RBAC.

### D5 — `sys_role` is a *job role* (capability bundle), not a second hierarchy

Keep `sys_role` (platform-owned, correctly named). Its job is a **named, assignable bundle of
permission sets** (via the existing `sys_role_permission_set`) plus an optional default unit placement
— the NetSuite/Workday "job role / job profile" shape. **Visibility hierarchy does NOT live on
`sys_role`.** Therefore:

- **Retire the broken `sys_role.parent` path.** `role-graph.ts`'s `childRoles` query targets a `parent`
  column `sys_role` does not have (`packages/plugins/plugin-sharing/src/role-graph.ts:52`; the ADR-0056
  D6 "landed" claim was proven only against a mock engine). Rather than add the missing column, the
  `role_and_subordinates` sharing recipient is **re-homed onto the BU subtree** (D2/D3) and renamed
  `unit_and_subordinates`, with `role_and_subordinates` kept as a deprecated alias that resolves
  through the unit tree. This reconciles ADR-0056 D6 honestly (implement via the working tree, not the
  broken one).
- (Alternative retained in the record: a customer who genuinely needs a *Salesforce-style role tree*
  distinct from the BU tree can opt into adding `sys_role.parent` later; it is not on the v1 path.)

### D6 — Reconcile and seed roles, units, and sharing rules at boot (subsumes #2077, ADR-0056 D5)

Stack-declared `roles`, business units, role assignments, and `sharingRules` are seeded
**idempotently** into their system tables at boot (verify harness + CLI), so the existing evaluators
activate — closing the #2077 "decorative metadata" gap.

- **Roles -> `sys_role`** and **assignments -> `sys_user_role`**: read `metadataService.list('role')`,
  upsert by name, mark provenance so re-seed reconciles updates/removals without clobbering
  UI-created rows. Home: `plugin-security` (sibling to `bootstrapPlatformAdmin`,
  `packages/plugins/plugin-security/src/bootstrap-platform-admin.ts`).
- **Sharing rules -> `sys_sharing_rule`**: seed inside `SharingServicePlugin.start()`'s `kernel:ready`
  **before** `listRules()`/`bindRuleHooks` (`packages/plugins/plugin-sharing/src/sharing-plugin.ts:168`)
  so hooks bind to a populated table.
- **#1887 / ADR-0056 D5 — pick the canonical sharing-rule shape.** The spec `SharingRuleSchema` (CEL
  `condition`, `ownedBy`, `sharedWith` enum incl. `group`/`guest`) diverges from the runtime
  `sys_sharing_rule` (`criteria_json` JSON filter, `recipient_type`/`recipient_id`) and is flagged
  `EXPERIMENTAL — NOT ENFORCED` (`packages/spec/src/security/sharing.zod.ts:97`). Decision: the
  **runtime shape is canonical**. The seeder translates the directly-mappable authoring fields
  (`object`->`object_name`, `accessLevel`->`access_level`,
  `sharedWith{type,value}`->`recipient_type`/`recipient_id` for user/role/unit-and-subordinates), and
  the unmappable parts (CEL `condition`, `owner`-type `ownedBy`, `group`/`guest`) stay
  **`[EXPERIMENTAL — not enforced]`** until a minimal CEL->FilterCondition compiler lands (tracked under
  #1887). This keeps #2077 deliverable without blocking on the full CEL reconciliation.

### D7 — Honesty / naming pass (ADR-0049 no silent fail-open)

One coordinated rename + alias wave: `sys_department`->`sys_business_unit`,
`sys_member.role`->`org_membership_level` (projection label), recipient enum
`role_and_subordinates`->`unit_and_subordinates`, with one-release deprecated aliases throughout. No
behaviour change in this pass. Any grant scope, recipient, or `using`/`check` the runtime cannot
resolve is a **compile error**, never silently inert.

### D8 — Bind the new primitives into the conformance matrix + liveness ledger

Extend the ADR-0056 **D10 Authorization Conformance Matrix** and the ADR-0054 proof registry with one
row + dogfood proof per new primitive: **scope `own`/`unit`/`unit_and_below`/`org`**, **BU rollup**,
**manager rollup**, **`sys_user_role` assignment resolution**, and the **`unit_and_subordinates`
sharing recipient e2e** (a manager + their unit subordinates gain access via the widening — the
#2077 / ADR-0056 D6 demo). Ratchet, not retrofit: each proof lands with its phase's PR.

---

## Consequences

**Positive.**
- ObjectStack moves from Salesforce-lite to **ERP-grade**: "regional manager edits their unit and
  below" becomes a one-line declarative grant (`Account.edit = unit_and_below`), enforceable and
  provable, instead of N hand-written RLS policies.
- The model becomes **self-owned**: RBAC no longer borrows better-auth's membership role; better-auth
  is cleanly confined to identity + org-administration.
- **AI-safe**: scope-depth is trivially authorable and gated (unknown/unenforceable scope = compile
  error); the three-half-trees ambiguity collapses to one BU tree + the manager chain.
- Closes #2077 honestly and reconciles ADR-0056 D5/D6 via the *working* hierarchy.

**Negative / costs.**
- Renames (D2/D7) touch many registration points (graph services, member table, recipient enums,
  translations, nav contributions, approver prefixes) — mitigated by one-release aliases.
- Owning-unit derivation (D2) introduces a record-level coordinate that existing example apps must
  adopt to benefit from `unit*` scopes; the default (`org`) preserves current behaviour, so adoption
  is opt-in.
- Activating previously-inert roles/rules (D6) changes who-can-see-what for apps that declared them
  (`app-showcase`, `app-crm`) — requires a full dogfood-suite run; any change must be intentional and
  documented (mirrors ADR-0056's behaviour-change discipline).

**Neutral / open.**
- Whether owning-unit is always derived from the owner's primary unit, or sometimes explicitly stamped
  per object — settled per-object in the D2 PR.
- Whether a customer ever needs a Salesforce-style role tree distinct from the BU tree (D5 alternative)
  — evidence-gated.

## Non-goals

- **Not** a rewrite of the widening layer — OWD (`sharingModel`), FLS, RLS predicates, sharing rules,
  manual shares all stay.
- **Not** full Dataverse: **position hierarchy**, **record-owning teams**, and **matrix cross-BU
  sharing** are deferred (P4, evidence-gated).
- **Not** adding RLS-compiler subquery support (ADR-0055 stands; rollup uses pre-resolved IN sets).
- **Not** a full CEL->FilterCondition compiler for sharing rules — only the minimal mappable subset is
  seeded now; the rest stays `experimental` under #1887.

## Alternatives considered

- **(a) Pure Salesforce** (role hierarchy + sharing only). Rejected for an ERP-aspiring platform: no BU
  partition, no scope-depth -> every "see my unit" need collapses onto hand-written RLS; SF's
  materialised-share runtime also scales worse than ObjectStack's RLS-IN injection.
- **(b) Pure Dataverse** (BU-per-user, depth baked into a heavy role, dual hierarchy, three team types,
  matrix sharing). Rejected as too large a config surface to AI-author safely and prove per ADR-0049.
- **(c) Add `sys_role.parent` (Salesforce role tree).** Rejected as the default: it builds a third
  hierarchy duplicating the working BU/manager trees; re-homing `role_and_subordinates` onto the BU
  subtree (D5) is honest and reuses a tree that already enforces. Retained as an opt-in.
- **(d, chosen) Dataverse-core / Salesforce-discipline hybrid** — minimum Dataverse subset (BU +
  scope-depth + rollup) with SF's additive-widening framing and capability/visibility decoupling.

## Phasing (each phase independently shippable, each with proofs)

- **P1 — Naming + honesty (no behaviour change).** D7 renames + aliases; `sys_user_role` schema +
  `BusinessUnitGraphService` scaffolding; D8 conformance-matrix skeleton. Compile-error gates for
  unresolvable scopes/recipients.
- **P2 — ERP core.** D1 scope-depth grants + D2 owning-unit partition + D3 rollup IN-sets. Each with a
  dogfood proof (own / unit / unit_and_below / org).
- **P3 — Assignment + activation (subsumes #2077, ADR-0056 D6 e2e).** D4 `sys_user_role` decoupling +
  D6 seeding (roles, assignments, units, sharing rules) + the `unit_and_subordinates` showcase demo
  proof.
- **P4 — Evidence-gated.** Position hierarchy, record-owning teams, matrix cross-BU sharing, minimal
  CEL->filter compiler (#1887 full close).

## References

- ADRs: 0010, 0049, 0054, 0055, 0056. Issues: #2077 (seed roles/rules), #1887 (SharingRuleSchema
  disconnected).
- Capability shape: `packages/spec/src/security/permission.zod.ts:17` (`allow*` +
  `viewAllRecords`/`modifyAllRecords`).
- RLS IN-form + membership injection: `packages/plugins/plugin-security/src/rls-compiler.ts:126`,
  `packages/runtime/src/security/resolve-execution-context.ts:226`.
- BU tree: `packages/platform-objects/src/identity/sys-department.object.ts`,
  `packages/plugins/plugin-sharing/src/department-graph.ts`.
- Role concept: `packages/plugins/plugin-security/src/objects/sys-role.object.ts` (no `parent`),
  `packages/plugins/plugin-sharing/src/role-graph.ts:52` (broken walk).
- better-auth boundary: `packages/platform-objects/src/identity/sys-member.object.ts:152`,
  `packages/plugins/plugin-auth/src/auth-manager.ts:657`,
  `packages/plugins/plugin-auth/src/auth-schema-config.ts`.
- Seeding precedent: `packages/plugins/plugin-security/src/bootstrap-platform-admin.ts`; sharing boot:
  `packages/plugins/plugin-sharing/src/sharing-plugin.ts:168`.

---

## Implementation status (2026-06-21)

Landed incrementally on branch `adr/0057-erp-authz-core`, each with a runtime proof:

| Decision | Status | Proof / artifact |
| :-- | :-- | :-- |
| D1 — scope-depth grants (own/unit/unit_and_below/org) | ✅ landed | `showcase-scope-depth.dogfood` (4 cases) |
| D2 — `sys_business_unit` canonical partition tree | ✅ landed | repo-wide rename, all suites green |
| D3 — BU rollup via owner-set expansion (no compiler change) | ✅ landed | scope-depth + bu-hierarchy dogfoods |
| D4 — `sys_user_role` assignment, decoupled from better-auth | ✅ landed (read-merge) | `resolve-execution-context` reads `sys_user_role` ∪ `sys_member.role` |
| D5 — `role_and_subordinates` re-homed onto the BU subtree | ✅ landed | `showcase-bu-hierarchy-sharing.dogfood` |
| D6 — seed declared roles + sharingRules at boot (#2077) | ✅ landed | `showcase-declarative-rbac-seeding.dogfood` |
| D8 — conformance matrix rows for the new primitives | ✅ landed | `authz-conformance.matrix.ts` + `.test.ts` |
| (latent) `find({filter})` ignored by engine → over-grant | ✅ fixed | engine `filter`→`where` normalization; objectql 670 tests green |

**Deferred (evidence-gated, P4):** `sys_member.role`→`org_membership_level` relabel; manager-chain
rollup (`subordinate_user_ids`); position hierarchy; record-owning teams; matrix cross-BU sharing;
a full CEL→FilterCondition compiler (#1887) beyond the field-equality subset.

### Open/paid seam — hierarchy scopes are a pluggable enterprise capability (2026-06-21)

Hierarchy-relative visibility (scope `unit` / `unit_and_below` / `own_and_reports` —
"you see records by where you sit in the org") is the Salesforce/Dynamics commercial
hallmark and is **not** required to build a secure app (explicit RLS + sharing rules +
`own`/`org` scope suffice). It is therefore an **enterprise** capability, not open-core:

- **Open (framework):** the `IHierarchyScopeResolver` contract (`spec/contracts`),
  `own`/`org` scope, the BU data model + graph + `business_unit` *explicit* sharing
  recipient, roles, `#2077` seeding, the (future) predicate compiler. `SharingService`
  delegates hierarchy scopes to the resolver and **fails closed to owner-only** when none
  is registered — never fail-open. `defineStack` **errors** if a grant uses a hierarchy
  scope without `requires: ['hierarchy-security']` (no silent lie, ADR-0049).
- **Paid (`@objectstack/security-enterprise`, private cloud repo):** the
  `hierarchy-scope-resolver` implementation (BU subtree + manager-chain rollup), plus the
  P4 heavy org-modeling (position hierarchy, matrix cross-BU, owner-teams) and governance
  (SSO/SCIM, audit/access-review, SoD).

The commercial boundary ADR lives in `cloud/docs/adr/`; this note records only the
open-side technical seam. Proof: `showcase-scope-depth.dogfood` (reference resolver +
fail-closed case).

---

## Addendum — org-structure surfacing & edition tiering (2026-06-21)

ADR-0057 settled the authorization **model** (BU partition, scope-depth grants, rollup,
open/paid resolver seam). It did **not** settle how the three org-shaped objects are
**surfaced** in the Setup app, nor how they tier across editions:

- `sys_organization` (better-auth) — the **tenant container**;
- `sys_business_unit` (platform, D2) — the **hierarchical data-partition tree**;
- `sys_team` (better-auth) — the **flat collaboration grouping**.

Left unaddressed, all three land flat in the Setup `group_people_org` menu
(`packages/platform-objects/src/apps/setup-nav.contributions.ts:48-55`) and read as three
competing "organisation" concepts — the ambiguity is sharpest in a single-tenant install,
where `sys_organization` is a single, un-creatable row. This addendum closes that gap. One
decision per gap (ADR-0049 discipline); no model change, only surfacing + one denormalised
projection field.

### Context — three objects, three different questions, three editions

| Object | Question it answers | Hierarchy | `managedBy` | Distinguishing capability | Works in OSS? |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `sys_team` | "who collaborates / who is this shared with" | flat | better-auth | `TeamGraphService` flat expansion | **yes — now** |
| `sys_business_unit` | "where in the org tree does this record sit / who sees down the subtree" | tree | platform | scope-depth rollup (`unit*`) | model yes; **rollup = paid** |
| `sys_organization` | "which tenant" | none | better-auth | multi-tenant isolation | degenerate single-row unless multi-org |

Cross-platform consensus that grounds the tiering: **Salesforce** never surfaces the tenant
container ("Org") as a managed list, and keeps flat Public Groups *alongside* its role
hierarchy; **Dataverse** keeps Business Units **and** Teams as deliberately distinct axes
(Teams exist precisely to cross BU boundaries); **ServiceNow** keeps flat Groups even with a
Department/Cost-Center structure, and isolates tenancy on a *separate* axis (domain
separation), not on the org dimensions. The invariant: **the flat grouping is the floor; the
partition tree and the tenant container are conditional surfaces.**

This yields the **floor / ceiling / tenant** framing:

```
floor   (all editions)   Users + Teams + manager_id     <- baseline, auth-native, no resolver
ceiling (enterprise)     + Business Units                <- object open; nav + rollup gated
tenant  (multi-org)      + Organizations + Invitations   <- surfaced only when multi-org on
```

### D9 — Edition tiering of the org surface (floor / ceiling / tenant)

- **Teams = floor (all editions).** It is the better-auth-native flat primitive, its
  `TeamGraphService` expansion works open with no resolver, and a tree cannot express a
  flat cross-cutting / matrix set or a group-owned record — there is no structural
  substitute. It stays in the `group_people_org` baseline. (Teams is the *harder* of the
  two to remove, not the easier: removing it means fighting the auth layer for the one
  capability that is not paywalled.)
- **Business Units = ceiling.** Per the open/paid seam above, the BU **object + graph +
  explicit `business_unit` sharing recipient** are OPEN, but the **hierarchy rollup** is
  paid. Its Setup *surface* is therefore gated on the capability (D10) so a vanilla OSS
  deployment that does not use BU is not shown a tree whose distinguishing power (subtree
  rollup) is dormant.
- **Organizations = tenant-only surface.** Surfaced only when multi-org is enabled
  (`features.multiOrgEnabled != false` — the predicate already gating the
  `create_organization` action, `sys-organization.object.ts`). In single-tenant it is a
  degenerate single un-creatable row and is hidden (D10).

### D10 — Setup-nav surfacing follows the capability (ADR-0029 K2); the object stays open

The objects remain registered **open** in every edition (data continuity, no upgrade
migration; BU stays usable as owning-unit coordinate, explicit sharing recipient, and
people-picker filter even when its nav is hidden). Only the **nav entries** tier:

- **Business Units.** `nav_business_units` today carries `requiresObject: 'sys_business_unit'`
  (`setup-nav.contributions.ts:50`), but `platform-objects` registers that object
  unconditionally, so the gate is **inert (always true)**. Move the entry **out** of
  `SETUP_NAV_CONTRIBUTIONS` and contribute it from the capability that gives BU teeth —
  the hierarchy-security capability (`@objectstack/security-enterprise` when present), or an
  explicit app opt-in feature `business-units` — exactly the ADR-0029 K2 pattern already
  used for webhooks/approvals/sharing ("nav lives and dies with the capability").
- **Organizations / Invitations.** `nav_organizations` / `nav_invitations`
  (`setup-nav.contributions.ts:52-53`) carry no gate at all today. Add a
  `multiOrgEnabled != false` visibility gate (same predicate as the create action).
- **Mechanism gap to close first (ADR-0049 — gated, never silently inert).** The
  `create_organization` *action* gates via a `visible` CEL string, but a `NavigationItem`
  today exposes only `requiresObject` / `requiredPermissions`. Either extend the nav
  contribution schema with a `visible` predicate (or a `requiresFeature` key) — a small
  `spec` addition — or the gate is unimplementable and must not be claimed.

### D11 — Resolve the `team` naming collision: drop `team` from `sys_business_unit.kind`

`sys_business_unit.kind` includes `team` (`sys-business-unit.object.ts:96`,
`company | division | department | team | office | cost_center`), colliding head-on with the
first-class `sys_team`: a `kind='team'` BU walks `BusinessUnitGraphService` (hierarchical)
while `sys_team` walks `TeamGraphService` (flat) — two "teams", different semantics, no UI
distinction. This collision is the single largest source of the "teams vs BU feel
redundant" perception.

- **Decision:** remove `team` from the enum. `kind` is display-only by its own description
  ("Categorisation hint — does not change graph semantics"), so this is semantically free.
  Repo-wide usage of `kind: 'team'` is **0** (seeds included) → no data migration. New enum:
  `company | division | department | office | cost_center`. Per D7 alias discipline, a
  one-release read-tolerance mapping stray `team` -> `department` may be kept, though no rows
  exist to need it.

### D12 — `sys_user.primary_business_unit_id` — denormalised projection for "pick people by BU"

"Pick people by business unit" (Dataverse **filtered lookup**, ServiceNow **reference
qualifier**, Workday org-scoped picker) is a baseline ERP interaction and needs **no** rollup
engine — it is a plain equality filter, valid in OSS. But it is not configurable today:

- Lookup fields filter only on the **target object's own fields** (`lookupFilters`,
  `dependsOn`; `packages/spec/src/data/field.zod.ts`), and `sys_user` has **no** BU column —
  membership lives in the junction `sys_business_unit_member`.
- The query layer cannot traverse the junction in a single filter (no `$exists` / reverse
  relationship; `expand.where` is schema-accepted but **engine-ignored** — tracked
  separately as a latent ObjectQL gap).

**Decision:** add a denormalised `sys_user.primary_business_unit_id` (lookup to
`sys_business_unit`), maintained from `sys_business_unit_member.is_primary` via a sync hook
+ one-time backfill. This mirrors the `manager_id` precedent (commit `94fedcccc`, ADR-0057),
which likewise denormalised an org coordinate onto the better-auth-managed `sys_user`. Then
`lookupFilters: [{ field: 'primary_business_unit_id', operator: 'eq', value: X }]` and
`dependsOn: ['primary_business_unit_id']` work with **zero query-engine change**, OSS-safe.

- **Scope limit:** the projection captures the **primary** BU only; matrix / multi-BU
  pickers still use the two-step junction expansion (`BusinessUnitGraphService` pattern).
  `sys_business_unit_member` remains the effective-dated source of truth; the field is a
  maintained projection of `is_primary`, not a second source.

### Forward note — interaction with `feat/slim-remove-multitenant-runtime`

The in-flight breaking change `feat/slim-remove-multitenant-runtime` (`5d820cb5e`,
`feat(runtime)!: remove multi-tenant runtime; keep single-env + contracts`) moves multi-tenant
routing out of the OSS framework to the cloud distribution. If it lands, D9/D10's
`multiOrgEnabled` predicate simply resolves **false** in OSS (single-env), so Organizations /
Invitations never surface in the OSS Setup app and become a cloud-distribution concern that
re-contributes the org nav. The `multiOrgEnabled != false` framing is therefore
**forward-compatible with both worlds** and needs no rework when that branch lands — which is
why this addendum keeps the mode-gate rather than hard-coding single-tenant (per decision of
2026-06-21).

### Surfacing conformance (extends D8)

One proof per surfacing decision, ratcheted with its PR:

- single-tenant Setup nav **omits** Organizations / Invitations; multi-org on -> present;
- BU nav **absent** without the hierarchy-security capability, **present** with it (object
  registered in both);
- `sys_business_unit.kind` **rejects** `team`;
- a `sys_user` lookup with `lookupFilters` on `primary_business_unit_id` returns **only**
  members of that BU.

### Phasing

- **PS-1 (low risk, no engine change).** D11 (`kind` enum) + D10 Organizations/Invitations
  gate (after the nav `visible`/`requiresFeature` mechanism lands).
- **PS-2.** D10 — relocate `nav_business_units` to the hierarchy-security capability
  (ADR-0029 K2), retiring the inert `requiresObject` gate.
- **PS-3.** D12 — `primary_business_unit_id` field + sync hook + backfill + picker proof.

### PS-2 implementation note (2026-06-22) — D10 realized via server-enforced `requiresService`

Implementing D10 refined the mechanism (no cross-repo relocation needed):

- The Setup nav is filtered **server-side** (`rest-server` `filterAppForUser`), which
  previously honoured only `requiredPermissions`. `requiresObject` is a **client-side**
  (objectui) gate, not enforced in this repo.
- The spec already carries `NavigationItem.requiresService` (a kernel-service capability
  gate). PS-2 gives it **server-side teeth**: gated entries are dropped from the served
  payload (fail-open when the kernel can't be probed). Satisfies ADR-0049 (enforced, not
  merely declared-for-frontend), in-repo and testable.
- **Organizations / Invitations** → `requiresService: 'org-scoping'`. `org-scoping` is the
  canonical multi-org probe (SecurityPlugin already uses it), registered only in
  multi-tenant mode → single-tenant hides both entries.
- **Business Units is deliberately NOT gated.** The only available signal would be
  `hierarchy-security` (the **paid** rollup resolver), and gating on it would hide the
  management UI for functionality that is **open**: BU as owning-unit, the explicit
  `business_unit` sharing recipient, and the D12 "pick people by BU" projection. The
  "ceiling" in D9 refers to the **hierarchy rollup capability**, not BU's data/management
  surface. With Organizations hidden in single-tenant and the `kind='team'` collision
  removed (D11), the residual community menu is Users + Teams + Business Units — two
  distinct, legitimately co-present concepts, which was never the ambiguity this addendum
  set out to remove. If hiding BU in vanilla deployments later proves desirable, gate it on
  an explicit `business-units` opt-in, never on the paid resolver.

Proof: `filterAppForUser` unit tests (rest.test.ts) — requiresService entries drop when the
gate reports the service absent, persist when present, fail-open with no gate, and
requiresObject entries are untouched. An end-to-end Setup-nav test is not feasible in the
verify harness: the platform Setup app's navigation is not materialized there (`/meta/app`
lists only the business app; `/meta/app/setup` returns a protection stub).
