# ADR-0105: Group Tenancy Posture — Organization Scope as a First-Class Authorization Dimension

**Status**: Accepted (2026-07-27; proposed 2026-07-25) — Phase 0/1 implemented (#3559). Amended 2026-07-27: **D12 correction** — `group` posture activation is entitled, not open (#3570; see the D12 Amendment). Phase 2 **D8** and **D9** implemented 2026-07-28 — D8: #3645 (host seam) → #3663 (placement engine) → #3674 (`/security/my-delegable-scope`) → #3695 (issuer-grant resolution) → #3722 (`delegated_admin` + invitation role cap, #3697) → #3767 (`sys_member` governed), console objectui#2868/#2891, e2e cloud#886; the membership-role channel D8's placement replaces is closed by [ADR-0108](./0108-membership-grade-is-not-a-capability-channel.md). D9: #3824 + #3873 (see the D9 amendment below). D10 stays reserved pending its follow-up ADR; D13 not started
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove), [ADR-0057](./0057-erp-authorization-core-business-units-and-scope-depth.md) (business units + scope depth), [ADR-0066](./0066-unified-authorization-model.md) (unified authz, superuser bypass), [ADR-0086](./0086-authz-metadata-config-boundary-and-cross-package-composition.md), [ADR-0090](./0090-permission-model-v2-concept-convergence.md) (permission set / position / business unit), [ADR-0091](./0091-grant-lifecycle-and-recertification.md) (validity windows), [ADR-0092](./0092-sys-user-profile-field-delegation.md) (identity write guard + field whitelist), [ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) (tenancy service), [ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) (tenant Layer 0, posture ladder), [ADR-0103](./0103-managedby-write-policy-and-engine-write-guard.md); cloud ADR-0016 (open/paid boundary: 强制免费、治理收费), cloud ADR-0081 (`@objectstack/organizations`)
**Tracking**: #3541 (P0 findings F1/F2 became #3539/#3540, closed by #3559); cloud-side tracking cloud #874
**Consumers**: `@objectstack/plugin-security`, `@objectstack/core` (`resolve-authz-context`), `@objectstack/plugin-auth` (tenancy service), `@objectstack/plugin-sharing`, `@objectstack/plugin-approvals`, `@objectstack/lint`, dogfood conformance suite, `@objectstack/organizations` (cloud)

---

## TL;DR

Group-shaped customers (multi-plant manufacturing, multi-branch retail, holding
structures) need **one shared database, organization as the membership
boundary, group-wide visibility, and cross-org workflows** — a shape between
today's two tenancy modes. Today that middle is not just unsupported; an
attempt to configure it by hand trips two latent defects (F1, F2 below).

Mainstream ERP converged on one answer decades ago: **organization scope is a
parameter of the authorization grant, enforced by the engine** — SAP
authorization objects carry org-level fields and derive roles per plant;
NetSuite roles carry subsidiary restrictions; Dataverse security roles bind to
business units with per-privilege access depth; Oracle retired
one-org-at-a-time responsibility switching in favor of MOAC union access. This
ADR adopts that end state:

- **D1** — Tenancy becomes a three-posture spectrum: `single | group |
  isolated`. `group` = organizations share one database as *data*, wall
  enforced by the engine with **union** semantics; `isolated` = today's
  `multi`.
- **D2** — `accessible_org_ids` becomes a first-class, core-resolved
  `ExecutionContext` field; the `group` Layer 0 filter is
  `organization_id IN accessible_org_ids` (MOAC semantics), preserving
  ADR-0095's W1/W2 invariants (AND-first, independent compiler, no bypass
  bit).
- **D3 (P0, ships regardless)** — stop stripping *authored* RLS policies: the
  `current_user.organization_id` substring strip in `collectRLSPolicies` is
  narrowed to the platform's own wildcard tenant policies.
- **D4 (P0, ships regardless)** — contain `viewAllRecords`/`modifyAllRecords`:
  the superuser bypass is bounded by the caller's org access set in every
  posture; wall-less postures never auto-grant unbounded wildcard VAMA.
- **D5–D13** — group-mode stamping, org grouping metadata (reporting-only, no
  permission inheritance), managed-table extension fields via the ADR-0092
  whitelist, scoped invitations, cross-org approval targeting, layered master
  data, enforce-or-remove cleanup of dead spec surface, the open/commercial
  split, and a BU-subtree → organization promotion path so deployments can
  move along the spectrum without a rebuild.

