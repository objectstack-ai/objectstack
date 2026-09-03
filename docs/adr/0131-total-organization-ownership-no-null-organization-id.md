# ADR-0131: Organization ownership is total — no NULL `organization_id`, a platform organization owns deployment-level rows, and sharing is declared

**Status**: Proposed (2026-09-04) — awaiting the maintainer's hand-merge, which is itself the
acceptance act for a governed surface (Prime Directive #14). ⛔ Nothing below is settled until
this record merges; the implementation cards are cut **from** the merged ADR, never ahead of it.
**Deciders**: ObjectStack maintainer, 2026-09-03/04, live chat on
[#13564](https://github.com/objectstack-ai/objectstack/issues/13564), verbatim and untranslated —
first the premise: 「这个是很严肃的问题，平台自带的角色、岗位、权限集、系统元数据、设置项、通知模板。
这些不是从代码加载的元数据吗？理论上不需要写到数据库中啊，在单独多组织隔离模式下，我理解是使用需要墙的。」
then the principle this record implements: 「或者说我们数据库中，不应该有允许 org_id 为空的状况。」
and the approval to draft: 「认可这个方向，起草 ADR 和分阶段的卡」.
**Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (the metadata overlay whose
environment layer is keyed today by a NULL organization — amended by D4),
[ADR-0066](./0066-unified-authorization-model.md) D2 (`tenancy.enabled:false` as the platform-global
posture — kept, and given the single meaning "no tenant column" by D1),
[ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) D2/D5 (the membership reconciler; degraded
tenancy fails fast — the reason the measured leak's precondition is a refused boot today),
[ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) D1 (Layer 0, the strict tenant
wall this record makes agree with the driver by construction),
[ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) D2 (the `group` union scope
that the single computed scope of D6 generalizes),
[ADR-0120](./0120-unique-scope-vocabulary-and-null-safe-tenant-uniqueness.md) D3/D4/D7
(`COALESCE(organization_id, '__global__')`, the migration ceremony, and the 17.x → protocol 18
staging this record's D11 aligns with),
[ADR-0123](./0123-no-active-organization-session-semantics.md) D2–D4 ("no silent NULL stamping" for
the no-active-organization session — generalized by D7 to every writer in every posture),
[ADR-0049](./0049-no-unenforced-security-properties.md) (a declared shape that is not enforced is removed — the
posture D10's retirements follow), and the two censuses on #13564 (the 2026-08-31 write-side
reuse and the 2026-09-02 read-side ledger) that supplied the object-by-object inventory D8 consumes.
**Evidence**: #13564 (both ledgers and the 2026-09-03 cloud-side supplement),
[#10103](https://github.com/objectstack-ai/objectstack/issues/10103) (two implementations of one
predicate, the catalog reading zero under a wall), [#13491](https://github.com/objectstack-ai/objectstack/issues/13491)
(the tenant-audit control cut by object classification), [#2734](https://github.com/objectstack-ai/objectstack/issues/2734)
(why the NULL arm was added), [#12699](https://github.com/objectstack-ai/objectstack/issues/12699)
(the deployment-level platform-global declaration), [#14484](https://github.com/objectstack-ai/objectstack/issues/14484)
and [#14547](https://github.com/objectstack-ai/objectstack/issues/14547) (two live NULL-row defects
found while this record was being discussed), cloud#1232 / cloud#1239 (the measured cross-tenant
read of a credentials table through the NULL arm), cloud#1663 / cloud#1664 (the label-the-row repairs
and the control plane's wall). Every framework anchor below was re-verified against `origin/main`
`2514d49f3` while drafting; cloud anchors against `cloud` `main` `3856fbf7`.
**Consumers**: `@objectstack/spec` (`injected-system-columns.ts`, the org-scoping entitlement in
`tenancy-posture.ts`), `@objectstack/objectql` (`engine.ts` `buildDriverOptions`,
`tenancy/system-write-organization.ts`, `tenancy/platform-object-tenancy.ts`), every driver that
implements a tenant scope (`driver-sql` `applyTenantScope`, `driver-memory` and `driver-mongodb`
tenancy guards, `driver-turso`, `driver-sqlite-wasm`), `plugin-security` (`tenant-layer.ts`,
`per-organization-catalog.ts`, the five bootstrap seeders, `bootstrap-platform-admin.ts`),
`plugin-auth` (`ensure-default-organization.ts`), `@objectstack/core`
(`security/resolve-authz-context.ts`), `metadata-core` / `metadata-protocol` (the overlay),
`service-settings`, `plugin-email`, `plugin-sharing`, `plugin-audit`, `service-storage`,
`plugin-approvals`, `service-automation`, and — in their own repository — `cloud`'s control plane
(`control-plane-platform-global.ts`, `control-plane-org-scope-plugin.ts`, `migrations/org-id-backfill.ts`)
and `objectos-ee`.

---

## TL;DR

Today a NULL `organization_id` means two things at once: **"this row belongs to the platform"** and
**"whoever wrote this row forgot to say whose it is."** The database cannot tell them apart, so the
SQL driver's tenant predicate — `(organization_id = :tenant OR organization_id IS NULL)`, added by
#2734 so that seeded roles stay visible — hands a forgotten row to every tenant. cloud#1239 measured
exactly that on a credentials table.

This record makes NULL mean **nothing**:

- **D1** — `organization_id` is NOT NULL wherever it exists. An object whose rows have no tenant has
  **no column**, not a nullable one.
- **D2** — Every deployment has one **platform organization**, created before any seeder runs, in
  every posture. It is the owner of every deployment-level row.
- **D3** — The RBAC catalog is per-organization in every posture (`single` = one Default Organization).
- **D4** — Registries, templates, the settings global rung and the ADR-0005 environment layer are
  owned by the platform organization.
- **D5** — Whether tenants may read platform-organization rows of an object is a **declaration**, per
  object, per deployment — generalizing #12699.
- **D6** — Layer 0 and every driver consume **one** computed scope, so they cannot disagree (closes
  #10103's cause 1).
- **D7** — A write without a resolvable organization is **refused**, in every posture. ⛔ Nothing ever
  defaults to the platform organization.
- **D8** — Existing NULL rows get one of three fates — column dropped, platform-owned, or attributed to
  their real organization — loudly, per table, with no reaping and no guessing.
- **D9–D11** — Postures differ only in enforcement; the compatibility arms are retired when the data
  is clean; the constraint lands at protocol 18.

The two censuses on #13564 are not discarded by this record — they become its migration inventory.

---

## 1. Context

### 1.1 One column, two meanings

The SQL driver's read-side tenant chokepoint, `applyTenantScope`
(`packages/drivers/driver-sql/src/sql-driver.ts`), emits two arms with a NULL disjunct: the equality
arm `where(field, tenantId).orWhereNull(field)` and, under the `group` posture, the union arm
`whereIn(field, tenantIds).orWhereNull(field)`. Its own docblock states why:

> a NULL tenant column marks a GLOBAL/platform row (bootstrap-seeded positions and permission sets,
> business units, pre-org first-boot seeds). Such a row belongs to no OTHER tenant, so the
> cross-tenant wall must not hide it: with strict equality every tenant admin saw ZERO RBAC rows on a
> fresh deployment, because every platform row is org-less (#2734).

The rationale is true of the rows it names. It is also true of every row a writer forgot to stamp —
and the database holds both populations in the same NULL. cloud#1239 measured the consequence
end-to-end: an organization admin of tenant A read tenant B's `sys_environment_credential` rows
(`secret_ciphertext`, `encryption_key_id`) and `sys_package_installation` rows, because both objects
receive an injected `organization_id` that their raw-driver writers never populated, and the NULL arm
was the only wall standing on that deployment.

### 1.2 What the censuses established (#13564, two rounds)

1. **Whether the arm fires is a property of the caller, not the object.** `buildDriverOptions`
   (`packages/objectql/src/engine.ts`) threads `execCtx.tenantId` for every object that is not
   `tenancy.enabled:false` or federated. The dominant read shape in the platform namespace is a bare
   `{ isSystem: true }` context — no `tenantId`, therefore **no scoping at all** (over 100 sites across
   30 objects). The arm's live consumers are the internal `{ isSystem: true, tenantId }` passes.
2. **On a walled deployment running `plugin-security`, tenants already do not see NULL rows.**
   `computeTenantLayer0Filter` (`packages/plugins/plugin-security/src/tenant-layer.ts`) composes a
   strict `organization_id = :tenant`; ANDed over the driver's arm, the conjunction is the strict
   equality alone. This is #10103's symptom: on a real `isolated` deployment every principal listed
   zero positions, permission sets and sharing rules while the tables held rows.
3. **The measured leak ran on a degraded posture.** cloud's control plane requested `isolated` without
   mounting `@objectstack/organizations`; the posture resolved to `single`, Layer 0 was inert, and
   the arm was the only wall. Today that precondition is a refused boot in the framework
   ([ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) D5, escape hatch
   `OS_ALLOW_DEGRADED_TENANCY`), in `objectos-ee` (cloud#1020) and on the control plane (cloud#1664,
   `supportedPostures = ['isolated']`).
4. **The arm has more load-bearing dependents than the driver comment names.** Beyond `sys_position`'s
   authorization read (`resolve-authz-context.ts` §6a: organization-less rows "stay REACHABLE on
   purpose") and `per-organization-catalog.ts`'s residue detection ("depends on that arm being
   there"), the deployment-level platform-global declaration of #12699 disarms **only Layer 0**; the
   engine still threads `tenantId`, so a tenant's read of a declared-global object sees the
   deployment's NULL rows **through the arm**. cloud's control plane declares 32 such objects
   (`control-plane-platform-global.ts`) and pins their tenant reads in
   `unscoped-control-plane-tenant-wall.test.ts`. Neither census round could see this from inside
   the framework repository.
5. **The read-side ledger placed all 59 tenant-column platform objects**: 9 load-bearing, 12 accidental,
   38 undetermined in four named sub-groups — and the undetermined sub-groups are undetermined because
   NULL cannot say which meaning it carries. Two live producers surfaced while it was being written:
   every `sys_record_share` row lands NULL (#14484); a seeded `sys_business_unit` at NULL silently
   defeats sharing rules because a service open-coded the strict equality (#14547).

### 1.3 Two implementations of one predicate

#10103 named the structural defect: the wall's predicate exists twice — governed in the driver
(`check-tenant-chokepoint` re-derives that every read door routes through it) and ungoverned in
`plugin-security` — and they disagree on NULL. Every option on #13564 ("keep the arm and add rules
above it", "narrow it to declared-global objects", "switch on posture") keeps the two implementations
and keeps NULL as a meaning; each therefore reproduces one of the two failures (#10103's blank catalog
or cloud#1239's leak) on some path.

### 1.4 What already exists

The record is small because most of its parts are built:

- The open framework already bootstraps a **Default Organization** under `single`
  (`packages/plugins/plugin-auth/src/ensure-default-organization.ts`, slug `default`, system context,
  idempotent) — but on `kernel:ready`, **after** the seeders, which is why seeds land org-less
  (measured 1.3 s ahead of the first `sys_organization` on a fresh walled rig).
- Under a walled posture the RBAC catalog is **already per-organization** (#10103 Option C,
  `catalogIsPerOrganization(posture)` in `per-organization-catalog.ts`); the platform bucket there is
  "meant to be unreadable through the tenant wall" (cloud's own words).
- A system write with no organization is **already derived** when exactly one organization exists and
  **refused** on a walled posture (`resolveSystemInsertOrganization`,
  `packages/objectql/src/tenancy/system-write-organization.ts`; #8844, #13491) — for objects the
  #13491 ledger classified. ⛔ Its docblock already forbids silently defaulting to `__global__`.
- An object can already declare that it has **no tenant column** (`systemFields.tenant: false` /
  `tenancy.enabled: false`, `packages/spec/src/data/injected-system-columns.ts`).
- A deployment can already declare objects **platform-global** for Layer 0 (#12699,
  `deployment-org-scoping-entitlement.ts`), and cloud's control plane maintains such a list with a
  written three-clause derivation rule.
- A named owner instead of NULL has precedent: the autonumber counter files org-less rows under the
  `__global__` sentinel ([ADR-0120](./0120-unique-scope-vocabulary-and-null-safe-tenant-uniqueness.md) D3).
- Per-table backfills with a maintainer order each exist for `sys_file`
  (`packages/services/service-storage/src/backfill-sys-file-organizations.ts`), the approval family
  (`packages/plugins/plugin-approvals/src/backfill-platform-row-organizations.ts`) and, in cloud, six
  raw-driver objects (`migrations/org-id-backfill.ts`, cloud#1663).

What is missing is the principle that ties them together: **ownership is total**, so NULL has nothing
left to mean.

---

## 2. Decision

### D1 — NULL is not a state

Every object that carries `organization_id` carries it **NOT NULL** — at the DDL (emitted by the
schema sync once D8 has cleared the table, see D11) and at the engine (D7). There is no third shape:
an object whose rows belong to no organization declares `systemFields.tenant: false` (or
`tenancy.enabled: false`, [ADR-0066](./0066-unified-authorization-model.md) D2) and has **no column**;
an object that has the column has an owner on every row.

This is the whole record in one sentence. Everything below exists to make D1 true without changing
what any tenant can see.

### D2 — The platform organization

Every deployment has exactly one **platform organization**: a `sys_organization` row with the reserved
slug `platform`, created by the kernel **before any seeder runs**, in every posture. Under `single`,
the Default Organization (`ensureDefaultOrganization`) is created at the same point, so no seeder ever
runs against an installation with zero organizations.

The platform organization is an **owner of rows, not a container of principals**:

- it has no members; it does not appear in membership-derived listings (better-auth's
  `organization/list`), the org switcher, or the membership reconciler ([ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) D2);
- `resolveSystemInsertOrganization`'s "exactly one organization ⇒ derive" counts **non-platform**
  organizations only, so the Default Organization — not the platform one — is what a `single`
  deployment derives;
- quota, billing and per-organization seeding sweeps (`listSeedOrganizationIds`) skip it.

Platform-level standing stays config-derived (#13514 L4, `OS_PLATFORM_OWNER_EMAIL`); the grant rows
that express it today at NULL (the `single`-posture first-user `admin_full_access` row, Choice 4A) are
owned by the platform organization under D4. Whether platform standing may later be *modelled* as
membership in the platform organization is deferred (§6 Q2), not decided here.

### D3 — The catalog is per-organization in every posture

`catalogIsPerOrganization` becomes unconditionally true. The four catalog seeders
(`bootstrapBuiltinRoles`, `bootstrapDeclaredPositions`, `bootstrapDeclaredPermissions`,
`bootstrapDeclaredSharingRules`) and `bootstrapPlatformAdmin`'s `defaultPermissionSets` write **one
pass per organization**; under `single` that is one pass for the Default Organization. The
organization-less "platform bucket" of `sys_position` / `sys_permission_set` /
`sys_position_permission_set` ceases to be produced. `seedCtx()` without an organization becomes a
programming error rather than a `single`-posture branch.

This is the maintainer's premise made structural: the walled posture already worked this way; `single`
is now the same code path with one organization.

### D4 — Deployment-level rows are owned by the platform organization

Rows that belong to the deployment and not to any tenant are stamped with the platform organization:

- the [ADR-0005](./0005-metadata-customization-overlay.md) **environment layer** of `sys_metadata`
  (every type that is not `allowOrgOverride`), `sys_metadata_activation` install-level rows,
  environment-level `sys_view_definition` rows, and env-wide `sys_metadata_audit` / `_commit` /
  `_history` rows — the overlay's resolution order (organization row → environment row → in-memory
  registry) is unchanged; only the key of the middle layer changes from NULL to the platform
  organization. **ADR-0005 is amended accordingly** (its "no overlay row = platform-global" sentence
  about the registry is untouched);
- the platform's **capability registry** rows (`sys_capability`, `managed_by: 'platform'`);
- **seeded templates** (`sys_email_template`, `sys_notification_template`);
- the **settings global rung** (`sys_setting` `scope: 'global'`, and its audit rows);
- **platform-global sharing rules** (`sharing-rule-service.ts::criteriaContext`'s "owned by no
  organization" class) and **global** `sys_user_position` assignments;
- the platform-standing grant rows of D2.

The `__global__` sentinel ([ADR-0120](./0120-unique-scope-vocabulary-and-null-safe-tenant-uniqueness.md) D3)
resolves to the platform organization's id; the `COALESCE` becomes inert and is removed under D10.

### D5 — Sharing is declared, per object, per deployment

Whether a **tenant** principal may read the platform organization's rows of an object — alongside its
own — is a declaration, never an inference from the column's value. The existing deployment-level
declaration of #12699 (`platformGlobalObjects` on the org-scoping entitlement) is generalized to
`platformSharedObjects` with these semantics:

- **listed**: tenant reads admit platform-organization rows in addition to the tenant's own; writes to
  platform-organization rows require platform standing;
- **not listed**: platform-organization rows are invisible to tenants, exactly like any other
  organization's rows.

The framework ships a **default** list for its own platform objects whose platform rows are meant to be
shared in a tenant runtime (the D4 owners: capability registry, templates, the metadata environment
layer, the settings global rung); a deployment extends or shrinks it — because the same object is
per-organization on a tenant runtime and deployment-wide on a control plane (`sys_setting` is cloud's
own example), the declaration cannot be a static property of the object. The per-object authoring
channel keeps its D1 meaning ("no column") and is **not** the sharing declaration.

Declaring an object shared is a widening, and stays a governed decision on the deployment's side — the
cloud control plane's three-clause derivation rule ("registered here; Layer 0 would otherwise wall it;
rows belong to the deployment, never to an organization — a question about **writers**") is adopted as
the written bar for adding a name.

### D6 — One scope, computed once, consumed by every wall

The engine computes one **tenant read scope** per operation —
`{ organizationIds: [...], sharedOrganizationIds: [...] }` — from the posture, the context
(`tenantId` under `isolated`, `accessible_org_ids` under `group`, [ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) D2)
and the D5 declaration, and threads **that object** both to Layer 0 (`computeTenantLayer0Filter`) and to
the driver (`DriverOptions`). Both emit `organization_id IN (…organizationIds, …sharedOrganizationIds)`.
No layer re-derives the scope; no layer has a NULL arm.

Two corrections fall out of this by construction:

- #10103 cause 1 (two implementations disagreeing) cannot recur — there is one input;
- #12699's "declared global ⇒ Layer 0 stands down entirely" over-widening is replaced by "admit the
  platform organization": a declared-shared object is still walled between tenants.

Every driver that implements a tenant scope is held to the same predicate; `check-tenant-chokepoint`
is extended to refuse an `IS NULL` arm on a tenant column.

### D7 — A missing stamp is a refused write, in every posture

`resolveSystemInsertOrganization` generalizes [ADR-0123](./0123-no-active-organization-session-semantics.md) D3
to every writer: a write on a tenant-column object that carries no organization is **derived** when
exactly one non-platform organization exists, and **refused** otherwise — under `single` as well as
under a wall — with a message naming what is missing ([ADR-0123](./0123-no-active-organization-session-semantics.md) D4).

⛔ **Nothing ever defaults to the platform organization.** A writer that means the platform names it
explicitly (a `platformCtx()` sibling of `seedCtx()`); a writer that forgets gets a refusal, never a
shared row. Silently stamping the platform organization would rebuild the shared pile under a new
name — the one outcome this record exists to make impossible.

The #13491 classification (`tenant-scoped` / `global` / `unclassified`) becomes structural: an object
with the column is in scope; an object without it is not; there is nothing left to be `unclassified`
about. The ledger `platform-object-tenancy.ts` is retired under D10 once D8 has run.

### D8 — Migration: three fates, loud, per table, no reaping

Existing NULL rows are resolved by **one generic migration family** driven by an inventory that the two
#13564 ledgers seed (59 platform objects + 28 example objects; the cloud supplement covers the
cloud-declared ones). Every object gets exactly one fate:

1. **Column dropped** (D1 tenant-less objects — the read-side ledger's U-A plumbing group and every
   object whose writer confirms "infrastructure rows, not tenant data"), through the
   [ADR-0120](./0120-unique-scope-vocabulary-and-null-safe-tenant-uniqueness.md) D4 migration ceremony
   and an [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) registry entry.
2. **Platform organization** (D4 objects): `NULL → platform` in one statement per table.
3. **Real organization** (accidental rows): derived from a declared parent anchor
   (`childKey` / `parentObject` / `parentOrgColumn`, the shape cloud's `org-id-backfill.ts` and this
   repository's two backfills already share), per table, with the citation recorded in the inventory.
   RBAC residue — pre-fix organization-less catalog rows that grants point at by id — is **adopted**
   into per-organization copies with the grants remapped (cloud#1664 item 5's runbook made
   first-class), superseding #10103's warn-not-reap posture now that the adopt path is defined.

A row whose owner cannot be derived is **left NULL and reported**: the boot report lists, per table,
the count of unattributed rows and the remedy. ⛔ No row is deleted; no unattributed row is assigned to
the platform organization. The NOT NULL constraint (D1) is applied to a table **only when that table
reports zero NULL rows** — a table that still carries them stays red in the report and keeps its
nullable column until an operator resolves them.

### D9 — Postures differ only in enforcement

Ownership, seeding and constraints are identical across `single`, `group` and `isolated`. What differs
is whether the wall is enforced: under `single` Layer 0 contributes nothing (as today) and the driver
scopes to the Default Organization plus the shared set; under a wall both layers enforce D6's scope.
Degraded tenancy stays a refused boot ([ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) D5).
`single` is no longer a reason for any row to be org-less.

### D10 — Retirements (ADR-0049)

When D8 reports zero NULL rows on every table of a deployment, the following are removed rather than
kept as dead compatibility: both `orWhereNull` arms in `applyTenantScope` and any sibling driver's
equivalent; the NULL readings in `resolve-authz-context.ts` (§4, §6, §6a, §6b),
`per-organization-catalog.ts` (`warnPreFixOrganizationLessRows`, residue detection),
`sharing-rule-service.ts::criteriaContext`, `settings-service.ts`'s global-rung special case,
`meta-write-org-scope.ts`'s NULL layer, `bootstrap-system-capabilities.ts`'s
`organization_id: null` identity predicate; the `__global__` sentinel and ADR-0120 D3's `COALESCE`;
the `platform-object-tenancy.ts` ledger and `isPlatformObjectOutOfTenantAuditScope`; #12699's
stand-down semantics (replaced by D5/D6). Each removal is an [ADR-0087](./0087-metadata-protocol-upgrade-contract.md)
entry where it retires an authorable shape.

### D11 — Staging

Phases that add — the platform organization (D2), the computed scope and declaration (D5/D6), the
seeders and writers (D3/D4/D7 in refusing mode behind the existing #13491 gate), the migration (D8) —
ship in **17.x**, with the driver's arms kept as the compatibility path. The NOT NULL constraint, the
every-posture refusal and the arm removal (D1/D7/D10) land at **protocol 18**, in the same staging
[ADR-0120](./0120-unique-scope-vocabulary-and-null-safe-tenant-uniqueness.md) D7 set for the
uniqueness work they compose with. Until D10 runs, ⛔ no card narrows or removes an arm.

---

## 3. Non-goals

- **Changing what tenants can see.** Platform rows that are shared today remain shared where the
  deployment declares them so (D5); the record changes the *key* under which they are owned and the
  *mechanism* by which sharing is expressed, not the visible result set.
- **Moving code-declared metadata into or out of the database.** Object/field/view metadata declared
  in code stays in the in-memory registry (ADR-0005's base layer); the RBAC catalog's persistence
  (Setup editability, provenance, grants by id — ADR-0078, ADR-0086 D5) is not revisited here. Whether
  declared catalog rows *should* be persisted at all is a separate question the maintainer's premise
  raises and this record does not answer.
- **better-auth-managed tables.** They have no tenant column (`managedBy: 'better-auth'` suppresses
  injection) and are untouched.
- **The platform organization as a principal container.** No membership, no login, no SSO binding
  (deferred, §6 Q2).
- **Reaping.** No data row is deleted by any part of this record (D8).
- **cloud's data model beyond ownership.** Scope rules anchored on `environment_id` / `invoice_id`
  (cloud#1239, cloud#1255) stay; only the injected `organization_id`'s owner changes.

---

## 4. Consequences

**What becomes true.**

- A forgotten stamp is a failed write (D7) and, once D1 lands, a constraint violation — it can no longer
  land in a pile every tenant reads. The class cloud#1239 belongs to is closed structurally, not by
  per-table repairs after each measurement.
- "Is this platform row visible to tenants?" has one answer in one place (D5), consumed by both walls
  (D6). #10103's blank catalog and cloud#1239's leak are the same disagreement; D6 removes the second
  implementation.
- The #13564 undetermined groups dissolve: an object is either tenant-less (no column), platform-owned,
  or tenant-owned. The read-side ledger's 38 rows each acquire one of three fates in D8's inventory.
- ADR-0120 D3's NULL-safe uniqueness simplifies to plain per-organization uniqueness.
- #14547's class ("a service open-coded the strict equality and lost the seeded rows") cannot recur:
  seeded units belong to an organization (D3/D7) and there is no NULL arm to forget.

**What it costs.**

- Boot ordering changes (D2): two bootstraps move ahead of every seeder; the plugin ordering is
  declared ([ADR-0116](./0116-plugin-ordering-declared-contract.md)), not incidental.
- Every platform writer is touched once (D3/D4/D7) — the read-side ledger enumerates them; the
  dominant shape (bare `SYSTEM_CTX`) does not need a tenant on reads, but every **write** site names
  its owner.
- Tests that pin NULL semantics are rewritten to pin the new predicate (`deal_p1`,
  `sql-driver-tenant-scope`, `memory-tenancy-guard`, `rule-criteria-org-scope`,
  `per-organization-catalog`, cloud's `unscoped-control-plane-tenant-wall`).
- A live migration on customer databases (D8), staged per table and gated per table; unattributable
  rows are an operator task, surfaced loudly, never resolved by the platform guessing.
- `sys_organization` gains a reserved row; any admin surface that lists *all* organizations (not
  membership-derived) must mark or hide it (verified per surface; objectui card if one exists).
- Under `group`, the driver's `IN` list grows by one id (the platform organization) on declared-shared
  objects; index shape is unchanged.

**Risks.**

- A writer "helpfully" stamping the platform organization to make a refusal go away. D7 forbids it in
  terms; review and the chokepoint gate look for it; the boot report of D8 would show the shared pile
  reforming under the platform id.
- A declared-shared list that grows by convenience. D5 adopts cloud's written three-clause bar and
  keeps the list a governed deployment decision.
- A `single` deployment whose Default Organization bootstrap fails (it is best-effort today). D2 makes
  it load-bearing: a failure is a boot error, not a degraded warning.

---

## 5. Alternatives considered

| Alternative | Why not |
|---|---|
| **(a) Keep the arm; add per-object scope rules above the driver** (cloud#1239's pattern; #13564's option a) | Keeps NULL's double meaning. Every new writer inherits fail-open; every repair is per table after a measurement. It is the status quo the maintainer rejected: 「不应该有允许 org_id 为空的状况」. |
| **(b) Narrow the arm to declared-global objects** | "Global" is per deployment, not per object (`sys_setting`), so the driver — constructed from connection config with no kernel access — cannot know it; and #12699's list would still ride the arm. It moves the fail-open behind a list without removing it. |
| **(c) Switch the arm on posture** | Keyed on effective posture it would have kept the arm on cloud#1239's degraded deployment (the leak); keyed on requested posture it blanks every #12699 object and revokes pre-fix RBAC grants silently. Either way NULL keeps a meaning under `single`. |
| **NOT NULL without a platform organization** (per-organization copies of everything) | Impossible for the shared-schema environment layer (ADR-0005: object/field overlays cannot be per-organization in a shared DB) and for the capability registry; it would also multiply every seeded template per tenant. |
| **A string sentinel (`__global__`) instead of a real organization row** | No FK to `sys_organization`, so lookups, RLS and admin surfaces treat it as a special case forever; ADR-0120 D3 already shows the COALESCE this costs. A real row lets every layer treat the platform like any other owner. |
| **Serve the declared catalog from the registry and persist nothing** | Answers the maintainer's first question differently and may be right — but it changes Setup editability, provenance and grants-by-id (ADR-0078, ADR-0086 D5) and is independent of NULL: persisted rows would still need an owner. Recorded as a follow-up question, not folded in (§6 Q3). |

---

## 6. Open questions for the maintainer's merge decision

1. **Identity of the platform organization.** Slug `platform` and a fixed display name are proposed;
   should it be visible (marked) or hidden in platform-admin organization lists?
2. **Platform standing as membership.** D2 keeps standing config-derived. Should a later record allow
   "member of the platform organization" to *be* platform standing (replacing the legacy grant anchor)?
   Deferred here.
3. **Persisting the declared catalog at all.** The premise 「理论上不需要写到数据库中」 is not decided
   by this record (§3). Should a follow-up card measure what Setup, provenance and grants-by-id would
   lose if declared roles/positions/permission sets were served from the registry and only
   runtime-created ones persisted?
4. **cloud's recipient-anchored group** (`sys_inbox_message`, `sys_notification*`,
   `sys_user_preference`): D1 (no column, anchored on `user_id`) or D4 (platform-owned, shared)? cloud's
   own reading ("their inbox follows them, not their active workspace") points at D1.
5. **Staging confirmation.** D11 aligns with ADR-0120 D7 (17.x additive, protocol 18 constraint).
   Confirm, or name a different boundary.

---

## 7. Verification notes — where citations did not survive re-verification

- The issue body of #13564 cites the arm at `sql-driver.ts:7320`; on `origin/main` `2514d49f3` the
  arms are inside `applyTenantScope` (~line 12016–12066) and there are **two** of them. This record
  cites the symbol, not the line.
- `ensure-default-organization.ts` cites "ADR-0081 D1" for the Default Organization; in this
  repository `docs/adr/0081` is the trusted React page tier. The framework record that describes the
  bootstrap is [ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) (§D6/D7 compose with it);
  the "0081" is cloud's numbering. This record cites the module by path.
- The read-side ledger stated the arm's live tenant-facing surface is empty on a walled deployment
  running `plugin-security`. Re-verified — with the addition in §1.2 item 4: the #12699 deployment
  declaration is a tenant-facing dependent the ledger could not see, because it lives in cloud.
- `driver-memory` and `driver-mongodb` carry tenancy **guards** (`memory-tenancy-guard.ts`,
  `mongodb-tenancy-guard.ts`) keyed on `tenancy.enabled === true`, not a NULL-armed predicate. D6 holds
  them to the same computed scope; the audit of each driver's actual predicate is a card, not an
  assumption recorded here.

---

## 8. Execution plan (cards are cut from the merged record)

One epic tracks the family. Phases 1–3 are additive (17.x); phase 4 is protocol 18.

| # | Card | Decisions | Blocked by |
|---|---|---|---|
| C1 | Platform organization exists before the first seeder, in every posture | D2, D9 | ADR merge |
| C2 | One tenant read scope; `platformSharedObjects` threads to Layer 0 and every driver | D5, D6 | ADR merge |
| C3 | Catalog per-organization in every posture; registry, platform grants, authz reads on the platform organization | D3, D4 | C1, C2 |
| C4 | ADR-0005 environment layer owned by the platform organization | D4 | C1 |
| C5 | Every remaining platform writer names its owner — platform organization or no column; U-A/U-B adjudicated | D1, D4, D7 | C1 |
| C6 | Generic NULL-organization backfill: three fates, per-table boot report | D8 | C3, C4, C5 |
| C7 | NOT NULL; unstamped writes refused in every posture; both arms retired — protocol 18 | D1, D7, D10, D11 | C6 |
| C8 | cloud: control plane and objectos-ee adopt the record (cloud repository) | D1, D4, D5, D8 | C2, then C7 |
| C9 | Docs and card-family close-out (#13564, #11611, #10103 residue posture) | — | C7, C8 |

⛔ Rules every card inherits: no card touches the driver's arms before C7; no writer ever defaults to
the platform organization; no row is reaped; `content/docs/releases/` is never edited in a code PR.

---

## 9. References

- Issues: [#13564](https://github.com/objectstack-ai/objectstack/issues/13564) ·
  [#10103](https://github.com/objectstack-ai/objectstack/issues/10103) ·
  [#13491](https://github.com/objectstack-ai/objectstack/issues/13491) ·
  [#2734](https://github.com/objectstack-ai/objectstack/issues/2734) ·
  [#12699](https://github.com/objectstack-ai/objectstack/issues/12699) ·
  [#14484](https://github.com/objectstack-ai/objectstack/issues/14484) ·
  [#14547](https://github.com/objectstack-ai/objectstack/issues/14547) ·
  [#11611](https://github.com/objectstack-ai/objectstack/issues/11611) ·
  [#8844](https://github.com/objectstack-ai/objectstack/issues/8844) ·
  [#13514](https://github.com/objectstack-ai/objectstack/issues/13514) · cloud#1020 · cloud#1232 ·
  cloud#1239 · cloud#1255 · cloud#1663 · cloud#1664.
- Records: [ADR-0005](./0005-metadata-customization-overlay.md) ·
  [ADR-0049](./0049-no-unenforced-security-properties.md) · [ADR-0066](./0066-unified-authorization-model.md) ·
  [ADR-0078](./0078-no-silently-inert-metadata.md) · [ADR-0086](./0086-authz-metadata-config-boundary-and-cross-package-composition.md) ·
  [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) · [ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) ·
  [ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) ·
  [ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) ·
  [ADR-0116](./0116-plugin-ordering-declared-contract.md) ·
  [ADR-0120](./0120-unique-scope-vocabulary-and-null-safe-tenant-uniqueness.md) ·
  [ADR-0123](./0123-no-active-organization-session-semantics.md).
- Code (framework, `origin/main` `2514d49f3`): `packages/drivers/driver-sql/src/sql-driver.ts`
  (`applyTenantScope`, `injectTenantOnInsert`, `auditMissingTenant`);
  `packages/objectql/src/engine.ts` (`buildDriverOptions`);
  `packages/objectql/src/tenancy/system-write-organization.ts`;
  `packages/objectql/src/tenancy/platform-object-tenancy.ts`;
  `packages/plugins/plugin-security/src/tenant-layer.ts` (`computeTenantLayer0Filter`);
  `packages/plugins/plugin-security/src/per-organization-catalog.ts`;
  `packages/plugins/plugin-security/src/bootstrap-platform-admin.ts`;
  `packages/plugins/plugin-security/src/bootstrap-system-capabilities.ts`;
  `packages/plugins/plugin-security/src/deployment-org-scoping-entitlement.ts`;
  `packages/plugins/plugin-auth/src/ensure-default-organization.ts`;
  `packages/core/src/security/resolve-authz-context.ts`;
  `packages/metadata-core/src/meta-write-org-scope.ts`;
  `packages/metadata-protocol/src/protocol.ts` (`getMetaItem`);
  `packages/spec/src/data/injected-system-columns.ts`; `scripts/check-tenant-chokepoint.mjs`.
- Code (cloud, `main` `3856fbf7`): `packages/service-cloud/src/control-plane-platform-global.ts`;
  `packages/service-cloud/src/control-plane-org-scope-plugin.ts`;
  `packages/service-cloud/src/control-plane-organizations.ts`;
  `packages/service-cloud/src/migrations/org-id-backfill.ts`;
  `apps/cloud/test/unscoped-control-plane-tenant-wall.test.ts`;
  `apps/objectos-ee/objectstack.config.ts`.
