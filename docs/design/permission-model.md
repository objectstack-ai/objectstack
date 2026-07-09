# The ObjectStack Permission Model

> **Status**: companion reference to [ADR-0090](../adr/0090-permission-model-v2-concept-convergence.md)
> (Proposed). This document describes the **decided target model**; it is maintained as the model's
> source of truth and supersedes older concept descriptions wherever they disagree. User-facing docs
> under `content/docs/permissions/*` are aligned to this document as the implementation phases land.

ObjectStack's authorization is a small **declarative vocabulary that compiles down to RBAC checks and
row-level predicates**. Administrators and AI author five kinds of structured metadata; the engine
compiles them into capability decisions (`permission-evaluator`) and record filters (`rls-compiler`,
`buildReadFilter`). Nobody ships handwritten predicates for the common cases.

The whole model in four sentences:

1. A user's **capability** is the *union* of every **permission set** they hold — additive only,
   nothing subtracts.
2. **Positions** decide who holds which permission sets (flat job-shaped groups; the built-in
   `everyone` position is the tenant-wide baseline).
3. The **business-unit tree** and the **manager chain** decide *how deep* a grant sees
   (`own → own_and_reports → unit → unit_and_below → org`).
4. Each object's **OWD** (`sharingModel`) sets the record-visibility baseline; **sharing** only ever
   *widens* it, **RLS** only ever *narrows* it.

---

## 1. The five concepts

| Concept | Answers | Shape | Owned by |
|---|---|---|---|
| **Permission set** | *what can be done* — object CRUD, field R/W (FLS), View/Modify-All (VAMA), scope depth, lifecycle ops, system permissions, tab visibility | flat bundle; union-merged | 📦 package **or** ✏️ environment (provenance: `managedBy`/`packageId`, ADR-0086 D3) |
| **Position** (岗位) | *who gets which sets* — the distribution layer | flat, **no hierarchy** | environment (admins) |
| **Business unit + manager chain** | *how deep a grant sees* | one tree (`sys_business_unit`) + `sys_user.manager_id` | environment |
| **OWD + sharing** | *whose records are visible by default, and what widens that* | per-object `sharingModel`; sharing rules, manual shares, teams as recipients | OWD: object author · sharing: environment |
| **RLS** | *hard boundaries nothing widens* (dimension/compliance isolation) | CEL predicates on permission sets | expert escape hatch (~5% of cases) |

**Position assignments may carry an optional business-unit anchor.** The
POSITION DEFINITION never binds to a BU (that would recreate the
position-per-department explosion); but an ASSIGNMENT row
(`sys_user_position.business_unit_id`, reserved since ADR-0057 D4) may name
the unit the person holds that position IN — "张三 is sales_manager **of
华东**". When present it does exactly three things: anchors that
assignment's depth grants (`readScope: unit*`) to that subtree, provides
the delegated-administration boundary check (ADR-0090 D12), and makes the
"manager of what" fact auditable instead of drifting with the user's BU
membership. Capability bits (CRUD/FLS) are never BU-scoped — row filtering
stays the job of OWD + depth. Semantics activate with the delegated-admin
phase; simple orgs never touch the field.

**Teams** are deliberately *not* a sixth concept: `sys_team` is a flat collaboration group that can
**receive shared records and nothing else** — it never owns records and never carries permission
sets (ADR-0090 D8). Positions distribute capability vertically; teams receive access horizontally.

**Words that do not exist here**: *profile* (removed — ADR-0090 D2) and *role* (reserved-forbidden —
ADR-0090 D3; the only surviving `role` is better-auth's internal `sys_member.role` column, projected
as `org_membership_level` and labelled "organization membership").

## 2. How a request is evaluated