**Rejected**: org-per-plant hard walls as the default group topology; config-only
soft isolation on the current engine; a cross-org BU mega-tree; permission
inheritance along an organization hierarchy. See Alternatives.

---

## Context

### The customer shape

A manufacturing group runs N plants on one MES: each plant manages its own
members and process configuration; group HQ approves plant documents and reads
all plants' data. Two requirements are *inherent* to the shape, not optional:

1. **Group-wide visibility** — consolidated reporting and drill-down across
   every plant.
2. **Cross-org workflow** — plant-submitted documents route to group-level
   approvers.

### Today's two postures, and the unsupported middle

- **`single`** (ADR-0093): one logical tenant. Layer 0 inert
  (`plugin-security/src/tenant-layer.ts:87`). Factories can be modeled as
  business units in one tree — group visibility and approvals are native, but
  there is no per-factory membership/invitation boundary, and org scoping
  relies entirely on authored configuration.
- **`multi` / isolated** (ADR-0093, ADR-0095): the hard wall.
  `organization_id = activeOrganizationId` AND-composed first; **no**
  business-RLS change, sharing rule, or superuser bit can widen it (W1/W2).
  Correct for legal-entity isolation — and structurally hostile to the two
  inherent requirements above: one active org per session
  (`core/src/security/resolve-authz-context.ts:125`), org-scoped approver
  resolution (`plugin-approvals/src/approval-node.ts:118`, other-tenant
  position holders excluded — `approval-service.test.ts:263-265`), no
  cross-org query path short of `isSystem` mirroring.

The middle — organizations as *membership boundaries* over one shared dataset —
is what group customers actually want. Attempting it today by hand (better-auth
orgs + `organization_id` columns + authored RLS, without
`@objectstack/organizations`) fails on two latent defects:

### Findings (verified, file:line)

- **F1 — authored org policies are silently stripped.**
  `collectRLSPolicies` (`plugin-security/src/security-plugin.ts:2785-2791`)
  drops **any** policy whose `using` contains the substring
  `current_user.organization_id` whenever the `org-scoping` service is absent.
  The intent was to strip the platform's own wildcard tenant policies in
  single-tenant deployments; the substring match also swallows app-authored
  policies. A silently-dropped authored security policy is exactly the
  ADR-0049 class of defect ("declared but unenforced").
