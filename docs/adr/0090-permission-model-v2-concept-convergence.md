# ADR-0090: Permission Model v2 — Concept Convergence, Final Naming, and AI-Authoring Safety

**Status**: Accepted (2026-07-09)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove),
[ADR-0056](./0056-permission-model-landing-verification.md) (permission-model landing verification),
[ADR-0057](./0057-erp-authorization-core-business-units-and-scope-depth.md) (ERP authorization core: BU tree, scope depth, `sys_user_role`),
[ADR-0066](./0066-unified-authorization-model.md) (secure-by-default `'*'` posture),
[ADR-0086](./0086-authz-metadata-config-boundary-and-cross-package-composition.md) (authz metadata↔config boundary)
**Amends / supersedes**: ADR-0056 **D7** (default-profile fallback — replaced by D5 here);
ADR-0057 **D5**'s `role_and_subordinates` deprecated-alias clause and **D7**'s "one-release aliases"
discipline (superseded by the pre-launch one-step renames in D3/D4 here).
**Consumers**: `@objectstack/spec`, `@objectstack/plugin-security`, `@objectstack/plugin-sharing`,
`@objectstack/plugin-auth`, `@objectstack/runtime`, ObjectUI (Studio Data + Access pillars, Setup).
**Companion document**: [docs/design/permission-model.md](../design/permission-model.md) — the complete,
maintained reference for the model this ADR decides. The ADR records *why*; the companion records *what/how*.

---

## TL;DR

ADR-0056/0057 landed the enforcement machinery (OWD, sharing, FLS, scope depth, BU tree). This ADR
fixes what the machinery is **wrapped in**: the concept count, the names, the defaults, and the
authoring-safety story. Three forcing facts:

1. **The platform has not launched.** This is the only zero-cost window for breaking renames and
   removals. Aliases and one-release deprecation ladders written now become permanent migration debt.
2. **The metadata is AI-authored.** The error space of AI-generated authorization metadata is
   proportional to the size and ambiguity of the authoring vocabulary. Every removed concept, alias,
   and synonym removes a class of plausible-but-wrong output that no reviewer reliably catches.