```
┌─ who ───────────────────────────────┐   ┌─ capability ────────────────┐
│ user                                │   │ permission sets             │
│  ├─ positions (flat; incl everyone) ─────┤ = union of all held sets   │
│  ├─ business unit (the one tree)    │   │ CRUD/FLS/VAMA/depth/system  │
│  ├─ manager chain (user field)      │   │ additive only               │
│  └─ teams (flat, receive-only)      │   └─────────────────────────────┘
└─────────────────────────────────────┘
                 ▼ one read request ▼
① capability gate   does ANY held set allow this operation on this object?
                    (union; a private object ignores a non-superuser '*' wildcard, ADR-0066)
② field mask        FLS union
③ record scope      OWD baseline (object.sharingModel)
                    → widened by scope depth (own → reports → unit → unit+below → org)
                    → widened by sharing (rules / manual shares / team receipts)
                    → bypassed entirely by VAMA (view/modifyAllRecords)
④ hard rules        RLS always intersects; no share can widen past it
```

Every step is structured data, so the pipeline is **explainable by construction**: the explain
engine (ADR-0090 D6) reports *which* set/position/OWD/share/rule produced any decision, powering
both the admin "view-as" simulator and the publish-time access-matrix snapshot gate.

*Who* is calling matters too — a human, an AI agent, an integration service, an anonymous
visitor, or an external portal user each evaluate slightly differently. See §9.

**Deployment note (multi-org groups).** Large groups on this platform run
one organization per legal entity: every record carries `organization_id`
and the tenant filter prunes FIRST, so the owner/BU `IN`-lists that follow
are sized to a single org's population (hundreds–thousands), not the whole
group. This is why records do not need a stamped BU column and why the
`IN`-form stays comfortably within budget at group scale; cross-entity
consolidation is a reporting concern, not a row-filter concern.

## 3. OWD (`sharingModel`) — the record baseline

Four canonical values, no aliases (ADR-0090 D4):

| Value | Effect |
|---|---|
| `private` | owner-only; grants apply to *your* records; depth/sharing widen from there |
| `public_read` | everyone reads, only the owner writes |
| `public_read_write` | everyone reads and writes (a deliberate, explicit choice) |
| `controlled_by_parent` | inherited from the master record via master-detail (ADR-0055) |

**A custom object without a declared `sharingModel` is `private`** (ADR-0090 D1). Authoring a new
custom object requires choosing explicitly; pre-existing OWD-less objects were stamped
`public_read_write` once, with a warning, at migration time — the unset state no longer exists.

**External users get a second, stricter dial.** For portal/partner scenarios an object may also
declare `externalSharingModel` (same four values, ADR-0090 D11). It defaults to `private` and may
**never be wider than the internal one** — e.g. accounts can be `public_read` for employees while
staying `private` for dealer-portal users, who then see only records they own or were explicitly
shared. If your object has no external audience, ignore this field entirely.

## 4. Worked example — a CRM package

### What the developer ships

Packages ship **objects (with explicit OWD) and functional permission sets**. Never positions, BUs,
teams, or user assignments — those are the customer's assets.

```ts
export const Opportunity = ObjectSchema.create({
  name: 'crm_opportunity',
  sharingModel: 'private',            // explicit, mandatory
  fields: { name: …, amount: …, stage: …, owner_id: … },
});

export const crmSalesUser = definePermissionSet({
  name: 'crm_sales_user',             // capability-shaped, not person-shaped
  objects: {
    crm_opportunity: { allowCreate: true, allowRead: true, allowEdit: true },
    crm_account:     { allowCreate: true, allowRead: true, allowEdit: true },
  },
  fields: { 'crm_opportunity.cost_internal': { readable: false } },
});

export const crmSalesManager = definePermissionSet({
  name: 'crm_sales_manager',          // add-on: only the manager DELTA
  objects: {
    crm_opportunity: { allowRead: true, allowEdit: true, allowTransfer: true,
                       readScope: 'unit_and_below' },
  },
});

export const crmReadonly = definePermissionSet({
  name: 'crm_readonly',
  isDefault: true,                    // a SUGGESTION consumed at install time, never auto-bound
  objects: { crm_account: { allowRead: true },
             crm_opportunity: { allowRead: true, readScope: 'unit' } },
});
```

