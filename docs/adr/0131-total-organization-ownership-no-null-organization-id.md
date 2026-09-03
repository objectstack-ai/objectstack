# ADR-0131: Organization ownership is total — no NULL `organization_id`; declared metadata stays in code; a row exists only when an organization authored it

**Status**: Proposed (2026-09-04) — awaiting the maintainer's hand-merge, which is itself the
acceptance act for a governed surface (Prime Directive #14). ⛔ Nothing below is settled until
this record merges; the implementation cards are cut **from** the merged ADR, never ahead of it.
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
保存在库中，可以在界面上修改，包括 ../cloud build agent 构建的元数据，因为也是保存在库中，可以在界面上修改。」
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
stamping — generalized by D9), [ADR-0129](./0129-object-name-is-the-canonical-id.md) D1 (the `name`
is the canonical id — extended by D4 to catalog items).
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

1. **Metadata is the registry, and the registry has two provenances.** Code-declared metadata —
   objects, fields, views, and equally positions, permission sets, capabilities, declared sharing
   rules, email and notification templates — is edited **in code only** and is **never materialized
   as rows**; there is nothing to seed, per tenant or otherwise. Metadata authored at runtime in
   Studio or by the cloud build agent is **saved in the database and edited in the UI**; it is the
   environment's, not any organization's, and its ledger carries **no organization column**. Both
   provenances are cross-tenant by nature: every organization runs the same schema.
2. **A row with an organization column exists only when an organization authored it** — a position an
   admin created in Setup, a set they cloned, an assignment they made. Every such row carries its
   organization, NOT NULL. Registry items are referenced **by name**, the way ADR-0129 already treats
   objects.
3. **A table with no organization column is deployment-level or code-level**, governed by permission,
   not by a wall. There is no third shape.

Consequences: NULL has nothing left to mean (D1); the driver's NULL arm and Layer 0's strict
equality stop disagreeing because there is one predicate (D8); a forgotten stamp is a refused write
(D9); the seeders, the per-organization catalog machinery and the #13491 ledger retire (D13); runtime
editing of declared templates stays **closed** until an organization asks, and opens — if ever — as
copy-on-write, never as a seed (D6). Startup posture throughout: the stable answer, not the
feature-complete one.

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