- **F2 — wildcard VAMA is contained only by the wall.** `organization_admin`
  carries `'*': { viewAllRecords: true, modifyAllRecords: true }`
  (`plugin-security/src/objects/default-permission-sets.ts:150-160`) and is
  auto-granted to every owner/admin member (`auto-org-admin-grant.ts`). The
  superuser bit short-circuits Layer 1 business RLS and sharing; in the
  isolated posture Layer 0 contains it (the #2937 fix), but in any wall-less
  posture nothing does. Combined with automatic personal-org creation on
  signup, a wall-less multi-org deployment makes effectively every user an
  environment-wide superuser while operating in an org where they hold
  owner/admin.
- **F3 — dead spec surface on the org axis.**
  `PermissionSet.contextVariables` (`spec/src/security/permission.zod.ts:282`)
  has zero runtime consumers; `ExecutionContext.rlsMembership`
  (`spec/src/kernel/execution-context.zod.ts:165`, merged at
  `plugin-security/src/rls-compiler.ts:164-177`) has no production resolver —
  only `org_user_ids` is populated; `spec/src/security/territory.zod.ts` has
  no runtime object or stack field. All three violate ADR-0049
  enforce-or-remove.
- **F4 — the extension-field channel exists but has one whitelist entry.**
  Extending better-auth-managed tables is established practice
  (`sys_user.manager_id`, `sys_user.primary_business_unit_id`,
  `sys_user.ai_access`) and ADR-0092's registry-driven identity write guard
  with a per-object update whitelist is the sanctioned mechanism
  (`sys_user → {name, image}` is its first entry). Group-mode org/member
  metadata needs whitelist entries and a collision guard, not a new mechanism.

### Industry convergence (why this shape, and not another)

| System | Mechanism | Lesson adopted here |
|---|---|---|
| SAP (ECC/S4) | Authorization objects carry org-level fields (`BUKRS`, `WERKS`); derived roles re-parameterize a master role per plant; one client holds the whole group | Org scope is a **grant parameter**, engine-checked; legal entities/plants are data, not tenants |
| Oracle EBS → R12/Fusion | One-OU-per-responsibility switching was retired for **MOAC** (security profile lists many OUs, union access); Fusion data access sets | Union access beats context switching — D2's `IN` semantics |
| Microsoft Dataverse | Security roles bound to business units; per-privilege access depth (user/BU/parent-child/org) — the model ADR-0057 adopted | Depth axis stays org-internal; BU tree is the intra-org hierarchy |
| NetSuite OneWorld | One DB; `subsidiary` on every record; roles carry subsidiary restrictions natively | The closest analog of the `group` posture — and its scoping is engine-native, never a per-app convention |
| Workday | Role-based security groups assigned **on org nodes** | Grant = capability × org node (`sys_user_position.business_unit_id` anchoring, ADR-0090 Addendum) |
| Odoo | `company_id` + record rules only (config-level soft isolation) | The cautionary tale: a forgotten record rule = cross-company leak. Config-only scoping is not an acceptable product answer (F1/F2 are our version of it) |

No mainstream vendor ships "org scope as an app-level configuration
convention" as its group story. The engine owns it everywhere.

---

## Decisions

### Kernel

**D1 — Three tenancy postures: `single | group | isolated`.**
The tenancy service (ADR-0093) gains a `group` mode. Semantics:

| Posture | Wall | Stamping | Intended shape |
|---|---|---|---|
| `single` | none (Layer 0 inert) | none | one logical tenant; factories as BUs in one tree remain a fully supported deployment (Appendix A) |
| `group` | `organization_id IN accessible_org_ids` — engine-enforced, union | engine stamps + validates on write | organizations = membership/invitation boundaries over one shared dataset |
| `isolated` | `organization_id = activeOrganizationId` (today's `multi`, ADR-0095 Layer 0) | engine stamps active org | legal-entity / sovereignty isolation |

`isolated` behavior is unchanged. `single` behavior is unchanged except D3/D4
correctness fixes. Existing `multi` configuration maps to `isolated`.

**D2 — `accessible_org_ids`: core-resolved union org scope.**
`resolveAuthzContext` resolves the caller's full set of *currently valid* org
memberships (validity windows per ADR-0091, `core/src/security/grant-validity.ts`)
into a first-class `ExecutionContext.accessible_org_ids`, sibling to
`org_user_ids`. In `group` posture the Layer 0 filter becomes
`{ organization_id: { $in: accessible_org_ids } }`, composed exactly as
ADR-0095 D1 mandates: **AND-first, independent compiler, no shared bypass bit**
(W1/W2 preserved; only the predicate widens from equality to set membership).
Empty set ⇒ `RLS_DENY_FILTER` (fail closed), mirroring
`tenant-layer.ts:103`. The active organization keeps its current meaning
(default write target, UI context); it no longer bounds *read* reach in
`group` posture — membership does.

**D3 (P0) — Strip only the platform's own wildcard tenant policies.**
`collectRLSPolicies` stops substring-matching. The platform's wildcard
`tenant_isolation` policies are tagged (provenance flag on the default-set
policies, or `object === '*'` ∧ shipped-by-default), and only tagged policies
are stripped when isolation is inactive. An authored policy referencing an
unavailable context variable follows the existing availability path (fails
closed at resolution, surfaced by `isSupportedRlsExpression` authoring lint) —
it is **never silently dropped**. Ships in the open edition immediately;
independent of D1.

**D4 (P0) — VAMA is bounded by org scope in every posture.**
`viewAllRecords` / `modifyAllRecords` mean "bypass ownership, sharing, and
business RLS **within the caller's org access set**" — never "cross the org
boundary". Concretely: the Layer 1 superuser bypass no longer implies skipping
the org predicate in any posture where one applies (this is already true in
`isolated` per ADR-0095 W2; D4 extends the invariant to `group`), and
wall-less postures get a de-VAMA'd `organization_admin` variant from
`auto-org-admin-grant` so the F2 amplification path (personal orgs) closes.
Crossing org scope remains exclusively the `PLATFORM_ADMIN` rung on
posture-permitting objects (`tenant-layer.ts:54,100`), unchanged.

**D5 — Group-mode stamping and write validation move into the engine.**
On insert in `group`/`isolated` postures the engine stamps `organization_id`
from `ctx.tenantId` (active org) when absent, and **validates** any explicit
value against `accessible_org_ids` (group) / equality (isolated) — the
write-side twin of the read wall, alongside the existing Layer-0 post-image
check (#2937). `tenancy.enabled: false` objects
(`spec/src/data/object.zod.ts:240-256`) remain exempt: platform-global by
declaration, business RLS as their only scoping — the sanctioned escape hatch
for cross-org catalogs.

### Model

**D6 — Organization grouping is reporting metadata; hierarchy stays on the BU
tree; the cut-line doctrine.**
Group structure above the organization boundary (region, brand, legal
grouping, ordering) is carried by extension fields on `sys_organization`
(via D7), optionally including a `parent_organization_id` reference — **as a
reporting/grouping dimension only**. Two red lines, both lint-enforced:

1. **No permission inheritance along the org axis.** Cross-org visibility
   comes from membership union (D2), never from walking an org tree.
   Re-adding a second permission hierarchy is the mistake ADR-0057 D5 retired
   and ADR-0090 D3 finalized for positions; it stays retired for
   organizations.
2. **BU trees remain org-internal.** `sys_business_unit` is org-scoped
   (`plugin-sharing/src/business-unit-graph.ts:174-177`; the enterprise
   resolver org-predicates all lookups). Every BU mechanism —
   `unit_and_subordinates` sharing, `adminScope` delegation, depth scopes —
   operates within one organization. There is no cross-org tree.

The **cut-line doctrine** (deployment guidance, Appendix A): model the group's
full structure as one conceptual tree, then cut it at the layer that needs
membership autonomy and isolation. Above the cut → organizations (+ grouping
metadata). Below the cut → each org's BU tree. `single` posture = no cut.

**D7 — Managed-table extension fields ride ADR-0092's whitelist.**
Protocol fields (better-auth's own: `email`, `slug`, `sys_member.role`, …)
remain guarded exactly as ADR-0092 D2 prescribes. Group-mode extension fields
— org grouping metadata (D6), per-membership attributes (employee number,
plant-local status on `sys_member` — the org-cardinality home, since
`sys_user` is global) — are added as whitelist entries in the single ADR-0092
whitelist module, editable through the generic path under normal FLS /
`requiredPermissions`. New: a **collision lint** — extension field names on
better-auth-managed objects must not collide with the better-auth schema
surface of the pinned version, so a library upgrade cannot silently change a
field's owner.

### Product

**D8 — Scoped invitations.**
An invitation may carry placement intent: target business unit and positions.
On accept, the platform applies the placement (BU membership + position
assignments) atomically with the better-auth membership. Issuance is governed
by `adminScope` (ADR-0090 D12): a delegated admin may only invite into their
subtree and only attach allowlisted permission sets — the existing
anti-escalation gate, reused verbatim. This closes the one structural gap of
the `single`-posture deployment (plant-autonomous member admission) and is the
natural admission UX in `group` posture.

**D9 — Cross-org approval targeting.**
An approval **approver** may name a **target organization** for its resolution
(default: the request's org, today's behavior). A plant document's escalation
step declares `organization: $root` and resolves group-side position holders.
Reads of the request by those approvers are covered by D2 (membership union) in
`group` posture; in `isolated` posture this decision does not apply (cross-org
approval there remains mirroring via system context, cloud #2937 contract).

*Amended during implementation (#3812). Four points the original text left
open, each settled from what the code and the authoring model actually
require:*

1. *Per **approver**, not per node.* The node-level form cannot express the
   commonest group shape — one node requiring a plant manager **and** a group
   CFO in parallel (`behavior: 'per_group'`). Expressing it as two serial nodes
   changes the semantics (parallel co-sign becomes sequential approval), so the
   node-level form distorts the model rather than merely inconveniencing the
   author. A node-level default is a strict special case of the per-approver
   form and remains addable later as sugar; the reverse is not true.
2. *Symbolic references first: `$root`, `$parent`.* Flow metadata is portable
   across environments; an organization id is data minted per deployment. A
   literal id in a flow is therefore unportable by construction, and an AI
   author cannot know one at authoring time. The symbols express the two common
   intents against D6's tree with **zero deployment knowledge**. A slug covers
   what they cannot — notably a **sibling** organization (a shared-services
   centre approving payables for every plant).
3. *Legality is "shares a `parent_organization_id` root", not "is an
   ancestor".* The sibling case above is first-class, as is downward targeting.
   The rule depends only on the organization tree and **never on the
   submitter**, so one flow routes identically for everyone — which is what
   makes a routing bug reproducible. A deployment with no grouping metadata
   gets a refusal naming D6, not a silent pass.
4. *Non-`group` postures **refuse** at runtime rather than ignoring.* Posture is
   environment configuration, so the same portable metadata may be deployed
   into any posture and no static check can see which. Silently ignoring the
   declaration would let a `group` → `isolated` migration reroute approvals
   with no signal — an audit event, not a config detail.

*Two consequences worth stating, both enforced:* an approver type that resolves
no org-scoped directory (`user` / `field` / `manager` / `team`) **refuses** the
declaration instead of ignoring it (an author who wrote it believed it did
something); and a targeted approver who holds no membership in the request's
organization is **dropped with a warning** naming them, because D2's union
would otherwise hide the request from someone the router had already committed
to — routing succeeds, the inbox row is written, and the approver opens a task
she cannot open. Dropping converts that silent dead-end into the node's
existing `onEmptyApprovers` policy.

**D10 — Layered master data (group template + org override).**
A spec-level pattern for the SAP material-master / 用友-金蝶 distribution
shape: an object may declare layered governance — group-level template rows
(platform-global or group-org-owned, read-shared) plus per-org override rows
linked to the template, with a resolution rule (org override wins). Mechanics
(linkage field, resolution in the read path or a view layer, distribution
policies: 集团统管 / 分级 / 自由) to be detailed in a follow-up ADR; this ADR
reserves the concept and its place in Phase 2.

**D11 — Enforce-or-remove cleanup (ADR-0049 debts on the org axis).**
- `PermissionSet.contextVariables`: **remove** from the spec (no consumer;
  its use cases are covered by `rlsMembership` and literal predicates).
- `ExecutionContext.rlsMembership`: **productize** the seam — a registered
  membership-resolver extension point (service contract) that plugins/apps
  implement; resolved sets merge under their declared keys
  (`rls-compiler.ts:164-177` already merges). `accessible_org_ids` (D2) is
  core-resolved, not an app resolver.
- `spec/src/security/territory.zod.ts`: **remove**. Matrix requirements are
  served today by multi-position × BU anchoring; a generalized dimension
  security module (Workday segments / Dataverse XDS class) may revisit later
  with its own ADR.

**D12 — Edition split, per the cloud ADR-0016 iron rule (强制免费、治理收费).**
*(As amended 2026-07-27, #3570 — see the Amendment below for the original
text and why it was wrong.)* The split is **code vs. activation**, not code
vs. code. The wall's *implementation* ships open — D3/D4 correctness, the
Layer 0 predicates, D5 stamping/validation, `accessible_org_ids` resolution,
the D6 red-line lints — exactly as `isolated`'s wall has always lived in
`plugin-security`. Posture *activation* is entitled: `group` probes the
enterprise `org-scoping` runtime (`@objectstack/organizations`) exactly like
`isolated`; without it the tenancy service resolves the posture to `single` +
`degraded`, and an `os serve` boot configured for `group` **refuses to
start** (the ADR-0093 D5 guard, keyed off the resolved posture) rather than
silently running unwalled. The iron rule guarantees a deployment *running* a
multi-org shape is safe by default; that is satisfied by refusing to run one
unwalled — **open code is not free activation**. The inherited commercial
line stands, and **this decision is now its owner**: both multi-org postures
are `@objectstack/organizations` capability. Commercial surface (unchanged):
org lifecycle management, grouping/registry UI, scoped invitations UX,
cross-org approval templates, master-data distribution management, per-org
seed/config replay, org analytics, and the D13 promotion tooling.

> **Citation note (2026-08-16) — hygiene, not a decision.** Code and tests
> carried this entitlement as **"ADR-0081 D2"**, a label inherited from a
> decision record that predates this repo's ADR series — the same pre-repo
> record whose "ADR-0081 D1" label [ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md)
> D9 names. That number now collides with this repo's
> [ADR-0081](./0081-trusted-react-page-tier.md), the trusted `kind:'react'`
> page tier, whose Decision section is numbered 1–4 and has no D-numbered
> decisions at all — so a reader following the citation landed in a document
> about React pages with no signal they were in the wrong record. **D12 is the
> anchor** for "enabling multi-organization operation is an entitlement": it
> is the accepted, repo-local decision that both walled postures probe
> `@objectstack/organizations` to activate, and the #3570 amendment below is
> the founder ruling that settled it. Nothing about the decision changes here;
> it simply stops being cited by a number that resolves elsewhere.
>
> ⚠️ The anchor is **D12**, not `D2` — this ADR's own **D2** is
> `accessible_org_ids`, an unrelated kernel decision. The one-character slip
> reproduces the exact defect this note closes.

> **Amendment (2026-07-27, #3570).** As proposed, this section read "the
> `group` wall ships open — an open deployment configured into the group
> shape must be safe by default; the wall's correctness is never paid", and
> #3559 implemented that reading: a self-activating `group` posture with no
> entitlement probe. That was the founder decision flagged in #3559, and the
> founder ruled it wrong on review. Two defects in the original reading:
> it made the *stronger* multi-org posture (union wall) free while the
> *weaker* one (`isolated`) stayed entitled — inverting the inherited
> commercial line and handing out a free path around the `org-scoping` gate
> — and it opened a
> silent-degradation hole (`os serve` gated the enterprise package load on
> `OS_MULTI_ORG_ENABLED`, so `OS_TENANCY_POSTURE=group` skipped both the
> load and the ADR-0093 D5 fail-fast, booting single-org without saying so).
> The iron rule's obligation is a *security* property (never run a multi-org
> shape unwalled), not a *packaging* one (give the posture away). #3570
> restored the entitled model above; safety stays free because an unwalled
> `group` boot is refused, not run.

**D13 — Migration along the spectrum; BU-subtree → organization promotion.**
Deployments move `single → group → isolated` without schema rework because
`organization_id` columns exist everywhere by construction. The load-bearing
tool: **promote a BU subtree to an organization** — create the org, move BU
subtree rows under it, backfill `organization_id` on scoped business data from
the subtree's scoping field, convert BU memberships to org memberships +
placements, re-home position assignments. This is "moving the cut line" (D6)
as a supported operation, and the exit path when one plant later requires
legal isolation (promote, then flip posture or extract to its own
environment).

---

## Non-goals

- No change to the physically-isolated cloud topology (one database per
  environment, ADR-0002/0095): `group` is an in-database posture.
- No cross-org permission inheritance, org-axis role trees, or a second
  hierarchy (D6 red lines).
- No org-per-plant hard-wall default for group customers (see Alternatives).
- No change to `PLATFORM_ADMIN` wall-crossing semantics (ADR-0095 D3 /
  `posturePermitsCrossTenant` stays as-is).
- D10 mechanics (linkage/resolution/distribution) — reserved, follow-up ADR.

## Phasing

- **Phase 0 (correctness, immediately; open edition; independent of D1)**:
  D3, D4, D11 removals (`contextVariables`, territory), collision lint (D7),
  conformance-matrix rows for the wall-less-VAMA and authored-policy-survival
  cases.
- **Phase 1 (group posture MVP)**: D1, D2, D5, D6 (fields + lints), D7
  whitelist entries, group-mode default permission sets. Acceptance: the
  three-plants-one-group dogfood — plant admins configure process data
  mutually invisibly, group reads all plants on one screen, zero custom
  security code.
- **Phase 2 (group product depth)**: D8, D9, D10, "all my organizations"
  console affordances, D13 promotion tool.
- **Phase 3 (governance, commercial)**: SoD constraints, certification
  campaigns over ADR-0091 validity/recert data, deny/muting layer (ADR-0066
  ⑦⑧), generalized dimension security (territory's successor).

## Alternatives considered

1. **Org-per-plant hard walls (isolated posture) as the group default.**
   Evaluated in depth for the MES shape. Both inherent requirements become
   architecture problems: group visibility needs `isSystem` mirror/rollup
   pipelines (cloud #2937 contract), approvals fragment per org (org-scoped
   approver resolution), every cross-org flow is bespoke integration.
   Retained only for genuine legal isolation — reachable via D13, never the
   default.
2. **Config-only soft isolation on the current engine** (better-auth orgs +
   authored RLS, no engine wall). Defeated by F1 (policies stripped) and F2
   (VAMA uncontained); even with both fixed, it reproduces the Odoo failure
   mode — every new object is one forgotten policy away from a cross-plant
   leak, with no engine invariant behind it. Rejected as a product answer;
   D1/D2 exist to make the engine own it.
3. **One cross-org BU mega-tree** (group→plants→workshops in a group org).
   Fights the grain of every org-scoped BU mechanism (sharing expansion,
   `adminScope`, depth anchors — all org-predicated); plant users' active
   context would not even see the tree. Rejected; cut-line doctrine instead.
4. **Permission inheritance along `parent_organization_id`.** Re-creates the
   dual-hierarchy mistake (ADR-0057 D5); visibility via membership union is
   strictly simpler and matches MOAC. Rejected; reporting dimension only.
5. **`PLATFORM_ADMIN` as the group-HQ access path.** Wall-crossing is an
   operator affordance gated on posture-permitting objects, bundled with
   metadata/settings capabilities — over-grant by construction for business
   analysts. Rejected; D2 membership union is the business path.

## Consequences

**Positive**: the tenancy story becomes a spectrum matching customer growth
(single plant → group → legal split) with no data rework at the transitions;
org scoping gains the same engine-invariant status the tenant wall has today
(closing the F1/F2 class permanently); the platform's group story reaches
parity with the NetSuite/SAP mechanism class while keeping the open-core
boundary honest per cloud ADR-0016.

**Negative / costs**: a third posture multiplies the authz test matrix (every
conformance row × posture); `accessible_org_ids` adds a resolver read path
that must respect ADR-0091 validity windows and the existing 60s cache
staleness envelope; the D12 split is code-vs-activation — the wall's
implementation is open while both multi-org postures stay entitled (the
original open-activation concession shipped in #3559 and was reverted by
#3570, see the D12 Amendment); D13
promotion is a data migration with real blast radius and needs its own
verification harness.

**Risks**: D4 touches the superuser hot path — it lands behind the
`authz-matrix-gate` snapshot exactly as ADR-0095 did, any visibility delta
outside the two intended F1/F2 corrections is a bug; D2's union read wall
changes what "active organization" means to end users in group posture — UI
affordances (org switcher as *write context* + "all my orgs" read views) must
land with Phase 1, not after.

---

## Appendix A — Deployment guidance available today (pre-Phase-1)

For a group MES engagement **now**, on the current platform:

- **Posture**: `single`. One organization; the full structure as one BU tree
  (集团 → 工厂 → 车间 → 产线) — the SAP one-client shape, and after Phase 1
  simply the no-cut point on the D6 spectrum.
- **Plant scoping**: business objects carry a plant reference; high-volume
  transactional tables scope via RLS predicates (per-plant permission sets
  generated in code — the hand-rolled derived-role pattern) or, with the
  enterprise hierarchy resolver, `readScope/writeScope` depth anchored via
  `sys_user_position.business_unit_id`. Criteria sharing rules
  (`unit_and_subordinates`) for low-volume collaboration only — they
  materialize `sys_record_share` rows per record.
- **Plant admin**: `adminScope` delegation per plant subtree
  (ADR-0090 D12); duty delegation via ADR-0091 delegatable positions.
- **Group master data**: group-standard objects OWD `public_read` with write
  permission held by group positions; plant-local overrides as plant-scoped
  rows (D10 formalizes this later).
- **Member admission**: until D8 lands, plant-scoped invitation is an
  app-level flow (invitation carries BU/position intent; placement on
  accept).
- **What not to do**: do not hand-build wall-less multi-org on the current
  engine (Alternative 2 / F1 / F2), and do not put plants behind isolated-org
  walls to "prepare" for D1 — the D13 promotion path exists precisely so the
  cut line can move later.