Three developer disciplines:

- **Slice additively**: add-on sets carry only the delta; composition happens at the position.
- **Isolate dangerous capability** (`crm_export`, `crm_purge`) into their own small sets so customers
  can target them precisely.
- **Restrict by not granting**: in a union model a `readable: false` cannot defeat another set's
  `true`. There are no subtraction sets — to withhold, don't grant.

On install, `bootstrapDeclaredPermissions` seeds these rows with `packageId` +
`managedBy: 'package'`; upgrades re-seed **only** those rows. Customer-authored sets and all
bindings are never touched — that provenance line *is* the package/platform isolation boundary.

### What the admin configures after install

1. **Org, once** — build the BU tree, import users with `manager_id`.
2. **Positions** — create flat positions and bind package sets like bricks:
   `sales_rep` ← 📦 crm_sales_user; `sales_manager` ← 📦 crm_sales_user + 📦 crm_sales_manager;
   `sales_ops` ← 📦 crm_readonly + 📦 crm_export + ✏️ ops_extra.
3. **Defaults** — accept (or decline) the install prompt binding `crm_readonly` to **`everyone`**.
4. **OWD check** — the Studio object-settings control shows each object's sharing model; private
   opportunities, public-read accounts.
5. **Widen / narrow as needed** — sharing rules for cross-BU access; manual shares and team receipts
   for deal-level collaboration; RLS for hard dimension walls ("only my legal entity's rows").
6. **Verify** — the "view as" simulator confirms a rep sees only their own opportunities and never
   `cost_internal`; a manager sees the unit's.

New-hire onboarding thereafter is two assignments: a BU and a position.

## 5. Defaults for new users — the `everyone` position

- Built-in, undeletable; every authenticated member belongs implicitly.
- "New-user defaults" ≡ "sets bound to `everyone`" — same tables, UI, audit, and explain path as
  any other grant. There is no separate defaults mechanism.
- **Resolved per-request** (never materialized): binding applies to existing users instantly;
  package uninstall revokes instantly; no ghost grants, and no "fallback cliff" (the baseline is
  additive — receiving your first explicit grant does not cost you the baseline).
- Multiple packages compose naturally: each ships one small self-service set (`crm_readonly`,
  `hr_employee_self`, `helpdesk_requester`); `everyone` holds their union.
- Lint hard-blocks high-privilege bits (VAMA, delete/purge/transfer, system permissions) on any set
  bound to `everyone`.

`everyone` has an anonymous sibling: the built-in **`guest`** position (ADR-0090 D9). Visitors who
are not logged in hold `guest` and nothing else. Its bindings face the strictest checks — named
objects only, read-only by default (create allowed case-by-case, e.g. a public ticket form), never
a wildcard, never a sensitive field. Rule of thumb: **the guest position decides which *kinds* of
things anonymous visitors may reach; share links decide which *individual records*.**

There is deliberately **no "admin" anchor**: platform admins already reach every new package's
objects through the superuser wildcard, and an app's admin capability (e.g. `crm_admin`) is an
ordinary package set the customer binds to whichever position *they* decide runs that app.

## 6. AI-authoring safety

All of this metadata may be AI-drafted. The defense is layered, and every layer depends on grants
being **structured data**:

1. **A small, closed vocabulary** — 5 concepts, 4 OWD values, no aliases, banned words: the error
   space is shrunk before any checker runs. Strict authoring (rejects, never lenient-parses).
2. **Publish linter** (security domain, landed in P3 as `validateSecurityPosture` in
   `@objectstack/lint`, gating `os compile`): unset OWD, retired OWD aliases, external dial wider
   than internal, non-admin superuser wildcards, high-privilege everyone-suggested sets, forbidden
   vocabulary — each rule traceable to an observed failure class and mirrored by a runtime gate.