3. **A dogfood incident proved the default is wrong.** An object created without `sharingModel` +
   an ordinary C/R/U permission set silently produced **org-wide read AND write** of other users'
   records (surfaced via objectstack-ai/objectui#2348). The admin's mental model ("grant Read =
   read your own") and the runtime's actual default ("no OWD = fully public") disagree — the most
   dangerous kind of security bug, because nothing looks broken.

Twelve decisions:

- **D1** — Custom objects default to OWD `private`; an unset `sharingModel` no longer means "public".
- **D2** — The Profile concept is removed (`isProfile` deleted, not deprecated).
- **D3** — `sys_role` and friends are renamed to `position`; **"role" becomes a reserved-forbidden
  word** across identifiers, UI copy, and docs (lint-enforced), with the better-auth boundary as the
  single documented exception.
- **D4** — The OWD vocabulary shrinks to the four canonical values; legacy aliases are removed from
  the spec enum, not tolerated at parse time.
- **D5** — A built-in, undeletable **`everyone` position** carries default grants for authenticated
  users; packages *suggest*, admins *confirm*, resolution is per-request (no materialized copies, no
  fallback cliff).
- **D6** — An **explain engine** (`why can user X do OP on record Y`) is promoted to P0, and an
  **access-matrix snapshot** gates every publish of security-domain metadata.
- **D7** — Security-domain metadata gets a publish-time **linter** and a **tiered human gate**;
  non-security metadata may auto-publish.
- **D8** — **Teams receive sharing; they never carry capability.** No permission-set bindings, no
  record ownership on `sys_team`.
- **D9** — **Audience anchors**: the built-in `everyone` position (D5) is joined by a built-in
  **`guest`** position for anonymous access. Packages target audiences by *suggesting* bindings —
  never by shipping shared builtin sets. Platform admin needs no anchor (the ADR-0066 superuser
  wildcard already covers every new package's objects).
- **D10** — A **principal taxonomy** (`kind: human | agent | service | guest | system`,
  `audience: internal | external`, optional `onBehalfOf`) enters ExecutionContext. **AI agents run
  on the intersection** of their own grants and their delegator's, under a lint-enforced ceiling,
  with human co-sign required for destructive operations.
- **D11** — OWD gains an **external dimension**: optional `externalSharingModel`, default
  `private`, validated `external ≤ internal`. The spec shape lands in P1.
- **D12** — **Delegated administration**: admin capability itself becomes scoped (BU subtree +
  assignable-set allowlist + no self-escalation), so subsidiary admins run their own units without
  holding tenant-wide power.

The resulting admin-facing model is five words, each with exactly one industry-unambiguous reading:
**permission set** (capability), **position** (distribution), **business unit** (visibility geometry),
**sharing/OWD** (record baseline + widening), **team** (collaboration reception).

---

## Context

### The launch window

ADR-0057 D5/D7 prescribed deprecated aliases and one-release rename ladders — the correct discipline
for a live platform. The platform is not live. Compatibility layers authored before launch are pure
cost: they ship the old and the new vocabulary simultaneously into the first release, doubling the
surface AI and admins can pick wrongly from, and committing us to a deprecation cycle nobody is on
the other end of. This ADR explicitly supersedes those clauses: **renames and removals below are
one-step, with no aliases.**

### AI authors the metadata

Objects, permission sets, and sharing rules on this platform are drafted by AI (Studio copilot,
agents) at least as often as by humans. For authorization metadata specifically, an AI error is not a
bug but a silent security incident. Two consequences drive this ADR:

- **Vocabulary is attack surface.** A model with 9 overlapping layers, 3 things named "role", and a
  7-value OWD enum (3 of them aliases) offers countless "plausible" wrong combinations. A model with
  5 orthogonal concepts and 4 enum values is one an LLM can be *constrained* to author correctly.
- **Structure is the precondition for defense.** Linters (D7) and access-matrix snapshots (D6) can
  only exist because grants are structured data. Every escape into freeform predicates removes the
  metadata from the reach of every automated defense we have. This is also the standing answer to
  "why not raw RBAC + RLS" — see *Alternatives considered*.

### The `role` collision

"Role" is the single most overloaded word in access control — four incompatible industry readings,
each with a large constituency:

| Constituency | What "role" means there | Our equivalent |
|---|---|---|
| Kubernetes / ServiceNow / Dataverse | capability container | permission set |
| Salesforce | **visibility hierarchy** (no capability at all) | business unit |
| AWS IAM | assumable identity | (no equivalent) |
| better-auth / generic SaaS | org-administration tier (owner/admin/member) | `sys_member.role` |

Meanwhile the codebase itself has three: `sys_role` (job-role bundle per ADR-0057 D5),
`sys_member.role` (org administration), and `ctx.roles[]`. No spelling of "role" can be
chosen that does not mislead at least two constituencies. The resolution is not to pick a winner but
to **remove the word** (D3).

### What mature kernels converge on

Surveying Salesforce, Dataverse, ServiceNow, SAP, NetSuite, Odoo, Frappe, and modern IAM
(policy/ReBAC systems), three invariants hold everywhere the model aged well:

1. **Capability and visibility are separate axes** (what you can do vs whose records).
2. **Users never hold capability directly** — a flat grouping layer distributes it
   (SNOW groups, SAP composite roles, Salesforce PSGs). That layer is our *position*.
3. **Nobody keeps two hierarchies.** Systems with parallel org trees (early Salesforce role tree +
   territories) universally regret it. ADR-0057 already chose the BU tree; D3 finishes the job.

The negative example is Dataverse **owner teams** (may own records *and* carry security roles):
powerful, and the single most-complained-about auditability feature in that ecosystem. D8 codifies
the opposite stance while our teams are still flat.

---

## Decision

### D1 — Custom objects default to OWD `private`

`effectiveSharingModel()` (`packages/plugins/plugin-sharing/src/sharing-service.ts`) today collapses
"no `sharingModel` declared" to **public** — full-tenant read/write for anyone with an object-level
grant. That default inverts the admin's mental model and produced the objectui#2348 incident.

- A **custom object** (non-`sys_*`, not platform-managed) with no `sharingModel` now resolves to
  **`private`**.
- Authoring/publish of a *new* custom object **requires** an explicit `sharingModel` (the Studio UI
  already surfaces the control and an unset-warning as of objectui#2348; the spec gate makes it
  mandatory rather than advisory).
- **Existing metadata is grandfathered by stamping, not by behavior**: a migration pass stamps
  current OWD-less custom objects with an explicit `sharingModel: 'public_read_write'` + a publish
  warning, so nothing silently changes behavior on upgrade — the *unset* state simply ceases to exist
  going forward.
- `sys_*` / platform objects keep their ADR-0066 posture (explicitly declared, secure-by-default).

### D2 — The Profile concept is removed

`isProfile` is deleted from `PermissionSetSchema` (`packages/spec/src/security/permission.zod.ts`)
— removed, not deprecated (launch window). Rationale, in decreasing order of weight:

1. **Package/platform isolation.** A profile is "this user's identity baseline in this customer's
   environment" — inherently environment-owned. A package shipping profiles claims ownership of the
   customer's identity model, which is exactly the boundary ADR-0086 D3 made machine-checkable.
   Upgrade semantics ("does the package overwrite the customer's edited profile?") are unresolvable
   by construction.
2. **The runtime never consumed it.** `permission-evaluator.ts` merges all sets most-permissively
   regardless; `isProfile`'s only consumers are a fallback-selection helper and a UI badge.
3. **Learning cost.** The concept is free only for Salesforce-trained admins — and Salesforce itself
   is retiring profiles (permission-set-first). A pure-additive model teaches in one sentence.

`isDefault` **survives with narrowed semantics**: a package-authored *suggestion* consumed once at
install time (D5), never a runtime fallback. ADR-0056 D7's fallback mechanism
(`appDefaultProfileName`, `fallbackPermissionSet`) is superseded by D5.

UI consequence (ObjectUI): the profile badge/toggle in the permission matrix is removed; in its place
surface the two flags that actually matter — **provenance** (📦 package / ✏️ environment, from
ADR-0086 D3 `managedBy`/`packageId`) and **default** (bound to the `everyone` position).

### D3 — `role` → `position`; "role" becomes a reserved-forbidden word

One-step renames (no aliases — supersedes ADR-0057 D7's alias clause for these):

| Current | New |
|---|---|
| `sys_role` | `sys_position` |
| `sys_user_role` | `sys_user_position` |
| `sys_role_permission_set` | `sys_position_permission_set` |
| `ctx.roles[]` (ExecutionContext) | `ctx.positions[]` |
| `current_user.role` (RLS variable) | `current_user.position` |
| `RoleSchema` / `identity/role.zod.ts` | `PositionSchema` / `identity/position.zod.ts` |
| `role-graph.ts` (flat expansion only, per 0057 D5) | `position-graph.ts` |
| sharing recipient `'role'` | `'position'` |
| sharing recipient `'role_and_subordinates'` | **removed** — `unit_and_subordinates` is canonical (0057 D5); the deprecated alias is not shipped |

`PositionSchema` carries **no `parent`** field: ADR-0057 D5 already ruled the visibility hierarchy
does not live here (the old `parent` walk queried a column that never existed). Positions are flat.

Why `position` (and not `group`, `persona`, or keeping `role`): it is the exact translation of the
enterprise-HR term (岗位), matches SAP HCM structural authorizations and Dynamics hierarchy-security
vocabulary, collides with nothing in-system (`group` is a sharing recipient; teams exist), and leaves
the correct seam for a future HR module where the permission position and the HR position are the
same entity.

**Word ban.** "role" is a reserved-forbidden word in identifiers, UI copy, and documentation,
enforced by lint. Single documented exception: the better-auth boundary — `sys_member.role` is
third-party schema we do not own; it remains, already relabelled `org_membership_level` in the
platform projection (ADR-0057 D7), and its UI label is "organization membership", never "role".
The naming commandment, for humans and AI alike:
**capability = `permission_set` · distribution = `position` · hierarchy = `business_unit` ·
collaboration = `team`. The word "role" does not exist here.**

`permission_set` is deliberately **not** renamed — see *Alternatives considered*.

### D4 — OWD vocabulary: canonical four, aliases removed

The `sharingModel` enum shrinks to `private | public_read | public_read_write |
controlled_by_parent`. The legacy aliases `read`, `read_write`, `full` are **removed from the zod
enum** — authoring rejects them with a fix-it message; no lenient parse, no normalization layer.
(Contract-first: producers are fixed, renderers/evaluators never learn dialects. The alias
normalization ObjectUI shipped defensively in objectui#2348 becomes dead code and is removed there.)
The grandfathering pass in D1 rewrites any stored alias to its canonical value.

### D5 — The built-in `everyone` position carries default grants

Replaces both the `member_default` builtin-set fallback and ADR-0056 D7's default-profile flag as
*mechanisms* (the flag survives as a suggestion, below).

- A built-in, undeletable position **`everyone`**; every authenticated org member is implicitly a
  member. "What do new users get" ≡ "what is bound to `everyone`" — same tables
  (`sys_position_permission_set`), same UI, same audit path, same explain path as every other grant.
  **No second distribution channel** (an env-level `defaultPermissionSets` setting was considered
  and rejected — see Alternatives).
- **Resolved per-request, never materialized** per user: binding a newly installed package's
  self-service set applies to existing users on their next request; uninstalling the package
  (removing its sets by `packageId`, ADR-0086 D3) revokes it everywhere at once. No ghost grants.
- **The fallback cliff is abolished.** Today's semantics ("fallback applies only while the user has
  *zero* explicit grants") mean the first real grant silently *removes* the user's baseline.
  `everyone` is additive like any other position: baseline ∪ explicit, always.
- **Packages suggest, admins confirm.** `isDefault: true` on a package permission set produces an
  install-time prompt ("CRM suggests adding `crm_readonly` to Everyone — accept?"). It is **never**
  auto-bound: installing a package must not silently widen every tenant user's access.
- **Lint (D7) hard-blocks high-privilege bits on `everyone` bindings**: `viewAllRecords`,
  `modifyAllRecords`, `allowDelete`, `allowPurge`, `allowTransfer`, and `systemPermissions` are
  rejected (or force a break-glass confirmation) on any set bound to `everyone`.

### D6 — Explain engine is P0; access-matrix snapshots gate publishes

A contract `explain(principal, operation, object, record?) → decision + granting path` (which
set/position/OWD/share/rule produced the answer) is added to `@objectstack/spec/contracts` and
implemented across `plugin-security` + `plugin-sharing`. It is the shared engine for:

1. **The admin simulator** ("view as 张三") in Studio/Setup;
2. **The access-matrix snapshot gate**: the publish pipeline evaluates a matrix of representative
   positions × objects (operation × depth) and diffs it against the committed snapshot. Unchanged
   matrix → auto-pass. Changed matrix → the publish requires a human gate (D7) and the diff is
   presented **semantically** ("this change grants `sales_rep` (~1,200 users) org-wide read on
   `crm_opportunity`"), not as JSON.

This is the piece that turns the 9-layer evaluation pipeline from "auditable in principle" into
"explained by construction", and it is the load-bearing dependency of the AI-safety story — hence P0.

### D7 — Security-domain publish linter + tiered human gates

Metadata publishes are gated by domain:

- **Security domain** (permission sets, `sharingModel`, sharing rules, RLS policies, position
  bindings): publish requires the linter to pass **and** a human approval whose review artifact is
  the D6 semantic diff. AI may draft freely; it may not silently publish capability.
- **Non-security domain** (pages, views, layouts): may auto-publish per existing rules.

Initial linter rules (each traceable to an observed failure class; the taxonomy grows by incident):

| Rule | Origin |
|---|---|
| Custom object with unset OWD → error | objectui#2348 incident (pre-D1 metadata) |
| High-privilege bits on an `everyone`-bound set → block | D5 |
| `'*'` wildcard carrying `viewAll/modifyAll` outside a platform-admin set → error | ADR-0066 |
| OWD alias values → error with fix-it | D4 |
| The word `role` in identifiers/labels → error | D3 |
| `private` object granted `allowRead` with no `readScope` → info ("owner-only — intended?") | admin-intent mismatch class |

Per ADR-0049 discipline, a lint the runtime cannot enforce is not shipped as advisory security — it
either gates or it does not exist.

### D8 — Teams receive sharing; they never carry capability

`sys_team` (better-auth, flat — `team-graph.ts` explicitly walks no hierarchy) is confirmed as a
**sharing recipient and member-expansion group only**. Teams never own records and are never bindable
to permission sets. Positions distribute capability **vertically** (stable, org-shaped); teams
receive shared records **horizontally** (fluid, deal/project-shaped). This is a standing constraint,
lint-checked at the spec level (no `team_id` on `sys_position_permission_set`-like tables), so the
Dataverse owner-team auditability failure mode is unrepresentable rather than discouraged.

### D9 — Audience anchors: `everyone` + `guest` positions; packages suggest, never own

App developers legitimately need the universal audiences — admin, authenticated user, anonymous —
to be configurable in every app. The wrong realization is builtin *permission sets* that packages
write into: a shared set has no single `packageId`, so ADR-0086 provenance and uninstall semantics
collapse, and a union-merged communal set becomes an unauditable grant sink that only ever grows.
The correct realization keeps audiences as **positions** (distribution) and capability in
package-owned sets:

- **`everyone`** (D5) — authenticated members.
- **`guest`** — NEW builtin, undeletable; unauthenticated principals hold it implicitly and
  nothing else. Bindings face the strictest lint tier: explicit objects only (no `'*'`), read-only
  by default (create allowed case-by-case — e.g. public form intake), no VAMA, no system
  permissions. Division of labor with `publicSharing`: the guest position answers "which object
  classes are anonymously reachable at all"; share links answer "which individual records".
- **admin — deliberately NO anchor.** Platform admins already cover every new package's objects
  via the ADR-0066 superuser wildcard; app-level admin (`crm_admin`) is an ordinary package set the
  customer binds to a position of their own choosing. In a large organization "who runs CRM" and
  "who runs the platform" are almost never the same people — the platform must not conflate them.
- The D5 install-time suggestion generalizes: a package may suggest bindings to `everyone` **or**
  `guest`; the admin confirms each individually.

### D10 — Principal taxonomy; agents act on intersected authority

ExecutionContext principals gain an explicit taxonomy:

```
principal.kind:      human | agent | service | guest | system
principal.audience:  internal | external          (orthogonal, for human/agent/service)
principal.onBehalfOf?: <principal>                (delegation chain for agent/service)
```

This formalizes what already exists implicitly (`SYSTEM_CTX`, share-link principals) and adds the
two kinds the platform's own thesis ("business applications that AI agents can operate safely")
depends on:

- **`service`** — static machine identity for integrations: least-privilege sets via positions,
  no interactive login, no seat, its own audit trail. Lint: no VAMA, no destructive bits without
  explicit justification. Exists so customers stop wiring integrations through a human admin
  account — the classic audit finding.
- **`agent`** — an AI actor. Four defining rules:
  1. **Intersection, never union**: acting for a user, effective permission =
     *agent's own grants ∩ the delegator's grants* — the confused-deputy prevention that OAuth
     on-behalf-of and Kerberos S4U converged on. An over-privileged agent prompted by an
     under-privileged user must not leak what the user could never see.
  2. **Lint-enforced ceiling**: agent-held sets may not carry VAMA, purge/transfer, system
     permissions, or superuser wildcards; an agent principal never runs `isSystem`.
  3. **Human co-sign for `DESTRUCTIVE_OPERATIONS`** regardless of grants — grants decide what an
     agent may *initiate*, not what it may *complete alone*.
  4. **Dual attribution**: every write records `performed_by` (agent) + `on_behalf_of` (user) +
     run id; explain (D6) reports both sides of the intersection.
  Task-scoped, time-boxed agent grants build on the grant-lifecycle follow-up ADR (see
  *Named follow-ups*).
- **`guest`** — resolves to the `guest` position (D9) and nothing else.

The ctx **shape** (kind / audience / onBehalfOf) is a P1 deliverable: it must exist before launch
even where evaluation semantics phase in later — retrofitting a principal model post-launch is an
alias tax on every API.

### D11 — OWD gains an external dimension (`externalSharingModel`)

Portal and partner scenarios need the Salesforce insight: internal and external record baselines
are **two different dials, and external must never be wider**. Decision:

- `sharingModel` stays scalar and internal; an optional **`externalSharingModel`** is added with
  the same canonical enum, **default `private`**.
- Authoring validates `external ≤ internal` (ordering `private < public_read <
  public_read_write`; `controlled_by_parent` inherits the master's pair).
- "External" is a property of the **principal** (`audience: 'external'`, from a separate portal /
  partner identity pool), never of the object.
- The BU depth axis does not apply to externals (they live outside the tree): external visibility
  = own records + explicit shares + external OWD, and the evaluator short-circuits accordingly.
- Sharing rules targeting external recipients draw a hard linter warning (data crossing the
  boundary); the D6 access matrix gains an external-audience column.

Alternatives rejected: enum products (`private_internal_public_external`, …) — combinatorial;
an audience-map OWD (`sharingModel: { internal, external, guest }`) — over-general, and guest is
deliberately **not** an OWD audience (guest access flows through the guest position + share links
only). The spec shape lands in P1; portal identity and licensing are a separate product track.

### D12 — Delegated administration: scoped admin, no self-escalation

A conglomerate cannot run fifty subsidiaries' grants centrally — and today whoever can manage
permissions can manage **all** permissions. Decision: administration itself becomes a scoped
capability. An **admin scope** attaches to a permission set (and is therefore distributed via
positions, audited in the same tables, and explained by the same engine as everything else),
declaring:

- **where** — a BU subtree (the tree is the natural delegation boundary);
- **what** — manage user↔position assignments and position↔set bindings within that subtree;
  optionally author environment-owned sets there;
- **which** — an **allowlist of permission sets the delegate may assign**. This is the
  anti-self-escalation core: a delegate can never hand out — to others *or themselves* — a set
  outside the allowlist; and granting an admin scope requires holding a scope that strictly
  contains it.

Security-domain publishes (D7) and the `everyone`/`guest` anchors stay tenant-level only — no
delegated scope can touch them. Explain (D6) learns to answer "who *could have* granted this",
not just "who did".

---

## Consequences

- **Final vocabulary** (five words, one reading each):
  `permission_set` · `position` · `business_unit` · `sharing`/`sharingModel` (with `team` as
  recipient) · plus `rls` as the expert escape hatch. The complete admin mental model:
  *permissions are unions of permission sets; positions decide who gets which sets; the BU tree and
  manager chain decide how deep you see; each object's OWD sets the record baseline — sharing only
  widens, RLS only narrows.*
- **The "who" column is now typed** without adding admin-facing vocabulary: guests and externals
  are audiences, agents and services are principal kinds — none of them is a sixth concept. AI
  agents are safe by construction (intersection + ceiling + co-sign), which is the platform thesis
  made mechanical.
- **Package developers** ship objects (with mandatory OWD, optionally an external dial) +
  functional permission sets (+ suggested audience bindings). They never ship positions, BUs,
  teams, or assignments.
- **Admins** own the org tree, positions, bindings, and the `everyone` baseline. Restriction is done
  by *not granting* (additive model), never by authoring "subtraction sets".
- **Breaking changes** are concentrated in one pre-launch wave (P1 below); after launch the
  vocabulary is frozen by lint.
- **ObjectUI**: Access pillar relabels (Position/岗位), profile badge → provenance + default badges,
  permission matrix gains OWD context per object row; Data pillar OWD control (objectui#2348) gains
  the mandatory-on-create behavior; alias normalization removed.
- The companion reference (`docs/design/permission-model.md`) is the maintained source of truth for
  the model; `content/docs/permissions/*` is updated to match in P1–P2 as the implementation lands.

## Non-goals and named follow-ups

Deliberate non-goals:

- **Per-privilege depth** (Dataverse `privilege × depth`). Object-level `readScope`/`writeScope`
  (ADR-0057 D1) is a deliberate simplification; Dataverse's granularity is its adoption tax.
- **Renaming `permission_set`** — see below.

Named follow-up ADRs — acknowledged, tracked on the ADR-0090 tracking issue, not blocking the
launch shape (none of them changes P1's breaking surface):

1. **Grant lifecycle & recertification** — time-boxed assignments (`valid_from`/`valid_until`),
   delegation-of-duty during absence, break-glass elevation with automatic expiry, and periodic
   access-review campaigns (SOX/等保). Also the substrate for task-scoped, time-boxed agent grants
   (D10).
2. **Segregation of Duties (SoD)** — declarative conflict rules between permission sets
   ("vendor-create must not combine with payment-approve"), checked at assignment time, with an
   audit report. Joins the D7 lint family.
3. **Scale & reorg hardening** — membership-set materialization/caching, asynchronous share
   recalculation, batched BU-subtree moves; a 100k-user × 10M-record benchmark gates P4.
4. **ERP dimension restrictions** — declarative "rows where field ∈ my values"
   (Frappe User-Permissions shape) as first-class metadata; today expressible via RLS.
5. **ALM / environment promotion** — export/import + semantic diff of positions/bindings across
   dev→test→prod, reusing the D6 matrix as the diff layer.
6. **Portal identity & licensing** — the product track that activates D11 at scale.

## Alternatives considered

1. **Rename `permission_set` → `role`** ("RBAC-orthodox"). Rejected: "role" has four incompatible
   industry readings; adopting any one of them misleads the constituencies of the other three
   (Salesforce admins read role=hierarchy, AWS engineers read role=assumable identity). The stable
   optimum is a vocabulary in which the contested word does not appear at all. `permission_set` is
   verbose but misread by no one.
2. **Keep Profile as a strong convention** (cardinality constraint "≤1 profile per user", UI
   partition). Rejected on the package/platform isolation argument (D2 #1) — the constraint polishes
   a concept whose ownership problem is unresolvable; and the industry trend (Salesforce
   permission-set-first) runs the other way.
3. **Environment-level `defaultPermissionSets` setting** instead of the `everyone` position.
   Rejected: it creates a second distribution channel outside the position system — one more place
   "why does this user have this?" must check, invisible to the explain path and the audit tables
   that positions already have.
4. **`group` / `persona` as the new name.** `group` collides with the sharing-recipient enum and IdP
   vocabulary; `persona` is meaningless to enterprise admins and has no HR-term mapping.
5. **Deprecated aliases for the renames** (ADR-0057 D7 discipline). Superseded by the launch-window
   argument: aliases now are debt with no debtor.
6. **Builtin shared permission sets for user/admin/anonymous that packages write into.** Rejected:
   a communal set has no single `packageId` (ADR-0086 provenance and uninstall semantics collapse),
   and under union-merge it becomes an ever-growing, unauditable grant sink. Audiences are
   *positions* (D9); capability stays in package-owned sets.
7. **Agent effective permission = the agent's own grants** (no intersection). Rejected: the
   confused-deputy hole — any over-privileged agent becomes an oracle for whatever an
   under-privileged prompter asks. Intersection with the delegator is the industry-converged
   answer (OAuth OBO, Kerberos S4U).

## Phasing (each independently shippable, proofs per ADR-0054)

- **P1 — The breaking wave** (one coordinated PR, mechanical): D3 renames, D4 enum cleanup, D2
  `isProfile` removal, D1 default flip + grandfather stamping, **plus the two pre-launch spec
  shapes**: the ctx principal taxonomy (D10 — `kind`/`audience`/`onBehalfOf` fields) and
  `externalSharingModel` (D11) — shapes land now; later-phase semantics may follow. Regenerated
  translations; conformance matrix rows updated. Proof: full test suite + a dogfood re-run of the
  objectui#2348 scenario showing owner isolation with *no* explicit OWD authored.
- **P2 — Audience anchors** (D5 + D9): `everyone` and `guest` builtin seeding, install-time
  suggestion prompt for both anchors, fallback-cliff removal. Proof: package install/uninstall
  grant-liveness e2e + an anonymous-principal e2e (a guest sees exactly the guest bindings and
  nothing else).
- **P3 — Linter + tiered gates + delegated admin** (D7 + D12 + the per-kind lint tiers of D9/D10):
  publish-pipeline integration; admin scopes with allowlist / no-self-escalation checks. Proof:
  each lint rule has a fixture that fails without it; a delegation e2e where a subsidiary admin
  cannot exceed their allowlist or subtree.
- **P4 — Explain + matrix gate** (D6, intersection- and audience-aware): contract, engine,
  simulator UI, snapshot gate with the external-audience column. Proof: matrix snapshot diff drill
  on a seeded CRM stack, including an agent on-behalf-of case and an external-portal case.

## References

- ADR-0049, ADR-0056, ADR-0057 (+ its 2026-06-25 addendum), ADR-0066, ADR-0086
- objectstack-ai/objectui#2348 — OWD control in Studio + the dogfood incident writeup
- Companion: [docs/design/permission-model.md](../design/permission-model.md)
- Industry survey (capability/visibility split, distribution layers, hierarchy convergence):
  Salesforce sharing architecture, Microsoft Dataverse security model, ServiceNow ACL/groups,
  SAP PFCG/structural authorizations, Odoo groups/record rules, Frappe user permissions,
  AWS IAM policy simulator (explainability prior art).