This retires: `bootstrapBuiltinRoles`, `bootstrapDeclaredPositions`, `bootstrapDeclaredPermissions`,
`bootstrapDeclaredSharingRules`, `bootstrapSystemCapabilities`, `bootstrapPlatformAdmin`'s
`defaultPermissionSets` materialization, `bootstrapDeclaredEmailTemplates`, `seedTemplates`, the
`sys_permission_set` projector and reconciler of [ADR-0094](./0094-sys-permission-set-pure-projection.md)
D2/D4 (D1 of that record stands and is generalized; its projection is no longer needed), and the whole
per-organization catalog machinery (`per-organization-catalog.ts`, #10103 Option C) — there is
nothing left to copy per organization.

### D3 — A row exists only when an organization authored it

The tables that hold catalog-shaped data (`sys_position`, `sys_permission_set`,
`sys_position_permission_set`, `sys_user_position`, `sys_user_permission_set`, `sys_capability`,
`sys_sharing_rule`, `sys_record_share`, `sys_email_template`, `sys_notification_template`, …) hold
**only what an organization wrote**: positions and sets an admin created (including clones of declared
ones), capabilities they defined, rules they authored, assignments and bindings they made, and — when
a door is open (D6) — overrides they saved. Every such row carries the authoring organization, NOT
NULL.

Under `single` the authoring organization is the Default Organization
([ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md); `ensure-default-organization.ts`), which
becomes **load-bearing**: it exists before the first authenticated write (today it is created on
`kernel:ready` best-effort; a failure becomes a boot error). Because nothing is seeded, no boot-order
inversion is needed — the organization only has to exist before a person acts.

An organization has no rows until it authors something. A fresh deployment with ten organizations
and no customization has an **empty** catalog table.

### D4 — Declared items are referenced by name; resolution is registry-first

[ADR-0129](./0129-object-name-is-the-canonical-id.md) made the object `name` the canonical id; this
record extends the principle to catalog items. A declared position or permission set has no row id,
so every reference to a catalog item — `sys_user_position`, `sys_position_permission_set`, sharing
recipients, grants — names it by its machine name, which is already unique per organization and,
for declared names, reserved across the deployment (an organization may not create an item whose
name a declaration holds; the uniqueness check spans registry and rows).

Resolution is **registry first (both provenances — code-declared and environment-authored), then the
caller's organization's rows**. `resolve-authz-context.ts` already looks positions up by name
(`grants.positions`); the change is where it looks first. A name
that resolves nowhere — a declaration removed or renamed in code — **fails closed** for that reference
and is **reported at boot** per organization, by name. This is loud where today's behaviour is a
zombie: a seeded mirror of a removed declaration stays in the table and keeps granting.

The registry and the organization's rows are **disjoint sets unioned by name**, not two definitions
of one item merged field by field. That distinction is what keeps the read-time-merge failures of the
overlay model (§5) out of this design.

### D5 — Platform standing is configuration, or a Default-Organization row under `single`

`PLATFORM_ADMIN` derives from `OS_PLATFORM_OWNER_EMAIL` (#13514 L4) — configuration, not a row. The
`single`-posture first-user promotion (Choice 4A), which today writes an `admin_full_access` grant row
with a NULL organization, writes it **owned by the Default Organization** instead; under a walled
posture no grant row is written (unchanged). `reportLegacyPlatformAdminGrant` and the legacy unscoped
anchor retire with D13. No NULL grant row is ever produced.

### D6 — Editability follows provenance; the environment ledger has no organization column

**Code-provenance metadata is edited in code.** No runtime door edits a declared item — not Setup, not
Studio, not the data API. The catalog's customization path is the 2026-08-24 one, **clone** (create an
org-owned row from a declaration, D3), and the environment's is **author** (create environment
metadata in Studio, below).

**Environment-provenance metadata is edited in the UI.** What Studio or the cloud build agent wrote
into `sys_metadata` is theirs to change there, on every posture, by anyone holding the
metadata-authoring capability. This is [ADR-0005](./0005-metadata-customization-overlay.md)'s
environment layer, kept — and re-homed: **`sys_metadata` is the environment definition ledger and
carries no organization column** (D1/D7). It holds every type not `allowOrgOverride` and the
environment-level rows of the five overridable types. Per-organization overlays of those five
presentational types (`view`, `dashboard`, `report`, `translation`, `email_template`) are
organization-authored D3 rows and live in their **own** org-owned object, not beside environment rows
in a nullable column. ADR-0005 is amended accordingly; its "no overlay row = the registry" reading and
its overlay-wins resolution are unchanged. Under `single` the split is invisible in behaviour (one
environment, one organization); under a wall it is what makes environment metadata deployment-level
without an owner and organization overlays walled without a NULL arm.

**Organization-level editing of declared templates stays closed.** Templates are the one class where
runtime editing by an *organization* is a stated requirement; the maintainer's startup posture is to
not open that door until an organization asks: `sendTemplate` resolves the registry (code-declared or
Studio-authored); no per-organization template row exists. If and when the door opens, it opens as
**copy-on-write**, never as a seed: the editor pre-fills the registry template; *Save* writes one row
owned by that organization; resolution becomes `(organization, name, locale)` with the org row winning
**whole** (no field-level merge); *Reset to default* deletes the row; a registry template removed
leaves an orphan override that the boot report names. The same shape serves any other class that later
earns an organization-level door.

### D7 — Deployment-level state has no organization column; the UI never merges sources server-side