3. **Access-matrix snapshot** (landed in P4 as `buildAccessMatrix`/`diffAccessMatrix` in
   `@objectstack/lint`, gating `os compile` when `access-matrix.json` is committed): the
   (permission set × object) matrix is derived purely from metadata and diffed on every build; an
   unchanged matrix auto-passes, a changed one FAILS the build with the *semantic* impact
   ("`crm_admin` gains delete on `crm_lead`", depth changes, OWD swings) until the snapshot is
   re-generated with `--update-access-matrix` — the snapshot's git diff is the review artifact.
   The runtime side is the **explain engine** (P4, `security` service `explain(request)`): the
   nine-layer pipeline reported per-layer with contributor attribution, walking the same code the
   middleware enforces with — explained by construction.
4. **Tiered human gates**: AI drafts anything; publishing security-domain metadata requires human
   approval of that semantic diff. Non-security metadata auto-publishes.
5. **Fail-closed runtime** (ADR-0049/#2565 posture) + post-publish telemetry as the last parachute.

## 7. If you come from…

| You know | Map to ObjectStack |
|---|---|
| **Salesforce** | Permission Set ≈ permission set · Role hierarchy → **business units** · Profile → *(removed; `everyone` + positions)* · OWD/sharing rules ≈ same words, same semantics (incl. internal/external defaults ≈ `sharingModel`/`externalSharingModel`) · PSG ≈ position · Delegated admin ≈ admin scope |
| **Dataverse** | Security Role ≈ permission set · BU ≈ BU · access level/depth ≈ `readScope`/`writeScope` (object-level, deliberately coarser) · owner teams → **not replicated** (teams receive only) |
| **ServiceNow** | Group → position · Role → permission set · ACL scripts → OWD/sharing declaratively, RLS for the rest |
| **SAP** | Composite role ≈ position · Authorization object ≈ permission set entries · Org levels → BU depth + (future) dimension restrictions |
| **AWS IAM** | Policy ≈ permission set · Policy attachment ≈ position binding · Policy Simulator ≈ the explain engine |

## 8. Why a vocabulary instead of raw RBAC + RLS

The engine *is* RBAC + row predicates under the hood — the vocabulary is a domain language that
compiles to them. Hand-authored RBAC/RLS was rejected as the *authoring* surface because:

- predicates are code, and the platform's authors are admins and AI, not developers;
- static predicates cannot express dynamic per-record collaboration (you would rebuild
  `sys_record_share` ad hoc);
- pure RBAC has no data-scope axis and explodes combinatorially (capability × territory);
- a predicate pile can be neither explained, linted, nor snapshot-diffed — every AI-safety layer
  above dies with it.

RLS remains in the model precisely once, as the expert escape hatch for the ~5% of cases (dimension
walls, compliance) the vocabulary does not cover — never as the primary authoring surface.

## 9. Who is calling — people, AI agents, services, guests, external users

Every request carries a **principal** — who (or what) is asking. Five kinds, in plain terms:

| Kind | Plain description | What they run on |
|---|---|---|
| **human** (internal) | an employee, logged in | their positions' sets, full pipeline |
| **human** (external) | a partner/customer in a portal | own records + explicit shares + the object's **external** OWD dial; BU depth doesn't apply (they're not in your org tree) |
| **agent** | an AI assistant acting *for* someone | the **overlap** of two badges — see below |
| **service** | a system integration (API key) | its own small, fixed set of grants; can't log in interactively; audited separately. Exists so nobody wires an integration through a real admin account |
| **guest** | an anonymous visitor | the `guest` position's bindings, nothing else |

**The agent rule, in one sentence:** when 张三's AI assistant does something, it may only do what
**both** the assistant is allowed to do **and** 张三 is allowed to do — the overlap, never the
union. Why: if an assistant with big permissions simply obeyed whoever prompts it, any intern
could ask it to fetch the CEO's records. The overlap rule makes that structurally impossible.

Three more agent guardrails:

1. **Ceiling** — sets held by agents may never contain super-user bits (View/Modify All, purge,
   transfer, system permissions). Lint rejects the binding, not the request.
2. **Human co-sign for destructive actions** — an agent may *start* a deletion or mass change,
   but a human must confirm it, regardless of grants.
3. **Double signature in the audit log** — every agent write records both "performed by:
   assistant-X" and "on behalf of: 张三", plus the run that did it.

## 10. Running a large organization

**Delegated administration** (ADR-0090 D12). A group with fifty subsidiaries cannot manage every
grant from headquarters — but handing each subsidiary a full admin is worse. So *administration
itself is a scoped grant*. Example: the 华东 subsidiary's IT admin receives an **admin scope**
that says:

- *where*: the 华东 business-unit subtree only;
- *what*: assign users to positions, bind sets to positions — inside that subtree;
- *which*: an **allowlist** of sets they may hand out (say, the CRM and HR self-service sets).

They can onboard their own staff and reshuffle their own positions, but they can never grant
anything outside the allowlist — **including to themselves** — and can never touch tenant-level
things (the `everyone`/`guest` anchors, security publishes). Headquarters keeps one dashboard:
the same explain engine answers "who *could have* granted this", not just "who did".

**How it is authored (landed in P3).** An admin scope is a field on an ordinary permission set
(`adminScope: { businessUnit, includeSubtree, manageAssignments, manageBindings,
authorEnvironmentSets, assignablePermissionSets[] }`), so it is distributed via positions and
audited like every other grant. The same set should also carry plain CRUD on the RBAC link
tables (`sys_user_position`, `sys_position_permission_set`, `sys_user_permission_set`) — the
scope authorizes *what* may be administered, the CRUD bits let the requests through at all.
Runtime rules enforced by the `DelegatedAdminGate` (plugin-security):

- assignments a delegate creates must be **anchored** (`sys_user_position.business_unit_id`)
  inside their subtree, and are `granted_by`-stamped automatically;
- every set reached by the write — bound to the assigned position, or granted directly — must be
  in the allowlist; re-composing a position (bindings) requires every current holder to sit
  inside the subtree;
- granting or authoring a set that itself carries an `adminScope` requires a held scope that
  **strictly contains** it (handing your own exact scope to a peer is refused — no lateral
  propagation);
- delegates write **single rows by id** only (a broad filter-write cannot be boundary-checked);
- holders of plain CRUD on the RBAC tables with **no** scope are refused: administration is a
  scoped capability now, not a side effect of table access.

Planned next (tracked as follow-up ADRs, not yet in the model): **expiring grants** (contractor
access that ends on a date, stand-in approvers during vacations, break-glass access that
auto-revokes), **separation-of-duties rules** ("the person who creates vendors must not also
approve payments"), and **environment promotion tooling** (compare/copy permission config across
dev → test → prod).

## 11. Glossary & naming rules

- **permission set** — the only capability container. Never called a role.
- **position** — flat distribution group (岗位). Machine names: `sys_position`,
  `sys_user_position`, `sys_position_permission_set`, `ctx.positions[]`, `current_user.position`.
- **business unit** — the one and only hierarchy. Depth vocabulary: `own`, `own_and_reports`,
  `unit`, `unit_and_below`, `org`.
- **team** — flat, receives shares, carries nothing.
- **everyone** — the built-in baseline position for authenticated members.
- **guest** — the built-in position anonymous visitors hold; strictest lint tier.
- **principal** — who is calling: `human | agent | service | guest | system`, with
  `audience: internal | external` and an optional `onBehalfOf` delegation link.
- **admin scope** — a delegated-administration grant: a BU subtree + the actions allowed there +
  an allowlist of assignable sets; self-escalation is structurally impossible.
- **OWD / `sharingModel`** — `private` · `public_read` · `public_read_write` ·
  `controlled_by_parent`. Nothing else parses. Optional `externalSharingModel` is the stricter
  dial for external (portal/partner) users; defaults to `private`, never wider than internal.
- **role** — reserved-forbidden word (lint-enforced). Sole exception: better-auth's internal
  `sys_member.role`, projected as `org_membership_level`.
