# ADR-0131: Organization ownership is total — no NULL `organization_id`; declared metadata stays in code; a row exists only when an organization authored it

**Status**: Proposed (2026-09-04) — awaiting the maintainer's hand-merge, which is itself the
acceptance act for a governed surface (Prime Directive #14). ⛔ Nothing below is settled until
this record merges; the implementation cards are cut **from** the merged ADR, never ahead of it.
**Supersedes**: [ADR-0126](./0126-packaged-metadata-customization-model.md) (maintainer, 2026-09-04: 「ADR-0126 可以先作废」— its regimes are replaced by the install mode of D6, its activation ledger is removed before 17.3; §1.7 keeps what its survey found so the superseded record need not be read).
**Deciders**: ObjectStack maintainer, 2026-09-03/04, live chat on
[#13564](https://github.com/objectstack-ai/objectstack/issues/13564), verbatim and untranslated,
in the order the model was built: the premise 「我理解只有代码定义的元数据是跨租户的，对象、字段、视图等
元数据，不落库；其他诸如角色、岗位、权限集 代码声明的会 seed 进库 … 但是应该是每个组织一套？」; the
principle 「或者说我们数据库中，不应该有允许 org_id 为空的状况。」; the rejection of per-tenant seeding
「既然你不让改，又要求每个租户 seed 一遍，好像很蠢，有没有更好的方案。」; the templates ruling
「在组织没有提出编辑诉求前，强制为每个组织 seed 也是很蠢。我宁可先不让他编辑。」; the withdrawal of
group-level template rows 「不考虑集团级模板行，作废相关需求」「不考虑 分层主数据」; the posture that
breaks every remaining tie: 「我们现在创业阶段，应该定一套最稳定可靠的方案，而不是盲目追求功能。」; and the
provenance rule for editing: 「可以先约定代码推送过来的元数据就只能在代码中修改。studio 界面上配置的元数据，
保存在库中，可以在界面上修改，包括 ../cloud build agent 构建的元数据，因为也是保存在库中，可以在界面上修改。」;
the sealing ruling that fixes D6: 「你这么说还不如先完全封死。flow 也先不让改。然后软件包应该有两种安装方式，
有一种是模版形式直接进库，那就是所有都可以修改。但是单库多租户禁止安装这种模版软件包；有一种是受管软件包，什么都以
软件包中的为准，就是不让改。」; and the catalog ruling that fixes D3: 「角色、岗位、权限集，Setup 里组织自建的是组织级。
这个说的是单库单租户吧，单库多租户我可以禁止他们创建。但是你要支持我绑定到人员。」; and, on the proposals this record
carried as open questions and on the post-17.2 audit (§7), 「接受你的建议」(2026-09-04) — recorded per item below.
**Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (the metadata overlay — its
environment layer is re-keyed by D6), [ADR-0049](./0049-no-unenforced-security-properties.md)
(enforce or remove — the posture of D13), [ADR-0066](./0066-unified-authorization-model.md) D2
(`tenancy.enabled:false` — given the single meaning "no tenant column" by D1),
[ADR-0078](./0078-no-silently-inert-metadata.md) (declared-but-unread metadata is a defect — the
reason the seeders existed, answered differently by D2/D4),
[ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) D5 (degraded tenancy fails fast) and its
Default Organization bootstrap (made load-bearing by D3), [ADR-0094](./0094-sys-permission-set-pure-projection.md)
D1 (the metadata layer is the only authoritative store for a permission-set definition — D2
generalizes this to the whole declared catalog and stops materializing the projection),
[ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) D1 (Layer 0),
[ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) D2/D6/D10 (the `group` union
scope; the org-axis red lines; D10 withdrawn — D12), [ADR-0120](./0120-unique-scope-vocabulary-and-null-safe-tenant-uniqueness.md)
D3/D4/D7 (`COALESCE(organization_id, '__global__')`, the migration ceremony, the 17.x → protocol 18
staging), [ADR-0123](./0123-no-active-organization-session-semantics.md) D2–D4 (no silent NULL
stamping — generalized by D9), [ADR-0126](./0126-packaged-metadata-customization-model.md) D1–D3
(the three customization regimes for packaged metadata — overlay, disable + clone, extend — and the
activation ledger; D6 maps them onto this record's provenances and amends D3's reserved column),
[ADR-0129](./0129-object-name-is-the-canonical-id.md) D1 (the `name` is the canonical id — extended by
D4 to catalog items).
**Evidence**: the two censuses on #13564 (2026-08-31, 2026-09-02) and the 2026-09-03 cloud-side
supplement; [#10103](https://github.com/objectstack-ai/objectstack/issues/10103);
[#13491](https://github.com/objectstack-ai/objectstack/issues/13491);
[#2734](https://github.com/objectstack-ai/objectstack/issues/2734);
[#12699](https://github.com/objectstack-ai/objectstack/issues/12699);
[#14484](https://github.com/objectstack-ai/objectstack/issues/14484);
[#14547](https://github.com/objectstack-ai/objectstack/issues/14547);
[#13636](https://github.com/objectstack-ai/objectstack/issues/13636) and its draft PR #14923 (the
write-side diagnosis of the same root, and the mechanism this record supersedes — §1.6); cloud#1232 /
cloud#1239 / cloud#1663 / cloud#1664. Framework anchors re-verified against `origin/main` `2514d49f3`;
cloud anchors against `cloud` `main` `3856fbf7`.
**Consumers**: `@objectstack/spec` (`injected-system-columns.ts`, the org-scoping entitlement),
`@objectstack/objectql` (`engine.ts` `buildDriverOptions`, `tenancy/system-write-organization.ts`,
`tenancy/platform-object-tenancy.ts`), every driver with a tenant scope (`driver-sql`
`applyTenantScope` and the `driver-memory` / `driver-mongodb` / `driver-turso` / `driver-sqlite-wasm`
guards), `plugin-security` (`tenant-layer.ts`, `per-organization-catalog.ts`, the five bootstrap
seeders, `bootstrap-platform-admin.ts`, `permission-set-projection.ts`), `plugin-auth`
(`ensure-default-organization.ts`), `@objectstack/core` (`security/resolve-authz-context.ts`),
`plugin-email` (`bootstrap-declared-email-templates.ts`, `email-template-provenance.ts`,
`template-loader.ts`), `plugin-sharing`, `metadata-core` / `metadata-protocol`, `service-settings`,
`plugin-audit`, `service-storage`, `plugin-approvals`, `service-automation`, `objectui` (Setup /
Studio / pickers — D7), and in their own repository `cloud`'s control plane and `objectos-ee`.

---

## TL;DR

Today a NULL `organization_id` means two things at once — **"this row belongs to the platform"**
and **"whoever wrote this row forgot to say whose it is"** — and the SQL driver's tenant predicate
`(organization_id = :tenant OR organization_id IS NULL)` (#2734) hands the second kind to every
tenant. cloud#1239 measured that on a credentials table.

The obvious repair — give the platform's rows an owner — was drafted and rejected: it needed a
"platform organization", a concept that is an organization for the database and not for anyone
else. The maintainer's model is simpler and this record adopts it whole:

1. **Metadata is the registry, and the registry has two provenances.** A **managed** package —
   objects, fields, views, and equally positions, permission sets, capabilities, sharing rules,
   templates, flows — is code: edited **in code only**, changed by publishing a new version, **never
   materialized as rows**, and **sealed** at runtime (no overlay, no disable, no clone). Metadata
   authored at runtime — in Studio, by the cloud build agent, or by installing a **template** package
   (a one-time copy into the database) — is **saved in the database and edited in the UI**; it is the
   environment's, not any organization's, and its ledger carries **no organization column**. Template
   packages are **refused on shared-DB multi-tenant deployments**. Both provenances are cross-tenant
   by nature: every organization runs the same schema.
2. **A row with an organization column exists only when an organization authored it** — an assignment
   (this user holds this position, this user holds this permission set), a business unit, a sharing
   rule, a record share. Every such row carries its organization, NOT NULL, and references registry
   items **by name**, the way ADR-0129 already treats objects. **Catalog definitions — positions,
   permission sets, capabilities — are never organization rows**: they live only in the environment
   registry. In a single-tenant deployment the organization *is* the environment, so its admins author
   them there; in a shared-DB multi-tenant deployment tenants **assign but do not define**.
3. **A table with no organization column is deployment-level or code-level**, governed by permission,
   not by a wall. There is no third shape.

Consequences: NULL has nothing left to mean (D1); the driver's NULL arm and Layer 0's strict
equality stop disagreeing because there is one predicate (D8); a forgotten stamp is a refused write
(D9); the seeders, the per-organization catalog machinery and the #13491 ledger retire (D13);
customization of managed content is **sealed** — ADR-0126's overlay and disable + clone regimes are
paused, and ADR-0005's per-organization overlay axis is retired, so `sys_metadata` needs no split (D6).
Startup posture throughout: the stable answer, not the feature-complete one.

---

## 1. Context

### 1.1 One column, two meanings

`applyTenantScope` (`packages/drivers/driver-sql/src/sql-driver.ts`) emits two arms with a NULL
disjunct — the equality arm and, under `group`, the `whereIn` union arm — and states why:

> a NULL tenant column marks a GLOBAL/platform row (bootstrap-seeded positions and permission sets,
> business units, pre-org first-boot seeds) … with strict equality every tenant admin saw ZERO RBAC
> rows on a fresh deployment, because every platform row is org-less (#2734).

True of the rows it names; equally true of every row a writer forgot to stamp. cloud#1239 measured an
organization admin of tenant A reading tenant B's `sys_environment_credential` rows through exactly
this arm, on a control plane whose requested `isolated` posture had degraded to `single`.

### 1.2 What the censuses established

1. Whether the arm fires is a property of the **caller**: the dominant platform read shape is a bare
   `{ isSystem: true }` context, which scopes nothing at all; the arm's live consumers are internal
   `{ isSystem: true, tenantId }` passes.
2. On a walled deployment running `plugin-security`, tenants already do not see NULL rows — Layer 0's
   strict equality ANDs over the arm and wins (#10103's symptom, the other face of the same coin).
3. The measured leak's precondition — many organizations with Layer 0 inert — is today a refused boot
   ([ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) D5, cloud#1020, cloud#1664).
4. Beyond `sys_position`'s authorization read and the catalog's residue detection, the #12699
   deployment-level platform-global declaration depends on the arm: it disarms Layer 0 only, so a
   tenant's read of a declared-global object sees the deployment's NULL rows *through the driver*
   (cloud's control plane declares 32 such objects). Neither census could see this from the framework.
5. 59 platform objects carry the column; 38 could not be placed as "by design" or "accidental",
   because NULL cannot say which it is.

### 1.3 Why the seeders exist, and what they actually do

The maintainer's first question was whether declared roles, positions and permission sets need to be
in the database at all. Read from the seeders' own docblocks:

- **Declared items are seeded so the admin surface can see them** (Setup reads the table;
  [ADR-0078](./0078-no-silently-inert-metadata.md) names the alternative "false compliance"), so
  runtime resolution can join on rows (`resolveExecutionContext → sys_position →
  sys_position_permission_set`), and so uninstall and provenance have an axis (`managed_by`,
  `package_id`).
- **Seeded rows are read-only mirrors of code.** The machine name is immutable after creation;
  package-managed rows refuse `update` and `delete` through the admin door ("change it by editing its
  package and re-publishing"); platform-managed built-ins are "visible but not repurposable"; every
  boot re-seeds package rows from the declaration. The maintainer's 2026-08-24 ruling — lock the base,
  clone to customize — closed the last edit path. Customization is a **new org-owned row**, never an
  edit of the mirror.
- **For permission sets the mirror is not even the authority**: [ADR-0094](./0094-sys-permission-set-pure-projection.md)
  D1 makes the metadata layer the only authoritative store; the evaluator resolves registry-first;
  the row is a derived read-model.
- **Under a walled posture the mirror is copied once per organization** (#10103 Option C), and under
  `single` once with no owner — the NULL population this record is about.

So the seed's purpose was never "so admins can modify them". Its three real purposes — visibility,
id-resolution, provenance — are each answerable without rows (D2, D4, D7).

### 1.4 Templates are the one place editing is a requirement — and still not a reason to seed

`sys_email_template` is record-authoritative today: declared and built-in templates are materialized
into rows on every boot (`seedTemplates`, `bootstrapDeclaredEmailTemplates`), an admin edit stamps
`customized: true` and the seeder skips that row thereafter, and `sendTemplate` resolves by
`(name, locale)` with **no organization in the key**. Two opposite doctrines therefore coexist for
"declared in code, editable at runtime": permission sets are metadata-authoritative with a projected
row; templates are row-authoritative with a seeded row. The maintainer's ruling settles both under
one rule: the requirement is real, the seed is not the way to meet it, and until an organization asks,
the door stays closed (D6).

### 1.5 The rejected middle: a platform organization

The first draft of this record gave deployment-level rows an owner — a reserved `sys_organization`
row with no members. It is recorded here as the alternative considered (§5) because it is the
natural repair and the wrong one: it keeps every mixed table mixed, adds a concept every organization
enumerator must special-case, and exists only to give NULL a new name. Under the maintainer's model
the mixed tables un-mix instead (D6, D7), and no owner is needed.

### 1.6 The same root, diagnosed from the write side: #13636 and PR #14923

While #13491's tenant-audit control was being implemented, its seat found a **third** tenancy state
the two-state ruling could not express: objects holding both org-stamped and legitimately org-less
rows, where org-less is a property of the **row** (specimens: `sys_metadata`'s env-wide writes under
the #6190 ruling; `sys_audit_log`'s records about objects that have no organization column). #13636's
own root sentence is this record's: 「today the same `NULL` means both "deliberate" and "bug"」. Its
option B — **declare** a legitimately org-less write per call, loud and countable — is implemented in
draft PR #14923 (`orgless-write-declaration.ts`, ~1400 lines), paused by the maintainer.

This record resolves the third state the other way round. A row that is legitimately org-less is a row
on an object that should have **no organization column**: `sys_metadata` becomes the tenant-less
environment ledger (D6/D7); `sys_audit_log` is a deployment ledger whose organization attribution is a
plain data field, not the tenancy anchor (D7). Once the column is gone there is nothing to declare, and
a declared-NULL mechanism would keep alive exactly the state D1 removes. #14923 therefore does not
merge; #13636 closes as superseded when this record merges (§8, C11).

### 1.7 What ADR-0126 found, kept here so the superseded record need not be read

ADR-0126 (2026-08-25) surveyed every metadata type for post-install customization pull and found
three mechanisms already in the tree, each invented per type with its own ledger: an **organization
overlay** for exactly five presentational types (ADR-0005 tier A), **clone-to-customize** for permission
sets (the 2026-08-24 lock-the-base ruling), and **package-grain extend** for objects and app navigation
(`objectExtensions`, ADR-0029 D7). It recorded that two shipped documentation pages promised "install
with one click, then customize in Studio" while the platform refused nearly every post-install change;
that a tenant had once switched a shipped flow off environment-wide through an unscoped in-process map
(#10243); and that behavioral types must never gain an org overlay (the #6190 wall). Its answer was a
per-type regime table plus a generic activation ledger. This record keeps the findings and replaces the
answer: the extend mechanism stands because it is a package; the #10243 class is closed by sealing
managed content rather than by a durable switch; and the documentation promise is rewritten as "install
managed, or install as a template" (C11).

---

## 2. Decision

### D1 — NULL is not a state

Every object that carries `organization_id` carries it **NOT NULL** — at the DDL once D10 has cleared
the table, and at the engine from the start (D9). An object whose rows belong to no organization
declares `systemFields.tenant: false` (or `tenancy.enabled: false`,
[ADR-0066](./0066-unified-authorization-model.md) D2) and has **no column**. There is no nullable
tenant column anywhere.

### D2 — Declared metadata is code and is never materialized as rows

Everything a stack, package or the platform itself **declares** lives in the metadata registry and
only there: objects, fields, views, dashboards, reports, translations — and equally positions,
permission sets, the built-in identity roles (`platform_admin`, `org_owner`, `org_admin`,
`org_member`) and audience anchors (`everyone`, `guest`), capabilities, declared sharing rules,
declared and built-in email and notification templates, declared settings defaults.

Declared items are cross-tenant by nature (every organization runs the same code), upgrade with the
code, and are immutable at runtime (the 2026-08-24 lock). **No seeder writes them into any table**, in
any posture, for any organization. Resolution reads the registry (D4). Setup and pickers read the
registry (D7).

**The registry has a second provenance: environment metadata authored at runtime.** What a metadata
author creates in Studio, through the metadata door (ADR-0070), or through the cloud build agent —
objects, fields, views, flows, and equally positions, permission sets or templates created there — is
**saved in the database** (`sys_metadata`, the environment definition ledger) and **edited in the UI**.
It is hydrated into the same registry the code layer feeds (`loadMetaFromDb`), so everything below
that says "registry" means both provenances. The rule that separates them is provenance, verbatim:
「代码推送过来的元数据就只能在代码中修改；studio 界面上配置的元数据，保存在库中，可以在界面上修改」.
Environment metadata belongs to the deployment, not to an organization: its ledger carries **no
organization column** (D6/D7), and writing it requires the metadata-authoring capability
(`manage_metadata` / `studio.access`), which `organization_admin` deliberately does not hold.

A package reaches a deployment in one of **two install modes** (D6): **managed** — registered as code,
sealed, upgradeable; or **template** — copied once into the environment ledger as environment
metadata, fully editable, no upgrade channel, refused on shared-DB multi-tenant postures.

This retires: `bootstrapBuiltinRoles`, `bootstrapDeclaredPositions`, `bootstrapDeclaredPermissions`,
`bootstrapDeclaredSharingRules`, `bootstrapSystemCapabilities`, `bootstrapPlatformAdmin`'s
`defaultPermissionSets` materialization, `bootstrapDeclaredEmailTemplates`, `seedTemplates`, the
`sys_permission_set` projector and reconciler of [ADR-0094](./0094-sys-permission-set-pure-projection.md)
D2/D4 (D1 of that record stands and is generalized; its projection is no longer needed), and the whole
per-organization catalog machinery (`per-organization-catalog.ts`, #10103 Option C) — there is
nothing left to copy per organization.

### D3 — A row exists only when an organization authored it; the catalog is environment-level, assignments are organization-level

**The catalog has one home.** Positions, permission sets and capabilities are **definitions**, and a
definition lives only in the environment registry — code-declared (managed, sealed) or
environment-authored (Studio, template package; editable by metadata-authoring capability holders).
The position → permission-set binding is part of the position's definition, declared in code or
authored in Studio. There is **no organization-level catalog**: the objects `sys_position`,
`sys_permission_set`, `sys_position_permission_set` and `sys_capability` retire (D13), completing
[ADR-0094](./0094-sys-permission-set-pure-projection.md) D1 — the metadata layer was already the sole
authoritative store; the projected row no longer exists either. Consequences by posture, verbatim from
the ruling 「单库多租户我可以禁止他们创建。但是你要支持我绑定到人员」:

- **Single-tenant** (`single`): the organization is the environment. An admin who creates a position
  or permission set in Setup performs an environment metadata write — the redirect ADR-0094 D3
  already makes today — gated by the metadata-authoring capability, which the deployment's owner holds
  and grants as they see fit.
- **Shared-DB multi-tenant** (`group` / `isolated`): tenant admins **cannot create or edit catalog
  items**; the operator defines the catalog for every tenant (managed packages, Studio). Creation
  through Setup or the API is refused with a message naming the posture and the capability.

**Assignments are organization rows, in every posture.** `sys_user_position` (this user holds this
position) and `sys_user_permission_set` (this user holds this set) are owned by the organization the
assignment is made in, NOT NULL, reference the catalog item **by name** (D4), and are created and
removed by that organization's admins for its own members — walled by Layer 0 like any other
organization data. So are the other things an organization writes: business units, sharing rules and
record shares it authors, approvals, files, and every business row. Every such row carries the
authoring organization, NOT NULL.

Under `single` the authoring organization is the Default Organization
([ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md); `ensure-default-organization.ts`), which
becomes **load-bearing**: it exists before the first write that needs an owner (today it is created on
`kernel:ready` best-effort; a failure becomes a boot error). The catalog needs no ordering because it is
never seeded — but **application seed data** (`SeedSchema` datasets: a showcase's accounts, business
units, sample records) still is, and today lands `organization_id = NULL` on a first boot because the
organization does not exist yet (`seed-loader.ts::resolveSoleOrganizationId` correctly finds none; the
`seed-tenancy-backfill` migration exists for exactly that residue). Two rules close it: the Default
Organization is created **before** application seed datasets load under `single`, and the seed loader's
exemption of `sys_` / `cloud_` / `ai_` seeds from stamping ("intentionally global") is withdrawn — there
are no platform-global seeds left; a seeded `sys_business_unit` is the organization's business unit
(D9 derives the owner; #14547 is this defect seen from the sharing side).

An organization has no rows until it authors something. A fresh deployment with ten organizations
has **no catalog tables at all** and empty assignment tables until an admin assigns someone.

### D4 — Catalog items are referenced by name; resolution reads the registry

[ADR-0129](./0129-object-name-is-the-canonical-id.md) made the object `name` the canonical id; this
record extends the principle to catalog items. A position or permission set has no row id, so every
reference to one — `sys_user_position`, `sys_user_permission_set`, sharing-rule recipients, grants —
names it by its machine name. The namespace is the environment registry's: code-declared and
environment-authored items share it, and Studio refuses a name a managed package holds.

Resolution reads the **registry** — one source, both provenances. `resolve-authz-context.ts` already
looks positions up by name (`grants.positions`); the change is that the lookup is a registry read
instead of a table read, and the position → permission-set binding is read from the position's
definition instead of a junction table. A name that resolves nowhere — a declaration removed or renamed
in code — **fails closed** for that reference and is **reported at boot** per organization, by name.
This is loud where today's behaviour is a zombie: a seeded mirror of a removed declaration stays in the
table and keeps granting.

Because the catalog has one home (D3), nothing is merged at selection time: a picker lists the
registry, an assignment names one of its entries. The read-time-merge failures of the overlay model
(§5) cannot arise.

### D5 — Platform standing is configuration, or a Default-Organization row under `single`

`PLATFORM_ADMIN` derives from `OS_PLATFORM_OWNER_EMAIL` (#13514 L4) — configuration, not a row. The
`single`-posture first-user promotion (Choice 4A), which today writes an `admin_full_access` grant row
with a NULL organization, writes it **owned by the Default Organization** instead; under a walled
posture no grant row is written (unchanged). `reportLegacyPlatformAdminGrant` and the legacy unscoped
anchor retire with D13. No NULL grant row is ever produced.

### D6 — Managed is sealed; template is copied in and fully editable; the environment ledger has no organization column

**Two install modes, and the mode is the whole customization story.**

The package **declares** the modes it permits (`installModes`, default `['managed']`); the installer picks one at
install time; a shared-DB multi-tenant deployment refuses `template` whatever the package permits (ruled
2026-09-04).

- **Managed** (default). The package is registered into the registry as code. Nothing in it is
  editable at runtime — not in Setup, not in Studio, not through the data or metadata API — and
  nothing in it can be switched off or cloned-with-linkage either: [ADR-0126](./0126-packaged-metadata-customization-model.md)'s
  Regime O (overlay) and Regime C (disable + clone) are **paused for managed content, packaged flows
  included** (verbatim: 「先完全封死。flow 也先不让改」). To change a managed item, the vendor publishes a
  new version and upgrades flow to the base untouched. Regime E (extend) stands, because an extension
  is itself a package. Managed is the **only** mode a shared-DB multi-tenant deployment (`group` /
  `isolated`) accepts.
- **Template.** The package's metadata is copied **once** into the environment definition ledger as
  environment-provenance items — from then on it is the environment's own metadata, editable in Studio
  like anything authored there, with no upgrade channel (a later version is a new import, refused where
  names collide; provenance is recorded for information only). ⛔ **Refused on `group` / `isolated`**
  with a message naming the posture: a template import would hand every tenant an editable shared
  schema. Under `single` it is how a customer takes an app and makes it theirs.

Creating one's own item — a new permission set, position, view, flow — is environment authoring
(Studio, or Setup acting as a metadata editor under `single`), gated by the metadata-authoring
capability and refused to tenants of a shared-DB deployment (D3). It is not customization of a
managed item; pre-filling the form from a managed item is a UI convenience that records no linkage.

**Code-provenance metadata is edited in code.** No runtime door edits a managed item.

**Environment-provenance metadata is edited in the UI.** What Studio, the cloud build agent or a
template install wrote into `sys_metadata` is the environment's to change there, by anyone holding the
metadata-authoring capability. This is [ADR-0005](./0005-metadata-customization-overlay.md)'s
environment layer, kept — and made the **whole** ledger: **`sys_metadata` is the environment definition
ledger and carries no organization column** (D1/D7).

**ADR-0005's per-organization overlay axis is retired for now.** The five `allowOrgOverride` types
(`view`, `dashboard`, `report`, `translation`, `email_template`) were the only reason `sys_metadata`
carried an organization. With managed content sealed and template content environment-owned there is
no per-organization metadata left to hold: under `single` the organization *is* the environment; under
a wall no metadata is editable at all. So there is **no split and no second object** — org-scoped
metadata writes are refused (the existing identity pin flips from "exactly five types accepted" to
"none"), and the environment layer is the ledger. ADR-0005 is amended (status note); its "no overlay
row = the registry" reading and its layered resolution (environment → code) are unchanged. If a
measured pull for per-organization presentational overlays returns, it comes back as an org-owned
overlay object holding D3 rows — never as a nullable column on the environment ledger.

**What this does to ADR-0126.** Its three regimes were the answer to "how is packaged metadata
customized without being edited"; the maintainer's answer is now "it is not — pick the install mode".
Regime O and Regime C are paused for managed content. The Regime C machinery that landed for packaged
flows — the activation ledger `sys_metadata_activation` and its `execute()`-time consult (#12158, PR
#12296), the flow clone action (#12156), the ledger convergence (#12419) — reached `main` on and after
2026-08-26, **after the last release** (17.2.0, tagged 2026-08-23; npm serves 17.2.0). Nothing published
depends on it, so it is **removed before 17.3 is cut** — a revert of #12296, #12419 and the clone action (#12156) — not sealed and carried
([ADR-0049](./0049-no-unenforced-security-properties.md): a shape nobody may use is not shipped
dormant). Clone without disable would in any case be worse than nothing — a cloned flow fires beside the
managed one it copied. Epic #12150 closes as superseded. ADR-0126 D3's "org column reserved, written
NULL" is withdrawn with the ledger. Regime E stands. ADR-0126 carries the amendment note.

**Templates** follow the same two modes: a managed template renders from the registry and is immutable;
a Studio-authored or template-installed template is environment metadata, editable in Studio. There is
no per-organization template override (the door the maintainer chose not to open: 「我宁可先不让他编辑」).
If a measured organization-level pull ever returns, it opens as **copy-on-write** — one org-owned row,
whole-item, `(organization, name, locale)`, *Reset to default* deletes it — never as a seed.

### D7 — Deployment-level state has no organization column; the UI never merges sources server-side

Rows that belong to the deployment and not to an organization live in objects **without** the column
(D1): the environment metadata ledger and its family (`sys_metadata`, `sys_metadata_audit`,
`sys_metadata_commit`, `sys_metadata_history`, environment-level `sys_view_definition` — D6;
`sys_metadata_activation` is reverted before 17.3 and does not return), operational plumbing whose
rows no writer attributes to an organization (`sys_job`, `sys_job_run`, `sys_job_queue`,
`sys_flow_dispatch`, `sys_migration`, `sys_migration_journal`), the audit ledger
(`sys_audit_log`, whose rows may concern deployment-level actions — the organization an audit row is
*about* becomes a plain attribution field under a name the tenant-field resolver does not claim, never
the tenancy anchor; cloud's `tenant_id` rule already reads it this way), and deployment-level runtime
settings — `sys_setting`'s global rung leaves the tenant-scoped table: infrastructure values go to
configuration; a tenant-less object holds only values an operator must change without a restart (ruled
2026-09-04). Such objects are governed by object permission, not by the wall.

⚠️ **Membership in this list is decided by the writer, not by the object's name.** The read-side ledger
grouped `sys_http_delivery`, `sys_inbox_message`, `sys_notification*` and `sys_email` as "plumbing"; the
tree has since decided otherwise for each — #13565 stamps `sys_http_delivery` from the webhook's
organization *because* `redeliver()` walls by tenant, #11741 widened `SendEmailInput` so `sys_email` is
stamped at its producers (#11303 Decision 2), and the notification family is recipient-anchored in
cloud's reading. An object whose writer attributes rows to an organization is tenant data and keeps the
column (NOT NULL, D3); an object no writer attributes is deployment-level and loses it. The C7
inventory records the verdict per object with the writer fact as its citation — this record names only
the objects whose verdict the tree already states.

The #12699 deployment declaration becomes **total**: an object a deployment declares platform-global
gets **no organization column on that deployment** (the injected-columns plan reads the declaration),
so Layer 0 and the driver agree by having nothing to scope. This is how the cloud control plane
expresses that its own settings, metadata and jobs are deployment-level while the same objects are
per-organization on a tenant runtime.

**Presentation** (the lesson of the maintainer's prior platform, where a merged list of in-memory and
database metadata forced search, sort and paging to be re-implemented in application code): no surface
merges sources. The catalog has one source, the registry (D3): Studio lists and edits it; Setup's
position and permission-set pages read the same registry — as an editor under `single` for capability
holders, read-only under a wall — and the assignment pages list the organization's own rows with the
data API's native search, sort and paging. Pickers (assign a user to a position, choose a recipient)
list the registry. Catalogs are tens of items; nothing about them needs a server-side merge.

### D8 — One predicate, computed once

The engine computes the tenant read scope from posture and context — `organization_id = :tenant`
under `isolated`, `IN accessible_org_ids` under `group`
([ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) D2), nothing under `single` —
and threads the **same** value to Layer 0 (`computeTenantLayer0Filter`) and to every driver. No layer
has a NULL arm; no layer has a shared-owner set (there are no shared owners — D2/D7 removed the need).
#10103 cause 1 cannot recur: one input, one predicate. `check-tenant-chokepoint` refuses an
`IS NULL` arm on a tenant column.

### D9 — A missing stamp is a refused write, in every posture

`resolveSystemInsertOrganization` generalizes [ADR-0123](./0123-no-active-organization-session-semantics.md)
D3 to every writer: a write on a tenant-column object with no organization is **derived** under
`single` (the Default Organization is the only one) and **refused** otherwise, with a message naming
what is missing (ADR-0123 D4). ⛔ Nothing defaults to any owner other than the derivable one. The
#13491 classification (`tenant-scoped` / `global` / `unclassified`) becomes structural — column ⇒ in
scope — and its ledger retires (D13).

### D10 — Migration: four fates, loud, per table; mirrors are the one sanctioned deletion

Driven by the inventory the two censuses seed (59 platform + 28 example objects; cloud's supplement
for cloud-declared ones). Every object gets one fate; every row in it follows:

1. **Column dropped** — D7 objects (through the [ADR-0120](./0120-unique-scope-vocabulary-and-null-safe-tenant-uniqueness.md)
   D4 ceremony and an [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) registry entry).
2. **Mirror deleted** — rows that are re-derivable from code and nothing else: seeded catalog copies
   (per-organization and NULL residue alike), seeded templates, seeded capabilities. They are deleted
   **after** every reference to them has been rewritten from row id to name (D4) and the rewrite has
   been verified to resolve. ⚠️ This is the one deletion this record sanctions, and the reason it is
   safe is the reason it is allowed: a mirror carries no information the code does not.
3. **Attributed** — organization-authored and accidental rows take their real organization from a
   parent anchor (`childKey` / `parentObject` / `parentOrgColumn`, the shape
   `backfill-sys-file-organizations.ts`, `plugin-approvals`' `backfill-platform-row-organizations.ts`
   and cloud's `org-id-backfill.ts` share); under `single`, the Default Organization.
4. **Reported** — a row whose owner cannot be derived is left NULL and listed at boot, per table, with
   counts and the remedy. ⛔ Never guessed, never deleted. The NOT NULL constraint lands on a table
   **only when it reports zero NULL rows**.

Template rows an admin has customized (`customized: true`) are the one population the maintainer must
rule on (§6 Q1): keep them readable as the Default Organization's overrides (half of the D6 door), or
accept the loss under the startup posture with a release note.

### D11 — Postures differ only in enforcement

Ownership rules, refusals and constraints are identical under `single`, `group` and `isolated`; only
whether the wall is enforced differs. Degraded tenancy stays a refused boot. `single` is never a
reason for a row to be org-less.

### D12 — The `group` posture, rule by rule

[ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) defines `group` as "organizations =
membership boundaries over one shared dataset". This record does not redefine the posture; it states,
for each of its own decisions, what a group deployment gets. The maintainer asked for the list
(2026-09-04: 「你目前新的 ADR 有重新考虑集团版的规则吗？帮我具体列一下」).

**Unchanged from ADR-0105, restated so nothing is inferred:**

1. **The wall is membership union.** Reads are bounded by `organization_id IN accessible_org_ids`
   (ADR-0105 D2), resolved from the caller's valid memberships; an empty set fails closed. A
   headquarters analyst sees every plant they are a member of, on one screen. This is D8's one
   predicate under `group`, threaded identically to Layer 0 and to every driver — and with **no NULL
   arm**, so a plant's unstamped row can no longer be seen by the whole group.
2. **The active organization is the write target** (ADR-0105 D2/D5): a row written in plant A is owned
   by plant A, NOT NULL (D1/D3).
3. **The org-axis red lines stand** (ADR-0105 D6): no permission inheritance along
   `parent_organization_id`; business-unit trees stay inside one organization. This record adds no
   sharing source and no tree walk (D12, above).
4. **Cross-organization approvals** (ADR-0105 D9): the request row belongs to the plant; a
   headquarters approver reaches it through membership union or the system-context mirror; `$root`
   resolution keeps its single chain walk. Unaffected.
5. **Delegated administration and scoped invitations** (ADR-0105 D8): unaffected.
6. **Layered master data** (ADR-0105 D10): **withdrawn** — 「不考虑集团级模板行，作废相关需求」「不考虑
   分层主数据」. ADR-0105 carries the note. There are no group-shared business rows; a headquarters that
   wants a plant to read its data makes the plant's users members of the organization that owns it.

**What this record decides for `group`:**

7. **One environment, one schema, one catalog.** A group deployment is one environment. Its managed
   packages are sealed (D6); its Studio-authored metadata — objects, views, flows, positions, permission
   sets, templates — is environment-wide and belongs to the deployment, not to any plant (D2/D6). The
   metadata-authoring capability (`manage_metadata` / `studio.access`) is what headquarters IT holds and
   plant admins do not. This is 集团统管 for roles by construction: the group defines positions and
   permission sets once, every plant assigns from the same list (D3/D4).
8. **Plants assign; plants do not define.** A plant admin assigns its members to positions and
   permission sets (org-owned rows, NOT NULL, by name — D3/D4), authors its business units, sharing
   rules and record shares, and manages its data. It cannot create a position, a permission set, a
   capability, a template or any metadata (D3, verbatim ruling 「单库多租户我可以禁止他们创建。但是你要支持我
   绑定到人员」). A plant that needs its own catalog is given its own environment.
9. **No per-plant catalog copies.** #10103 Option C's one-pass-per-organization seeding under `group`
   retires with the seeders (D2/D13); the catalog tables retire (D3). There is nothing to copy.
10. **Template packages are refused; managed only.** A shared-DB deployment accepts only the managed
    install mode (D6): a template import would hand every plant an editable shared schema.
11. **No per-plant overlays and no per-plant template overrides.** ADR-0005's per-organization overlay
    axis is retired (D6); a plant cannot re-word an email template or re-lay a view for itself.
    Presentation customization per plant, if it is ever pulled for, returns as an org-owned overlay
    object (D3 shape), never as a nullable column.
12. **Seeds under `group` must name their organization.** D9 derives an owner only under `single`.
    Application seed datasets on a group deployment carry an explicit `organizationId` (the plant they
    populate) or the load is refused; a system writer without an organization is refused, never
    defaulted (D9). Boot seeds no longer exist (D2), so nothing runs before the organizations do.
13. **Platform standing is configuration.** Under `group` no grant row is written by first-user
    promotion (D5); `OS_PLATFORM_OWNER_EMAIL` and the platform-exclusive capabilities decide who crosses
    the wall (ADR-0095 D3, #12974 for the verified owner). Unchanged, restated.
14. **Deployment-level state has no organization column** (D7) — the environment metadata ledger, the
    audit ledger, operational plumbing, deployment settings. Recipient-anchored objects (a person who is
    a member of several plants has one inbox) are decided by their writer facts in the C7 inventory,
    with cloud's reading — anchor on the person, not on the active organization — as the evidence on
    file.
15. **Migration on a group database.** Existing NULL rows take D10's fates: mirrors deleted, business
    rows attributed to the plant their parent anchor names, unattributable rows reported per table and
    left NULL until an operator resolves them; the NOT NULL constraint lands per table only when that
    table reports zero (D10). Nothing is attributed to a "group root" or to any default plant.

**Costs specific to `group`, stated once:** a plant cannot define its own roles, templates or views
(items 8, 11); a group that wants HQ-authored business data visible in plants expresses it through
membership, not through a shared row (item 6). Both are the startup posture applied to the shared-DB
shape; the escape hatch is an environment per plant.

### D13 — Retirements (ADR-0049)

When D10 reports zero NULL rows on every table: both `orWhereNull` arms and any sibling driver's
equivalent; the seeders and projector of D2; `per-organization-catalog.ts` including
`warnPreFixOrganizationLessRows`; the NULL readings in `resolve-authz-context.ts` (§4, §6, §6a, §6b),
`sharing-rule-service.ts::criteriaContext`, `settings-service.ts`'s global rung,
`meta-write-org-scope.ts`'s NULL layer, `bootstrap-system-capabilities.ts`; the email-template seed
and `email-template-provenance.ts`; the `__global__` sentinel and ADR-0120 D3's `COALESCE`;
`platform-object-tenancy.ts` and `isPlatformObjectOutOfTenantAuditScope`; #12699's stand-down
semantics (replaced by D7's no-column); ADR-0005's org-scoped write path for the five tier-A types;
the catalog objects `sys_position`, `sys_permission_set`, `sys_position_permission_set` and
`sys_capability` (D3 — definitions live in the registry; ADR-0094's projection is no longer needed).
The packaged-flow disable/clone door and `sys_metadata_activation` are **not** on this list because they
do not wait for protocol 18: unreleased, they are removed in C5 before the next release (D6). Each
retirement of an authorable shape is an [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) entry.

### D14 — Staging: one pre-17.3 removal, everything else on the v18 line

Maintainer, 2026-09-04: 「我发 17.3，然后后续这么大的改动应该放到 v18」. Two consequences:

- **Before 17.3 is cut**, the unreleased ADR-0126 flow machinery is reverted (D6; C0). Nothing else of
  this record ships in 17.x. The #13491 tenant-audit ledger (#13635, also unreleased) **may** ship in
  17.3: it is internal protection with no authorable surface, refuses org-less system writes on walled
  postures, and retires in v18 as machinery, not as a contract.
- **Everything else is the v18 line** — one major, one migration: D1's constraint, D2/D3's retirements,
  D4's name references, D6's sealing and template mode, D7's column drops, D8's single predicate, D9's
  refusals, D10's four-fate migration, D13's retirements. Within the line the order of §8 still holds
  (C1–C6 before C7 before C8), and the migration keeps its per-table gate (D10) — the customer database
  is never asked to satisfy a constraint its report has not cleared. The driver arms are removed in the
  same major, after C7. ⛔ No 17.x card narrows or removes an arm, adds a name column beside an id
  column, or ships a half of this record.

Doing it in one major rather than additively across 17.x avoids carrying dual id/name columns, a
registry-first-then-rows resolution, and a sealed-but-present flow ledger through a public release —
compatibility shims for a shape nobody has used yet.

---

## 3. Non-goals

- **Changing what a tenant can see or do.** Declared items remain visible to every organization (they
  are code); organizations keep creating their own items and cloning declared ones. Only the
  mechanism moves.
- **Opening any editing door.** D6 closes template editing and adds no new customization surface;
  copy-on-write is the *shape* a future door takes, not a commitment to build one.
- **A platform organization** in any form (§1.5, §5).
- **Group-level shared business rows** (D12; ADR-0105 D10 withdrawn, not deferred).
- **better-auth-managed tables** — no tenant column; untouched.
- **Reaping data.** The only deletion is D10 fate 2, mirrors re-derivable from code.
- **cloud's environment- and invoice-anchored scope rules** — they stay; only ownership changes.

---

## 4. Consequences

**What becomes true.**

- A forgotten stamp is a refused write (D9) and then a constraint violation (D1); the cloud#1239
  class is closed structurally.
- Nothing is seeded, per tenant or otherwise; a fresh deployment's catalog tables are empty; upgrades
  need no reconciliation pass and leave no residue; a removed declaration fails loudly instead of
  granting from a zombie mirror (D4).
- The two doctrines of §1.4 collapse into one (registry-authoritative, rows only when authored).
- One predicate in one place (D8); ADR-0120 D3's NULL-safe uniqueness becomes plain per-organization
  uniqueness; #14547's class (a service open-coding the strict equality and losing seeded rows) has
  nothing left to lose.
- #13564's three options are all moot: the arm is retired with its reason, not narrowed.

**What it costs.**

- **Reference columns move from id to name** (D4): `sys_user_position`, `sys_user_permission_set`,
  sharing recipients, grants — a schema migration with an id→name rewrite over existing rows, and the
  verified rewrite is the precondition of D10 fate 2.
- **Four catalog objects retire** (D3/D13): `sys_position`, `sys_permission_set`,
  `sys_position_permission_set`, `sys_capability`. Every reader of those tables — authorization
  resolution, hierarchy security, delegated admin, sharing recipients, the Setup pages — moves to the
  registry. The read-side ledger counted the tenant-threaded readers; the bare-context readers are the
  larger population and are enumerated by C2.
- **Setup changes shape** (D7): its catalog pages become registry views (editors under `single`,
  read-only under a wall); its assignment pages stay data pages. No server-side merge is built.
- **Tenants of a shared-DB deployment lose catalog authoring** they nominally have today (creating a
  position or set in Setup). They keep assignment. A tenant that needs its own catalog gets its own
  environment.
- **Organization-level template editing is unavailable** (D6); existing customized template rows
  need a ruling (§6 Q1). Studio-authored and template-installed templates remain editable in Studio.
- **Deployment-level settings leave `sys_setting`** (D7): configuration or a tenant-less object.
- **`sys_metadata` loses its organization column and ADR-0005's per-organization overlay axis is
  retired** (D6): org-scoped writes of the five tier-A types are refused; the identity pin, the layered
  read in `metadata-protocol` (`getMetaItem`), `meta-write-org-scope.ts`, the ADR-0094 write-through and
  `sys-metadata-repository.ts` all simplify. A live feature is switched off; the maintainer confirms it
  in §6 Q6.
- **Managed content is sealed** (D6): ADR-0126's disable/clone machinery for packaged flows (#12158,
  #12156, #12419) is removed before the next release — it never shipped (landed after the 17.2.0 tag),
  so recently landed work is deleted rather than published dormant.
- **The template install mode is new work** (D6): a manifest declaration of permitted modes, a
  one-time importer into the environment ledger, and the posture refusal on `group` / `isolated`.
- Tests pinning NULL semantics and seeded rows are rewritten (`deal_p1`, `sql-driver-tenant-scope`,
  `memory-tenancy-guard`, `rule-criteria-org-scope`, `per-organization-catalog`,
  `bootstrap-declared-email-templates`, cloud's `unscoped-control-plane-tenant-wall`).

**Risks.**

- A writer defaulting a missing organization to *something* to silence a refusal. D9 forbids it; the
  boot report shows the pile reforming.
- A name reference outliving its declaration. D4 fails closed and reports; the report is the control.
- The Default Organization bootstrap failing under `single`. D3 makes it a boot error.
- A surface quietly re-introducing a merged, paged list of two sources. D7 names the pattern and
  refuses it; the objectui card carries the rule.

---

## 5. Alternatives considered

| Alternative | Why not |
|---|---|
| **Keep the arm; per-object scope rules above the driver** (#13564 option a) | Keeps NULL's double meaning; every new writer inherits fail-open; repairs are per table after a measurement. Rejected by the maintainer in terms. |
| **Narrow the arm to declared-global objects / switch on posture** (options b, c) | Keeps two predicates and NULL's meaning under `single`; blanks #12699 objects or revokes pre-fix grants silently; would have kept the arm on cloud#1239's degraded posture. |
| **A platform organization owning deployment-level rows** (this record's first draft) | Gives NULL a new name instead of removing it; keeps every mixed table mixed; adds an organization every enumerator special-cases; puts business editing behind platform standing. The maintainer's model removes the need. |
| **Per-organization seeded read-only mirrors of the declared catalog** (today under a wall; Salesforce-style managed components) | Copies immutable code into N tables to be read back; needs boot reconciliation, residue guards and provenance columns; is exactly the "既然不让改，又每个租户 seed 一遍" the maintainer rejected. |
| **Read-time overlay of code and database metadata for the same item** (the maintainer's prior platform; ADR-0005's mechanism) | Field-level precedence ambiguity, silent drift on upgrade, no way to delete a code item from the database, merged lists that re-implement search/sort/paging. D4 avoids it by keeping the sets disjoint and unioned by name; D7 avoids it by never merging lists server-side. |
| **A string sentinel (`__global__`) as owner** | Breaks the FK to `sys_organization`; every layer special-cases it forever (ADR-0120 D3's COALESCE is the running cost). |
| **Declare a legitimately org-less write per call** (#13636 option B, draft PR #14923) | Makes NULL a *declared* state instead of removing it; every future writer of a conditionally-scoped object must know to declare; the column stays nullable, so the constraint D1 wants can never land. Superseded by taking the column off the objects whose rows are legitimately org-less (§1.6). |
| **An organization-level catalog beside the environment one** (this record's second draft: tenant-created positions and sets as org-owned rows, pickers unioning registry and rows) | Two sources at selection time, a uniqueness check spanning both, a resolution order — three costs paid so that a tenant of a shared-DB deployment can define its own roles, a need no customer has stated. Deferred: if it arrives, it returns as an org-owned catalog object (the same shape), never as rows in a nullable-column table. |
| **Keep ADR-0126's overlay and disable + clone regimes live for managed content** | Each regime is a per-type customization mechanism with its own ledger, walls and UI; under the startup posture the maintainer chose one switch (the install mode) over three mechanisms. Regime E stays because it costs nothing (a package). Paused, not rejected: the regimes return only on a measured pull, and never through a nullable tenant column. |

---

## 6. Open questions for the maintainer's merge decision

Four of the five questions this draft carried were **accepted as proposed** on 2026-09-04 (「接受你的建议」)
and are now part of the decisions: the `single`-posture first-user grant row is owned by the Default
Organization (D5); the package **declares** the install modes it permits (`installModes`, default
`['managed']`), the installer picks one, and a shared-DB multi-tenant deployment refuses `template`
whatever the package permits (D6); deployment-level settings go to configuration, with a tenant-less
object only for values an operator must change without a restart (D7); ADR-0005's per-organization
overlay axis is retired (D6). One remains:

1. **Existing customized template rows** (D10): keep readable as the Default Organization's overrides
   (builds the read half of a copy-on-write door now), or accept the loss under the startup posture
   with a release note? Depends on whether any deployment relies on the feature — this record cannot
   see that; the maintainer rules it when the C4 card is cut.

## 7. Verification notes

**The post-17.2 audit (2026-09-04, maintainer: 「查 17.2 之后的修改就可以」).** Every merged change between the
17.2.0 tag (2026-08-23) and `origin/main` touching organization ownership was read, with a mechanical
scan of the unreleased diff for newly added NULL-tolerant reads (`organization_id: null`, `IS NULL`,
`orWhereNull`, `$or … null`); the scan's positive control is that it found the ADR-0126 machinery.
Verdicts: **revert before 17.3** — the ADR-0126 flow/action disable + clone machinery (#12185, #12190,
#12296, #12348, #12419, framework half of #12491; card #15024) and the NULL-inclusive business-unit
screen added by #14949 (its strict member screen stays; card #15030); **ship in 17.3, retire in v18 as
machinery** — the #13491 ledger (#13635, #13584), per-organization catalog resolution (#13818),
seed-ownership batching (#14718, #14687), ADR-0120 D3's COALESCE shadow (#13016), the capability lookup
batching (#11537), the deployment platform-global declaration (#12704); **consistent, keep** — every
stamp-and-backfill repair (#12929, #13180, #13527, #13572, #13565, #14726) and #14635, #13685, #14129;
**closed unmerged** — PR #14923. Pre-17.2 behaviour (Choice 4A's NULL grant row, the legacy grant anchor,
#10103 Option C, ADR-0005 overlays) is out of the audit's scope and moves in v18.

- The issue body of #13564 cites the arm at `sql-driver.ts:7320`; on `origin/main` `2514d49f3` the
  arms are inside `applyTenantScope` (~12016–12066) and there are **two**. This record cites symbols.
- `ensure-default-organization.ts` cites "ADR-0081 D1" for the Default Organization; in this
  repository `docs/adr/0081` is the trusted React page tier — the "0081" is cloud's numbering. The
  framework record is [ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md).
- `resolve-authz-context.ts` already resolves positions **by name** (`{ name: { $in: grants.positions } }`
  against `sys_position`); D4 changes where that lookup goes first, not what it is keyed on.
- `template-loader.ts` resolves by `(name, locale)`; a grep for `organization` / `tenant` in it returns
  nothing — templates are deployment-wide today, which is what makes "close the door" behaviour-neutral
  for every organization that never edited one.
- `driver-memory` and `driver-mongodb` carry tenancy **guards** keyed on `tenancy.enabled === true`,
  not a NULL-armed predicate; D8 holds every driver to the one computed predicate, and each driver's
  actual behaviour is measured by its card, not assumed here.

---

## 8. Execution plan (cards are cut from the merged record)

One epic tracks the family. C0 lands before 17.3; every other card is on the **v18** line (D14), in this order.

| # | Card | Decisions | Blocked by |
|---|---|---|---|
| C0 | Revert the unreleased ADR-0126 flow machinery (#12296, #12419, #12156) so 17.3 does not publish it | D6, D14 | ADR merge; **before 17.3** |
| C1 | Default Organization load-bearing under `single` and created before application seed datasets load; the seed loader stamps every seed (the `sys_` exemption withdrawn); `resolveSystemInsertOrganization` derives it, refuses elsewhere | D3, D9, D11 | ADR merge |
| C2 | Catalog resolution reads the registry; assignment tables reference by name (id→name columns + rewrite); dangling-name boot report; every reader of the four catalog tables enumerated and converted | D2, D3, D4 | ADR merge |
| C3 | Retire the seeders, the per-organization catalog machinery and the four catalog objects; built-ins and audience anchors as declared metadata; Setup catalog creation = environment metadata write under `single`, refused under a wall; platform-admin grant row owned by the Default Organization | D2, D3, D5, D13 | C1, C2 |
| C4 | Templates: `sendTemplate` resolves the registry; seed and provenance stamp retired; door closed; customized-rows ruling applied | D6, D10 | ADR merge (+ §6 Q1) |
| C5 | `sys_metadata` family tenant-less (environment definitions, UI-editable by metadata authors); per-organization overlay axis retired (org-scoped writes of the five tier-A types refused); managed content sealed — the unreleased packaged-flow disable/clone machinery and `sys_metadata_activation` **removed before the next release**; ADR-0005 and ADR-0126 amended | D6, D7 | C1 |
| C12 | Template install mode: manifest `installModes`, one-time import into the environment ledger with provenance, refusal on `group` / `isolated`, CLI + marketplace surfaces | D6 | C5 |
| C6 | Deployment-level state has no column: settings global rung leaves `sys_setting`; plumbing objects drop the column; #12699 declaration made total | D7 | ADR merge (+ §6 Q3) |
| C7 | Inventory + migration: four fates, id→name rewrite verified before mirror deletion, per-table boot report | D10 | C2, C3, C4, C5, C6 |
| C8 | One predicate; NOT NULL per cleared table; every-posture refusal; both arms and the ledger retired — protocol 18 | D1, D8, D9, D13, D14 | C7 |
| C9 | objectui: Setup catalog pages read the registry (editor under `single`, read-only under a wall); assignment pages stay data pages; pickers list the registry; Studio lists and edits environment metadata | D3, D7 | C2 |
| C10 | cloud: control plane and objectos-ee adopt the record (per-deployment no-column, backfill, tests) | D7, D8, D10 | C6, then C8 |
| C11 | Docs and card-family close-out (#13564, #11611, #10103 posture; #13636 superseded, PR #14923 closed unmerged) | — | C8, C10 |

⛔ Rules every card inherits: no card touches the driver's arms before C8; no writer ever defaults a
missing organization to anything but the derivable Default Organization; no deletion except D10
fate 2 after a verified rewrite; no surface builds a merged server-paged list of two sources;
`content/docs/releases/` is never edited in a code PR.

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
  [#13636](https://github.com/objectstack-ai/objectstack/issues/13636) (PR #14923) ·
  [#6190](https://github.com/objectstack-ai/objectstack/issues/6190) ·
  [#8844](https://github.com/objectstack-ai/objectstack/issues/8844) ·
  [#13514](https://github.com/objectstack-ai/objectstack/issues/13514) ·
  [#4509](https://github.com/objectstack-ai/objectstack/issues/4509) · cloud#1020 · cloud#1232 ·
  cloud#1239 · cloud#1257 · cloud#1663 · cloud#1664.
- Records: [ADR-0005](./0005-metadata-customization-overlay.md) ·
  [ADR-0049](./0049-no-unenforced-security-properties.md) · [ADR-0066](./0066-unified-authorization-model.md) ·
  [ADR-0078](./0078-no-silently-inert-metadata.md) · [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) ·
  [ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) · [ADR-0094](./0094-sys-permission-set-pure-projection.md) ·
  [ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) ·
  [ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) ·
  [ADR-0120](./0120-unique-scope-vocabulary-and-null-safe-tenant-uniqueness.md) ·
  [ADR-0123](./0123-no-active-organization-session-semantics.md) ·
  [ADR-0126](./0126-packaged-metadata-customization-model.md) · [ADR-0129](./0129-object-name-is-the-canonical-id.md).
- Code (framework, `origin/main` `2514d49f3`): `packages/drivers/driver-sql/src/sql-driver.ts`
  (`applyTenantScope`); `packages/objectql/src/engine.ts` (`buildDriverOptions`);
  `packages/objectql/src/tenancy/system-write-organization.ts`;
  `packages/objectql/src/tenancy/platform-object-tenancy.ts`;
  `packages/plugins/plugin-security/src/tenant-layer.ts`;
  `packages/plugins/plugin-security/src/per-organization-catalog.ts`;
  `packages/plugins/plugin-security/src/bootstrap-declared-permissions.ts`;
  `packages/plugins/plugin-security/src/bootstrap-declared-positions.ts`;
  `packages/plugins/plugin-security/src/bootstrap-builtin-positions.ts`;
  `packages/plugins/plugin-security/src/bootstrap-system-capabilities.ts`;
  `packages/plugins/plugin-security/src/bootstrap-platform-admin.ts`;
  `packages/plugins/plugin-security/src/permission-set-projection.ts`;
  `packages/plugins/plugin-security/src/packaged-permission-set-lock.ts`;
  `packages/plugins/plugin-auth/src/ensure-default-organization.ts`;
  `packages/core/src/security/resolve-authz-context.ts`;
  `packages/plugins/plugin-email/src/bootstrap-declared-email-templates.ts`;
  `packages/plugins/plugin-email/src/email-template-provenance.ts`;
  `packages/plugins/plugin-email/src/template-loader.ts`;
  `packages/metadata-core/src/meta-write-org-scope.ts`;
  `packages/spec/src/data/injected-system-columns.ts`; `scripts/check-tenant-chokepoint.mjs`.
- Code (cloud, `main` `3856fbf7`): `packages/service-cloud/src/control-plane-platform-global.ts`;
  `packages/service-cloud/src/control-plane-org-scope-plugin.ts`;
  `packages/service-cloud/src/migrations/org-id-backfill.ts`;
  `apps/cloud/test/unscoped-control-plane-tenant-wall.test.ts`.
