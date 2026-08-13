# ADR-0086: Authorization metadata↔config boundary + cross-package composition — DEFINITION travels, ASSIGNMENT stays, packages ship their own sets

**Status**: Accepted (2026-07-04) — **substantially implemented**; parts refined/superseded by [ADR-0090](./0090-permission-model-v2-concept-convergence.md) and [ADR-0094](./0094-sys-permission-set-pure-projection.md). See the **Re-evaluation (2026-07-16)** addendum for the current, code-grounded status of every decision.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0066](./0066-unified-authorization-model.md) (three-way separation: Capability / Assignment / Requirement — this ADR operationalizes its **D5** for the packaging axis), [ADR-0056](./0056-permission-model-landing-verification.md) (whole-model enforce/prove; **D7** app-declared default profile), [ADR-0057](./0057-erp-authorization-core-business-units-and-scope-depth.md) (`readScope`/`writeScope` depth), [ADR-0005](./0005-metadata-customization-overlay.md) (per-org overlay = the subtract/adjust layer), [ADR-0028](./0028-metadata-naming-and-namespace-isolation.md) / [ADR-0048](./0048-cross-package-metadata-collision.md) (namespaced api names = collision-proof keys), [ADR-0078](./0078-no-silently-inert-metadata.md) (no declarable-but-never-seeded metadata), [ADR-0016](./0016-studio-package-authoring-and-publish.md) / [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (draft/publish), [ADR-0084](./0084-application-builder-information-architecture.md) (Access pillar = matrix; defers composition), [ADR-0025](./0025-plugin-package-distribution.md) (manifest `permissions` = install-consent scopes, **not** RBAC grants), [ADR-0003](./0003-package-as-first-class-citizen.md) / [ADR-0070](./0070-package-first-authoring.md) (package-first), [ADR-0006](./0006-project-environment-split.v4.md) (environment split)
**Consumers**: `@objectstack/spec` (`security/permission.zod.ts`, `stack.zod.ts`, `system/metadata-persistence.zod.ts`), `@objectstack/plugin-security` (`bootstrap-declared-*`, `permission-evaluator`), `@objectstack/core` (`resolve-authz-context`), `@objectstack/metadata` (overlay), `../objectui` (`AccessPillar`, `PermissionMatrixEditor`, `metadata-admin`)
**Surfaced by**: [objectui#2196](https://github.com/objectstack-ai/objectui/issues/2196) — the Studio **Access** pillar, opened inside a *package* design surface (`/studio/:packageId/access`), lists **all** of the environment's objects ("84 objects") and edits **environment-level** permission sets live, with no package scope and no composition story. Same class of bug the Interfaces pillar just fixed ([objectui#2197](https://github.com/objectstack-ai/objectui/issues/2197)).

---

## TL;DR

The platform has never drawn a **model-wide** line between the authorization primitives
that are **package metadata** (versioned, shipped with a package, draft/published, portable
across environments) and those that are **environment / system-admin configuration** (edited
live, environment-specific, bound to real users/orgs) — and it has no story for **how grants
from several installed packages compose** into one user's effective access.

This ADR draws that line and fixes it to the near-universal mainstream invariant, already
half-named by ADR-0066: **authorization DEFINITIONS travel with the app (metadata);
SUBJECT bindings and environment-specific values stay as environment config/data** — with an
overlay/subtract layer (ADR-0005; Salesforce *muting*; Dataverse layering) so a subscriber
environment can adjust a packaged definition **without forking it**.

Three decisions follow:

1. **Classification (Q1/Q2).** Every primitive lands as **metadata**, **config**, or
   **hybrid** on the DEFINITION↔ASSIGNMENT axis. The boundary is **already expressible** with
   the existing `metadata-persistence.managedBy: 'package' | 'platform' | 'user'` provenance
   axis on each permission-set record — `package` ⇒ metadata (versioned, draft/publish);
   `platform`/`user` ⇒ config (env-admin, live). We populate and gate on it; we do **not**
   invent a third axis (Prime Directive #8).
2. **Composition (Q3/Q4).** A package ships **its own** permission sets (Salesforce
   managed-package shape — **Shape B**), `managedBy:'package'` + owning `packageId`, seeded on
   install by a new **`bootstrapDeclaredPermissions`** (the missing sibling of
   `bootstrapDeclaredRoles`) that finally migrates the already-declarable
   `stack.permissions` into `sys_permission_set`. Runtime composes by the **existing
   most-permissive UNION** across a user's assigned sets, conflict-free because object api
   names are package-namespaced. Cross-package assembly into one *shared* set (**Shape A**) is
   retained strictly as an **environment-admin** convenience, never something a package writes.
3. **Governance & two doors (Q5/Q6).** Because a package's own access is **metadata**, the
   **package** Access pillar edits only that package's object slice and flows through
   **draft/publish** (like Data/Interface). The **environment-admin** door keeps the
   cross-package all-objects matrix **and** the assignment UI, edited **live** (config). Two
   doors, one metadata.

This is a design/ADR; the code lands in three independently-shippable phases (P0 objectui
scope-fix, P1 framework `bootstrapDeclaredPermissions`, P2 two-door + overlay).

---

## Context

### The trigger, and why it is not a one-off

The Access pillar renders `<AccessPillar/>` with **zero props**, so it never receives the
route's `packageId` (`objectui StudioDesignSurface.tsx:589`). Its matrix loads **all** objects
via `client.list('object')` with no filter (`PermissionMatrixEditor.tsx:171`) — the "84
objects" — and **saves the whole permission-set record**, including its full `objects` dict
(`:289`). Every other pillar already scopes by `client.list('object', { packageId })`
(Interfaces `:822`, Data `:1377`); Access simply never got the same treatment. So the surface
is doing three wrong things at once: it edits an **environment-level** thing from a **package**
door, with **no package scope**, and **no composition model** to say what "the package's
access" even means. The last one is the actual gap — the UI can't be scoped correctly until
the model says which permission bits belong to the package and which to the environment.

### What is already true (grounded, verified — not re-derived)

- **Permission sets are environment-level today, with no owning-package field.**
  `sys_permission_set` is `managedBy: 'config'` on the object-affordance axis
  (`plugin-security/objects/sys-permission-set.object.ts:20`); `PermissionSetSchema`
  (`spec/security/permission.zod.ts:108`) has **no `packageId`**. Grants live **inline as flat
  dicts** on the record: `objects: Record<name, ObjectPermission>` (`:120`) and
  `fields: Record<"object.field", FieldPermission>` (`:122`). **One record holds every
  package's grants.**
- **Object api names are package-namespaced and collision-proof** (`crm_account`, `todo_task`);
  the prefixed name is the physical table name, so two packages cannot collide
  (`manifest.zod.ts:142-179`). ⭐ *This is what makes cross-package composition conflict-free at
  the key level* — a package's grants are exactly the `objects.<namespace>_*` keys.
- **Runtime resolution is a most-permissive UNION** across a user's assigned sets
  (`permission-evaluator.ts:64-101`, `'*'` wildcard fallback `:40`); assignment resolution
  user→roles→sets→union in `core/security/resolve-authz-context.ts:84-252`.
- **No package-shipped access exists.** `bootstrapDeclaredRoles` seeds a package manifest's
  `roles` into `sys_role` (`bootstrap-declared-roles.ts:61`), but there is **no
  `bootstrapDeclaredPermissions`**. `stack.permissions: PermissionSetSchema[]`
  (`stack.zod.ts:235`, "Permission Sets and Profiles") is **declarable but never migrated**
  into `sys_permission_set`. The manifest's `permissions` field (`manifest.zod.ts:264`) is
  **plugin install-consent scopes** (ADR-0025), *not* RBAC grants. → **a package cannot ship
  default access for its own objects, and the metadata it *can* declare is silently inert** —
  a live ADR-0078 violation. (ADR-0066 **D5** named this "gap to close"; this ADR closes it.)
- **The vocabulary for the boundary already exists** — two `managedBy` axes:
  provenance/layer `managedBy: 'package' | 'platform' | 'user'`
  (`metadata-persistence.zod.ts:72`) and the object CRUD-affordance bucket
  `'platform' | 'config' | 'system' | 'append-only' | 'better-auth'` (`object.zod.ts:408`).
  We build on the **provenance** axis, not a parallel one.

### Governing precedent (do not re-litigate)

ADR-0066 already split authorization into **Capability** (definition), **Assignment** (who
holds it — runtime records), **Requirement** (resource→capability contract), with the rule *"a
resource declares the capability it requires (a stable contract); the capability and its
assignment are dynamic, admin-maintained records."* This ADR does **not** re-open that split;
it applies it to the **packaging & composition** dimension (which side of the metadata↔config
line each primitive sits on, and how packages assemble) that 0066 left as D5.

---

## The mainstream invariant (confirmed)

Every established metadata-driven / low-code platform draws the *same* line, and it is exactly
the DEFINITION↔ASSIGNMENT split:

| Platform | DEFINITION = packaged metadata | ASSIGNMENT / env value = data | Subtract/adjust without forking |
|---|---|---|---|
| **Salesforce** | Permission sets, permission-set **groups**, (legacy) profiles = Metadata API components; travel in managed/unmanaged packages. FLS + object CRUD ride the permission set. | User↔permission-set assignment = **org data, never packaged**. | **Muting** permission sets — a subscriber subtracts from a managed set without editing it. |
| **ServiceNow** | Scoped apps + update sets carry **ACLs and roles** (`sys_scope`). | `sys_user_has_role` (user↔role) = **instance data**. | Scope isolation + overrides. |
| **Power Platform / Dataverse** | **Solutions** carry **security roles** as metadata. | Team/user role assignment = data; env-specific values externalized via **environment variables** + **connection references** (never baked into packaged metadata). | Managed/unmanaged **solution layering**. |
| **OutSystems / Mendix** | Module/app **roles** deploy with the app. | User→role mapping = runtime/admin. | Per-env config. |

**Invariant to adopt:** *definitions travel with the app; subject bindings and
environment-specific values stay as environment config/data; an overlay/subtract mechanism lets
a subscriber adjust packaged definitions without forking them.* ObjectStack already has all
three ingredients (namespaced definitions, runtime RBAC records, ADR-0005 overlay) — they were
just never wired for authorization packaging.

---

## Decision

### D1 — The classification (Q1) — one axis: DEFINITION (metadata) ↔ ASSIGNMENT (config)

Each primitive lands as **metadata** (travels with the package; versioned; draft/publish),
**config** (environment-specific; live; binds real subjects), or **hybrid** (a metadata *shape*
that references a concrete subject — split it: shape = metadata, binding = config). The class is
recorded on the record's **`managedBy` provenance** (`package` ⇒ metadata; `platform`/`user` ⇒
config), not a new field.

| Primitive | Class | Rationale (one line) | Precedent |
|---|---|---|---|
| **Role** (definition) | **metadata** | A named capability bundle the app ships. | SF role · SN role in scope · Dataverse role in solution · OutSystems module role |
| **Role hierarchy `parent`** | **hybrid** | The *shape* (A reports to B) ships; when nodes bind a tenant's real org-unit tree that binding is config. | SF role hierarchy (metadata) vs the org's actual users (data) |
| **PermissionSet / Profile** (definition) | **metadata** | The grant bundle is packageable content. | SF permission set / profile = Metadata API components |
| **ObjectPermission** grant | **metadata** | Part of the set definition — **for the package's own objects only**. | SF object CRUD rides the permission set |
| **FieldPermission (FLS)** | **metadata** | Rides the set; own fields only. | SF FLS on the permission set |
| **`systemPermissions` / capabilities** | **metadata** | Capability *definitions* (ADR-0066 D1 registry). | SF Custom Permissions |
| **`tabPermissions`** | **metadata** | UI-surface grant riding the set. | SF tab visibility on profile/set |
| **RLS policy** (`using`/`check`) | **metadata** | A behavioural predicate shipped with the object. | SF sharing / Odoo record rules deploy with the app |
| **Sharing rule** | **hybrid** | Rule shape = metadata; recipients naming a real team/queue = config. | SF sharing rule (metadata) recipients resolve to org data |
| **OWD / `object.sharingModel`** | **metadata** (package default) → env may **tighten** via overlay | The object ships a default posture; the environment can only make it *stricter*. | Dataverse org-wide defaults; SF OWD (env tightens) |
| **Package secure-default posture** (`access.default:'private'`, ADR-0066 D2) | **metadata** | A data-model posture on the object, ships with it. | SF "new object = no access until granted" |
| **Permission-set / role ASSIGNMENT** (`sys_user_permission_set`, `sys_role_permission_set`) | **config / data** | Binds a **real** user/team — the universal line. | SF assignment = org data, never packaged · SN `sys_user_has_role` = instance data |
| **Organization / tenancy** | **config / data** | Real tenants of the environment. | every platform |
| **Actual users / teams** | **data** | Runtime subjects. | every platform |

### D2 — The DEFINITION↔ASSIGNMENT principle (Q2), stated

> **Authorization *definitions* are metadata; *subject bindings* are environment data.**
> A permission set / role / RLS policy *defines* what some abstract holder may do — it ships,
> versions, and publishes with the package. *Which real user or team holds it* is an
> environment record an admin maintains at runtime. A definition **never bakes "who"**; it only
> declares "what a holder can do".

**Exceptions are the `hybrid` rows, and they are resolved by *splitting*, not by moving the
whole primitive to config:** a sharing rule's *shape* is metadata but its *recipient that names
a real team* is config; a role hierarchy's *structure* is metadata but its *binding to the
tenant's org-unit tree* is config. This is exactly the split ADR-0066 already made for
capabilities (definition = metadata, assignment = admin record). No primitive is *wholly*
hybrid — each decomposes into a metadata shape + a config binding.

### D3 — A permission set carries its owning package (`packageId` + `managedBy` provenance) [spec]

Add to `PermissionSetSchema` (and persist on `sys_permission_set`):

- `packageId?: string` — the owning package for a package-shipped set (absent ⇒ env-authored).
- Populate the **provenance** `managedBy: 'package' | 'platform' | 'user'` on every
  permission-set *record* (distinct from the table's object-affordance `managedBy:'config'`,
  which stays — the table still *accepts* admin rows; the per-record provenance says whether a
  given row is package metadata or env config).

This is the single spec change that makes the boundary **machine-checkable**: a record with
`managedBy:'package'` is versioned metadata (draft/publish, upgrade-owned, read-mostly for
admins per ADR-0010); `platform`/`user` is env config (live). It also makes package **uninstall**
well-defined (remove the package's own sets) — impossible today when one shared record holds
everyone's grants.

### D4 — Composition shape (Q3): package-owned sets (Shape B); shared slices stay env-only

**Chosen: Shape B — a package ships its own permission sets** (`crm_sales_rep`,
`todo_member`), namespaced, `managedBy:'package'` + `packageId`. The environment admin assigns
one or more to a role/user; the **runtime unions** them (existing most-permissive semantics),
conflict-free because each set only grants `objects.<own-namespace>_*` keys.

**Shape A** — one shared "Contributor" set into which packages write disjoint object slices —
is **retained only as an environment-admin construct** (the admin's own `managedBy:'platform'`
set, into which they may hand-pick grants across packages). **A package never writes into a
shared/foreign record.** Rejecting package-writes-shared-slice avoids: the objectui **data-loss
trap** (naively saving "the rendered rows" deletes other packages' grants — issue Q3.A),
coupling a package upgrade to a mutable shared row, and an undefined uninstall. Salesforce
managed packages are Shape B for exactly these reasons; ADR-0005 overlay + Salesforce-style
**muting** is how a subscriber *adjusts* a packaged set without forking it (the subtract layer),
so Shape B loses no flexibility.

Runtime composition semantics (unchanged, now stated as the contract): **grants UNION
most-permissively across all of a user's assigned sets; keys never collide because object api
names are package-namespaced; the flattened per-user effective grant is served at
`GET /api/v1/auth/me/permissions` (`objectui MePermissionsProvider.tsx:56`).** Precedence with
AND-gates (`private` posture, `requiredPermissions`) and RLS OR/AND is per ADR-0066's
*Precedence / combination semantics* — this ADR does not change it.

### D5 — Packages ship working default access (Q4): `bootstrapDeclaredPermissions` [bootstrap]

Installing a package **should** grant working default access to **its own** objects.
Implement `bootstrapDeclaredPermissions` — the exact sibling of `bootstrapDeclaredRoles`
(`plugin-security/security-plugin.ts:719`) — that migrates `stack.permissions`
(`stack.zod.ts:235`) into `sys_permission_set` as `managedBy:'package'` + `packageId`,
**idempotently** and **upgrade-aware** (re-seed the package's own slice on version bump; never
clobber env-authored `platform`/`user` sets). This:

- **closes the ADR-0078 inert-metadata violation** (a declarable `permissions[]` that is never
  seeded is precisely the smell 0078 prohibits);
- seeds a **package-owned set** (Shape B / D4), not a slice into a shared set;
- respects the **least-privilege floor** — the package chooses its default grants; the platform
  `member_default` remains the floor (ADR-0056 D7 default-profile is the env-level counterpart:
  packages ship *their* defaults, the environment declares *its* default profile).

The manifest `permissions` install-consent field (ADR-0025) is **untouched and unrelated** —
consent scopes are not RBAC grants; do not conflate them.

### D6 — Governance (Q5): the package Access door is draft/published metadata

Because a package's own access is **metadata** (D1/D3), editing it in the **package** Access
pillar flows through **package draft/publish** (ADR-0016/0033), exactly like Data and
Interfaces — not "saves the ACTIVE item directly". The #2196 banner ("permissions are
platform-level … saves the active item directly") is **correct for the environment-admin door**
and **wrong for the package door**; the fix is to *relocate* the live-save behaviour to the
env-admin door, and put the package door under draft/publish.

### D7 — Two doors, one metadata (Q6)

| Door | Scope | Edits | Governance |
|---|---|---|---|
| **Package** Access pillar (`/studio/:packageId/access`) | **this package's own object slice** (`objects.<namespace>_*`, own fields, own sets) | package permission-set **definitions** (metadata) | **draft → publish** (D6) |
| **Environment admin** (`metadata-admin`) | **cross-package** all-objects matrix **+** assignment (`sys_user_permission_set`, `sys_role_permission_set`) | env config: shared sets (Shape A), overlay/mute of packaged sets, subject bindings | **live** (config) |

This is builder-ui §3.5 "two doors, one metadata": the package door is the scoped,
version-controlled authoring view; the env-admin door is the cross-cutting, live operational
view. The same underlying `sys_permission_set` / assignment records are reached from both, but
each door only writes what it owns.

---

## Change list (phased — each phase independently shippable)

### P0 — objectui, low-risk (closes the leak + the data-loss trap) — mirrors objectui#2197
- Pass the route `packageId` into `<AccessPillar/>` (`StudioDesignSurface.tsx:589`).
- Scope the matrix rows to `client.list('object', { packageId })` (`PermissionMatrixEditor.tsx:171`)
  and fields likewise (`:208`) — render **only this package's object rows**.
- **Slice-merge on save** (`:289`): persist `{ ...original.objects, ...editedPackageKeys }` so
  editing the package's slice **never deletes other packages' grants** from the shared record.
  The namespaced keys make the package's slice unambiguous.
- Keep the left rail global (permission sets are still env-level under the current model).
- *Ships against today's shared-record model; no framework change required.*

### P1 — framework (packages ship default access) — per D3/D4/D5
- `PermissionSetSchema.packageId` + per-record provenance `managedBy` (D3); migration for
  `sys_permission_set`.
- `bootstrapDeclaredPermissions` seeding `stack.permissions` → `sys_permission_set`
  (`managedBy:'package'`, idempotent, upgrade-aware) (D5). Closes ADR-0078 for this surface.
- Add a **liveness / conformance** row (ADR-0056 D10 matrix) asserting `stack.permissions` is
  now *seeded and enforced*, so it can never silently regress to inert again.

### P2 — the two doors + subtract layer — per D6/D7
- Environment-admin surface owns the cross-package all-objects matrix **and** the assignment UI
  (config, live).
- Package Access door edits only the package slice, under **draft/publish**.
- Overlay/subtract: an environment adjusts a packaged set via ADR-0005 overlay
  (Salesforce-muting-style subtract), never by forking — the precedence-step-4 explicit-deny
  layer ADR-0066 deferred; gated on proven need.

---

## Consequences

**Positive.**
- One stated, mainstream-aligned line for the *whole* authz model (metadata vs config), encoded
  on an **existing** axis (`managedBy` provenance) — no parallel vocabulary (PD #8).
- Packages become **self-contained and upgrade/uninstall-safe**: a package ships, versions, and
  removes its own access; no shared mutable record entangles two packages.
- The objectui object-leak **and** the silent data-loss trap both close (P0), independent of the
  deeper model work.
- ADR-0078 inert-metadata violation on `stack.permissions` is closed (P1); ADR-0066 D5 is
  operationalized rather than left aspirational.
- Cross-package composition is **conflict-free by construction** (namespacing + union), and now
  *specified* rather than incidental.

**Negative / cost.**
- Spec change (`packageId` + provenance) + a `sys_permission_set` migration; must backfill
  existing rows (hardcoded platform defaults → `managedBy:'platform'`).
- The package Access door gains a draft/publish lifecycle it did not have — more UI surface, but
  consistent with every other pillar.
- Shape B means "package default access" is a *new* set to assign, not automatic membership; the
  environment still decides who gets it (correct, but one more admin step than a shared slice).

**Neutral / open.**
- Whether OWD/`sharingModel` env-tightening rides the same overlay path as view overlays
  (ADR-0005 whitelist currently marks `security` types **not** org-overridable) — resolved in
  the P2 overlay/subtract PR, not here.
- Permission-set **groups** (ADR-0066 ⑦) as the bundling primitive over Shape-B sets — deferred,
  evidence-gated.

## Non-goals

- **Not** re-opening ADR-0066's Capability/Assignment/Requirement split — this ADR sits on top
  of it.
- **Not** changing runtime enforcement, RLS compilation, or precedence (ADR-0056/0066 own those).
- **Not** designing permission-set groups or delegated admin (deferred).
- **Not** touching the manifest install-consent `permissions` field (ADR-0025) — orthogonal.
- **Not** making `security` metadata org-overridable by default (ADR-0005 keeps it global; the
  subtract layer is an explicit, gated P2 mechanism).

## Alternatives considered

- **(A) Shape A — packages write disjoint slices into one shared "Contributor" set.** Rejected as
  the *packaging* primitive: it is the data-loss trap (issue Q3.A), couples package upgrade to a
  shared mutable row, has no clean uninstall, and requires every editor forever to honour the
  slice invariant. Kept only as an env-admin convenience where the admin owns the record.
- **(B) Leave `stack.permissions` inert, seed nothing.** Rejected — a live ADR-0078 violation and
  the reason a package cannot ship working access; ADR-0066 D5 already called it a gap.
- **(C) A new third `managedBy`-style axis for "authz metadata vs config".** Rejected (PD #8) — the
  `metadata-persistence.managedBy` provenance axis already expresses exactly this; reuse it.
- **(D, chosen) Classify on the existing provenance axis + Shape-B packaging + two doors +
  overlay subtract**, delivered as P0/P1/P2.

## References

- ADR-0066 (unified authz — three-way separation, D5), ADR-0056 (landing verification — D7, D10
  conformance matrix), ADR-0057 (scope depth), ADR-0005 (overlay = subtract layer), ADR-0028 /
  ADR-0048 (namespace isolation), ADR-0078 (no inert metadata), ADR-0016 / ADR-0033
  (draft/publish), ADR-0084 + `docs/design/builder-ui.md` §7 & §3.5 (Access pillar; defers
  composition), ADR-0025 (manifest consent scopes ≠ grants), ADR-0010 (metadata protection).
- Framework: `spec/security/permission.zod.ts`, `spec/stack.zod.ts:235`,
  `spec/system/metadata-persistence.zod.ts:72`, `spec/data/object.zod.ts:408`,
  `spec/kernel/manifest.zod.ts:142-179,264`, `plugin-security/bootstrap-declared-roles.ts`,
  `plugin-security/default-permission-sets.ts`, `plugin-security/permission-evaluator.ts`,
  `core/security/resolve-authz-context.ts`, `dogfood/test/authz-conformance.matrix.ts`.
- objectui: `StudioDesignSurface.tsx` (`AccessPillar` `:589`, Interfaces `:822`, Data `:1377`),
  `metadata-admin/PermissionMatrixEditor.tsx` (`:171`, `:208`, `:289`),
  `permissions/MePermissionsProvider.tsx:56`.
- Related issues: objectui#2196 (trigger), objectui#2197 (Interfaces scope-fix template),
  framework#1828 (ADR-0048), #1892/#1893 (aspirational-metadata hygiene), #2377 (ADR-0049
  enforce-or-remove), #1883 (permission lifecycle ops ungated).
- **Lifecycle context**: this ADR covers the package-authoring/composition slice of the authz
  surface; the whole-lifecycle gap map (P0–P3, package dev → production) is tracked in
  umbrella issue #2561.

---

## Re-evaluation (2026-07-16) — code-grounded status; what landed, what later ADRs refined

This ADR was written the day issue #2557 opened (2026-07-04). In the two weeks since, its
whole plan **shipped**, and three later ADRs (0090, 0094, and — transitively — 0095) built on
top of it and refined two of its parts. This addendum re-grounds every decision against the
current code (HEAD 2026-07-16) so the ADR stops reading as an unimplemented proposal. **The
central thesis holds unchanged**: authorization *definitions* travel with the package
(metadata, on the `managedBy` provenance axis + `packageId`); *subject bindings* stay
environment config; cross-package grants compose conflict-free by the namespaced-key UNION.
Two mechanisms named in the original text have been overtaken by a better realization and are
flagged inline below.

### Status of each decision / phase

| Item | Status | Where it landed / how it changed |
|---|---|---|
| **D1** classification on the provenance axis | **Adopted**; table vocabulary now stale — see "revised table" below | Principle intact. Rows renamed/removed by ADR-0090 (Profile gone, role→position). |
| **D2** DEFINITION↔ASSIGNMENT principle | **Adopted, reinforced** | ADR-0090 D2 leans on it to justify removing Profile; ADR-0091 dates the *assignment* rows only (`valid_from`/`valid_until`), confirming they are env data. |
| **D3** `packageId` + provenance `managedBy` on the set | **Implemented** | `spec/security/permission.zod.ts:167` (`packageId`, tagged `[ADR-0086 D3]`) + `:178` (`managedBy` enum); record fields `package_id`/`managed_by`/`customized` + index on `sys-permission-set.object.ts:217-266`. |
| **D4** Shape B (packages ship own sets; union; shared slices env-only) | **Adopted, reinforced; subtract layer upgraded** | ADR-0090 D9 / Alt #6 reject package-written shared/builtin sets for the same reasons. Composition is now anchored at the **position** ("bind several packages' sets to one position"), ADR-0094 D5. **Subtract layer changed** — see ⚠️ below. |
| **D5** `bootstrapDeclaredPermissions` | **Implemented; `isDefault` semantics refined by ADR-0090 D5** | `plugin-security/src/bootstrap-declared-permissions.ts` (invoked at `kernel:ready`, `security-plugin.ts`); seeds `managed_by:'package'` + `package_id`, idempotent/upgrade-aware; closes the ADR-0078 inert-metadata smell the D5 header calls out. `isDefault` no longer means "profile fallback": app-level default sets **auto-bind to the `everyone` position**; package-level default sets materialize a `sys_audience_binding_suggestion` an admin confirms (new object). |
| **D6** package Access door under draft/publish | **Implemented** | objectui writes the package door as `mode:'draft', packageId` (`PermissionMatrixEditor.tsx`); env door stays live and, per ADR-0094 D3, that "live" save is itself redirected into a metadata overlay. |
| **D7** two doors | **Implemented; ADR-0094 D5's gate narrowing is RETIRED (D5-R, 2026-08-09)** | Package door edits the package slice (scoped, draft); env-admin door keeps the cross-package matrix + assignment (live). ADR-0094 D5 had narrowed the two-doors *gate* so that an env edit of a package set became a first-class overlay "not a flat 403" — **that narrowing is retired as of 2026-08-09 (see ADR-0094 D5-R)**: `permission` rolled back to `allowOrgOverride: false`, so an env edit of an artifact-backed set is refused with `403 not_overridable` and this ADR's original two-doors channel stands — edit the package and re-publish. What ADR-0094 left standing either way: the admin door can never **forge** package provenance, package-row lifecycle ops with no overlay translation stay refused, and a data-door "delete" of a packaged set degrades to a reset rather than removing it. |
| **P0** objectui scope + slice-merge | **Done** (objectui #2505/#2508) | `permission-slice.ts` + `mergePermissionSlice`; matrix loads `client.list('object', { packageId })`, fields lazy per-object; save re-reads a fresh layered record and merges only the package slice, byte-for-byte preserving other packages. ⚠️ realized against the ADR-0094 store — see below. |
| **P1** framework `packageId` + seeder | **Done** | = D3 + D5 above. |
| **P2** two doors + overlay/subtract | **Two doors done; the overlay subtract layer is RETIRED for `permission`** | Two doors shipped (D6/D7). The subtract layer had landed as an **ADR-0005 first-class overlay** (ADR-0094 D5) rather than the Salesforce-muting/explicit-deny path this ADR sketched — **retired 2026-08-09 (ADR-0094 D5-R)**, so for an artifact-backed set there is no overlay customization channel at all. The ADR-0066 precedence-step-4 explicit-deny layer remains deferred and **evidence-gated**; with the overlay channel withdrawn, a package set is customized by editing the package and re-publishing. |

### ⚠️ Two mechanisms in the original text are superseded by a better realization

1. **P0's "slice-merge the shared *data record*" premise → ADR-0094 projection + overlay.**
   The original Context/P0 assumed grants live inline on **one writable `sys_permission_set`
   record** and the fix was to slice-merge that record on save. **ADR-0094 relocated the
   authoritative store to the metadata layer**: the `sys_permission_set` row is now a **pure
   projection** written only by an awaited mutation projector, and every data-door write is
   redirected (write-through) into a metadata save/overlay. The data-loss trap this ADR
   worried about is now closed **structurally** (there is no second writable authority to
   clobber), and the shipped P0 correctly slice-merges the **layered effective** body, not a
   raw shared row. *Note the inline `objects`/`fields` dict shape survived — ADR-0094 moved
   the store, not the body shape — so this ADR's load-bearing claim that namespaced keys make
   a package's slice unambiguous still holds and underpins both slice-merge and overlay.*

2. **D4's "Salesforce muting / clone-to-customize" subtract layer → ADR-0005 whole-document
   overlay — ⛔ RETIRED 2026-08-09, see ADR-0094 D5-R.** ADR-0094 D5 (revised 2026-07-14) had
   made an environment overlay of a package-owned set a **first-class ADR-0005 customization**
   (overlay-wins, `managed_by: 'package'` + `package_id` preserved; a data-door "delete" an
   overlay reset to the shipped declaration), argued as strictly better than muting/forking
   because the customization kept receiving the vendor's baseline security tightenings and
   retained the code-vs-overlay diff. **That direction is retired.** #6483 / PR #6608 rolled
   `permission` back to `allowOrgOverride: false` (ADR-0005's security row: overlays of the
   authorization surface would create silent privilege drift), and ADR-0094 D5-R followed
   through: for a set whose definition ships as a code artifact the ADR-0005 overlay is no
   longer a customization channel of any kind, and the write is refused with `403
   not_overridable` at the moment it is made. **So this ADR's own D4/D7 answer stands
   unsuperseded** — customize a packaged set by editing the package and re-publishing. Two
   narrow carry-overs: a data-door "delete" of a packaged set still degrades to a reset (the
   env door can never remove a packaged definition), and `supportsOverlay: true` is unchanged,
   so a pre-rollback overlay row still merges overlay-wins at read time — legacy state to be
   lifted by an operator, not a supported channel. Sets authored through the data door, whose
   definition lives only in `sys_metadata`, ride the still-open `allowRuntimeCreate` tier;
   ADR-0094 D5-R records that tier as the surviving neighbour, explicitly **not** D5's
   successor (it edits one stored definition in place — no code-vs-overlay layering).

### D1 classification table — restated in current (ADR-0090) vocabulary

Superseding the D1 table only where vocabulary changed; the **class** column is unchanged
except where noted:

| Primitive (current name) | Class | What changed since 2026-07-04 |
|---|---|---|
| **Position** (was "Role") definition | **metadata** | Renamed `role`→`position` (ADR-0090 D3); "role" is now a reserved-forbidden word. |
| ~~Role hierarchy `parent`~~ | **removed** | Positions are **flat, no `parent`** (ADR-0090 D3); the visibility hierarchy is the **Business Unit tree** (ADR-0057), which carries its own metadata/config split. The old "hybrid parent" row no longer exists. |
| **PermissionSet** definition | **metadata** | **Profile removed** (ADR-0090 D2 — `isProfile` deleted); `permission_set` is the sole capability container. |
| ObjectPermission / FieldPermission / `systemPermissions` / `tabPermissions` | **metadata** | Unchanged — ride the set definition, own objects/fields only. |
| RLS policy / Sharing rule / OWD `sharingModel` | metadata / hybrid / metadata | Unchanged in class. `sharingModel` default flipped to `private` for custom objects (ADR-0090 D1) and gained `externalSharingModel` (D11). `sys_sharing_rule` is **record-authoritative** (seed-not-clobber), per the ADR-0094 addendum. |
| **`everyone` / `guest`** built-in positions | **config** (admin-confirmed) | NEW default-grant mechanism (ADR-0090 D5/D9) that replaces the `member_default` fallback + ADR-0056 D7 default-profile. Packages *suggest* bindings; admins confirm. High-privilege bits on `everyone`/`guest` are lint-blocked. |
| **Assignment** `sys_user_position` / `sys_position_permission_set` (was `sys_user_permission_set` / `sys_role_permission_set`) | **config / data** | Tables renamed (ADR-0090 D3); still the universal DEFINITION↔ASSIGNMENT line. ADR-0091 adds `valid_from`/`valid_until` — assignment is now *time-boxed* config. |
| Delegated-admin **`adminScope`** on a set | **metadata (definition) + config (grant)** | NEW (ADR-0090 D12): admin capability itself is scoped (BU subtree + assignable-set allowlist + no self-escalation); `authorEnvironmentSets` keeps package-managed rows publish-only per this ADR. |
| Organization / tenancy / actual users & teams | **config / data** | Unchanged. Tenancy is now an explicit kernel service (ADR-0093) and tenant isolation an always-first Layer 0 (ADR-0095). Teams *receive* sharing, never carry capability (ADR-0090 D8). |

### Net assessment

ADR-0086 is **done and correct**, not pending. Its provenance-axis classification and Shape-B
composition became the load-bearing assumption of the whole permission-model-v2 wave: ADR-0090
cites "ADR-0086 D3 made machine-checkable" as the reason Profile could be removed and
uninstall-by-`packageId` works; the companion `docs/design/permission-model.md` documents D3/D5
as the operative package/platform isolation boundary. The only corrections a reader needs are
(1) the two superseded *mechanisms* above (store = ADR-0094 projection/overlay, not a raw shared
record; subtract = ADR-0005 overlay, not muting) and (2) the ADR-0090 vocabulary (Position not
Role, no Profile, `everyone`/`guest`). No decision here was reversed. Remaining genuinely-open
items are the ones this ADR already marked deferred and evidence-gated: the ADR-0066 explicit-deny
precedence layer, permission-set **groups** as a bundling primitive over Shape-B sets, and
OWD/`sharingModel` env-tightening riding the overlay path (ADR-0005 still marks `security` types
non-org-overridable by default; ADR-0094's overlay is the explicit, gated exception).