Rows that belong to the deployment and not to an organization live in objects **without** the column
(D1): the environment metadata ledger and its family (`sys_metadata`, `sys_metadata_audit`,
`sys_metadata_commit`, `sys_metadata_history`, `sys_metadata_activation`, environment-level
`sys_view_definition` — D6), operational plumbing (`sys_job`, `sys_job_run`, `sys_job_queue`,
`sys_flow_dispatch`, `sys_http_delivery`, `sys_migration`, `sys_migration_journal`, and the
recipient-anchored notification/inbox family where `user_id` is the anchor), the audit ledger
(`sys_audit_log`, whose rows may concern deployment-level actions — the organization an audit row is
*about* becomes a plain attribution field under a name the tenant-field resolver does not claim, never
the tenancy anchor; cloud's `tenant_id` rule already reads it this way), and deployment-level runtime
settings — `sys_setting`'s global rung leaves the tenant-scoped table for configuration or a
tenant-less object. Such objects are governed by object permission, not by the wall.

The #12699 deployment declaration becomes **total**: an object a deployment declares platform-global
gets **no organization column on that deployment** (the injected-columns plan reads the declaration),
so Layer 0 and the driver agree by having nothing to scope. This is how the cloud control plane
expresses that its own settings, metadata and jobs are deployment-level while the same objects are
per-organization on a tenant runtime.

**Presentation** (the lesson of the maintainer's prior platform, where a merged list of in-memory and
database metadata forced search, sort and paging to be re-implemented in application code): no surface
promises **one merged, server-paged list** of declared and organization-authored items. Studio lists
declared items from the registry; Setup lists the organization's rows with the data API's native
search, sort and paging, plus a *Clone from package* action that reads the registry; pickers
(assignments, bindings, recipients) union the two **small** sets client-side. Declared catalogs are
tens of items; nothing about them needs a server.

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

### D12 — The `group` posture: no group-shared business rows; the org-axis red lines stand

[ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) D10 — layered master data
(group template rows shared down an organization tree) — is **withdrawn** by the maintainer (verbatim:
「不考虑集团级模板行，作废相关需求」「不考虑 分层主数据」); ADR-0105 carries the note. Under `group` there
is exactly one kind of cross-organization visibility, membership union (D2 of that record); D6's red
lines (no permission inheritance along `parent_organization_id`; business-unit trees stay
org-internal) are untouched, and this record adds no sharing source of any kind. The catalog needs no
per-organization copies under `group` either — D2 applies; a headquarters-authored position is an
ordinary org-owned row of the headquarters.

### D13 — Retirements (ADR-0049)

When D10 reports zero NULL rows on every table: both `orWhereNull` arms and any sibling driver's
equivalent; the seeders and projector of D2; `per-organization-catalog.ts` including
`warnPreFixOrganizationLessRows`; the NULL readings in `resolve-authz-context.ts` (§4, §6, §6a, §6b),
`sharing-rule-service.ts::criteriaContext`, `settings-service.ts`'s global rung,
`meta-write-org-scope.ts`'s NULL layer, `bootstrap-system-capabilities.ts`; the email-template seed
and `email-template-provenance.ts`; the `__global__` sentinel and ADR-0120 D3's `COALESCE`;
`platform-object-tenancy.ts` and `isPlatformObjectOutOfTenantAuditScope`; #12699's stand-down
semantics (replaced by D7's no-column). Each retirement of an authorable shape is an
[ADR-0087](./0087-metadata-protocol-upgrade-contract.md) entry.

### D14 — Staging

**17.x, additive**: the Default Organization made load-bearing (D3); registry-first resolution and
name-keyed references added beside the id columns (D4); refusals behind the existing #13491 gate (D9);
D7's no-column declarations; the D10 inventory and attribution migration; the template door closed
(D6). The driver arms stay as the compatibility path. **Protocol 18**: NOT NULL, every-posture
refusal, mirror deletion, arm removal, retirements (D1/D9/D10/D13), in the staging
[ADR-0120](./0120-unique-scope-vocabulary-and-null-safe-tenant-uniqueness.md) D7 set. Until D13 runs,
⛔ no card narrows or removes an arm.

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

- **Reference columns move from id to name** (D4): `sys_user_position`, `sys_position_permission_set`,
  sharing recipients, grants — a schema migration with an id→name rewrite over existing rows, and the
  verified rewrite is the precondition of D10 fate 2.
- **Resolution changes at the measured sites** — the read-side ledger counted them: three objects with
  tenant-threaded reads, plus the store helpers — from row lookup to registry-first lookup.
- **Setup, Studio and pickers change** (D7): Setup drops the declared rows it used to list, gains
  *Clone from package*; pickers read two sources. No server-side merge is built.
- **Organization-level template editing is unavailable** until an organization asks (D6); existing
  customized template rows need a ruling (§6 Q1). Studio-authored templates remain editable in Studio.
- **Deployment-level settings leave `sys_setting`** (D7): configuration or a tenant-less object.
- **The metadata ledger splits** (D6): `sys_metadata` loses its organization column and becomes the
  environment definition ledger; per-organization overlays of the five presentational types move to
  an org-owned object. This touches the layered read in `metadata-protocol` (`getMetaItem`),
  `meta-write-org-scope.ts`, the ADR-0094 write-through, the ADR-0126 activation ledger, and
  `sys-metadata-repository.ts` — the largest single item in the plan, and the reason C5 is its own card.
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

---

## 6. Open questions for the maintainer's merge decision

1. **Existing customized template rows** (D10): keep readable as the Default Organization's overrides
   (builds the read half of the D6 door now), or accept the loss under the startup posture with a
   release note? Depends on whether any deployment relies on the feature — this record cannot see that.
2. **`single`-posture first-user promotion** (D5): grant row owned by the Default Organization
   (proposed), or configuration only (`OS_PLATFORM_OWNER_EMAIL` becomes mandatory for self-hosters)?
3. **Deployment-level settings** (D7): configuration file/environment, or a tenant-less
   `sys_platform_setting` object? Proposed: configuration for infrastructure values, a tenant-less
   object only for values an operator must change without a restart.
4. **Staging** (D14): confirm the 17.x / protocol 18 boundary aligned with ADR-0120 D7.
5. **The metadata ledger split** (D6): one object losing its column plus a new org-owned overlay
   object is the shape this record proposes; the alternative — keep one `sys_metadata` and make the
   five overridable types the only rows with an organization — cannot satisfy D1 (a nullable column).
   Confirm the split, or rule that per-organization overlays are retired for now (startup posture),
   which would make `sys_metadata` tenant-less with no second object.

---

## 7. Verification notes

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

One epic tracks the family. Phases 1–3 are additive (17.x); phase 4 is protocol 18.

| # | Card | Decisions | Blocked by |
|---|---|---|---|
| C1 | Default Organization load-bearing under `single`; `resolveSystemInsertOrganization` derives it, refuses elsewhere | D3, D9, D11 | ADR merge |
| C2 | Registry-first catalog resolution; references by name (id→name columns + rewrite); dangling-name boot report; cross-source uniqueness | D2, D4 | ADR merge |
| C3 | Retire the seeders and the per-organization catalog machinery; built-ins and audience anchors as declared metadata; platform-admin grant row owned by the Default Organization | D2, D5, D13 | C1, C2 |
| C4 | Templates: `sendTemplate` resolves the registry; seed and provenance stamp retired; door closed; customized-rows ruling applied | D6, D10 | ADR merge (+ §6 Q1) |
| C5 | Metadata ledger split: `sys_metadata` family tenant-less (environment definitions, UI-editable by metadata authors); per-organization overlays of the five presentational types in an org-owned object; ADR-0005 amended | D6, D7 | C1 |
| C6 | Deployment-level state has no column: settings global rung leaves `sys_setting`; plumbing objects drop the column; #12699 declaration made total | D7 | ADR merge (+ §6 Q3) |
| C7 | Inventory + migration: four fates, id→name rewrite verified before mirror deletion, per-table boot report | D10 | C2, C3, C4, C5, C6 |
| C8 | One predicate; NOT NULL per cleared table; every-posture refusal; both arms and the ledger retired — protocol 18 | D1, D8, D9, D13, D14 | C7 |
| C9 | objectui: Setup lists org rows + *Clone from package*; Studio lists declared; pickers dual-source client-side; no merged server list | D7 | C2 |
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
  [ADR-0123](./0123-no-active-organization-session-semantics.md) · [ADR-0129](./0129-object-name-is-the-canonical-id.md).
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
